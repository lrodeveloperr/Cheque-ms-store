import assert from "node:assert/strict";
import test from "node:test";
import { hashAuditEntry, hashStateCore } from "../src/audit.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import { DomainError } from "../src/errors.ts";
import { fixture } from "./test-helpers.ts";

test("distinguishes nothing-sent from uncertain output and replaces spoiled stock with a new number", () => {
  const { engine, account, payee, profile } = fixture();
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 5050, memo: "Invoice", category: "Office" }); engine.markReady(check.id);
  const notSent = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey);
  assert.equal(engine.failPrint(check.id, notSent.attemptIds[0], notSent.plan.documentId, notSent.planHash, "NOT_SENT", "USER_CANCELED", "HOST_CANCELLED_BEFORE_SUBMIT").status, "READY");
  const uncertain = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey);
  assert.equal(engine.failPrint(check.id, uncertain.attemptIds[0], uncertain.plan.documentId, uncertain.planHash, "UNKNOWN", "SPOOLER_UNKNOWN").status, "MISPRINTED");
  assert.throws(() => engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey), (error: unknown) => error instanceof DomainError && error.code === "INVALID_TRANSITION");
  const replacement = engine.replaceMisprinted(check.id); assert.notEqual(replacement.checkNumber, check.checkNumber); assert.equal(replacement.replacementForCheckId, check.id);
  const state = engine.snapshot(); assert.equal(state.checks.find((item) => item.id === check.id)?.replacedByCheckId, replacement.id); assert.equal(state.checks.find((item) => item.id === check.id)?.status, "VOIDED");
});

test("confirmation remains available after an entitlement changes", () => {
  const { engine, account, payee, profile } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T12:00:00.000Z" });
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id);
  const queued = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey); engine.setEntitlement({ kind: "FREE", source: "LOCAL_FREE", verifiedAt: "2026-09-18T12:01:00.000Z" });
  assert.equal(engine.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash).status, "PRINTED");
});

test("entitlement kinds require a trustworthy matching source", () => {
  const { engine } = fixture();
  assert.throws(() => engine.setEntitlement({ kind: "LIFETIME", source: "LOCAL_FREE", verifiedAt: "2026-09-18T12:00:00.000Z" }));
  assert.throws(() => engine.setEntitlement({ kind: "FREE", source: "MICROSOFT_STORE", verifiedAt: "2026-09-18T12:00:00.000Z" }));
  engine.setEntitlement({ kind: "LIFETIME", source: "MICROSOFT_STORE", verifiedAt: "2026-09-18T12:00:00.000Z" });
  assert.equal(engine.snapshot().entitlement.kind, "LIFETIME");
});

test("one three-up document outcome commits every check atomically", () => {
  const { engine, account, payee } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" });
  const profile = engine.createCalibration({ accountId: account.id, name: "Three up", printerKey: "three", layout: "THREE_UP" });
  const ids = [100, 200, 300].map((amountCents) => { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents }); engine.markReady(check.id, profile.id); return check.id; });
  const queued = engine.queuePrint(ids, profile.id, profile.printerKey, profile.stockKey, 0, ["sheet-batch-1"]);
  const before = engine.snapshot(); assert.throws(() => engine.confirmPrint(ids[0], queued.attemptIds[0], queued.plan.documentId, queued.planHash)); assert.deepEqual(engine.snapshot(), before); assert.throws(() => engine.resolvePrintDocumentOutcome(queued.plan.documentId, "0".repeat(64), { kind: "PRINTED_CORRECTLY" })); assert.deepEqual(engine.snapshot(), before);
  assert.deepEqual(engine.resolvePrintDocumentOutcome(queued.plan.documentId, queued.planHash, { kind: "PRINTED_CORRECTLY" }).map((check) => check.status), ["PRINTED", "PRINTED", "PRINTED"]);
});

