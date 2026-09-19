import {
  OFFLINE_LICENSE_GRACE_DAYS,
  PRICE_DISCLOSURE_MAX_AGE_DAYS,
  STORE_PRODUCT,
  type LaunchHostLocale,
} from "./product-identity.ts";
import {
  type DurableStoreLicense,
  type DurableStoreProduct,
  type NativeStoreContextBridge,
  type StoreFailureCode,
  type StorePriceSnapshot,
  validateBridgeReadiness,
  validateDurableLicense,
  validateDurableProduct,
} from "./store-bridge.ts";

const DAY_MS = 86_400_000;
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;

export type EngineEntitlement = {
  kind: "FREE" | "LIFETIME";
  source: "LOCAL_FREE" | "MICROSOFT_STORE" | "TEST";
  verifiedAt: string;
};

export interface EntitlementEnginePort {
  snapshot(): { entitlement: EngineEntitlement };
  setEntitlement(entitlement: EngineEntitlement): void;
}

export interface LifetimeReceiptCache {
  schemaVersion: 1;
  inAppOfferToken: "lifetime_unlock";
  addOnStoreId: string;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  lastSeenAt: string;
  price?: StorePriceSnapshot;
}

export interface EntitlementCacheStore {
  /** Implementations must protect this record against local tampering. */
  load(): Promise<LifetimeReceiptCache | undefined>;
  save(value: LifetimeReceiptCache): Promise<void>;
  clear(): Promise<void>;
}

export interface ProductPriceCache {
  schemaVersion: 1;
  inAppOfferToken: "lifetime_unlock";
  addOnStoreId: string;
  price: StorePriceSnapshot;
  lastSeenAt: string;
}

export interface PriceCacheStore {
  load(): Promise<ProductPriceCache | undefined>;
  save(value: ProductPriceCache): Promise<void>;
  clear(): Promise<void>;
}

export type EntitlementVerification =
  | "STORE_VERIFIED"
  | "OFFLINE_GRACE"
  | "FREE"
  | "VERIFICATION_REQUIRED";

export interface CommerceSnapshot {
  entitlement: "FREE" | "LIFETIME";
  verification: EntitlementVerification;
  price?: StorePriceSnapshot;
  lastVerifiedAt?: string;
  offlineGraceEndsAt?: string;
  messageKey:
    | "purchase.status.free"
    | "purchase.status.lifetime"
    | "purchase.status.offlineGrace"
    | "purchase.status.verificationRequired"
    | "purchase.restore.notFound";
  canStartNewLivePrint: boolean;
  canResolveQueuedPrint: true;
}

export type CommerceActionResult =
  | { status: "PURCHASED" | "RESTORED"; snapshot: CommerceSnapshot }
  | { status: "ALREADY_OWNED"; snapshot: CommerceSnapshot }
  | { status: "CANCELLED"; snapshot: CommerceSnapshot }
  | { status: "NOT_OWNED"; snapshot: CommerceSnapshot }
  | {
      status: "FAILED";
      errorCode: StoreFailureCode;
      retryable: boolean;
      snapshot: CommerceSnapshot;
    };

export interface EntitlementCoordinatorOptions {
  now?: () => Date;
  offlineGraceDays?: number;
  priceMaxAgeDays?: number;
}

function validInstant(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function validPriceSnapshot(value: unknown): value is StorePriceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<StorePriceSnapshot>;
  return (
    typeof candidate.formattedPrice === "string" &&
    candidate.formattedPrice.trim().length > 0 &&
    candidate.formattedPrice.length <= 100 &&
    (candidate.currencyCode === undefined ||
      typeof candidate.currencyCode === "string") &&
    typeof candidate.fetchedAt === "string" &&
    validInstant(candidate.fetchedAt)
  );
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * DAY_MS).toISOString();
}

