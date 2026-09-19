import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createProtectedProductCacheStores } from "../../src/application/protected-product-cache.ts";
import { OneShotStoreProcessTransport } from "../../src/application/store-process-transport.ts";
import type { SafeStoragePort } from "../../src/platform/contracts.ts";

class FakeSafeStorage implements SafeStoragePort {
  async isEncryptionAvailable(): Promise<boolean> { return true; }
  async encryptString(value: string): Promise<Uint8Array> { return Buffer.from(`sealed:${value}`, "utf8"); }
  async decryptString(value: Uint8Array): Promise<{ value: string; shouldReEncrypt: boolean }> {
    const decoded = Buffer.from(value).toString("utf8");
    if (!decoded.startsWith("sealed:")) throw new Error("DPAPI validation failed");
    return { value: decoded.slice(7), shouldReEncrypt: false };
  }
}

const identity = {
  packageIdentityName: "WorksBienStudios.RealIdentity",
  packageFamilyName: "WorksBienStudios.RealIdentity_abcd1234",
  publisherSubject: "CN=00000000-0000-0000-0000-000000000000",
  appStoreId: "9ABCDEF12345",
  lifetimeAddOnStoreId: "9ZYXWVU98765",
};

test("DPAPI product caches round-trip valid records and reject copied or corrupt data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-product-cache-"));
  const stores = createProtectedProductCacheStores(directory, new FakeSafeStorage());
  const receipt = {
    schemaVersion: 1 as const,
    inAppOfferToken: "lifetime_unlock" as const,
    addOnStoreId: identity.lifetimeAddOnStoreId,
    firstVerifiedAt: "2026-09-19T12:00:00.000Z",
    lastVerifiedAt: "2026-09-19T12:00:00.000Z",
    lastSeenAt: "2026-09-19T12:00:00.000Z",
  };
  await stores.receiptStore.save(receipt);
  assert.deepEqual(await stores.receiptStore.load(), receipt);
  await writeFile(join(directory, "lifetime-receipt.dpapi"), "copied-or-corrupt", "utf8");
  assert.equal(await stores.receiptStore.load(), undefined);
});

test("Store bridge transport refuses relative executables and mismatched add-on IDs before spawning", async () => {
  assert.throws(() => new OneShotStoreProcessTransport("bridge.exe", identity), /absolute/i);
  const transport = new OneShotStoreProcessTransport(resolve("WorksBien.StoreBridge.exe"), identity);
  await assert.rejects(
    transport.request({ action: "getLicense", storeId: "9WRONGID0000", hwnd: 0 }),
    /not the configured Lifetime add-on/i,
  );
});
