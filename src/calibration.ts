import { hashCanonical } from "./audit.ts";
import { invariant } from "./errors.ts";
import { localize, type SupportedLocale } from "./localization.ts";
import { amountToWords, formatAmount } from "./money.ts";
import { assertPdfFontPrintable, estimatePdfTextWidthPt } from "./pdf-font.ts";
import type { BankCountry, CalibrationField, CalibrationOffset, CalibrationProfile, CheckRecord, Currency, FieldAdjustments, LayoutKind, Payee, PrintElement, PrintPage, PrintPlan, StubAdjustments, VoucherStub } from "./types.ts";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;

// Standards-safe default for 8.5 x 3.5 inch North American business cheque stock.
// Points are measured from the top-left of the Letter page. Vendor stock still
// requires calibration because the standards define safe areas, not one
// universal set of printable-field coordinates.
export const NORTH_AMERICAN_TOP_CHEQUE = {
  stockKey: "WB-VOUCHER-TOP-LETTER-3.5-3.5-4.0",
  widthPt: 612,
  heightPt: 252,
  micrClearBand: { topPt: 207, heightPt: 45 },
  convenienceAmount: { xPt: 450, yPt: 96, widthPt: 110, heightPt: 30, clearPt: 18, canadianDollarLeftPt: 441 },
  fields: {
    checkNumber: { xPt: 505, yPt: 35, widthPt: 49, heightPt: 13 },
    date: { xPt: 450, yPt: 54, widthPt: 104, heightPt: 14 },
    payee: { xPt: 83, yPt: 104, widthPt: 339, heightPt: 16 },
    amountNumeric: { xPt: 455, yPt: 107, widthPt: 99, heightPt: 16 },
    amountWords: { xPt: 45, yPt: 147, widthPt: 515, heightPt: 14 },
    memo: { xPt: 72, yPt: 184, widthPt: 245, heightPt: 13 }
  }
} as const;

export const STOCK_KEYS: Record<LayoutKind, string> = {
  VOUCHER_TOP: NORTH_AMERICAN_TOP_CHEQUE.stockKey,
  VOUCHER_MIDDLE: "WB-VOUCHER-MIDDLE-LETTER-3.5-3.5-4.0",
  VOUCHER_BOTTOM: "WB-VOUCHER-BOTTOM-LETTER-3.5-4.0-3.5",
  THREE_UP: "WB-THREE-UP-LETTER-3.5-WITH-0.167-GAPS"
};

export const STOCK_PROFILES: Record<LayoutKind, { key: string; displayName: string; page: "US_LETTER"; chequeHeightPt: 252; perforationsPt: readonly number[]; qualification: "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION" }> = {
  VOUCHER_TOP: { key: STOCK_KEYS.VOUCHER_TOP, displayName: "Business voucher - cheque at top", page: "US_LETTER", chequeHeightPt: 252, perforationsPt: [252, 504], qualification: "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION" },
  VOUCHER_MIDDLE: { key: STOCK_KEYS.VOUCHER_MIDDLE, displayName: "Business voucher - cheque in middle", page: "US_LETTER", chequeHeightPt: 252, perforationsPt: [252, 504], qualification: "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION" },
  VOUCHER_BOTTOM: { key: STOCK_KEYS.VOUCHER_BOTTOM, displayName: "Business voucher - cheque at bottom", page: "US_LETTER", chequeHeightPt: 252, perforationsPt: [252, 540], qualification: "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION" },
  THREE_UP: { key: STOCK_KEYS.THREE_UP, displayName: "Three business cheques per sheet", page: "US_LETTER", chequeHeightPt: 252, perforationsPt: [252, 264, 516, 528], qualification: "MEASURED_TEMPLATE_REQUIRES_PHYSICAL_CONFIRMATION" }
};

export interface VoucherStubGeometry {
  key: VoucherStub;
  topPt: number;
  heightPt: number;
  dataYPt: number;
}

export interface StockLayoutGeometry {
  slots: number;
  origins: ReadonlyArray<{ x: number; y: number }>;
  voucherStubs: ReadonlyArray<VoucherStubGeometry>;
}