function isClockRollback(lastSeenAt: string, now: Date): boolean {
  return now.getTime() + CLOCK_ROLLBACK_TOLERANCE_MS < Date.parse(lastSeenAt);
}

function withinDays(value: string, now: Date, days: number): boolean {
  const age = now.getTime() - Date.parse(value);
  return age >= -CLOCK_ROLLBACK_TOLERANCE_MS && age <= days * DAY_MS;
}

function validReceipt(
  receipt: LifetimeReceiptCache | undefined,
  addOnStoreId: string,
): receipt is LifetimeReceiptCache {
  return Boolean(
    receipt &&
      receipt.schemaVersion === 1 &&
      receipt.inAppOfferToken === STORE_PRODUCT.lifetimeAddOn.inAppOfferToken &&
      receipt.addOnStoreId === addOnStoreId &&
      validInstant(receipt.firstVerifiedAt) &&
      validInstant(receipt.lastVerifiedAt) &&
      validInstant(receipt.lastSeenAt) &&
      Date.parse(receipt.firstVerifiedAt) <= Date.parse(receipt.lastVerifiedAt) &&
      Date.parse(receipt.lastVerifiedAt) <=
        Date.parse(receipt.lastSeenAt) + CLOCK_ROLLBACK_TOLERANCE_MS &&
      (receipt.price === undefined || validPriceSnapshot(receipt.price)),
  );
}

function validPriceCache(
  cache: ProductPriceCache | undefined,
  addOnStoreId: string,
): cache is ProductPriceCache {
  return Boolean(
    cache &&
      cache.schemaVersion === 1 &&
      cache.inAppOfferToken === STORE_PRODUCT.lifetimeAddOn.inAppOfferToken &&
      cache.addOnStoreId === addOnStoreId &&
      cache.price.formattedPrice.trim().length > 0 &&
      validInstant(cache.price.fetchedAt) &&
      validInstant(cache.lastSeenAt),
  );
}

function freeSnapshot(
  price?: StorePriceSnapshot,
  messageKey: CommerceSnapshot["messageKey"] = "purchase.status.free",
): CommerceSnapshot {
  return {
    entitlement: "FREE",
    verification: "FREE",
    price,
    messageKey,
    canStartNewLivePrint: Boolean(price),
    canResolveQueuedPrint: true,
  };
}

