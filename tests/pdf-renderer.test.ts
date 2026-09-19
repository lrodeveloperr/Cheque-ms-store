import assert from "node:assert/strict";
import test from "node:test";
import { renderPrintPlanPdf, renderPrintPlanPdfArtifact } from "../harness/pdf-renderer.ts";
import { inspectPdfArtifact } from "../src/pdf-integrity.ts";
import { fixture } from "./test-helpers.ts";

test("renders a valid-looking Letter PDF from a print plan without changing the engine", () => {
  const { engine, profile } = fixture();
  const before = engine.snapshot();
  const plan = engine.samplePlan(profile.id, profile.printerKey);
  const pdf = renderPrintPlanPdf(plan);
  assert.equal(pdf.subarray(0, 8).toString("ascii"), "%PDF-1.7");
  assert.match(pdf.toString("ascii"), /\/MediaBox \[0 0 612 792\]/);
  assert.match(pdf.toString("ascii"), /\/BaseFont \/WorksBienSans-Regular/);
  assert.equal((pdf.toString("latin1").match(/\/FontFile2 /g) ?? []).length, 2);
  assert.match(pdf.toString("ascii"), /\/PrintScaling \/None/);
  assert.match(pdf.toString("ascii"), /CHECK PREVIEW/);
  assert.match(pdf.toString("ascii"), /\(SAMPLE \| 01\/01\/2000 \| SAMPLE PAYEE \| USD 123\.45/);
  assert.doesNotMatch(pdf.toString("ascii"), /\(#0 /);
  assert.match(pdf.toString("ascii"), /%%EOF\n$/);
  assert.deepEqual(engine.snapshot(), before);
});

test("preserves common North American accented text through WinAnsi PDF encoding", () => {
  const { engine, account, profile } = fixture();
  const payee = engine.createPayee({ name: "Jos\u00e9 Qu\u00e9bec" });
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 });
  engine.markReady(check.id);
  const plan = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan;
  const pdf = renderPrintPlanPdf(plan).toString("ascii");
  assert.match(pdf, /Jos\\351 Qu\\351bec/);
});

test("renders the complete Canadian French sample through the PDF adapter", () => {
  const { engine } = fixture();
  const account = engine.createAccount({ name: "Québec", companyName: "Exemple inc.", currency: "CAD", bankCountry: "CA", locale: "fr-CA", nextCheckNumber: 1 });
  const profile = engine.createCalibration({ accountId: account.id, name: "Français", printerKey: "fr", layout: "VOUCHER_TOP" });
  const pdf = renderPrintPlanPdf(engine.samplePlan(profile.id, profile.printerKey)).toString("ascii");
  assert.match(pdf, /SP\\311CIMEN/); assert.match(pdf, /B\\311N\\311FICIAIRE/); assert.match(pdf, /RELEV\\311 DE PAIEMENT/); assert.match(pdf, /D\\311TAILS DU CH\\310QUE/); assert.doesNotMatch(pdf, /PAYMENT RECORD|CHECK DETAILS|PAY TO THE ORDER OF/);
  const calibration = renderPrintPlanPdf(engine.calibrationPlan(profile.id, profile.printerKey)).toString("ascii"); assert.match(calibration, /\\311TALONNAGE DE L\\222IMPRIMANTE/); assert.doesNotMatch(calibration, /PRINTER CALIBRATION/);
});

test("renders preview furniture for every stock layout without cheque-band framing", () => {
  const { engine, account } = fixture();
  for (const layout of ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"] as const) {
    const profile = engine.createCalibration({ accountId: account.id, name: layout, printerKey: layout, layout }); const pdf = renderPrintPlanPdf(engine.samplePlan(profile.id, profile.printerKey)).toString("ascii");
    assert.equal((pdf.match(/\(CHECK PREVIEW\)/g) ?? []).length, layout === "THREE_UP" ? 3 : 1);
    assert.equal((pdf.match(/\(PAYMENT RECORD\)/g) ?? []).length, layout === "THREE_UP" ? 0 : 2);
    assert.match(pdf, /0\.96 g/);
  }
});

test("production output is deterministic, sparse, hashed, and structurally inspected", () => {
  const { engine, account, payee, profile } = fixture();
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 12345, memo: "Invoice 7" }); engine.markReady(check.id, profile.id);
  const queued = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey);
  const first = renderPrintPlanPdfArtifact(queued.plan); const second = renderPrintPlanPdfArtifact(queued.plan);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.integrity.renderMode, "production");
  assert.equal(first.integrity.planHash, queued.planHash);
  assert.deepEqual(first.integrity.checkIds, [check.id]);
  const raw = Buffer.from(first.bytes).toString("latin1");
  assert.doesNotMatch(raw, /WORKSBIEN BROWSER TEST|CHECK PREVIEW|SAMPLE - NOT NEGOTIABLE/);
  const inspection = inspectPdfArtifact(first, queued.plan);
  assert.ok(inspection.canadianDateClearancePt >= 18);
  assert.equal(inspection.productionFurnitureAbsent, true);
});