export const STOCK_LAYOUTS: Record<LayoutKind, StockLayoutGeometry> = {
  VOUCHER_TOP: {
    slots: 1,
    origins: [{ x: 0, y: 0 }],
    voucherStubs: [{ key: "first", topPt: 252, heightPt: 252, dataYPt: 338 }, { key: "second", topPt: 504, heightPt: 288, dataYPt: 590 }]
  },
  VOUCHER_MIDDLE: {
    slots: 1,
    origins: [{ x: 0, y: 252 }],
    voucherStubs: [{ key: "first", topPt: 0, heightPt: 252, dataYPt: 86 }, { key: "second", topPt: 504, heightPt: 288, dataYPt: 590 }]
  },
  VOUCHER_BOTTOM: {
    slots: 1,
    origins: [{ x: 0, y: 540 }],
    voucherStubs: [{ key: "first", topPt: 0, heightPt: 252, dataYPt: 86 }, { key: "second", topPt: 252, heightPt: 288, dataYPt: 338 }]
  },
  THREE_UP: { slots: 3, origins: [{ x: 0, y: 0 }, { x: 0, y: 264 }, { x: 0, y: 528 }], voucherStubs: [] }
};

export const CALIBRATION_FIELD_KEYS = ["checkNumber", "date", "payee", "amountNumeric", "amountWords", "memo"] as const satisfies ReadonlyArray<CalibrationField>;
export const VOUCHER_STUB_KEYS = ["first", "second"] as const satisfies ReadonlyArray<VoucherStub>;
export const MAX_LOCAL_ADJUSTMENT_PT = 18;

const zeroOffset = (): CalibrationOffset => ({ xPt: 0, yPt: 0 });

export function defaultFieldAdjustments(): FieldAdjustments {
  return { checkNumber: zeroOffset(), date: zeroOffset(), payee: zeroOffset(), amountNumeric: zeroOffset(), amountWords: zeroOffset(), memo: zeroOffset() };
}

export function defaultStubAdjustments(): StubAdjustments {
  return { first: zeroOffset(), second: zeroOffset() };
}

export function validateCalibration(profile: Pick<CalibrationProfile, "xOffsetPt" | "yOffsetPt" | "scalePercent">): void {
  invariant(Number.isFinite(profile.xOffsetPt) && Math.abs(profile.xOffsetPt) <= 36, "VALIDATION_ERROR", "Horizontal calibration must be within half an inch.");
  invariant(Number.isFinite(profile.yOffsetPt) && Math.abs(profile.yOffsetPt) <= 36, "VALIDATION_ERROR", "Vertical calibration must be within half an inch.");
  invariant(profile.scalePercent === 100, "VALIDATION_ERROR", "Production cheque geometry must remain at 100% scale.", { scalePercent: profile.scalePercent }, "validation.calibrationProtectedArea");
}

function adjusted(profile: Pick<CalibrationProfile, "xOffsetPt" | "yOffsetPt" | "scalePercent">, x: number, y: number, local: CalibrationOffset = { xPt: 0, yPt: 0 }): { x: number; y: number } {
  const scale = profile.scalePercent / 100;
  return { x: profile.xOffsetPt + x * scale + local.xPt, y: profile.yOffsetPt + y * scale + local.yPt };
}

function assertAdjustedPoint(x: number, y: number): void {
  invariant(x >= 0 && x <= LETTER_WIDTH && y >= 0 && y <= LETTER_HEIGHT, "VALIDATION_ERROR", "Calibration combination moves printable content outside US Letter.");
}

function assertLineInk(x1: number, y1: number, x2: number, y2: number, strokeWidthPt: number): void {
  const half = strokeWidthPt / 2;
  assertAdjustedPoint(Math.min(x1, x2) - half, Math.min(y1, y2) - half);
  assertAdjustedPoint(Math.max(x1, x2) + half, Math.max(y1, y2) + half);
}

