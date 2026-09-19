import type { PartnerCenterIdentity } from "./product-identity.ts";
import type {
  DurableStoreLicense,
  DurableStoreProduct,
  NativeStoreContextBridge,
  StoreBridgeReadiness,
  StoreCallResult,
  StoreFailureCode,
  StorePurchaseOutcome,
} from "./store-bridge.ts";

export interface JsonLineStoreTransport {
  request(value: {
    action: "readiness" | "getProduct" | "getLicense" | "purchase";
    storeId: string;
    hwnd: number;
  }): Promise<unknown>;
}

interface ProcessAdapterOptions {
  identity: PartnerCenterIdentity;
  hwnd: number;
  packaged: boolean;
  storeAssociated: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function failure(value: unknown): StoreCallResult<never> | undefined {
  if (!record(value) || value.ok !== false || typeof value.code !== "string") {
    return undefined;
  }
  const allowed = new Set<StoreFailureCode>([
    "OFFLINE",
    "USER_CANCELLED",
    "NOT_PURCHASED",
    "ALREADY_PURCHASED",
    "PACKAGE_IDENTITY_MISSING",
    "WINDOW_OWNER_MISSING",
    "PRODUCT_NOT_FOUND",
    "STORE_UNAVAILABLE",
    "INVALID_STORE_RESPONSE",
    "UNKNOWN",
  ]);
  if (!allowed.has(value.code as StoreFailureCode)) return undefined;
  return {
    ok: false,
    code: value.code as StoreFailureCode,
    retryable: value.retryable === true,
    ...(typeof value.diagnosticCode === "string"
      ? { diagnosticCode: value.diagnosticCode }
      : {}),
  };
}

function processValue(value: unknown): unknown {
  if (!record(value) || value.ok !== true || !("value" in value)) return undefined;
  return value.value;
}

function invalid(): StoreCallResult<never> {
  return { ok: false, code: "INVALID_STORE_RESPONSE", retryable: false };
}

export class StoreProcessAdapter implements NativeStoreContextBridge {
  readonly #transport: JsonLineStoreTransport;
  readonly #options: ProcessAdapterOptions;
  #nativeReadiness?: StoreBridgeReadiness;

  constructor(transport: JsonLineStoreTransport, options: ProcessAdapterOptions) {
    this.#transport = transport;
    this.#options = structuredClone(options);
  }

