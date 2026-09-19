import assert from "node:assert/strict";
import test from "node:test";
import { buildCalibrationPlan, defaultFieldAdjustments, defaultStubAdjustments, deriveCalibrationCorrection, estimateHelveticaWidthPt, NORTH_AMERICAN_TOP_CHEQUE, STOCK_KEYS, STOCK_LAYOUTS, STOCK_PROFILES, validateCalibrationForLayout } from "../src/calibration.ts";
import { DomainError } from "../src/errors.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import type { CalibrationProfile, PrintElement } from "../src/types.ts";
import { dependencies, fixture } from "./test-helpers.ts";

test("builds a bounded stock-driven voucher plan", () => {
  const { engine, account, payee, profile } = fixture(); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 12345, memo: "Invoice 7" }); engine.markReady(check.id);
  const { plan } = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey); assert.equal(plan.accountId, account.id); assert.equal(plan.printerKey, "printer-1"); assert.equal(plan.stockKey, profile.stockKey); assert.equal(plan.pages.length, 1); assert.equal(plan.pages[0].elements.filter((element) => element.kind === "text").length, 7);
  for (const element of plan.pages[0].elements) if (element.kind === "text") { assert.equal(element.fontFamily, "WorksBienSans"); assert.ok(element.xPt >= 0 && element.yPt >= 0 && element.xPt + element.widthPt <= 612 && element.yPt + element.heightPt <= 792); assert.ok(estimateHelveticaWidthPt(element.text, element.fontSizePt) <= element.widthPt + 0.01); }
  assert.match(plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "date")!.text, /^09\/18\/2026$/);
});

test("shrinks text to a floor and refuses text that cannot safely fit", () => {
  const { engine, account, profile } = fixture();
  const longPayee = engine.createPayee({ name: "International Manufacturing and Technical Services Corporation of America" });
  const check = engine.createDraft({ accountId: account.id, payeeId: longPayee.id, issueDate: "2026-09-18", amountCents: 12_345_67, memo: "1234567890123456789012345678901234567890123456789012345" }); engine.markReady(check.id);
  const plan = engine.queuePrint([check.id], profile.id, "printer-1", profile.stockKey).plan; const payeeElement = plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "payee"); assert.ok(payeeElement?.kind === "text" && payeeElement.fontSizePt < 11 && payeeElement.fontSizePt >= 8);
  const impossiblePayee = engine.createPayee({ name: "W".repeat(80) }); const impossible = engine.createDraft({ accountId: account.id, payeeId: impossiblePayee.id, issueDate: "2026-09-18", amountCents: 100 });
  assert.throws(() => engine.markReady(impossible.id, profile.id), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.payeeDoesNotFit"); assert.equal(engine.snapshot().checks.find((item) => item.id === impossible.id)?.status, "DRAFT");
  assert.throws(() => engine.createDraft({ accountId: account.id, payeeId: longPayee.id, issueDate: "2026-09-18", amountCents: 100, memo: "x".repeat(56) }));
});

test("three-up stock honors the selected starting slot without overprinting", () => {
  const { engine, account, payee } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" }); const profile = engine.createCalibration({ accountId: account.id, name: "Three-up", printerKey: "printer-3", layout: "THREE_UP" });
  const ids: string[] = []; for (let index = 0; index < 4; index++) { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 + index }); engine.markReady(check.id, profile.id); ids.push(check.id); }
  const fromMiddle = engine.queuePrint(ids.slice(0, 2), profile.id, "printer-3", profile.stockKey, 1, ["middle-sheet"]).plan; assert.equal(fromMiddle.pages.length, 1); assert.equal(fromMiddle.startSlot, 1); const dates = fromMiddle.pages[0].elements.filter((element) => element.kind === "text" && element.role === "date"); assert.deepEqual(dates.map((item) => item.yPt), [318, 582]);
  const fromBottom = engine.queuePrint(ids.slice(2), profile.id, "printer-3", profile.stockKey, 2, ["bottom-sheet", "next-sheet"]).plan; assert.equal(fromBottom.pages.length, 2); assert.throws(() => engine.queuePrint([], profile.id, "printer-3", profile.stockKey, 3));
});

test("voucher top, middle, and bottom use their measured cheque and stub sections", () => {
  const { engine, account, payee } = fixture(); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" });
  for (const layout of ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM"] as const) {
    const profile = engine.createCalibration({ accountId: account.id, name: layout, printerKey: layout, layout });
    const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 100 }); engine.markReady(check.id, profile.id);
    assert.throws(() => engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey, 1));
    const plan = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan; const geometry = STOCK_LAYOUTS[layout];
    const date = plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "date"); const stubs = plan.pages[0].elements.filter((element) => element.kind === "text" && element.role === "stub");
    assert.equal(date?.kind === "text" ? date.yPt : -1, geometry.origins[0].y + NORTH_AMERICAN_TOP_CHEQUE.fields.date.yPt); assert.deepEqual(stubs.map((stub) => stub.kind === "text" ? stub.yPt : -1), geometry.voucherStubs.map((stub) => stub.dataYPt)); assert.equal(plan.pages.length, 1);
  }
});