export class LifetimeEntitlementCoordinator {
  readonly #bridge: NativeStoreContextBridge;
  readonly #receiptStore: EntitlementCacheStore;
  readonly #priceStore: PriceCacheStore;
  readonly #engine: EntitlementEnginePort;
  readonly #now: () => Date;
  readonly #offlineGraceDays: number;
  readonly #priceMaxAgeDays: number;
  #snapshot: CommerceSnapshot = freeSnapshot();
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    bridge: NativeStoreContextBridge,
    receiptStore: EntitlementCacheStore,
    priceStore: PriceCacheStore,
    engine: EntitlementEnginePort,
    options: EntitlementCoordinatorOptions = {},
  ) {
    this.#bridge = bridge;
    this.#receiptStore = receiptStore;
    this.#priceStore = priceStore;
    this.#engine = engine;
    this.#now = options.now ?? (() => new Date());
    this.#offlineGraceDays =
      options.offlineGraceDays ?? OFFLINE_LICENSE_GRACE_DAYS;
    this.#priceMaxAgeDays =
      options.priceMaxAgeDays ?? PRICE_DISCLOSURE_MAX_AGE_DAYS;
    if (!Number.isInteger(this.#offlineGraceDays) || this.#offlineGraceDays < 1) {
      throw new Error("offlineGraceDays must be a positive integer");
    }
    if (!Number.isInteger(this.#priceMaxAgeDays) || this.#priceMaxAgeDays < 1) {
      throw new Error("priceMaxAgeDays must be a positive integer");
    }
  }

  snapshot(): CommerceSnapshot {
    return structuredClone(this.#snapshot);
  }

  async initialize(): Promise<CommerceSnapshot> {
    return this.refresh();
  }

  async refresh(): Promise<CommerceSnapshot> {
    return this.#runExclusive(() => this.#refreshInternal());
  }

  async #refreshInternal(): Promise<CommerceSnapshot> {
    const readiness = validateBridgeReadiness(this.#bridge.readiness(), "READ");
    if (!readiness.ok) return this.#fallBackOffline(readiness.code);

    const { lifetimeAddOnStoreId } = readiness.value;
    const [productResult, licenseResult] = await Promise.all([
      this.#bridge.getLifetimeProduct(lifetimeAddOnStoreId),
      this.#bridge.getLifetimeLicense(lifetimeAddOnStoreId),
    ]);

    let price: StorePriceSnapshot | undefined;
    if (productResult.ok) {
      const product = validateDurableProduct(productResult.value, readiness.value);
      if (!product.ok) return this.#fallBackOffline(product.code);
      price = await this.#cachePrice(product.value, lifetimeAddOnStoreId);
    } else if (productResult.code !== "OFFLINE") {
      return this.#fallBackOffline(productResult.code);
    }

    if (!licenseResult.ok) return this.#fallBackOffline(licenseResult.code, price);
    const license = validateDurableLicense(licenseResult.value, readiness.value);
    if (!license.ok) return this.#fallBackOffline(license.code, price);

    if (license.value.isActive) {
      return this.#grantFromStore(license.value, lifetimeAddOnStoreId, price);
    }

    await this.#receiptStore.clear();
    this.#setEngineFree(license.value.checkedAt);
    this.#snapshot = freeSnapshot(price);
    return this.snapshot();
  }

  async purchase(locale: LaunchHostLocale): Promise<CommerceActionResult> {
    return this.#runExclusive(() => this.#purchaseInternal(locale));
  }

  async #purchaseInternal(_locale: LaunchHostLocale): Promise<CommerceActionResult> {
    const readiness = validateBridgeReadiness(
      this.#bridge.readiness(),
      "PURCHASE",
    );
    if (!readiness.ok) {
      return {
        status: "FAILED",
        errorCode: readiness.code,
        retryable: readiness.retryable,
        snapshot: await this.#fallBackOffline(readiness.code),
      };
    }

    const productResult = await this.#bridge.getLifetimeProduct(
      readiness.value.lifetimeAddOnStoreId,
    );
    if (!productResult.ok) {
      return {
        status: "FAILED",
        errorCode: productResult.code,
        retryable: productResult.retryable,
        snapshot: await this.#fallBackOffline(productResult.code),
      };
    }
    const product = validateDurableProduct(productResult.value, readiness.value);
    if (!product.ok) {
      return {
        status: "FAILED",
        errorCode: product.code,
        retryable: product.retryable,
        snapshot: await this.#fallBackOffline(product.code),
      };
    }
    await this.#cachePrice(product.value, readiness.value.lifetimeAddOnStoreId);
    if (this.#snapshot.entitlement === "FREE") {
      this.#snapshot = freeSnapshot(product.value.price);
    }

    const purchase = await this.#bridge.requestLifetimePurchase(
      readiness.value.lifetimeAddOnStoreId,
    );
    if (!purchase.ok) {
      if (purchase.code === "USER_CANCELLED" || purchase.code === "NOT_PURCHASED") {
        return { status: "CANCELLED", snapshot: this.snapshot() };
      }
      return {
        status: "FAILED",
        errorCode: purchase.code,
        retryable: purchase.retryable,
        snapshot: this.snapshot(),
      };
    }
    if (
      purchase.value.status === "USER_CANCELLED" ||
      purchase.value.status === "NOT_PURCHASED"
    ) {
      return { status: "CANCELLED", snapshot: this.snapshot() };
    }

    const restored = await this.#restoreInternal(readiness.value, product.value.price);
    if (restored.status === "RESTORED") {
      return {
        status:
          purchase.value.status === "ALREADY_PURCHASED"
            ? "ALREADY_OWNED"
            : "PURCHASED",
        snapshot: restored.snapshot,
      };
    }
    return {
      status: "FAILED",
      errorCode: "INVALID_STORE_RESPONSE",
      retryable: true,
      snapshot: restored.snapshot,
    };
  }

  async restore(): Promise<CommerceActionResult> {
    return this.#runExclusive(() => this.#restore());
  }

  async #restore(): Promise<CommerceActionResult> {
    const readiness = validateBridgeReadiness(this.#bridge.readiness(), "READ");
    if (!readiness.ok) {
      return {
        status: "FAILED",
        errorCode: readiness.code,
        retryable: readiness.retryable,
        snapshot: await this.#fallBackOffline(readiness.code),
      };
    }
    return this.#restoreInternal(readiness.value);
  }

  async #restoreInternal(
    identity: Parameters<typeof validateDurableLicense>[1],
    knownPrice?: StorePriceSnapshot,
  ): Promise<CommerceActionResult> {
    const licenseResult = await this.#bridge.getLifetimeLicense(
      identity.lifetimeAddOnStoreId,
    );
    if (!licenseResult.ok) {
      return {
        status: "FAILED",
        errorCode: licenseResult.code,
        retryable: licenseResult.retryable,
        snapshot: await this.#fallBackOffline(licenseResult.code, knownPrice),
      };
    }
    const license = validateDurableLicense(licenseResult.value, identity);
    if (!license.ok) {
      return {
        status: "FAILED",
        errorCode: license.code,
        retryable: license.retryable,
        snapshot: await this.#fallBackOffline(license.code, knownPrice),
      };
    }
    if (!license.value.isActive) {
      await this.#receiptStore.clear();
      this.#setEngineFree(license.value.checkedAt);
      this.#snapshot = freeSnapshot(
        knownPrice ?? (await this.#loadFreshPrice(identity.lifetimeAddOnStoreId)),
        "purchase.restore.notFound",
      );
      return { status: "NOT_OWNED", snapshot: this.snapshot() };
    }
    const snapshot = await this.#grantFromStore(
      license.value,
      identity.lifetimeAddOnStoreId,
      knownPrice,
    );
    return { status: "RESTORED", snapshot };
  }

  async #grantFromStore(
    license: DurableStoreLicense,
    addOnStoreId: string,
    price?: StorePriceSnapshot,
  ): Promise<CommerceSnapshot> {
    const now = this.#now().toISOString();
    const previous = await this.#receiptStore.load();
    const firstVerifiedAt = validReceipt(previous, addOnStoreId)
      ? previous.firstVerifiedAt
      : license.checkedAt;
    const effectivePrice =
      price ??
      (validReceipt(previous, addOnStoreId) ? previous.price : undefined) ??
      (await this.#loadFreshPrice(addOnStoreId));
    await this.#receiptStore.save({
      schemaVersion: 1,
      inAppOfferToken: STORE_PRODUCT.lifetimeAddOn.inAppOfferToken,
      addOnStoreId,
      firstVerifiedAt,
      lastVerifiedAt: license.checkedAt,
      lastSeenAt: now,
      price: effectivePrice,
    });
    this.#setEngineLifetime(license.checkedAt);
    this.#snapshot = {
      entitlement: "LIFETIME",
      verification: "STORE_VERIFIED",
      price: effectivePrice,
      lastVerifiedAt: license.checkedAt,
      messageKey: "purchase.status.lifetime",
      canStartNewLivePrint: true,
      canResolveQueuedPrint: true,
    };
    return this.snapshot();
  }

  async #fallBackOffline(
    reason: StoreFailureCode,
    knownPrice?: StorePriceSnapshot,
  ): Promise<CommerceSnapshot> {
    const readiness = this.#bridge.readiness();
    const addOnStoreId = readiness.identity?.lifetimeAddOnStoreId;
    const now = this.#now();
    const mayUseOfflineGrace =
      reason === "OFFLINE" ||
      reason === "STORE_UNAVAILABLE" ||
      reason === "UNKNOWN";
    if (!addOnStoreId || !mayUseOfflineGrace) {
      this.#setEngineFree(now.toISOString());
      this.#snapshot = {
        ...freeSnapshot(knownPrice),
        verification: "VERIFICATION_REQUIRED",
        messageKey: "purchase.status.verificationRequired",
        canStartNewLivePrint: false,
      };
      return this.snapshot();
    }

    const receipt = await this.#receiptStore.load();
    if (
      validReceipt(receipt, addOnStoreId) &&
      !isClockRollback(receipt.lastSeenAt, now) &&
      withinDays(receipt.lastVerifiedAt, now, this.#offlineGraceDays)
    ) {
      const lastSeenAt = now.toISOString();
      await this.#receiptStore.save({ ...receipt, lastSeenAt });
      this.#setEngineLifetime(receipt.lastVerifiedAt);
      this.#snapshot = {
        entitlement: "LIFETIME",
        verification: "OFFLINE_GRACE",
        price: knownPrice ?? receipt.price,
        lastVerifiedAt: receipt.lastVerifiedAt,
        offlineGraceEndsAt: addDays(
          receipt.lastVerifiedAt,
          this.#offlineGraceDays,
        ),
        messageKey: "purchase.status.offlineGrace",
        canStartNewLivePrint: true,
        canResolveQueuedPrint: true,
      };
      return this.snapshot();
    }

    const price = knownPrice ?? (await this.#loadFreshPrice(addOnStoreId));
    this.#setEngineFree(now.toISOString());
    this.#snapshot = {
      entitlement: "FREE",
      verification: "VERIFICATION_REQUIRED",
      price,
      lastVerifiedAt: validReceipt(receipt, addOnStoreId)
        ? receipt.lastVerifiedAt
        : undefined,
      messageKey: "purchase.status.verificationRequired",
      canStartNewLivePrint: false,
      canResolveQueuedPrint: true,
    };
    return this.snapshot();
  }

  async #cachePrice(
    product: DurableStoreProduct,
    addOnStoreId: string,
  ): Promise<StorePriceSnapshot> {
    const lastSeenAt = this.#now().toISOString();
    await this.#priceStore.save({
      schemaVersion: 1,
      inAppOfferToken: STORE_PRODUCT.lifetimeAddOn.inAppOfferToken,
      addOnStoreId,
      price: structuredClone(product.price),
      lastSeenAt,
    });
    return structuredClone(product.price);
  }

  async #loadFreshPrice(
    addOnStoreId: string,
  ): Promise<StorePriceSnapshot | undefined> {
    const cached = await this.#priceStore.load();
    if (
      !validPriceCache(cached, addOnStoreId) ||
      isClockRollback(cached.lastSeenAt, this.#now()) ||
      !withinDays(cached.price.fetchedAt, this.#now(), this.#priceMaxAgeDays)
    ) {
      return undefined;
    }
    return structuredClone(cached.price);
  }

  #setEngineLifetime(verifiedAt: string): void {
    const current = this.#engine.snapshot().entitlement;
    if (current.kind === "LIFETIME" && current.source === "MICROSOFT_STORE") return;
    this.#engine.setEntitlement({
      kind: "LIFETIME",
      source: "MICROSOFT_STORE",
      verifiedAt,
    });
  }

  #setEngineFree(verifiedAt: string): void {
    const current = this.#engine.snapshot().entitlement;
    if (current.kind === "FREE" && current.source === "LOCAL_FREE") return;
    this.#engine.setEntitlement({
      kind: "FREE",
      source: "LOCAL_FREE",
      verifiedAt,
    });
  }

  async #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