  readiness(): StoreBridgeReadiness {
    return this.#nativeReadiness
      ? structuredClone(this.#nativeReadiness)
      : {
          packaged: false,
          storeAssociated: false,
          hwndOwnerInitialized: false,
        };
  }

  /** Proves package/store identity through the native bridge before commerce. */
  async initialize(): Promise<StoreBridgeReadiness> {
    if (!this.#options.packaged || !this.#options.storeAssociated) {
      this.#nativeReadiness = {
        packaged: false,
        storeAssociated: false,
        hwndOwnerInitialized: false,
      };
      return this.readiness();
    }
    let raw: unknown;
    try {
      raw = await this.#transport.request({
        action: "readiness",
        storeId: this.#options.identity.lifetimeAddOnStoreId,
        hwnd: this.#options.hwnd,
      });
    } catch {
      this.#nativeReadiness = {
        packaged: false,
        storeAssociated: false,
        hwndOwnerInitialized: false,
      };
      return this.readiness();
    }
    const value = processValue(raw);
    if (!record(value) || !record(value.identity)) {
      this.#nativeReadiness = {
        packaged: false,
        storeAssociated: false,
        hwndOwnerInitialized: false,
      };
      return this.readiness();
    }
    const identity = value.identity;
    const expected = this.#options.identity;
    const identityMatches =
      identity.packageIdentityName === expected.packageIdentityName &&
      identity.packageFamilyName === expected.packageFamilyName &&
      identity.publisherSubject === expected.publisherSubject &&
      identity.appStoreId === expected.appStoreId &&
      identity.lifetimeAddOnStoreId === expected.lifetimeAddOnStoreId;
    this.#nativeReadiness = identityMatches
      ? {
          packaged: value.packaged === true,
          storeAssociated: value.storeAssociated === true,
          hwndOwnerInitialized: value.hwndOwnerInitialized === true,
          identity: structuredClone(expected),
        }
      : {
          packaged: false,
          storeAssociated: false,
          hwndOwnerInitialized: false,
        };
    return this.readiness();
  }

  async getLifetimeProduct(
    addOnStoreId: string,
  ): Promise<StoreCallResult<DurableStoreProduct>> {
    const raw = await this.#call("getProduct", addOnStoreId, false);
    const failed = failure(raw);
    if (failed) return failed;
    const value = processValue(raw);
    if (
      !record(value) ||
      typeof value.storeId !== "string" ||
      typeof value.inAppOfferToken !== "string" ||
      typeof value.productKind !== "string" ||
      typeof value.title !== "string" ||
      typeof value.isInUserCollection !== "boolean" ||
      !record(value.price) ||
      typeof value.price.formattedPrice !== "string" ||
      typeof value.price.fetchedAt !== "string"
    ) return invalid();
    return {
      ok: true,
      value: {
        storeId: value.storeId,
        inAppOfferToken: value.inAppOfferToken,
        productKind: value.productKind as DurableStoreProduct["productKind"],
        title: value.title,
        price: {
          formattedPrice: value.price.formattedPrice,
          currencyCode:
            typeof value.price.currencyCode === "string"
              ? value.price.currencyCode
              : undefined,
          fetchedAt: value.price.fetchedAt,
        },
        isInUserCollection: value.isInUserCollection,
      },
    };
  }

  async getLifetimeLicense(
    addOnStoreId: string,
  ): Promise<StoreCallResult<DurableStoreLicense>> {
    const raw = await this.#call("getLicense", addOnStoreId, false);
    const failed = failure(raw);
    if (failed) return failed;
    const value = processValue(raw);
    if (
      !record(value) ||
      typeof value.storeId !== "string" ||
      typeof value.inAppOfferToken !== "string" ||
      typeof value.isActive !== "boolean" ||
      typeof value.checkedAt !== "string"
    ) return invalid();
    return {
      ok: true,
      value: {
        storeId: value.storeId,
        inAppOfferToken: value.inAppOfferToken,
        isActive: value.isActive,
        checkedAt: value.checkedAt,
        expiresAt:
          typeof value.expiresAt === "string" ? value.expiresAt : undefined,
      },
    };
  }

  async requestLifetimePurchase(
    addOnStoreId: string,
  ): Promise<StoreCallResult<StorePurchaseOutcome>> {
    const raw = await this.#call("purchase", addOnStoreId, true);
    const failed = failure(raw);
    if (failed) return failed;
    const value = processValue(raw);
    if (
      !record(value) ||
      typeof value.status !== "string" ||
      typeof value.completedAt !== "string" ||
      !["SUCCEEDED", "ALREADY_PURCHASED", "NOT_PURCHASED", "USER_CANCELLED"].includes(value.status)
    ) return invalid();
    return {
      ok: true,
      value: {
        status: value.status as StorePurchaseOutcome["status"],
        completedAt: value.completedAt,
      },
    };
  }

  async #call(
    action: "getProduct" | "getLicense" | "purchase",
    storeId: string,
    needsHwnd: boolean,
  ): Promise<unknown> {
    if (!this.#nativeReadiness?.packaged || !this.#nativeReadiness.storeAssociated) {
      return { ok: false, code: "PACKAGE_IDENTITY_MISSING", retryable: false };
    }
    if (storeId !== this.#options.identity.lifetimeAddOnStoreId) {
      return { ok: false, code: "PRODUCT_NOT_FOUND", retryable: false };
    }
    if (needsHwnd && (!Number.isSafeInteger(this.#options.hwnd) || this.#options.hwnd <= 0)) {
      return { ok: false, code: "WINDOW_OWNER_MISSING", retryable: false };
    }
    try {
      return await this.#transport.request({
        action,
        storeId,
        hwnd: needsHwnd ? this.#options.hwnd : 0,
      });
    } catch {
      return { ok: false, code: "STORE_UNAVAILABLE", retryable: true };
    }
  }
}
