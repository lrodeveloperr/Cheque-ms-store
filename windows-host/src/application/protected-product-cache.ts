import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  EntitlementCacheStore,
  LifetimeReceiptCache,
  PriceCacheStore,
  ProductPriceCache,
} from "../product/entitlement.ts";
import { atomicWriteBytes } from "../platform/atomic-file.ts";
import type { SafeStoragePort } from "../platform/contracts.ts";

interface ProtectedEnvelope {
  format: "WORKSBIEN-DPAPI-PRODUCT-CACHE";
  version: 1;
  recordType: "LIFETIME_RECEIPT" | "PRODUCT_PRICE";
  ciphertext: string;
}

type Validator<T> = (value: unknown) => value is T;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function instant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function price(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.formattedPrice === "string" &&
    value.formattedPrice.trim().length > 0 &&
    value.formattedPrice.length <= 100 &&
    (value.currencyCode === undefined || typeof value.currencyCode === "string") &&
    instant(value.fetchedAt)
  );
}

const receiptValidator: Validator<LifetimeReceiptCache> = (
  value,
): value is LifetimeReceiptCache =>
  record(value) &&
  value.schemaVersion === 1 &&
  value.inAppOfferToken === "lifetime_unlock" &&
  typeof value.addOnStoreId === "string" &&
  instant(value.firstVerifiedAt) &&
  instant(value.lastVerifiedAt) &&
  instant(value.lastSeenAt) &&
  (value.price === undefined || price(value.price));

const priceValidator: Validator<ProductPriceCache> = (
  value,
): value is ProductPriceCache =>
  record(value) &&
  value.schemaVersion === 1 &&
  value.inAppOfferToken === "lifetime_unlock" &&
  typeof value.addOnStoreId === "string" &&
  price(value.price) &&
  instant(value.lastSeenAt);

class ProtectedJsonFile<T> {
  readonly #path: string;
  readonly #recordType: ProtectedEnvelope["recordType"];
  readonly #safeStorage: SafeStoragePort;
  readonly #validator: Validator<T>;

  constructor(
    path: string,
    recordType: ProtectedEnvelope["recordType"],
    safeStorage: SafeStoragePort,
    validator: Validator<T>,
  ) {
    this.#path = path;
    this.#recordType = recordType;
    this.#safeStorage = safeStorage;
    this.#validator = validator;
  }

  async load(): Promise<T | undefined> {
    if (!(await this.#safeStorage.isEncryptionAvailable())) return undefined;
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      return undefined;
    }
    try {
      const envelope = JSON.parse(raw) as Partial<ProtectedEnvelope>;
      if (
        envelope.format !== "WORKSBIEN-DPAPI-PRODUCT-CACHE" ||
        envelope.version !== 1 ||
        envelope.recordType !== this.#recordType ||
        typeof envelope.ciphertext !== "string" ||
        envelope.ciphertext.length === 0
      ) return undefined;
      const decrypted = await this.#safeStorage.decryptString(
        Buffer.from(envelope.ciphertext, "base64"),
      );
      const value: unknown = JSON.parse(decrypted.value);
      if (!this.#validator(value)) return undefined;
      if (decrypted.shouldReEncrypt) await this.save(value);
      return structuredClone(value);
    } catch {
      // A damaged or copied DPAPI cache is never authority. Treat it as absent;
      // the Store must verify ownership again.
      return undefined;
    }
  }

  async save(value: T): Promise<void> {
    if (!this.#validator(value)) throw new Error("Refusing to persist an invalid product cache record.");
    if (!(await this.#safeStorage.isEncryptionAvailable())) {
      throw new Error("Windows secure storage is unavailable; product cache was not written.");
    }
    const ciphertext = await this.#safeStorage.encryptString(JSON.stringify(value));
    const envelope: ProtectedEnvelope = {
      format: "WORKSBIEN-DPAPI-PRODUCT-CACHE",
      version: 1,
      recordType: this.#recordType,
      ciphertext: Buffer.from(ciphertext).toString("base64"),
    };
    await atomicWriteBytes(this.#path, Buffer.from(JSON.stringify(envelope), "utf8"));
  }

  async clear(): Promise<void> {
    await unlink(this.#path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function createProtectedProductCacheStores(
  dataDirectory: string,
  safeStorage: SafeStoragePort,
): { receiptStore: EntitlementCacheStore; priceStore: PriceCacheStore } {
  return {
    receiptStore: new ProtectedJsonFile(
      join(dataDirectory, "lifetime-receipt.dpapi"),
      "LIFETIME_RECEIPT",
      safeStorage,
      receiptValidator,
    ),
    priceStore: new ProtectedJsonFile(
      join(dataDirectory, "store-price.dpapi"),
      "PRODUCT_PRICE",
      safeStorage,
      priceValidator,
    ),
  };
}
