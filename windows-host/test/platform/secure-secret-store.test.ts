import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SafeStoragePort } from "../../src/platform/contracts.ts";
import { WindowsSecureSecretStore } from "../../src/platform/secure-secret-store.ts";

class FakeSafeStorage implements SafeStoragePort {
  available = true;
  encryptions = 0;
  reencrypt = false;
  async isEncryptionAvailable(): Promise<boolean> { return this.available; }
  async encryptString(value: string): Promise<Uint8Array> { this.encryptions += 1; return Buffer.from(`protected:${value}`, "utf8"); }
  async decryptString(value: Uint8Array): Promise<{ value: string; shouldReEncrypt: boolean }> {
    const raw = Buffer.from(value).toString("utf8");
    assert.match(raw, /^protected:/);
    return { value: raw.slice("protected:".length), shouldReEncrypt: this.reencrypt };
  }
}

test("creates one protected random secret and reuses it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-key-"));
  const path = join(directory, "storage-key.dpapi");
  const safeStorage = new FakeSafeStorage();
  const store = new WindowsSecureSecretStore(path, safeStorage);
  const [first, second] = await Promise.all([store.getOrCreateStorageSecret(), store.getOrCreateStorageSecret()]);
  assert.equal(first, second);
  assert.ok(first.length >= 40);
  assert.equal(safeStorage.encryptions, 1);
  assert.doesNotMatch(await readFile(path, "utf8"), new RegExp(first));
  const reopened = new WindowsSecureSecretStore(path, safeStorage);
  assert.equal(await reopened.getOrCreateStorageSecret(), first);
});

test("refuses an unprotected fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-key-"));
  const safeStorage = new FakeSafeStorage();
  safeStorage.available = false;
  await assert.rejects(
    new WindowsSecureSecretStore(join(directory, "key"), safeStorage).getOrCreateStorageSecret(),
    /secure storage is unavailable/i
  );
});

test("rewrites ciphertext when the OS key provider requests rotation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-key-"));
  const path = join(directory, "key");
  const safeStorage = new FakeSafeStorage();
  const secret = await new WindowsSecureSecretStore(path, safeStorage).getOrCreateStorageSecret();
  safeStorage.reencrypt = true;
  assert.equal(await new WindowsSecureSecretStore(path, safeStorage).getOrCreateStorageSecret(), secret);
  assert.equal(safeStorage.encryptions, 2);
});