test("three-up sheet ledger blocks reused slots and releases only host-proven no-output", () => {
  const { engine, account, payee } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" });
  const profile = engine.createCalibration({ accountId: account.id, name: "Three up", printerKey: "three", layout: "THREE_UP" });
  const makeReady = () => { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id, profile.id); return check; };
  const first = makeReady(); const queued = engine.queuePrint([first.id], profile.id, profile.printerKey, profile.stockKey, 0, ["physical-sheet-1"]);
  const second = makeReady(); assert.throws(() => engine.queuePrint([second.id], profile.id, profile.printerKey, profile.stockKey, 0, ["physical-sheet-1"]), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.sheetSlotUsed");
  assert.throws(() => engine.queuePrint([second.id], profile.id, profile.printerKey, profile.stockKey, 0, [" physical-sheet-1 "]), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.sheetSlotUsed");
  assert.throws(() => engine.failPrint(first.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "NOT_SENT", "CLAIMED"), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.notPrintedEvidence");
  engine.failPrint(first.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "NOT_SENT", "CANCELLED", "HOST_CANCELLED_BEFORE_SUBMIT");
  assert.equal(engine.queuePrint([second.id], profile.id, profile.printerKey, profile.stockKey, 0, ["physical-sheet-1"]).plan.sheetIds[0], "physical-sheet-1");
});

test("an unresolved spoiled check can be corrected to printed", () => {
  const { engine, account, payee, profile } = fixture(); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id);
  const queued = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey); const spoiled = engine.failPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "UNKNOWN", "UNCERTAIN"); assert.ok(spoiled.warningKeys.includes("warning.secureOriginal"));
  assert.equal(engine.confirmMisprintedAsPrinted(check.id).status, "PRINTED"); assert.equal(engine.snapshot().checks.find((item) => item.id === check.id)?.printAttempts.at(-1)?.status, "CONFIRMED"); assert.ok(!engine.snapshot().checks.find((item) => item.id === check.id)?.warningKeys.includes("warning.secureOriginal"));
});

test("reconciliation separates deleted drafts, spoiled stock, voids, outstanding, and cleared", () => {
  const { engine, account, payee, profile } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" });
  const draft = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 500000 }); engine.deleteDraft(draft.id);
  const voided = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 200 }); engine.voidCheck(voided.id, "Cancelled");
  const outstanding = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 300 }); engine.markReady(outstanding.id); let queued = engine.queuePrint([outstanding.id], profile.id, "printer-1", profile.stockKey); engine.confirmPrint(outstanding.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash);
  const cleared = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 400 }); engine.markReady(cleared.id); queued = engine.queuePrint([cleared.id], profile.id, "printer-1", profile.stockKey); engine.confirmPrint(cleared.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash); engine.setCleared(cleared.id, true, "2026-09-18");
  const spoiled = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 600 }); engine.markReady(spoiled.id); queued = engine.queuePrint([spoiled.id], profile.id, "printer-1", profile.stockKey); engine.failPrint(spoiled.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "UNKNOWN", "PAPER_JAM");
  assert.deepEqual(engine.reconciliation(account.id), { outstandingCents: 300, clearedCents: 400, voidedCents: 200, spoiledCents: 600, outstandingCount: 1, clearedCount: 1, voidedCount: 1, spoiledCount: 1, deletedDraftCount: 1, issuedCheckCount: 4 });
  engine.voidCheck(spoiled.id, "Destroyed stock"); assert.equal(engine.reconciliation(account.id).spoiledCents, 600);
});

test("a replaced misprint remains spoiled in reconciliation, register, and CSV", () => {
  const { engine, account, payee, profile } = fixture();
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 600 }); engine.markReady(check.id);
  const queued = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey); engine.failPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "UNKNOWN", "SPOILED"); engine.replaceMisprinted(check.id);
  assert.equal(engine.queryRegister({ statuses: ["MISPRINTED"] })[0]?.checkId, check.id);
  assert.equal(engine.registerReport({ statuses: ["MISPRINTED"] }).totals.byCurrency.USD?.spoiledCents, 600);
  assert.match(engine.exportRegister(), /Spoiled/);
});

