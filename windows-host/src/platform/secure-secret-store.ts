import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { atomicWriteBytes } from "./atomic-file.ts";
import type { SafeStoragePort, SecretStorePort } from "./contracts.ts";

interface ProtectedSecretEnvelope {
  readonly format: "WORKSBIEN-DPAPI-SECRET";
  readonly version: 1;
  readonly ciphertext: string;
}

function parseEnvelope(raw: string): ProtectedSecretEnvelope {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("The protected storage-key file is not valid JSON."); }
  const candidate = value as Partial<ProtectedSecretEnvelope>;
  if (candidate.format !== "WORKSBIEN-DPAPI-SECRET" || candidate.version !== 1 || typeof candidate.ciphertext !== "string" || candidate.ciphertext.length === 0) {
    throw new Error("The protected storage-key file has an unsupported format.");
  }
  return candidate as ProtectedSecretEnvelope;
}

function encodeEnvelope(ciphertext: Uint8Array): Uint8Array {
  return Buffer.from(JSON.stringify({
    format: "WORKSBIEN-DPAPI-SECRET",
    version: 1,
    ciphertext: Buffer.from(ciphertext).toString("base64")
  } satisfies ProtectedSecretEnvelope), "utf8");
}

/**
 * Persists only an OS-protected ciphertext. On Windows Electron safeStorage is
 * backed by DPAPI and tied to the signed-in Windows user.
 */
export class WindowsSecureSecretStore implements SecretStorePort {
  readonly #path: string;
  readonly #safeStorage: SafeStoragePort;
  #pending?: Promise<string>;

  constructor(path: string, safeStorage: SafeStoragePort) {
    this.#path = path;
    this.#safeStorage = safeStorage;
  }

  getOrCreateStorageSecret(): Promise<string> {
    this.#pending ??= this.#loadOrCreate().finally(() => { this.#pending = undefined; });
    return this.#pending;
  }

  async #loadOrCreate(): Promise<string> {
    if (!await this.#safeStorage.isEncryptionAvailable()) {
      throw new Error("Windows secure storage is unavailable; refusing to persist an unprotected data key.");
    }
    const existing = await readFile(this.#path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing !== undefined) {
      const envelope = parseEnvelope(existing);
      const decrypted = await this.#safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64"));
      if (decrypted.value.length < 12) throw new Error("The protected storage key is invalid.");
      if (decrypted.shouldReEncrypt) {
        await atomicWriteBytes(this.#path, encodeEnvelope(await this.#safeStorage.encryptString(decrypted.value)));
      }
      return decrypted.value;
    }
    const secret = randomBytes(32).toString("base64url");
    await atomicWriteBytes(this.#path, encodeEnvelope(await this.#safeStorage.encryptString(secret)));
    return secret;
  }
}
