import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashAuditEntry, hashStateCore } from "../src/audit.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import { DomainError } from "../src/errors.ts";
import { decryptState, EncryptedStateStore, encryptState, migrateState } from "../src/persistence.ts";
import { dependencies, fixture } from "./test-helpers.ts";

const secret = "correct horse battery staple"; const recovery = "separate recovery passphrase";
function continuedDependencies(prefix: string) { let id = 0; let second = 0; return { newId: () => `${prefix}-${++id}`, now: () => new Date(Date.UTC(2026, 8, 18, 16, 0, second++)).toISOString() }; }
async function runChild(source: string): Promise<void> { await new Promise<void>((resolve, reject) => { const child = spawn(process.execPath, ["--input-type=module", "--eval", source], { stdio: "ignore" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child exited ${code}`))); }); }
function resealTerminalAudit(state: any): void { const terminal = state.audit.at(-1); terminal.stateHash = hashStateCore(state); const { hash: _hash, ...partial } = terminal; terminal.hash = hashAuditEntry(partial); }

test("uses the hardened envelope and distinguishes wrong keys from tampering", () => {
  const { engine } = fixture(); const encrypted = encryptState(engine.snapshot(), secret); const envelope = JSON.parse(encrypted);
  assert.equal(envelope.version, 2); assert.equal(envelope.iterations, 600_000); assert.ok(envelope.keyCheck); assert.ok(!encrypted.includes("Northwind Supplies")); assert.equal(decryptState(encrypted, secret).schemaVersion, 7);
  assert.throws(() => decryptState(encrypted, "wrong secret value"), (error: unknown) => error instanceof DomainError && error.code === "WRONG_STORAGE_KEY");
  envelope.ciphertext = `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`;
  assert.throws(() => decryptState(JSON.stringify(envelope), secret), (error: unknown) => error instanceof DomainError && error.code === "TAMPERED_STORAGE");
});

test("rejects stale writers and an active single-instance lock", async () => {
  const { engine } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-stale-")); const path = join(dir, "state.wbc"); const store = new EncryptedStateStore(); await store.save(path, engine.snapshot(), secret);
  const base = await store.load(path, secret); const left = new CheckPrinterEngine(base, continuedDependencies("left")); const right = new CheckPrinterEngine(base, continuedDependencies("right")); left.createPayee({ name: "Left" }); right.createPayee({ name: "Right" });
  await store.save(path, left.snapshot(), secret, base.revision); await assert.rejects(() => store.save(path, right.snapshot(), secret, base.revision), (error: unknown) => error instanceof DomainError && error.code === "STALE_REVISION"); assert.ok((await store.load(path, secret)).payees.some((item) => item.name === "Left"));
  await writeFile(`${path}.lock`, "occupied"); await assert.rejects(() => store.save(path, left.snapshot(), secret, left.snapshot().revision), (error: unknown) => error instanceof DomainError && error.code === "CONCURRENT_WRITE"); await unlink(`${path}.lock`);
  const instance = await store.acquireInstanceLock(path); await assert.rejects(() => store.acquireInstanceLock(path), (error: unknown) => error instanceof DomainError && error.code === "CONCURRENT_WRITE"); await instance.release(); await instance.release(); const reopened = await store.acquireInstanceLock(path); await reopened.release();
  const moduleUrl = new URL("../src/persistence.ts", import.meta.url).href; await runChild(`import { EncryptedStateStore } from ${JSON.stringify(moduleUrl)}; await new EncryptedStateStore().acquireInstanceLock(${JSON.stringify(path)}); process.exit(0);`); const afterCrash = await store.acquireInstanceLock(path); await afterCrash.release();
  await runChild(`import { open } from "node:fs/promises"; const h=await open(${JSON.stringify(`${path}.lock`)},"wx",0o600); await h.writeFile(JSON.stringify({pid:process.pid,token:"crashed-writer",at:new Date().toISOString()})); process.exit(0);`); await store.save(path, left.snapshot(), secret, left.snapshot().revision);
});

test("queues and persists a print plan before returning it to the host", async () => {
  const { engine, account, payee, profile } = fixture(); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id);
  const dir = await mkdtemp(join(tmpdir(), "worksbien-durable-")); const path = join(dir, "state.wbc"); const store = new EncryptedStateStore(); const state = engine.snapshot(); await store.save(path, state, secret);
  const result = await store.queuePrintDurably(path, secret, state.revision, { checkIds: [check.id], calibrationProfileId: profile.id, printerKey: "printer-1", stockKey: profile.stockKey }); assert.equal(result.plan.checkIds[0], check.id); assert.equal((await store.load(path, secret)).checks.find((item) => item.id === check.id)?.status, "PRINT_QUEUED");
});

test("portable backups verify before copy and restore without reusing issued numbers", async () => {
  const { engine, account, payee } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-backup-")); const path = join(dir, "state.wbc"); const backup = join(dir, "backup.wbc"); const garbage = join(dir, "garbage.wbc"); const store = new EncryptedStateStore();
  const first = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); const early = engine.snapshot(); await store.save(path, early, secret); await store.createBackup(path, backup, secret, recovery);
  const backupContents = await readFile(backup, "utf8"); assert.throws(() => decryptState(backupContents, secret), (error: unknown) => error instanceof DomainError && error.code === "WRONG_STORAGE_KEY"); assert.equal(decryptState(backupContents, recovery).checks[0].id, first.id);
  await assert.rejects(() => store.createBackup(path, join(dir, "same-secret.wbc"), secret, secret));
  const liveBeforeAlias = await readFile(path, "utf8"); await assert.rejects(() => store.createBackup(path, `${dir}/./state.wbc`, secret, recovery)); assert.equal(await readFile(path, "utf8"), liveBeforeAlias);
  engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 200 }); const later = engine.snapshot(); await store.save(path, later, secret, early.revision);
  const restored = await store.restoreBackup(backup, path, recovery, secret, later.revision); assert.equal(restored.numberAdvances[0].from, 1002); assert.equal(restored.numberAdvances[0].to, 1003); assert.ok(restored.preRestorePath); await stat(restored.preRestorePath!);
  const reopened = new CheckPrinterEngine(restored.state, continuedDependencies("restored")); const next = reopened.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-20", amountCents: 300 }); assert.equal(next.checkNumber, 1003);
  await writeFile(garbage, "not encrypted"); await assert.rejects(() => store.createBackup(garbage, join(dir, "bad-backup.wbc"), secret, recovery));
});

test("an external guard survives whole-folder rollback and prevents number reuse", async () => {
  const { engine, account, payee, profile } = fixture(); const root = await mkdtemp(join(tmpdir(), "worksbien-folder-rollback-")); const dataDir = join(root, "data"); const guardDir = join(root, "external-guards"); const path = join(dataDir, "state.wbc"); const store = new EncryptedStateStore({ guardDirectory: guardDir });
  await store.save(path, engine.snapshot(), secret); await copyFile(path, `${root}/old-state.wbc`); await copyFile(`${path}.guard`, `${root}/old-state.guard`);
  const live = new CheckPrinterEngine(await store.load(path, secret), continuedDependencies("folder-live")); const check = live.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); live.markReady(check.id); const queued = live.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey); live.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash); await store.save(path, live.snapshot(), secret, engine.snapshot().revision);
  await copyFile(`${root}/old-state.wbc`, path); await copyFile(`${root}/old-state.guard`, `${path}.guard`);
  const restored = await store.load(path, secret); assert.equal(restored.accounts[0].nextCheckNumber, 1002); const reopened = new CheckPrinterEngine(restored, continuedDependencies("folder-restored")); assert.equal(reopened.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 200 }).checkNumber, 1002);
});

test("missing authoritative guard forces physical number confirmation", async () => {
  const { engine, account } = fixture(); const root = await mkdtemp(join(tmpdir(), "worksbien-missing-guard-")); const guardDir = join(root, "external-guards"); const path = join(root, "data", "state.wbc"); const store = new EncryptedStateStore({ guardDirectory: guardDir }); await store.save(path, engine.snapshot(), secret);
  for (const file of await readdir(guardDir)) await unlink(join(guardDir, file));
  const loaded = await store.load(path, secret); assert.equal(loaded.accounts.find((item) => item.id === account.id)?.numberingState, "RESTORE_CONFIRMATION_REQUIRED");
});

test("async key derivation yields the event loop during saves", async () => {
  const { engine } = fixture(); const root = await mkdtemp(join(tmpdir(), "worksbien-async-kdf-")); const store = new EncryptedStateStore({ guardDirectory: join(root, "guards") }); let ticks = 0; const timer = setInterval(() => ticks++, 1); await store.save(join(root, "state.wbc"), engine.snapshot(), secret); clearInterval(timer); assert.ok(ticks > 0);
});

test("heartbeat expiry defeats PID reuse and a confirmed lock can be broken", async () => {
  const root = await mkdtemp(join(tmpdir(), "worksbien-lock-heartbeat-")); const path = join(root, "state.wbc"); const store = new EncryptedStateStore({ machineId: "test-machine", lockStaleMs: 50, lockHeartbeatMs: 10 });
  await writeFile(`${path}.instance.lock`, JSON.stringify({ pid: process.pid, token: "old", machineId: "test-machine", processStartedAt: "2020-01-01T00:00:00.000Z", heartbeatAt: "2020-01-01T00:00:00.000Z" })); const reclaimed = await store.acquireInstanceLock(path); await reclaimed.release();
  const active = await store.acquireInstanceLock(path); assert.ok(await store.inspectInstanceLock(path)); assert.equal(await store.breakInstanceLock(path, "BREAK_LOCK"), true); await active.release();
});

test("breaking an active lock cannot let its old heartbeat overwrite a replacement owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "worksbien-lock-race-")); const path = join(root, "state.wbc"); const store = new EncryptedStateStore({ machineId: "test-machine", lockStaleMs: 1_000, lockHeartbeatMs: 1 });
  for (let index = 0; index < 100; index++) {
    const old = await store.acquireInstanceLock(path); await new Promise((resolve) => setTimeout(resolve, 2)); assert.equal(await store.breakInstanceLock(path, "BREAK_LOCK"), true);
    const replacement = await store.acquireInstanceLock(path); await old.release(); assert.ok(await store.inspectInstanceLock(path), `replacement lock ${index} was lost`); await replacement.release();
  }
});

test("restore preserves the non-rollbackable Free allowance and fresh restores require numbering confirmation", async () => {
  const { engine, account, payee, profile } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-rollback-")); const path = join(dir, "state.wbc"); const backup = join(dir, "early.wbc"); const fresh = join(dir, "fresh.wbc"); const store = new EncryptedStateStore();
  const printOne = (amount: number) => { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: amount }); engine.markReady(check.id); const queued = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey); engine.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash); };
  printOne(100); const early = engine.snapshot(); await store.save(path, early, secret); await store.createBackup(path, backup, secret, recovery); printOne(200); printOne(300); const later = engine.snapshot(); await store.save(path, later, secret, early.revision);
  const restored = await store.restoreBackup(backup, path, recovery, secret, later.revision); assert.equal(restored.state.freeUsageCount, 3); const reopened = new CheckPrinterEngine(restored.state, continuedDependencies("rollback")); const fourth = reopened.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 400 }); reopened.markReady(fourth.id); assert.throws(() => reopened.queuePrint([fourth.id], profile.id, "printer-1", profile.stockKey), (error: unknown) => error instanceof DomainError && error.code === "ENTITLEMENT_REQUIRED");
  const portable = await store.restoreBackup(backup, fresh, recovery, "fresh destination key", undefined); assert.deepEqual(portable.numberingConfirmationRequired, [account.id]); assert.equal(portable.state.freeUsageCount, 3); const portableEngine = new CheckPrinterEngine(portable.state, continuedDependencies("portable")); assert.throws(() => portableEngine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-20", amountCents: 500 }), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.numberingConfirmation"); portableEngine.confirmNextCheckNumber(account.id, 1004); assert.equal(portableEngine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-20", amountCents: 500 }).checkNumber, 1004);
});

test("a queued attempt retained by restore stays refundable as NOT_SENT", async () => {
  const { engine, account, payee, profile } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-queued-restore-")); const path = join(dir, "state.wbc"); const backup = join(dir, "queued.wbc"); const store = new EncryptedStateStore();
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id); const queued = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey); const queuedState = engine.snapshot(); assert.equal(queuedState.freeUsageCount, 0); await store.save(path, queuedState, secret); await store.createBackup(path, backup, secret, recovery);
  const restored = await store.restoreBackup(backup, path, recovery, secret, queuedState.revision); assert.equal(restored.state.freeUsageCount, 0); const reopened = new CheckPrinterEngine(restored.state, continuedDependencies("queued-refund")); reopened.failPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "NOT_SENT", "NOTHING_PRINTED", "HOST_CONFIRMED_NO_OUTPUT"); assert.equal(reopened.snapshot().freeUsageCount, 0); assert.equal(reopened.snapshot().checks.find((item) => item.id === check.id)?.status, "READY");
});

test("promotes a complete newer temp file and discards a corrupt one", async () => {
  const { engine } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-recover-")); const path = join(dir, "state.wbc"); const store = new EncryptedStateStore(); const base = engine.snapshot(); await store.save(path, base, secret);
  const newerEngine = new CheckPrinterEngine(base, continuedDependencies("recovered")); newerEngine.createPayee({ name: "Recovered" }); const newer = newerEngine.snapshot(); await writeFile(`${path}.tmp`, encryptState(newer, secret)); assert.equal(await store.recoverInterruptedSave(path, secret), "PROMOTED_TEMP"); assert.equal((await store.load(path, secret)).revision, newer.revision);
  await writeFile(`${path}.tmp`, "partial"); assert.equal(await store.recoverInterruptedSave(path, secret), "DISCARDED_TEMP"); assert.equal(await store.recoverInterruptedSave(path, secret), "NONE");
});

test("migrates legacy data at the real time and quarantines old sample checks", () => {
  const built = fixture(); const check = built.engine.createDraft({ accountId: built.account.id, payeeId: built.payee.id, issueDate: "2026-09-18", amountCents: 4321 }); built.engine.markReady(check.id); const queued = built.engine.queuePrint([check.id], built.profile.id, "printer-1", built.profile.stockKey); built.engine.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash);
  const current = built.engine.snapshot(); const legacy = { ...current, schemaVersion: 2, checks: current.checks.map((item) => ({ ...item, sample: true, warningKeys: undefined, clearedDate: undefined })), accounts: current.accounts.map(({ updatedAt: _updatedAt, ...item }) => item), payees: current.payees.map(({ updatedAt: _updatedAt, ...item }) => item), calibrations: current.calibrations.map(({ accountId: _accountId, stockKey: _stockKey, printCheckNumber: _printCheckNumber, dateFormat: _dateFormat, amountWordsCurrencyLabel: _label, amountWordsFill: _fill, ...item }) => item) }; resealTerminalAudit(legacy);
  const tampered = structuredClone(legacy); tampered.checks[0].amountCents = 999; assert.throws(() => migrateState(tampered), (error: unknown) => error instanceof DomainError && error.code === "AUDIT_INTEGRITY_FAILURE");
  const migrated = migrateState(legacy, () => "2026-09-18T15:30:00.000Z"); const reopened = new CheckPrinterEngine(migrated); assert.equal(migrated.schemaVersion, 7); assert.equal(migrated.audit.at(-1)?.at, "2026-09-18T15:30:00.000Z"); assert.deepEqual(migrated.calibrations[0].fieldAdjustments.date, { xPt: 0, yPt: 0 }); assert.equal(reopened.snapshot().checks[0].status, "VOIDED"); assert.equal(reopened.snapshot().checks[0].printAttempts[0].status, "FAILED"); assert.equal(reopened.reconciliation(built.account.id).voidedCents, 4321); assert.throws(() => migrateState({ schemaVersion: 999 }));
});

test("supported restore preserves consumed three-up sheet slots outside the restored folder", async () => {
  const { engine, account, payee } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" }); const profile = engine.createCalibration({ accountId: account.id, name: "Three up", printerKey: "three", layout: "THREE_UP" });
  const root = await mkdtemp(join(tmpdir(), "worksbien-sheet-restore-")); const path = join(root, "data", "state.wbc"); const backup = join(root, "early.wbc"); const store = new EncryptedStateStore({ guardDirectory: join(root, "external-guards") });
  const early = engine.snapshot(); await store.save(path, early, secret); await store.createBackup(path, backup, secret, recovery);
  const live = new CheckPrinterEngine(await store.load(path, secret), continuedDependencies("sheet-live")); const first = live.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); live.markReady(first.id, profile.id); const queued = live.queuePrint([first.id], profile.id, profile.printerKey, profile.stockKey, 0, ["physical-sheet-1"]); live.confirmPrint(first.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash); const later = live.snapshot(); await store.save(path, later, secret, early.revision);
  const restored = await store.restoreBackup(backup, path, recovery, secret, later.revision); assert.deepEqual(restored.state.stockSheets.find((sheet) => sheet.id === "physical-sheet-1")?.usedSlots, [0]);
  const reopened = new CheckPrinterEngine(restored.state, continuedDependencies("sheet-restored")); const second = reopened.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 200 }); reopened.markReady(second.id, profile.id); assert.throws(() => reopened.queuePrint([second.id], profile.id, profile.printerKey, profile.stockKey, 0, ["physical-sheet-1"]), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.sheetSlotUsed");
});

test("a same-millisecond trusted no-output event beats an older queued sheet reservation", async () => {
  let id = 0; const constant = { now: () => "2026-09-19T12:00:00.000Z", newId: () => `constant-${++id}` }; const engine = new CheckPrinterEngine(undefined, constant); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: constant.now() });
  const account = engine.createAccount({ name: "Constant", companyName: "Example", currency: "USD", nextCheckNumber: 1 }); const payee = engine.createPayee({ name: "Payee" }); const profile = engine.createCalibration({ accountId: account.id, name: "Three up", printerKey: "three", layout: "THREE_UP" }); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 100 }); engine.markReady(check.id, profile.id); const queued = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey, 0, ["same-time-sheet"]);
  const root = await mkdtemp(join(tmpdir(), "worksbien-sheet-same-time-")); const path = join(root, "state.wbc"); const backup = join(root, "queued.wbc"); const store = new EncryptedStateStore({ guardDirectory: join(root, "guards") }); const queuedState = engine.snapshot(); await store.save(path, queuedState, secret); await store.createBackup(path, backup, secret, recovery);
  engine.failPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "NOT_SENT", "CANCELLED", "HOST_CANCELLED_BEFORE_SUBMIT"); const released = engine.snapshot(); await store.save(path, released, secret, queuedState.revision);
  const restored = await store.restoreBackup(backup, path, recovery, secret, released.revision); assert.deepEqual(restored.state.stockSheets.find((sheet) => sheet.id === "same-time-sheet")?.usedSlots ?? [], []);
});

test("migrates authenticated schema-4 profiles to safe actual-size calibration", () => {
  const schema4 = fixture().engine.snapshot() as any; schema4.schemaVersion = 4;
  for (const profile of schema4.calibrations) { delete profile.fieldAdjustments; delete profile.stubAdjustments; profile.scalePercent = 95; }
  resealTerminalAudit(schema4);
  const migrated = migrateState(schema4, () => "2026-09-19T12:00:00.000Z"); const reopened = new CheckPrinterEngine(migrated);
  assert.equal(migrated.schemaVersion, 7); assert.equal(migrated.calibrations[0].scalePercent, 100); assert.deepEqual(migrated.calibrations[0].fieldAdjustments, { checkNumber: { xPt: 0, yPt: 0 }, date: { xPt: 0, yPt: 0 }, payee: { xPt: 0, yPt: 0 }, amountNumeric: { xPt: 0, yPt: 0 }, amountWords: { xPt: 0, yPt: 0 }, memo: { xPt: 0, yPt: 0 } }); assert.deepEqual(migrated.calibrations[0].stubAdjustments, { first: { xPt: 0, yPt: 0 }, second: { xPt: 0, yPt: 0 } }); assert.equal(migrated.audit.at(-1)?.entityId, "schema-4-to-7"); assert.equal(reopened.snapshot().revision, schema4.revision + 1);
});

test("migrates schema-5 Ready checks conservatively and restores printed profile bindings", () => {
  const readyBuilt = fixture(); const readyCheck = readyBuilt.engine.createDraft({ accountId: readyBuilt.account.id, payeeId: readyBuilt.payee.id, issueDate: "2026-09-18", amountCents: 100 }); readyBuilt.engine.markReady(readyCheck.id, readyBuilt.profile.id);
  const schema5Ready = readyBuilt.engine.snapshot() as any; schema5Ready.schemaVersion = 5; delete schema5Ready.checks[0].readyCalibrationProfileId; resealTerminalAudit(schema5Ready);
  const migratedReady = migrateState(schema5Ready, () => "2026-09-19T13:00:00.000Z"); const reopenedReady = new CheckPrinterEngine(migratedReady);
  assert.equal(migratedReady.schemaVersion, 7); assert.equal(reopenedReady.snapshot().checks[0].status, "DRAFT"); assert.equal(reopenedReady.snapshot().checks[0].readyCalibrationProfileId, undefined); assert.equal(migratedReady.audit.at(-1)?.entityId, "schema-5-to-7"); assert.deepEqual(migratedReady.audit.at(-1)?.details.demotedReadyCheckIds, [readyCheck.id]);

  const printedBuilt = fixture(); const printedCheck = printedBuilt.engine.createDraft({ accountId: printedBuilt.account.id, payeeId: printedBuilt.payee.id, issueDate: "2026-09-18", amountCents: 200 }); printedBuilt.engine.markReady(printedCheck.id, printedBuilt.profile.id); const queued = printedBuilt.engine.queuePrint([printedCheck.id], printedBuilt.profile.id, printedBuilt.profile.printerKey, printedBuilt.profile.stockKey); printedBuilt.engine.confirmPrint(printedCheck.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash);
  const schema5Printed = printedBuilt.engine.snapshot() as any; schema5Printed.schemaVersion = 5; delete schema5Printed.checks[0].readyCalibrationProfileId; resealTerminalAudit(schema5Printed);
  const migratedPrinted = migrateState(schema5Printed, () => "2026-09-19T13:01:00.000Z"); const reopenedPrinted = new CheckPrinterEngine(migratedPrinted);
  assert.equal(reopenedPrinted.snapshot().checks[0].status, "PRINTED"); assert.equal(reopenedPrinted.snapshot().checks[0].readyCalibrationProfileId, printedBuilt.profile.id); assert.deepEqual(migratedPrinted.audit.at(-1)?.details.demotedReadyCheckIds, []);
});

test("semantic corruption cannot overwrite a valid destination", async () => {
  const { engine } = fixture(); const dir = await mkdtemp(join(tmpdir(), "worksbien-invalid-")); const backup = join(dir, "invalid.wbc"); const destination = join(dir, "valid.wbc"); const store = new EncryptedStateStore(); const valid = engine.snapshot(); await store.save(destination, valid, secret); const before = await readFile(destination, "utf8");
  const invalid = engine.snapshot(); invalid.accounts = []; await writeFile(backup, encryptState(invalid, recovery)); await assert.rejects(() => store.restoreBackup(backup, destination, recovery, secret, valid.revision), (error: unknown) => error instanceof DomainError && error.code === "CORRUPT_STORAGE"); assert.equal(await readFile(destination, "utf8"), before); await assert.rejects(() => store.save(destination, invalid, secret, valid.revision)); assert.equal(await readFile(destination, "utf8"), before);
});
