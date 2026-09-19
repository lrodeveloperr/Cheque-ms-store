import assert from "node:assert/strict";
import test from "node:test";
import { LifetimeEntitlementCoordinator, type EngineEntitlement, type EntitlementCacheStore, type LifetimeReceiptCache, type PriceCacheStore, type ProductPriceCache } from "../../src/product/entitlement.ts";
import { decidePrintAccess } from "../../src/product/print-access.ts";
import type { DurableStoreLicense, DurableStoreProduct, NativeStoreContextBridge, StoreCallResult, StorePurchaseOutcome } from "../../src/product/store-bridge.ts";
import type { PartnerCenterIdentity } from "../../src/product/product-identity.ts";

const IDENTITY: PartnerCenterIdentity = {
  packageIdentityName: "WorksBienStudios.RealIdentity",
  packageFamilyName: "WorksBienStudios.RealIdentity_abcd1234",
  publisherSubject: "CN=00000000-0000-0000-0000-000000000000",
  appStoreId: "9ABCDEF12345",
  lifetimeAddOnStoreId: "9ZYXWVU98765",
};

class MemoryReceiptStore implements EntitlementCacheStore {
  value?: LifetimeReceiptCache;
  async load() { return this.value && structuredClone(this.value); }
  async save(value: LifetimeReceiptCache) { this.value = structuredClone(value); }
  async clear() { this.value = undefined; }
}

class MemoryPriceStore implements PriceCacheStore {
  value?: ProductPriceCache;
  async load() { return this.value && structuredClone(this.value); }
  async save(value: ProductPriceCache) { this.value = structuredClone(value); }
  async clear() { this.value = undefined; }
}

class MemoryEngine {
  entitlement: EngineEntitlement = { kind: "FREE", source: "LOCAL_FREE", verifiedAt: "1970-01-01T00:00:00.000Z" };
  snapshot() { return { entitlement: structuredClone(this.entitlement) }; }
  setEntitlement(value: { kind: "FREE" | "LIFETIME"; source: "LOCAL_FREE" | "MICROSOFT_STORE" | "TEST"; verifiedAt: string }) {
    this.entitlement = value;
  }
}

function success<T>(value: T): StoreCallResult<T> { return { ok: true, value }; }

class FakeBridge implements NativeStoreContextBridge {
  packaged = true;
  associated = true;
  hwnd = true;
  productResult: StoreCallResult<DurableStoreProduct>;
  licenseResult: StoreCallResult<DurableStoreLicense>;
  purchaseResult: StoreCallResult<StorePurchaseOutcome>;

  constructor(now: string, formattedPrice = "$19.99") {
    this.productResult = success({
      storeId: IDENTITY.lifetimeAddOnStoreId,
      inAppOfferToken: "lifetime_unlock",
      productKind: "DURABLE",
      title: "Lifetime Unlock",
      price: { formattedPrice, currencyCode: "USD", fetchedAt: now },
      isInUserCollection: false,
    });
    this.licenseResult = success({
      storeId: IDENTITY.lifetimeAddOnStoreId,
      inAppOfferToken: "lifetime_unlock",
      isActive: false,
      checkedAt: now,
    });
    this.purchaseResult = success({ status: "SUCCEEDED", completedAt: now });
  }
  readiness() { return { packaged: this.packaged, storeAssociated: this.associated, hwndOwnerInitialized: this.hwnd, identity: structuredClone(IDENTITY) }; }
  async getLifetimeProduct() { return structuredClone(this.productResult); }
  async getLifetimeLicense() { return structuredClone(this.licenseResult); }
  async requestLifetimePurchase() { return structuredClone(this.purchaseResult); }
}

function setup(nowValue = "2026-09-19T12:00:00.000Z", price = "$19.99") {
  let now = new Date(nowValue);
  const bridge = new FakeBridge(nowValue, price);
  const receipt = new MemoryReceiptStore();
  const priceStore = new MemoryPriceStore();
  const engine = new MemoryEngine();
  const coordinator = new LifetimeEntitlementCoordinator(bridge, receipt, priceStore, engine, { now: () => now });
  return { bridge, receipt, priceStore, engine, coordinator, setNow(value: string) { now = new Date(value); } };
}

test("Store-verified durable license grants Lifetime and preserves Store-formatted price", async () => {
  const subject = setup("2026-09-19T12:00:00.000Z", "25,99 $ CA");
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:00.000Z" });
  const state = await subject.coordinator.initialize();
  assert.equal(state.entitlement, "LIFETIME");
  assert.equal(state.verification, "STORE_VERIFIED");
  assert.equal(state.price?.formattedPrice, "25,99 $ CA");
  assert.equal(subject.engine.entitlement.kind, "LIFETIME");
});

test("purchase result alone is insufficient; the matching active license is required", async () => {
  const subject = setup();
  const result = await subject.coordinator.purchase("en-US");
  assert.equal(result.status, "FAILED");
  assert.equal(subject.engine.entitlement.kind, "FREE");
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:01.000Z" });
  const purchased = await subject.coordinator.purchase("en-US");
  assert.equal(purchased.status, "PURCHASED");
  assert.equal(subject.engine.entitlement.kind, "LIFETIME");
});