test("account and payee maintenance is explicit and safe", () => {
  const { engine, account, payee } = fixture();
  assert.equal(engine.updateAccount(account.id, { name: "Primary", companyName: "Updated Co" }).name, "Primary");
  assert.equal(engine.updatePayee(payee.id, { name: "Northwind Ltd", defaultMemo: "Parts" }).defaultMemo, "Parts");
  assert.equal(engine.setNextCheckNumber(account.id, 2000).nextCheckNumber, 2000);
  engine.archivePayee(payee.id); assert.throws(() => engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 })); engine.archivePayee(payee.id, false);
  engine.archiveAccount(account.id); assert.throws(() => engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 })); engine.archiveAccount(account.id, false);
  const draft = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 });
  assert.throws(() => engine.setNextCheckNumber(account.id, draft.checkNumber)); assert.throws(() => engine.updateAccount(account.id, { currency: "CAD" }));
});

test("normalizes NFC and rejects invisible, multiline, and bidi text", () => {
  const { engine } = fixture();
  const composed = engine.createPayee({ name: "Jose\u0301" }); assert.equal(composed.name, "José");
  for (const name of ["\u200B", "Alice\nBob", "Alice\tBob", "Alice\u202EBob", "Alice\u2028Bob", "Alice\u2029Bob"]) assert.throws(() => engine.createPayee({ name }), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.singleLine");
});

test("checks retain immutable account, payee, printer, stock, and calibration evidence", () => {
  const { engine, account, payee, profile } = fixture(); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id);
  engine.updatePayee(payee.id, { name: "CHANGED AFTER READY" }); engine.updateAccount(account.id, { name: "Renamed account" }); engine.archivePayee(payee.id);
  const queued = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey); const payeeText = queued.plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "payee"); assert.equal(payeeText?.kind === "text" ? payeeText.text : "", "Northwind Supplies");
  const persisted = engine.snapshot().checks.find((item) => item.id === check.id)!; assert.equal(persisted.payeeSnapshot.name, "Northwind Supplies"); assert.equal(persisted.accountSnapshot.name, "Operating"); assert.equal(persisted.printAttempts[0].printerKey, "printer-1"); assert.equal(persisted.printAttempts[0].stockKey, profile.stockKey); assert.match(engine.exportRegister(), /Operating/); assert.doesNotMatch(engine.exportRegister(), /Renamed account/);
  assert.throws(() => engine.updateCalibration(profile.id, { printerKey: "new-printer", stockKey: "new-stock" }));
});

test("calibration patches are whitelisted and all rejected mutations roll back", () => {
  const { engine, profile } = fixture(); const before = engine.snapshot();
  assert.throws(() => engine.updateCalibration(profile.id, { createdAt: "invalid", accountId: "other", xOffsetPt: 1 } as never)); assert.deepEqual(engine.snapshot(), before);
  assert.equal(engine.updateCalibration(profile.id, { xOffsetPt: 1, name: "Adjusted" }).xOffsetPt, 1);
  assert.throws(() => engine.updateCalibration(profile.id, { scalePercent: 500 }));
});

test("print plans cannot mix accounts or use the wrong printer", () => {
  const { engine, account, payee, profile } = fixture(); const otherAccount = engine.createAccount({ name: "Canada", companyName: "CA Co", currency: "CAD", nextCheckNumber: 1001 });
  const otherProfile = engine.createCalibration({ accountId: otherAccount.id, name: "CAD", printerKey: "printer-ca", layout: "THREE_UP" });
  const first = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); const second = engine.createDraft({ accountId: otherAccount.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(first.id); engine.markReady(second.id);
  assert.throws(() => engine.queuePrint([first.id], profile.id, "wrong-printer", profile.stockKey)); assert.throws(() => engine.queuePrint([first.id], profile.id, "printer-1", "wrong-stock")); assert.throws(() => engine.queuePrint([first.id, second.id], otherProfile.id, "printer-ca", otherProfile.stockKey));
  engine.requireNumberingConfirmation(account.id); assert.throws(() => engine.queuePrint([first.id], profile.id, "printer-1", profile.stockKey), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.numberingConfirmation"); engine.confirmNextCheckNumber(account.id, engine.snapshot().accounts.find((item) => item.id === account.id)!.nextCheckNumber);
});

test("Free mode reserves three live checks atomically", () => {
  const { engine, account, payee } = fixture(); const profile = engine.createCalibration({ accountId: account.id, name: "Three-up", printerKey: "p", layout: "THREE_UP" }); const ids: string[] = [];
  for (let index = 0; index < 4; index++) { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 + index }); engine.markReady(check.id, profile.id); ids.push(check.id); }
  engine.queuePrint(ids.slice(0, 3), profile.id, "p", profile.stockKey, 0, ["free-sheet-1"]); assert.throws(() => engine.queuePrint([ids[3]], profile.id, "p", profile.stockKey, 0, ["free-sheet-2"]), (error: unknown) => error instanceof DomainError && error.code === "ENTITLEMENT_REQUIRED");
});

