import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CheckPrinterEngine, createEmptyState } from "../../../src/engine.ts";
import { EncryptedStateStore } from "../../../src/persistence.ts";
import type { EngineState } from "../../../src/types.ts";
import type { PrintPlan } from "../../../src/types.ts";
import type { AppPaths, SecretStorePort, StateStorePort } from "../../src/platform/contracts.ts";
import type { RestoreResult } from "../../../src/persistence.ts";
import { WindowsStateRepository } from "../../src/platform/state-repository.ts";

class FakeSecretStore implements SecretStorePort {
  async getOrCreateStorageSecret(): Promise<string> { return "a-secure-storage-secret"; }
}

class FakeStateStore implements StateStorePort {
  calls: string[] = [];
  state = createEmptyState();
  released = false;
  async acquireInstanceLock(): Promise<{ release(): Promise<void> }> { this.calls.push("lock"); return { release: async () => { this.released = true; } }; }
  async recoverInterruptedSave(): Promise<"NONE"> { this.calls.push("recover"); return "NONE"; }
  async load(): Promise<EngineState> { this.calls.push("load"); return structuredClone(this.state); }
  async save(_path: string, state: EngineState, _secret: string, expectedRevision?: number): Promise<void> { this.calls.push(`save:${expectedRevision ?? "new"}`); this.state = structuredClone(state); }
  async createBackup(): Promise<void> { this.calls.push("backup"); }
  async restoreBackup(): Promise<RestoreResult> { this.calls.push("restore"); return { state: structuredClone(this.state), numberAdvances: [], numberingConfirmationRequired: [] }; }
  async queuePrintDurably(): Promise<{ state: EngineState; plan: PrintPlan; planHash: string; attemptIds: string[] }> {
    this.calls.push("queue");
    return {
      state: structuredClone(this.state),
      plan: {
        version: 4,
        documentId: "document-1",
        documentKind: "CHECKS",
        currency: "USD",
        locale: "en-US",
        bankCountry: "US",
        layout: "VOUCHER_TOP",
        calibrationProfileId: "calibration-1",
        accountId: "account-1",
        printerKey: "printer-1",
        stockKey: "TOP_VOUCHER_STANDARD",
        startSlot: 0,
        sheetIds: ["sheet-1"],
        pages: [{ widthPt: 612, heightPt: 792, elements: [] }],
        checkIds: ["check-1"],
        generatedAt: "2026-09-19T00:00:00.000Z",
        warningKeys: [],
      },
      planHash: "hash",
      attemptIds: ["attempt-1"],
    };
  }
}

async function paths(): Promise<AppPaths> {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-state-"));
  return { dataDirectory: directory, stateFile: join(directory, "state.wbc"), secureSecretFile: join(directory, "key"), guardDirectory: join(directory, "guards"), temporaryDirectory: join(directory, "tmp") };
}

test("recovers before load, creates first state, and holds the data lock", async () => {
  const stateStore = new FakeStateStore();
  const repository = new WindowsStateRepository(await paths(), new FakeSecretStore(), stateStore);
  const session = await repository.open();
  assert.deepEqual(stateStore.calls, ["lock", "recover", "save:new"]);
  await session.save({ ...session.state, revision: 1 });
  assert.equal(stateStore.calls.at(-1), "save:0");
  await session.close();
  assert.equal(stateStore.released, true);
  await assert.rejects(session.save(session.state), /closed/i);
});

test("loads an existing encrypted state after interrupted-save recovery", async () => {
  const appPaths = await paths();
  await writeFile(appPaths.stateFile, "present");
  const stateStore = new FakeStateStore();
  const session = await new WindowsStateRepository(appPaths, new FakeSecretStore(), stateStore).open();
  assert.deepEqual(stateStore.calls, ["lock", "recover", "load"]);
  await session.close();
});

test("routes backup and restore through validated .wbc files", async () => {
  const appPaths = await paths();
  const stateStore = new FakeStateStore();
  const session = await new WindowsStateRepository(appPaths, new FakeSecretStore(), stateStore).open();
  await session.createBackup(join(appPaths.dataDirectory, "backup.wbc"), "recovery-passphrase");
  await session.restoreBackup(join(appPaths.dataDirectory, "backup.wbc"), "recovery-passphrase");
  assert.deepEqual(stateStore.calls.slice(-2), ["backup", "restore"]);
  await assert.rejects(session.createBackup(join(appPaths.dataDirectory, "backup.zip"), "recovery-passphrase"), /\.wbc/i);
  await session.close();
});

test("exposes the engine's durable queue boundary through the session", async () => {
  const appPaths = await paths();
  const stateStore = new FakeStateStore();
  const session = await new WindowsStateRepository(appPaths, new FakeSecretStore(), stateStore).open();
  const result = await session.queuePrint({ checkIds: ["check-1"], calibrationProfileId: "calibration-1", printerKey: "printer-1", stockKey: "TOP_VOUCHER_STANDARD" });
  assert.equal(result.plan.documentId, "document-1");
  assert.equal(stateStore.calls.at(-1), "queue");
  await session.close();
});

test("fresh install persists the engine's canonical audit-empty state", async () => {
  const appPaths = await paths();
  const stateStore = new EncryptedStateStore({ guardDirectory: appPaths.guardDirectory });
  const session = await new WindowsStateRepository(
    appPaths,
    new FakeSecretStore(),
    stateStore,
  ).open();

  assert.equal(session.state.revision, 0);
  assert.equal(session.state.audit.length, 0);
  assert.deepEqual(session.state.entitlement, {
    kind: "FREE",
    source: "LOCAL_FREE",
    verifiedAt: new Date(0).toISOString(),
  });
  assert.doesNotThrow(() => new CheckPrinterEngine(session.state));
  await session.close();
});
