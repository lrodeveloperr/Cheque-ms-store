import assert from "node:assert/strict";
import test from "node:test";
import { CheckPrinterEngine } from "../src/engine.ts";
import { decryptState, encryptState } from "../src/persistence.ts";
import { dependencies, fixture } from "./test-helpers.ts";

test("Canadian French is frozen into drafts and used by sample and live plans", () => {
  const engine = new CheckPrinterEngine(undefined, dependencies());
  assert.throws(() => engine.createAccount({ name: "Bad US", companyName: "Bad", currency: "USD", bankCountry: "US", locale: "fr-CA", nextCheckNumber: 1 }));
  const account = engine.createAccount({ name: "Exploitation", companyName: "Exemple inc.", currency: "CAD", bankCountry: "CA", locale: "fr-CA", nextCheckNumber: 5001 });
  const payee = engine.createPayee({ name: "Fournitures Québec" });
  const profile = engine.createCalibration({ accountId: account.id, name: "Imprimante bureau", printerKey: "printer-fr", layout: "VOUCHER_TOP" });
  const sample = engine.samplePlan(profile.id, profile.printerKey);
  assert.equal(sample.locale, "fr-CA"); assert.match(sample.pages[0].elements.find((item) => item.kind === "text" && item.role === "overlay")?.text ?? "", /SPÉCIMEN/);
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 12_345 });
  assert.equal(check.locale, "fr-CA"); assert.equal(check.accountSnapshot.locale, "fr-CA"); engine.markReady(check.id);
  const plan = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan;
  assert.equal(plan.locale, "fr-CA");
  assert.match(plan.pages[0].elements.find((item) => item.kind === "text" && item.role === "amount_words")?.text ?? "", /cent vingt-trois.*dollars canadiens/);
  assert.equal(plan.pages[0].elements.find((item) => item.kind === "text" && item.role === "amount_numeric")?.text, "123,45");
});

test("payment favourites and duplication create new drafts with new reserved numbers", () => {
  const { engine, account, payee } = fixture();
  const template = engine.createPaymentTemplate({ name: "Monthly supplier", accountId: account.id, payeeId: payee.id, amountCents: 12_345, memo: "September", category: "Supplies" });
  const fromTemplate = engine.createDraftFromTemplate(template.id, { issueDate: "2026-09-19" });
  assert.equal(fromTemplate.checkNumber, 1001); assert.equal(fromTemplate.amountCents, 12_345); assert.equal(fromTemplate.memo, "September");
  const duplicate = engine.duplicateCheck(fromTemplate.id, { issueDate: "2026-10-19" });
  assert.equal(duplicate.checkNumber, 1002); assert.equal(duplicate.amountCents, fromTemplate.amountCents); assert.equal(duplicate.issueDate, "2026-10-19");
  engine.archivePaymentTemplate(template.id); assert.throws(() => engine.createDraftFromTemplate(template.id, { issueDate: "2026-11-19" }));
  const restored = decryptState(encryptState(engine.snapshot(), "0123456789ab"), "0123456789ab");
  assert.equal(restored.paymentTemplates.length, 1); assert.equal(restored.paymentTemplates[0].archived, true); assert.equal(restored.checks[0].locale, "en-US");
});

test("one host outcome API maps the three customer-visible print results", () => {
  const printed = fixture(); const first = printed.engine.createDraft({ accountId: printed.account.id, payeeId: printed.payee.id, issueDate: "2026-09-19", amountCents: 100 }); printed.engine.markReady(first.id); let queued = printed.engine.queuePrint([first.id], printed.profile.id, printed.profile.printerKey, printed.profile.stockKey); assert.equal(printed.engine.resolvePrintOutcome(first.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, { kind: "PRINTED_CORRECTLY" }).status, "PRINTED");
  const marked = printed.engine.createDraft({ accountId: printed.account.id, payeeId: printed.payee.id, issueDate: "2026-09-19", amountCents: 200 }); printed.engine.markReady(marked.id); queued = printed.engine.queuePrint([marked.id], printed.profile.id, printed.profile.printerKey, printed.profile.stockKey); assert.equal(printed.engine.resolvePrintOutcome(marked.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: "MISALIGNED" }).status, "MISPRINTED");
  const notPrinted = printed.engine.createDraft({ accountId: printed.account.id, payeeId: printed.payee.id, issueDate: "2026-09-19", amountCents: 300 }); printed.engine.markReady(notPrinted.id); queued = printed.engine.queuePrint([notPrinted.id], printed.profile.id, printed.profile.printerKey, printed.profile.stockKey); assert.equal(printed.engine.resolvePrintOutcome(notPrinted.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, { kind: "NOT_PRINTED", reasonCode: "CANCELLED", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" }).status, "READY");
});

test("engine-level filtered reports and exports use the same ordered rows", () => {
  const { engine, account, payee } = fixture();
  engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100, category: "One" });
  engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 200, category: "Two" });
  const query = { accountId: account.id, category: "Two", sortBy: "checkNumber" as const, direction: "ASC" as const };
  assert.deepEqual(engine.queryRegister(query).map((row) => row.checkNumber), [1002]);
  assert.equal(engine.registerReport(query, "en-CA").totals.byCurrency.USD?.totalCents, 200);
  const csv = engine.exportFilteredRegister(query, "en-CA"); assert.match(csv, /1002/); assert.doesNotMatch(csv, /1001/);
});

test("payment favourites can clear a fixed amount and ordinary drafts use the payee memo", () => {
  const { engine, account, payee } = fixture();
  const draft = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 100 });
  assert.equal(draft.memo, "Supplies");
  const template = engine.createPaymentTemplate({ name: "Variable bill", accountId: account.id, payeeId: payee.id, amountCents: 500 });
  assert.equal(engine.updatePaymentTemplate(template.id, { amountCents: null }).amountCents, undefined);
  assert.throws(() => engine.createDraftFromTemplate(template.id, { issueDate: "2026-10-19" }));
  assert.equal(engine.createDraftFromTemplate(template.id, { issueDate: "2026-10-19", amountCents: 700 }).amountCents, 700);
});

test("sample locale overrides stay inside the account jurisdiction", () => {
  const { engine, profile } = fixture();
  assert.throws(() => engine.samplePlan(profile.id, profile.printerKey, "fr-CA"));
  assert.throws(() => engine.calibrationPlan(profile.id, profile.printerKey, "en-CA"));
});