function intersects(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function validateLocalAdjustments(profile: Pick<CalibrationProfile, "fieldAdjustments" | "stubAdjustments" | "layout">): void {
  invariant(profile.fieldAdjustments && typeof profile.fieldAdjustments === "object", "VALIDATION_ERROR", "Field calibration adjustments are required.");
  invariant(profile.stubAdjustments && typeof profile.stubAdjustments === "object", "VALIDATION_ERROR", "Voucher calibration adjustments are required.");
  invariant(Object.keys(profile.fieldAdjustments).length === CALIBRATION_FIELD_KEYS.length && CALIBRATION_FIELD_KEYS.every((key) => Object.hasOwn(profile.fieldAdjustments, key)), "VALIDATION_ERROR", "Field calibration adjustment keys are invalid.");
  invariant(Object.keys(profile.stubAdjustments).length === VOUCHER_STUB_KEYS.length && VOUCHER_STUB_KEYS.every((key) => Object.hasOwn(profile.stubAdjustments, key)), "VALIDATION_ERROR", "Voucher calibration adjustment keys are invalid.");
  const entries = [...CALIBRATION_FIELD_KEYS.map((key) => profile.fieldAdjustments[key]), ...VOUCHER_STUB_KEYS.map((key) => profile.stubAdjustments[key])];
  for (const value of entries) for (const axis of [value?.xPt, value?.yPt]) invariant(Number.isFinite(axis) && Math.abs(axis) <= MAX_LOCAL_ADJUSTMENT_PT && Number.isInteger(axis * 2), "VALIDATION_ERROR", "Local calibration must use half-point steps within one quarter inch.", { maximumPt: MAX_LOCAL_ADJUSTMENT_PT }, "validation.calibrationProtectedArea");
  if (profile.layout === "THREE_UP") invariant(VOUCHER_STUB_KEYS.every((key) => profile.stubAdjustments[key].xPt === 0 && profile.stubAdjustments[key].yPt === 0), "VALIDATION_ERROR", "Three-up stock cannot use voucher-stub calibration.");
}

export function validateCalibrationForLayout(profile: Pick<CalibrationProfile, "xOffsetPt" | "yOffsetPt" | "scalePercent" | "layout" | "fieldAdjustments" | "stubAdjustments">): void {
  validateCalibration(profile);
  invariant(Object.hasOwn(STOCK_LAYOUTS, profile.layout), "VALIDATION_ERROR", "Unsupported check layout.");
  validateLocalAdjustments(profile);
  const layout = STOCK_LAYOUTS[profile.layout];
  const origins = layout.origins;
  const fields = NORTH_AMERICAN_TOP_CHEQUE.fields;
  const boxes = [
    { key: "checkNumber", role: "check_number", x: fields.checkNumber.xPt, y: fields.checkNumber.yPt, w: fields.checkNumber.widthPt, h: fields.checkNumber.heightPt },
    { key: "date", role: "date", x: fields.date.xPt, y: fields.date.yPt, w: fields.date.widthPt, h: fields.date.heightPt },
    { key: "payee", role: "payee", x: fields.payee.xPt, y: fields.payee.yPt, w: fields.payee.widthPt, h: fields.payee.heightPt },
    { key: "amountNumeric", role: "amount_numeric", x: fields.amountNumeric.xPt, y: fields.amountNumeric.yPt, w: fields.amountNumeric.widthPt, h: fields.amountNumeric.heightPt },
    { key: "amountWords", role: "amount_words", x: fields.amountWords.xPt, y: fields.amountWords.yPt, w: fields.amountWords.widthPt, h: fields.amountWords.heightPt },
    { key: "memo", role: "memo", x: fields.memo.xPt, y: fields.memo.yPt, w: fields.memo.widthPt, h: fields.memo.heightPt }
  ];
  for (const origin of origins) {
    const adjustedBoxes: Array<{ role: string; x: number; y: number; w: number; h: number }> = [];
    for (const box of boxes) {
      const offset = profile.fieldAdjustments[box.key as CalibrationField];
      const first = adjusted(profile, box.x, origin.y + box.y, offset);
      const second = adjusted(profile, box.x + box.w, origin.y + box.y + box.h, offset);
      assertAdjustedPoint(first.x, first.y); assertAdjustedPoint(second.x, second.y);
      const adjustedBox = { x: first.x, y: first.y, w: second.x - first.x, h: second.y - first.y };
      adjustedBoxes.push({ role: box.role, ...adjustedBox });
      const micrBand = { x: 0, y: origin.y + NORTH_AMERICAN_TOP_CHEQUE.micrClearBand.topPt, w: LETTER_WIDTH, h: NORTH_AMERICAN_TOP_CHEQUE.micrClearBand.heightPt };
      invariant(!intersects(adjustedBox, micrBand), "VALIDATION_ERROR", "Calibration moves cheque data into the protected MICR band.", { role: box.role }, "validation.calibrationProtectedArea");
      const amount = NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount;
      const protectedLeft = amount.canadianDollarLeftPt - amount.clearPt;
      const amountClear = { x: protectedLeft, y: origin.y + amount.yPt - amount.clearPt, w: amount.xPt + amount.widthPt + amount.clearPt - protectedLeft, h: amount.heightPt + amount.clearPt * 2 };
      if (box.role === "amount_numeric") {
        const amountInterior = { x: amount.xPt, y: origin.y + amount.yPt, w: amount.widthPt, h: amount.heightPt };
        invariant(adjustedBox.x >= amountInterior.x && adjustedBox.y >= amountInterior.y && adjustedBox.x + adjustedBox.w <= amountInterior.x + amountInterior.w && adjustedBox.y + adjustedBox.h <= amountInterior.y + amountInterior.h, "VALIDATION_ERROR", "Calibration moves the numeric amount outside its stock rectangle.", { role: box.role }, "validation.calibrationProtectedArea");
      } else {
        invariant(!intersects(adjustedBox, amountClear), "VALIDATION_ERROR", "Calibration moves cheque data into the convenience-amount clear area.", { role: box.role }, "validation.calibrationProtectedArea");
      }
    }
    for (let left = 0; left < adjustedBoxes.length; left++) for (let right = left + 1; right < adjustedBoxes.length; right++) invariant(!intersects(adjustedBoxes[left], adjustedBoxes[right]), "VALIDATION_ERROR", "Calibration makes two cheque fields overlap.", { firstRole: adjustedBoxes[left].role, secondRole: adjustedBoxes[right].role }, "validation.calibrationProtectedArea");
  }
  for (const stub of layout.voucherStubs) {
    const offset = profile.stubAdjustments[stub.key];
    const first = adjusted(profile, 20, stub.dataYPt, offset);
    const second = adjusted(profile, 592, stub.dataYPt + 13, offset);
    assertAdjustedPoint(first.x, first.y); assertAdjustedPoint(second.x, second.y);
    invariant(first.y >= stub.topPt && second.y <= stub.topPt + stub.heightPt, "VALIDATION_ERROR", "Calibration moves voucher data outside its stock section.", { stub: stub.key }, "validation.calibrationProtectedArea");
  }
  for (let x = 36; x <= 576; x += 36) { const point = adjusted(profile, x, 36); assertLineInk(point.x, point.y - 5, point.x, point.y + 5, 0.5); }
  for (let y = 36; y <= 756; y += 36) { const point = adjusted(profile, 36, y); assertLineInk(point.x - 5, point.y, point.x + 5, point.y, 0.5); }
}

export function assertHelveticaPrintable(value: string): void {
  try { assertPdfFontPrintable(value); }
  catch (error) {
    const details = error instanceof Error && "details" in error ? (error as Error & { details?: Record<string, string> }).details : undefined;
    invariant(false, "VALIDATION_ERROR", "Text contains a character unavailable in the cheque PDF font.", details, "validation.fontUnsupported");
  }
}

export function estimateHelveticaWidthPt(value: string, fontSizePt: number): number {
  return estimatePdfTextWidthPt(value, fontSizePt);
}

export function deriveCalibrationCorrection(input: { currentXOffsetPt: number; currentYOffsetPt: number; measuredXError: number; measuredYError: number; unit: "pt" | "in" | "mm" }): { xOffsetPt: number; yOffsetPt: number } {
  const multiplier = input.unit === "pt" ? 1 : input.unit === "in" ? 72 : 72 / 25.4;
  const roundHalf = (value: number) => Math.round(value * 2) / 2;
  const result = { xOffsetPt: roundHalf(input.currentXOffsetPt - input.measuredXError * multiplier), yOffsetPt: roundHalf(input.currentYOffsetPt - input.measuredYError * multiplier) };
  validateCalibration({ ...result, scalePercent: 100 });
  return result;
}

function fittedFontSize(value: string, widthPt: number, preferredPt: number, minimumPt: number, role: string): number {
  const preferredWidth = estimateHelveticaWidthPt(value, preferredPt);
  const result = preferredWidth <= widthPt ? preferredPt : preferredPt * widthPt / preferredWidth;
  invariant(result >= minimumPt, "VALIDATION_ERROR", "Text does not fit the configured stock field.", { field: role, role, requiredFontSizePt: result.toFixed(1), minimumFontSizePt: minimumPt }, `validation.${role}DoesNotFit`);
  return Math.min(preferredPt, result);
}

function text(profile: CalibrationProfile, role: Extract<PrintElement, { kind: "text" }>["role"], value: string, x: number, y: number, width: number, preferredPt = 10, minimumPt = 7, align: "left" | "right" | "center" = "left", offset: CalibrationOffset = { xPt: 0, yPt: 0 }): PrintElement {
  const pos = adjusted(profile, x, y, offset);
  const scale = profile.scalePercent / 100;
  const baseFontSize = fittedFontSize(value, width, preferredPt / scale, minimumPt / scale, role);
  return { kind: "text", role, text: value, xPt: pos.x, yPt: pos.y, widthPt: width * scale, heightPt: baseFontSize * 1.4 * scale, fontSizePt: baseFontSize * scale, fontFamily: "WorksBienSans", align };
}

function formatDate(value: string, format: CalibrationProfile["dateFormat"]): string {
  const [year, month, day] = value.split("-");
  if (format === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  if (format === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  return value;
}

function wordsForProfile(check: CheckRecord, profile: CalibrationProfile, bankCountry: BankCountry, locale: SupportedLocale): string {
  let words = amountToWords(check.amountCents, check.currency, locale);
  if (bankCountry === "CA" && check.currency === "USD") { if (locale !== "fr-CA") words += " U.S. Funds"; }
  else if (!profile.amountWordsCurrencyLabel) words = locale === "fr-CA" ? words.replace(/ (?:dollar|dollars) (?:US|canadien|canadiens) et (\d{2}\/100)$/u, " et $1") : words.replace(/ (?:Canadian )?Dollars$/, "");
  if (!profile.amountWordsFill) return words;
  return bankCountry === "CA" ? `*** ${words}` : `*** ${words} ***`;
}

function decimalAmount(cents: number, locale: SupportedLocale): string { return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100); }

function numericAmount(check: CheckRecord, bankCountry: BankCountry, locale: SupportedLocale): string {
  if (bankCountry === "CA") return decimalAmount(check.amountCents, locale);
  return formatAmount(check.amountCents, check.currency, locale);
}

function checkElements(profile: CalibrationProfile, bankCountry: BankCountry, locale: SupportedLocale, check: CheckRecord, payee: Payee, originY: number, voucherStubs: ReadonlyArray<VoucherStubGeometry>): PrintElement[] {
  const elements: PrintElement[] = [];
  const fields = NORTH_AMERICAN_TOP_CHEQUE.fields;
  if (profile.printCheckNumber) elements.push(text(profile, "check_number", String(check.checkNumber), fields.checkNumber.xPt, originY + fields.checkNumber.yPt, fields.checkNumber.widthPt, 9, 7, "right", profile.fieldAdjustments.checkNumber));
  const countryMinimum = bankCountry === "CA" ? 10 : 8;
  elements.push(
    text(profile, "date", formatDate(check.issueDate, profile.dateFormat), fields.date.xPt, originY + fields.date.yPt, fields.date.widthPt, 10, 10, "right", profile.fieldAdjustments.date),
    text(profile, "payee", payee.name, fields.payee.xPt, originY + fields.payee.yPt, fields.payee.widthPt, 11, countryMinimum, "left", profile.fieldAdjustments.payee),
    text(profile, "amount_numeric", numericAmount(check, bankCountry, locale), fields.amountNumeric.xPt, originY + fields.amountNumeric.yPt, fields.amountNumeric.widthPt, 11, 10, "right", profile.fieldAdjustments.amountNumeric),
    text(profile, "amount_words", wordsForProfile(check, profile, bankCountry, locale), fields.amountWords.xPt, originY + fields.amountWords.yPt, fields.amountWords.widthPt, 10, 10, "left", profile.fieldAdjustments.amountWords),
    text(profile, "memo", check.memo, fields.memo.xPt, originY + fields.memo.yPt, fields.memo.widthPt, bankCountry === "CA" ? 10 : 9, bankCountry === "CA" ? 10 : 7, "left", profile.fieldAdjustments.memo)
  );
  if (voucherStubs.length) {
    const stub = `#${check.checkNumber} | ${formatDate(check.issueDate, profile.dateFormat)} | ${payee.name} | ${check.currency} ${decimalAmount(check.amountCents, locale)} | ${check.memo}`;
    for (const section of voucherStubs) elements.push(text(profile, "stub", stub, 20, section.dataYPt, 572, 9, 6, "left", profile.stubAdjustments[section.key]));
  }
  return elements;
}

function assertPageBounds(page: PrintPage): void {
  for (const element of page.elements) {
    if (element.kind === "line") { assertLineInk(element.x1Pt, element.y1Pt, element.x2Pt, element.y2Pt, element.strokeWidthPt); continue; }
    invariant(element.xPt >= 0 && element.yPt >= 0 && element.xPt + element.widthPt <= LETTER_WIDTH + 0.01 && element.yPt + element.heightPt <= LETTER_HEIGHT + 0.01, "VALIDATION_ERROR", "A calibrated field falls outside US Letter bounds.", { role: element.role });
    invariant(estimateHelveticaWidthPt(element.text, element.fontSizePt) <= element.widthPt + 0.01, "VALIDATION_ERROR", "Rendered text exceeds its field width.", { role: element.role }, "validation.textDoesNotFit");
  }
}

export function buildCheckPrintPlan(input: { checks: CheckRecord[]; payees: Payee[]; profile: CalibrationProfile; bankCountry: BankCountry; locale?: SupportedLocale; documentId: string; generatedAt: string; startSlot?: number; sheetIds?: string[] }): PrintPlan {
  validateCalibrationForLayout(input.profile);
  invariant(input.checks.length > 0, "VALIDATION_ERROR", "At least one check is required.");
  const locale = input.locale ?? (input.bankCountry === "CA" ? "en-CA" : "en-US");
  const layout = STOCK_LAYOUTS[input.profile.layout];
  const startSlot = input.startSlot ?? 0;
  invariant(Number.isInteger(startSlot) && startSlot >= 0 && startSlot < layout.slots, "VALIDATION_ERROR", "Starting stock slot is invalid.", { startSlot });
  if (input.profile.layout !== "THREE_UP") invariant(startSlot === 0, "VALIDATION_ERROR", "Voucher stock always starts at slot zero.");
  const pages: PrintPage[] = [];
  let cursor = 0; let pageStartSlot = startSlot;
  while (cursor < input.checks.length) {
    const capacity = layout.slots - pageStartSlot;
    const batch = input.checks.slice(cursor, cursor + capacity);
    const page: PrintPage = { widthPt: LETTER_WIDTH, heightPt: LETTER_HEIGHT, elements: [] };
    batch.forEach((check, index) => {
      const payee = input.payees.find((candidate) => candidate.id === check.payeeId);
      invariant(payee, "NOT_FOUND", "Payee not found while constructing print plan.");
      const slot = pageStartSlot + index;
      page.elements.push(...checkElements(input.profile, input.bankCountry, locale, check, { ...payee, name: check.payeeSnapshot.name, address: check.payeeSnapshot.address }, layout.origins[slot].y, layout.voucherStubs));
    });
    assertPageBounds(page); pages.push(page); cursor += batch.length; pageStartSlot = 0;
  }
  const warnings = new Set(["warning.verifyStock", ...input.checks.flatMap((check) => check.warningKeys)]);
  return { version: 4, documentId: input.documentId, documentKind: "CHECKS", currency: input.checks[0].currency, locale, bankCountry: input.bankCountry, layout: input.profile.layout, calibrationProfileId: input.profile.id, accountId: input.profile.accountId, printerKey: input.profile.printerKey, stockKey: input.profile.stockKey, startSlot, sheetIds: input.sheetIds ?? [], pages, checkIds: input.checks.map((check) => check.id), generatedAt: input.generatedAt, warningKeys: [...warnings] };
}

export function buildCalibrationPlan(profile: CalibrationProfile, currency: Currency, bankCountry: BankCountry, documentId: string, generatedAt: string, locale: SupportedLocale = "en-US"): PrintPlan {
  validateCalibrationForLayout(profile);
  const elements: PrintElement[] = [];
  for (let x = 36; x <= 576; x += 36) { const p = adjusted(profile, x, 36); elements.push({ kind: "line", role: "calibration", x1Pt: p.x, y1Pt: p.y - 5, x2Pt: p.x, y2Pt: p.y + 5, strokeWidthPt: 0.5 }); }
  for (let y = 36; y <= 756; y += 36) { const p = adjusted(profile, 36, y); elements.push({ kind: "line", role: "calibration", x1Pt: p.x - 5, y1Pt: p.y, x2Pt: p.x + 5, y2Pt: p.y, strokeWidthPt: 0.5 }); }
  const xInches = (profile.xOffsetPt / 72).toFixed(3); const yInches = (profile.yOffsetPt / 72).toFixed(3);
  const xMillimetres = (profile.xOffsetPt * 25.4 / 72).toFixed(1); const yMillimetres = (profile.yOffsetPt * 25.4 / 72).toFixed(1);
  elements.push(text(profile, "calibration", `${localize(locale, "print.calibration")}: ${profile.name} | X ${xInches} in / ${xMillimetres} mm | Y ${yInches} in / ${yMillimetres} mm | ${profile.scalePercent}%`, 45, 380, 522, 12, 8, "center"));
  const page: PrintPage = { widthPt: LETTER_WIDTH, heightPt: LETTER_HEIGHT, elements }; assertPageBounds(page);
  return { version: 4, documentId, documentKind: "CALIBRATION", currency, locale, bankCountry, layout: profile.layout, calibrationProfileId: profile.id, accountId: profile.accountId, printerKey: profile.printerKey, stockKey: profile.stockKey, startSlot: 0, sheetIds: [], pages: [page], checkIds: [], generatedAt, warningKeys: ["warning.actualSize"] };
}

export function buildSamplePlan(profile: CalibrationProfile, currency: Currency, bankCountry: BankCountry, documentId: string, generatedAt: string, locale: SupportedLocale = "en-US"): PrintPlan {
  validateCalibrationForLayout(profile);
  const slotCount = STOCK_LAYOUTS[profile.layout].slots;
  const payee: Payee = { id: "sample-payee", name: localize(locale, "sample.payee"), archived: false, createdAt: generatedAt, updatedAt: generatedAt };
  const checks: CheckRecord[] = Array.from({ length: slotCount }, (_, index) => ({ id: `sample-${index}`, accountId: profile.accountId, payeeId: payee.id, payeeSnapshot: { name: payee.name }, accountSnapshot: { name: "SAMPLE", companyName: "SAMPLE", locale }, checkNumber: 0, issueDate: "2000-01-01", amountCents: 12345, currency, locale, memo: localize(locale, "sample.memo"), category: "SAMPLE", status: "READY", readyCalibrationProfileId: profile.id, warningKeys: [], printAttempts: [], createdAt: generatedAt, updatedAt: generatedAt }));
  const plan = buildCheckPrintPlan({ checks, payees: [payee], profile, bankCountry, locale, documentId, generatedAt });
  plan.documentKind = "SAMPLE"; plan.checkIds = []; plan.warningKeys = ["warning.sampleNonNegotiable", "warning.verifyStock"];
  const sampleNumber = localize(locale, "sample.number");
  plan.pages.forEach((page) => page.elements.forEach((element) => {
    if (element.kind !== "text") return;
    if (element.role === "check_number") element.text = sampleNumber;
    if (element.role === "stub") element.text = element.text.replace(/^#0(?=\s*\|)/u, sampleNumber);
  }));
  plan.pages.forEach((page) => STOCK_LAYOUTS[profile.layout].origins.forEach((origin) => page.elements.push(text(profile, "overlay", localize(locale, "sample.overlay"), 170, origin.y + 25, 272, 10, 10, "center"))));
  plan.pages.forEach(assertPageBounds);
  return plan;
}

export function hashPrintPlan(plan: PrintPlan): string { return hashCanonical(plan); }
