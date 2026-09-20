import { stat } from "node:fs/promises";
import { createEmptyState } from "../../../src/engine.ts";
import type { EngineState } from "../../../src/types.ts";
import type { AppPaths, PlatformSession, SecretStorePort, StateStorePort } from "./contracts.ts";
import { requireBackupPath } from "./paths.ts";

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class WindowsStateRepository {
  readonly #paths: AppPaths;
  readonly #secretStore: SecretStorePort;
  readonly #stateStore: StateStorePort;

  constructor(paths: AppPaths, secretStore: SecretStorePort, stateStore: StateStorePort) {
    this.#paths = paths;
    this.#secretStore = secretStore;
    this.#stateStore = stateStore;
  }

  async open(): Promise<PlatformSession> {
    const instanceLock = await this.#stateStore.acquireInstanceLock(this.#paths.stateFile);
    try {
      // The cross-process state lease must cover first creation of both the
      // DPAPI-wrapped secret and the encrypted state file.
      const secret = await this.#secretStore.getOrCreateStorageSecret();
      const recovery = await this.#stateStore.recoverInterruptedSave(this.#paths.stateFile, secret);
      let state: EngineState;
      if (await fileExists(this.#paths.stateFile)) state = await this.#stateStore.load(this.#paths.stateFile, secret);
      else {
        // An audit-empty state is valid only with the engine's canonical
        // epoch FREE entitlement. Store verification is applied later through
        // the engine so that it creates a corresponding audit entry.
        state = createEmptyState();
        await this.#stateStore.save(this.#paths.stateFile, state, secret);
      }
      let closed = false;
      let operationTail = Promise.resolve();
      const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
        const previous = operationTail;
        let release!: () => void;
        operationTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try { return await operation(); } finally { release(); }
      };
      return {
        get state() { return structuredClone(state); },
        secret,
        recovery,
        save: (nextState, expectedRevision = state.revision) => serialize(async () => {
          if (closed) throw new Error("The platform session is closed.");
          await this.#stateStore.save(this.#paths.stateFile, nextState, secret, expectedRevision);
          state = structuredClone(nextState);
        }),
        createBackup: (destinationPath, recoveryPassphrase) => serialize(async () => {
          if (closed) throw new Error("The platform session is closed.");
          await this.#stateStore.createBackup(this.#paths.stateFile, requireBackupPath(destinationPath), secret, recoveryPassphrase);
        }),
        restoreBackup: (sourcePath, backupPassphrase, expectedRevision = state.revision) => serialize(async () => {
          if (closed) throw new Error("The platform session is closed.");
          const result = await this.#stateStore.restoreBackup(requireBackupPath(sourcePath), this.#paths.stateFile, backupPassphrase, secret, expectedRevision);
          state = structuredClone(result.state);
          return result;
        }),
        queuePrint: (input, expectedRevision = state.revision) => serialize(async () => {
          if (closed) throw new Error("The platform session is closed.");
          const result = await this.#stateStore.queuePrintDurably(
            this.#paths.stateFile,
            secret,
            expectedRevision,
            input,
          );
          state = structuredClone(result.state);
          return structuredClone(result);
        }),
        close: async () => {
          if (closed) return;
          closed = true;
          await operationTail;
          await instanceLock.release();
        }
      };
    } catch (error) {
      await instanceLock.release().catch(() => undefined);
      throw error;
    }
  }
}