test("per-field and per-stub calibration is independent, bounded, and rollback-safe", () => {
  const { engine, account } = fixture();
  const profile = engine.createCalibration({ accountId: account.id, name: "Fine", printerKey: "fine", layout: "VOUCHER_TOP", printCheckNumber: true, fieldAdjustments: { date: { xPt: -1, yPt: -0.5 }, memo: { xPt: 2, yPt: 1 }, amountWords: { xPt: -18 } }, stubAdjustments: { first: { xPt: 1, yPt: 0.5 }, second: { xPt: -1, yPt: -0.5 } } });
  const sample = engine.samplePlan(profile.id, profile.printerKey); const item = (role: string) => sample.pages[0].elements.find((element) => element.kind === "text" && element.role === role);
  assert.equal(item("date")?.xPt, 449); assert.equal(item("date")?.yPt, 53.5); assert.equal(item("payee")?.xPt, 83); assert.equal(item("memo")?.xPt, 74); assert.equal(item("memo")?.yPt, 185);
  const stubs = sample.pages[0].elements.filter((element) => element.kind === "text" && element.role === "stub"); assert.deepEqual(stubs.map((stub) => [stub.xPt, stub.yPt]), [[21, 338.5], [19, 589.5]]);
  const before = engine.snapshot(); assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { memo: { xPt: 18.5 } } })); assert.deepEqual(engine.snapshot(), before);
  assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { memo: { xPt: 0.25 } } })); assert.deepEqual(engine.snapshot(), before);
  assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { date: { yPt: 12 } } })); assert.deepEqual(engine.snapshot(), before);
  assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { payee: { xPt: 2 } } })); assert.deepEqual(engine.snapshot(), before);
  assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { memo: { yPt: 18 } } })); assert.deepEqual(engine.snapshot(), before);
  assert.throws(() => engine.updateCalibration(profile.id, { fieldAdjustments: { memo: { xPt: 0, stray: 1 } as any } })); assert.deepEqual(engine.snapshot(), before);
  const updated = engine.updateCalibration(profile.id, { fieldAdjustments: { amountWords: { xPt: 18 } }, stubAdjustments: { first: { xPt: -18 }, second: { xPt: 18 } } }); assert.equal(updated.fieldAdjustments.amountWords.xPt, 18); assert.equal(updated.fieldAdjustments.amountWords.yPt, 0); assert.equal(updated.stubAdjustments.first.xPt, -18); assert.equal(updated.stubAdjustments.second.xPt, 18);
  assert.throws(() => engine.createCalibration({ accountId: account.id, name: "No voucher stubs", printerKey: "3", layout: "THREE_UP", stubAdjustments: { first: { xPt: 1 } } }));
});

test("sample and calibration documents are localized, currency-aware, and stateless", () => {
  const { engine } = fixture(); const cad = engine.createAccount({ name: "Canada", companyName: "CA Co", currency: "CAD", bankCountry: "CA", nextCheckNumber: 1 });
  assert.throws(() => engine.createCalibration({ accountId: cad.id, name: "Bad CAD profile", printerKey: "cad-printer", layout: "VOUCHER_TOP", dateFormat: "DD/MM/YYYY" }));
  const profile = engine.createCalibration({ accountId: cad.id, name: "CAD profile", printerKey: "cad-printer", layout: "VOUCHER_TOP", printCheckNumber: true, amountWordsFill: true, dateFormat: "YYYY-MM-DD" });
  const before = engine.snapshot(); const sample = engine.samplePlan(profile.id, "cad-printer", "en-CA"); assert.deepEqual(engine.snapshot(), before); assert.equal(sample.checkIds.length, 0); assert.equal(sample.documentKind, "SAMPLE");
  const words = sample.pages[0].elements.find((element) => element.kind === "text" && element.role === "amount_words"); assert.ok(words?.kind === "text" && words.text.includes("Canadian Dollars") && words.text.startsWith("*** ") && !words.text.endsWith("***"));
  const amount = sample.pages[0].elements.find((element) => element.kind === "text" && element.role === "amount_numeric"); assert.equal(amount?.kind === "text" ? amount.text : "", "123.45");
  const sampleNumber = sample.pages[0].elements.find((element) => element.kind === "text" && element.role === "check_number"); assert.ok(sampleNumber?.kind === "text" && sampleNumber.text === "SAMPLE");
  assert.ok(sample.pages[0].elements.filter((element) => element.kind === "text" && element.role === "stub").every((element) => element.kind === "text" && element.text.startsWith("SAMPLE |")));
  const calibration = engine.calibrationPlan(profile.id, "cad-printer", "en-CA"); assert.equal(calibration.warningKeys[0], "warning.actualSize"); assert.match((calibration.pages[0].elements.at(-1) as Extract<PrintElement, { kind: "text" }>).text, / in \/ .* mm/);
  assert.throws(() => engine.samplePlan(profile.id, "wrong"));
});