test("date and duplicate warnings are structured and clearing uses a local date", () => {
  const { engine, account, payee, profile } = fixture(); const old = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "1900-01-01", amountCents: 100 }); assert.deepEqual(old.warningKeys, ["warning.unusualDate"]);
  const duplicate = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "1900-01-01", amountCents: 100 }); assert.ok(duplicate.warningKeys.includes("warning.possibleDuplicate"));
  engine.updateDraft(duplicate.id, { issueDate: "2026-09-18" }); assert.deepEqual(engine.snapshot().checks.find((item) => item.id === duplicate.id)?.warningKeys, []);
  engine.markReady(old.id); const queued = engine.queuePrint([old.id], profile.id, "printer-1", profile.stockKey); engine.confirmPrint(old.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash);
  assert.throws(() => engine.setCleared(old.id, true)); assert.throws(() => engine.setCleared(old.id, true, "1899-12-31")); assert.equal(engine.setCleared(old.id, true, "2026-09-18").clearedDate, "2026-09-18"); assert.equal(engine.setCleared(old.id, false).clearedDate, undefined);
});

test("imports aliases once, records one batch audit, and exports localized safe or raw CSV", () => {
  const { engine, account } = fixture(); const before = engine.snapshot().audit.length;
  const imported = engine.importPayees("Name,Address,City,State,Zip,Country,Default Memo\r\n'-Smith Hardware,1 Main,Toronto,ON,M1A 1A1,Canada,=Invoice\r\n'-Smith Hardware,1 Main,Toronto,ON,M1A 1A1,CA,=Invoice\r\n");
  assert.equal(imported.created.length, 1); assert.equal(imported.skipped, 1); assert.equal(engine.snapshot().audit.length, before + 1);
  const check = engine.createDraft({ accountId: account.id, payeeId: imported.created[0].id, issueDate: "2026-09-18", amountCents: 250, memo: "+formula" });
  const safe = engine.exportRegister(undefined, "en-CA"); assert.ok(safe.startsWith("\uFEFF")); assert.match(safe, /Account,Cheque number/); assert.match(safe, /'\+formula/); assert.match(safe, /'-Smith Hardware/);
  const raw = engine.exportRegister(undefined, "en-CA", "RAW_TRUSTED"); assert.match(raw, /\+formula/); assert.doesNotMatch(raw, /'\+formula/); assert.match(raw, /'-Smith Hardware/); engine.deleteDraft(check.id);
});

test("audit binding rejects history and financial-state tampering", () => {
  const { engine, account, payee } = fixture(); engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 });
  const history = engine.snapshot(); history.audit[0].action = "TAMPERED"; assert.throws(() => new CheckPrinterEngine(history), (error: unknown) => error instanceof DomainError && error.code === "AUDIT_INTEGRITY_FAILURE");
  const financial = engine.snapshot(); financial.checks[0].amountCents = 999; assert.throws(() => new CheckPrinterEngine(financial), (error: unknown) => error instanceof DomainError && error.code === "AUDIT_INTEGRITY_FAILURE");
  const lifecycle = engine.snapshot(); lifecycle.checks[0].status = "PRINTED"; const last = lifecycle.audit.at(-1)!; last.stateHash = hashStateCore(lifecycle); const { hash: _hash, ...partial } = last; last.hash = hashAuditEntry(partial); assert.throws(() => new CheckPrinterEngine(lifecycle));
});
