import assert from "node:assert/strict";
import test from "node:test";
import { StoreProcessAdapter, type JsonLineStoreTransport } from "../../src/product/store-process-adapter.ts";

const identity = {
  packageIdentityName: "WorksBienStudios.RealIdentity",
  packageFamilyName: "WorksBienStudios.RealIdentity_abcd1234",
  publisherSubject: "CN=00000000-0000-0000-0000-000000000000",
  appStoreId: "9ABCDEF12345",
  lifetimeAddOnStoreId: "9ZYXWVU98765",
};

test("process adapter sends bounded product request and preserves FormattedPrice", async () => {
  const requests: unknown[] = [];
  const transport: JsonLineStoreTransport = { async request(value) { requests.push(value); return value.action === "readiness" ? { ok: true, value: { packaged: true, storeAssociated: true, hwndOwnerInitialized: true, identity } } : { ok: true, value: { storeId: identity.lifetimeAddOnStoreId, inAppOfferToken: "lifetime_unlock", productKind: "DURABLE", title: "Lifetime Unlock", price: { formattedPrice: "25,99 $ CA", currencyCode: "CAD", fetchedAt: "2026-09-19T12:00:00.000Z" }, isInUserCollection: false } }; } };
  const adapter = new StoreProcessAdapter(transport, { identity, hwnd: 1234, packaged: true, storeAssociated: true });
  await adapter.initialize();
  const result = await adapter.getLifetimeProduct(identity.lifetimeAddOnStoreId);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.price.formattedPrice, "25,99 $ CA");
  assert.deepEqual(requests, [
    { action: "readiness", storeId: identity.lifetimeAddOnStoreId, hwnd: 1234 },
    { action: "getProduct", storeId: identity.lifetimeAddOnStoreId, hwnd: 0 },
  ]);
});

test("purchase refuses a missing HWND without invoking the native transport", async () => {
  const actions: string[] = [];
  const transport: JsonLineStoreTransport = { async request(value) { actions.push(value.action); return { ok: true, value: { packaged: true, storeAssociated: true, hwndOwnerInitialized: false, identity } }; } };
  const adapter = new StoreProcessAdapter(transport, { identity, hwnd: 0, packaged: true, storeAssociated: true });
  await adapter.initialize();
  const result = await adapter.requestLifetimePurchase(identity.lifetimeAddOnStoreId);
  assert.deepEqual(result, { ok: false, code: "WINDOW_OWNER_MISSING", retryable: false });
  assert.deepEqual(actions, ["readiness"]);
});

test("adapter refuses a Store ID other than the configured Partner Center value", async () => {
  const actions: string[] = [];
  const transport: JsonLineStoreTransport = { async request(value) { actions.push(value.action); return { ok: true, value: { packaged: true, storeAssociated: true, hwndOwnerInitialized: true, identity } }; } };
  const adapter = new StoreProcessAdapter(transport, { identity, hwnd: 1234, packaged: true, storeAssociated: true });
  await adapter.initialize();
  const result = await adapter.getLifetimeLicense("9WRONGID0000");
  assert.deepEqual(result, { ok: false, code: "PRODUCT_NOT_FOUND", retryable: false });
  assert.deepEqual(actions, ["readiness"]);
});

test("adapter fails closed when native package identity differs", async () => {
  const transport: JsonLineStoreTransport = { async request() { return { ok: true, value: { packaged: true, storeAssociated: true, hwndOwnerInitialized: true, identity: { ...identity, appStoreId: "9MISMATCH0000" } } }; } };
  const adapter = new StoreProcessAdapter(transport, { identity, hwnd: 1234, packaged: true, storeAssociated: true });
  await adapter.initialize();
  assert.equal(adapter.readiness().packaged, false);
  assert.deepEqual(await adapter.getLifetimeLicense(identity.lifetimeAddOnStoreId), { ok: false, code: "PACKAGE_IDENTITY_MISSING", retryable: false });
});