test("North American defaults preserve the amount clear area and bottom MICR band", () => {
  const { engine, profile } = fixture(); const sample = engine.samplePlan(profile.id, profile.printerKey);
  const textElements = sample.pages[0].elements.filter((element) => element.kind === "text");
  const byRole = (role: Extract<PrintElement, { kind: "text" }>["role"]) => textElements.find((element) => element.role === role)!;
  const date = byRole("date"); const amount = byRole("amount_numeric"); const payee = byRole("payee"); const words = byRole("amount_words"); const memo = byRole("memo");
  assert.equal(date.xPt + date.widthPt, 554);
  assert.equal(amount.xPt + amount.widthPt, 554);
  assert.equal(payee.xPt + payee.widthPt, NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.canadianDollarLeftPt - NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.clearPt - 1);
  assert.equal(payee.align, "left");
  assert.ok(payee.yPt < memo.yPt);
  assert.ok(words.yPt >= NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.yPt + NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.heightPt + NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.clearPt);
  assert.equal(memo.align, "left");
  assert.ok(memo.yPt + memo.heightPt < NORTH_AMERICAN_TOP_CHEQUE.micrClearBand.topPt);
  assert.ok(date.fontSizePt >= 10 && amount.fontSizePt >= 10 && words.fontSizePt >= 10);
});

test("every accepted actual-size calibration keeps text and stroke ink on US Letter", () => {
  const inBounds = (element: PrintElement) => element.kind === "line" ? [element.x1Pt, element.x2Pt].every((x) => x - element.strokeWidthPt / 2 >= 0 && x + element.strokeWidthPt / 2 <= 612) && [element.y1Pt, element.y2Pt].every((y) => y - element.strokeWidthPt / 2 >= 0 && y + element.strokeWidthPt / 2 <= 792) : element.xPt >= 0 && element.yPt >= 0 && element.xPt + element.widthPt <= 612 && element.yPt + element.heightPt <= 792;
  for (const layout of ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"] as const) { let accepted = 0; for (let x = -36; x <= 36; x += 2) for (let y = -36; y <= 36; y += 2) {
    const profile: CalibrationProfile = { id: "p", accountId: "a", name: "p", printerKey: "p", stockKey: layout, layout, printCheckNumber: false, dateFormat: "YYYY-MM-DD", amountWordsCurrencyLabel: true, amountWordsFill: true, xOffsetPt: x, yOffsetPt: y, scalePercent: 100, fieldAdjustments: defaultFieldAdjustments(), stubAdjustments: defaultStubAdjustments(), createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
    try { validateCalibrationForLayout(profile); } catch { continue; } accepted++; assert.ok(buildCalibrationPlan(profile, "USD", "US", "d", "2026-09-18T00:00:00.000Z").pages[0].elements.every(inBounds), `${layout} x=${x} y=${y}`);
  } assert.ok(accepted > 0, `${layout} must have accepted calibration combinations`); }
});

test("bank jurisdiction is independent from currency and Canadian USD is explicit", () => {
  const { engine } = fixture();
  const account = engine.createAccount({ name: "Canada USD", companyName: "CA Co", currency: "USD", bankCountry: "CA", nextCheckNumber: 2001 });
  const payee = engine.createPayee({ name: "Quebec Supplier" });
  const profile = engine.createCalibration({ accountId: account.id, name: "CA USD", printerKey: "ca", layout: "VOUCHER_TOP", amountWordsCurrencyLabel: false });
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 12345 }); engine.markReady(check.id);
  const plan = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan;
  assert.equal(plan.bankCountry, "CA"); assert.equal(plan.currency, "USD");
  assert.match(plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "amount_words")?.text ?? "", /Dollars U\.S\. Funds$/);
  assert.equal(plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "amount_numeric")?.text, "123.45");
  assert.throws(() => engine.createAccount({ name: "US CAD", companyName: "US Co", currency: "CAD", bankCountry: "US", nextCheckNumber: 1 }));
});