test("cancelled purchase changes neither entitlement nor free-use authority", async () => {
  const subject = setup();
  subject.bridge.purchaseResult = success({ status: "NOT_PURCHASED", completedAt: "2026-09-19T12:00:00.000Z" });
  const result = await subject.coordinator.purchase("en-US");
  assert.equal(result.status, "CANCELLED");
  assert.equal(subject.engine.entitlement.kind, "FREE");
  assert.equal(result.snapshot.price?.formattedPrice, "$19.99");
});

test("restore finds an active license and reports no purchase when license is inactive", async () => {
  const subject = setup();
  let result = await subject.coordinator.restore();
  assert.equal(result.status, "NOT_OWNED");
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:00.000Z" });
  result = await subject.coordinator.restore();
  assert.equal(result.status, "RESTORED");
  assert.equal(subject.engine.entitlement.kind, "LIFETIME");
});

test("offline grace retains verified Lifetime for 30 days and then blocks only new live jobs", async () => {
  const subject = setup();
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:00.000Z" });
  await subject.coordinator.refresh();
  subject.bridge.productResult = { ok: false, code: "OFFLINE", retryable: true };
  subject.bridge.licenseResult = { ok: false, code: "OFFLINE", retryable: true };
  subject.setNow("2026-10-18T12:00:00.000Z");
  let state = await subject.coordinator.refresh();
  assert.equal(state.verification, "OFFLINE_GRACE");
  assert.equal(state.canStartNewLivePrint, true);
  subject.setNow("2026-10-20T12:00:00.000Z");
  state = await subject.coordinator.refresh();
  assert.equal(state.verification, "VERIFICATION_REQUIRED");
  assert.equal(state.canStartNewLivePrint, false);
  assert.equal(state.canResolveQueuedPrint, true);
  assert.equal(subject.engine.entitlement.kind, "FREE");
});

test("clock rollback invalidates offline grace", async () => {
  const subject = setup();
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:00.000Z" });
  await subject.coordinator.refresh();
  subject.bridge.productResult = { ok: false, code: "OFFLINE", retryable: true };
  subject.bridge.licenseResult = { ok: false, code: "OFFLINE", retryable: true };
  subject.setNow("2026-09-18T12:00:00.000Z");
  const state = await subject.coordinator.refresh();
  assert.equal(state.verification, "VERIFICATION_REQUIRED");
  assert.equal(state.canStartNewLivePrint, false);
});

test("missing package identity fails closed even when a cached receipt exists", async () => {
  const subject = setup();
  subject.bridge.licenseResult = success({ storeId: IDENTITY.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", isActive: true, checkedAt: "2026-09-19T12:00:00.000Z" });
  await subject.coordinator.refresh();
  subject.bridge.packaged = false;
  const state = await subject.coordinator.refresh();
  assert.equal(state.verification, "VERIFICATION_REQUIRED");
  assert.equal(state.canStartNewLivePrint, false);
  assert.equal(subject.engine.entitlement.kind, "FREE");
});

test("free-use host decision mirrors the three-check engine boundary without charging samples or replacements", () => {
  const free = { entitlement: "FREE", verification: "FREE", price: { formattedPrice: "$19.99", fetchedAt: "2026-09-19T12:00:00.000Z" }, messageKey: "purchase.status.free", canStartNewLivePrint: true, canResolveQueuedPrint: true } as const;
  const sample = decidePrintAccess("SAMPLE", { freeUsageCount: 3, queuedChargeableCount: 0, isReplacement: false }, free);
  assert.equal(sample.allowed, true);
  if (sample.allowed) assert.equal(sample.basis, "UNLIMITED_NON_NEGOTIABLE");
  assert.equal(decidePrintAccess("CALIBRATION", { freeUsageCount: 3, queuedChargeableCount: 0, isReplacement: false }, free).allowed, true);
  const third = decidePrintAccess("LIVE", { freeUsageCount: 2, queuedChargeableCount: 0, isReplacement: false }, free);
  assert.equal(third.allowed, true);
  if (third.allowed) assert.equal(third.remainingFreeAfterQueue, 0);
  assert.equal(decidePrintAccess("LIVE", { freeUsageCount: 3, queuedChargeableCount: 0, isReplacement: false }, free).allowed, false);
  const replacement = decidePrintAccess("LIVE", { freeUsageCount: 3, queuedChargeableCount: 0, isReplacement: true }, free);
  assert.equal(replacement.allowed, true);
  if (replacement.allowed) assert.equal(replacement.basis, "REPLACEMENT");
});

test("free live output is blocked until a current Store-formatted price has been disclosed", () => {
  const noPrice = { entitlement: "FREE", verification: "FREE", messageKey: "purchase.status.free", canStartNewLivePrint: false, canResolveQueuedPrint: true } as const;
  const decision = decidePrintAccess("LIVE", { freeUsageCount: 0, queuedChargeableCount: 0, isReplacement: false }, noPrice);
  assert.deepEqual(decision, { allowed: false, reason: "PRICE_DISCLOSURE_REQUIRED", messageKey: "purchase.priceRequired" });
});