test("Canadian French USD always retains its required currency designation", () => {
  const engine = new CheckPrinterEngine(undefined, dependencies()); const account = engine.createAccount({ name: "USD Canada", companyName: "Exemple", currency: "USD", bankCountry: "CA", locale: "fr-CA", nextCheckNumber: 1 }); const payee = engine.createPayee({ name: "Fournitures Québec" });
  const profile = engine.createCalibration({ accountId: account.id, name: "USD français", printerKey: "fr-usd", layout: "VOUCHER_TOP", amountWordsCurrencyLabel: false }); const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 12345 }); engine.markReady(check.id, profile.id);
  const words = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan.pages[0].elements.find((element) => element.kind === "text" && element.role === "amount_words"); assert.match(words?.kind === "text" ? words.text : "", /dollars US/);
});

test("rejects unsupported PDF glyphs before a draft becomes ready", () => {
  const { engine } = fixture(); assert.throws(() => engine.createPayee({ name: "Δelta Services" }), (error: unknown) => error instanceof DomainError && error.messageKey === "validation.fontUnsupported" && error.details.codePoint === "U+0394");
});

test("Ready is bound to the exact profile that passed render validation", () => {
  const { engine, account, payee } = fixture();
  const shortProfile = engine.createCalibration({ accountId: account.id, name: "Short words", printerKey: "short", layout: "VOUCHER_TOP", amountWordsFill: false, amountWordsCurrencyLabel: false });
  const defaultProfile = engine.createCalibration({ accountId: account.id, name: "Default words", printerKey: "default", layout: "VOUCHER_TOP" });
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 88_888_888_888 });
  assert.equal(engine.markReady(check.id, shortProfile.id).readyCalibrationProfileId, shortProfile.id);
  const before = engine.snapshot(); assert.throws(() => engine.queuePrint([check.id], defaultProfile.id, defaultProfile.printerKey, defaultProfile.stockKey)); assert.deepEqual(engine.snapshot(), before);
  assert.equal(engine.queuePrint([check.id], shortProfile.id, shortProfile.printerKey, shortProfile.stockKey).plan.calibrationProfileId, shortProfile.id);
});

test("Canadian minimum font sizes apply at locked actual size", () => {
  const { engine } = fixture(); const account = engine.createAccount({ name: "Canada actual size", companyName: "CA Co", currency: "CAD", bankCountry: "CA", nextCheckNumber: 3001 });
  const profile = engine.createCalibration({ accountId: account.id, name: "CA 100", printerKey: "ca-100", layout: "VOUCHER_TOP", scalePercent: 100 });
  const plan = engine.samplePlan(profile.id, profile.printerKey, "en-CA");
  for (const role of ["date", "payee", "amount_numeric", "amount_words", "memo"] as const) {
    const item = plan.pages[0].elements.find((element) => element.kind === "text" && element.role === role);
    assert.ok(item?.kind === "text" && item.fontSizePt >= 10, `${role} must remain at least 10pt after scaling`);
  }
});

test("rejects individually plausible but combined unsafe calibration", () => {
  const { engine, account } = fixture(); assert.throws(() => engine.createCalibration({ accountId: account.id, name: "Scaled", printerKey: "p", layout: "VOUCHER_TOP", scalePercent: 99.5 })); assert.throws(() => engine.createCalibration({ accountId: account.id, name: "Unsafe", printerKey: "p", layout: "THREE_UP", xOffsetPt: 37 })); assert.throws(() => engine.createCalibration({ accountId: account.id, name: "Combined", printerKey: "p", layout: "VOUCHER_TOP", xOffsetPt: 36, yOffsetPt: 36 }));
});

test("measured ruler error becomes a safe half-point calibration correction", () => {
  assert.deepEqual(deriveCalibrationCorrection({ currentXOffsetPt: 0, currentYOffsetPt: 0, measuredXError: 0.1, measuredYError: -0.05, unit: "in" }), { xOffsetPt: -7, yOffsetPt: 3.5 });
  assert.deepEqual(deriveCalibrationCorrection({ currentXOffsetPt: 1, currentYOffsetPt: -1, measuredXError: 1, measuredYError: -2, unit: "mm" }), { xOffsetPt: -2, yOffsetPt: 4.5 });
  assert.throws(() => deriveCalibrationCorrection({ currentXOffsetPt: 0, currentYOffsetPt: 0, measuredXError: 1, measuredYError: 0, unit: "in" }));
});

test("every launch stock choice resolves to one explicit measured profile", () => {
  for (const layout of ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"] as const) {
    assert.equal(STOCK_PROFILES[layout].key, STOCK_KEYS[layout]);
    assert.equal(STOCK_PROFILES[layout].page, "US_LETTER");
    assert.equal(STOCK_PROFILES[layout].qualification, "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION");
  }
});
