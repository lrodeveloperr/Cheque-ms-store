import { randomUUID } from "node:crypto";
import { appendAudit, hashStateCore, verifyAuditChain } from "./audit.ts";
import { assertHelveticaPrintable, buildCalibrationPlan, buildCheckPrintPlan, buildSamplePlan, CALIBRATION_FIELD_KEYS, defaultFieldAdjustments, defaultStubAdjustments, hashPrintPlan, STOCK_KEYS, validateCalibrationForLayout, VOUCHER_STUB_KEYS } from "./calibration.ts";
import { exportRegisterCsv, importPayeesCsv } from "./csv.ts";
import { DomainError, invariant } from "./errors.ts";
import type { NativePrintOutcome } from "./host-contract.ts";
import type { SupportedLocale } from "./localization.ts";
import { ensureSameCurrency, validateAmountCents } from "./money.ts";
import { buildRegisterReport, queryRegister as queryRegisterRows, type RegisterQuery, type RegisterReport, type RegisterRow } from "./register.ts";
import type { Account, Address, AppLocale, BankCountry, CalibrationField, CalibrationOffset, CalibrationProfile, CheckRecord, CheckStatus, Currency, EngineDependencies, EngineState, Entitlement, FieldAdjustments, LayoutKind, Payee, PaymentTemplate, PrintFailureDisposition, PrintPlan, StubAdjustments, VoucherStub } from "./types.ts";

const FREE_CHECK_LIMIT = 3;
const CHECK_TRANSITIONS: Record<CheckStatus, CheckStatus[]> = {
  DRAFT: ["READY", "VOIDED", "DELETED"],
  READY: ["DRAFT", "PRINT_QUEUED", "VOIDED"],
  PRINT_QUEUED: ["READY", "PRINTED", "MISPRINTED"],
  PRINTED: ["MISPRINTED", "VOIDED"],
  MISPRINTED: ["PRINTED", "VOIDED"],
  VOIDED: [],
  DELETED: []
};

function defaultDependencies(): EngineDependencies { return { now: () => new Date().toISOString(), newId: () => randomUUID() }; }

export function createEmptyState(entitlement?: Entitlement): EngineState {
  return { schemaVersion: 7, revision: 0, freeUsageCount: 0, freeUsageBasis: "COUNTED_OR_GUARDED", accounts: [], payees: [], paymentTemplates: [], checks: [], calibrations: [], stockSheets: [], audit: [], entitlement: entitlement ?? { kind: "FREE", source: "LOCAL_FREE", verifiedAt: new Date(0).toISOString() } };
}

function cleanText(value: string, field: string, maximum: number, allowEmpty = false): string {
  invariant(typeof value === "string", "VALIDATION_ERROR", `${field} must be text.`, { field, maximum }, `validation.${field}`);
  const normalized = value.normalize("NFC");
  invariant(!/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(normalized), "VALIDATION_ERROR", `${field} must be a single line without control, formatting, line-separator, or paragraph-separator characters.`, { field, maximum }, "validation.singleLine");
  const clean = normalized.trim();
  invariant((allowEmpty || clean.length > 0) && clean.length <= maximum, "VALIDATION_ERROR", `${field} is invalid.`, { field, maximum }, `validation.${field}`);
  return clean;
}

function assertOnlyKeys(value: object, allowed: readonly string[]): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(extras.length === 0, "VALIDATION_ERROR", "Patch contains unsupported fields.", { extras }, "validation.unsupportedFields");
}

type OffsetPatch = Partial<CalibrationOffset>;
type FieldAdjustmentPatch = Partial<Record<CalibrationField, OffsetPatch>>;
type StubAdjustmentPatch = Partial<Record<VoucherStub, OffsetPatch>>;

function mergeAdjustmentRecord<K extends string>(base: Record<K, CalibrationOffset>, patch: Partial<Record<K, OffsetPatch>> | undefined, keys: readonly K[]): Record<K, CalibrationOffset> {
  const result = structuredClone(base);
  if (patch === undefined) return result;
  invariant(patch && typeof patch === "object" && !Array.isArray(patch), "VALIDATION_ERROR", "Calibration adjustments must be an object.");
  assertOnlyKeys(patch, keys);
  for (const key of keys) {
    const value = patch[key]; if (value === undefined) continue;
    invariant(value && typeof value === "object" && !Array.isArray(value), "VALIDATION_ERROR", "A calibration offset must be an object."); assertOnlyKeys(value, ["xPt", "yPt"]);
    result[key] = { xPt: value.xPt ?? result[key].xPt, yPt: value.yPt ?? result[key].yPt };
  }
  return result;
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validIsoTimestamp(value: string): boolean { return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value; }

function validateDateFormatForCountry(bankCountry: BankCountry, dateFormat: CalibrationProfile["dateFormat"]): void {
  invariant(["MM/DD/YYYY", "YYYY-MM-DD", "DD/MM/YYYY"].includes(dateFormat), "VALIDATION_ERROR", "Date format is invalid.");
  invariant(bankCountry !== "CA" || dateFormat === "YYYY-MM-DD", "VALIDATION_ERROR", "Canadian cheque dates must use YYYY-MM-DD without slashes.", { bankCountry, dateFormat }, "validation.canadianDateFormat");
}

function validateJurisdictionCurrency(bankCountry: BankCountry, currency: Currency): void {
  invariant(bankCountry !== "US" || currency === "USD", "VALIDATION_ERROR", "The built-in US cheque template supports USD only.", { bankCountry, currency }, "validation.jurisdictionCurrency");
}

function validateLocaleForCountry(bankCountry: BankCountry, locale: AppLocale): void {
  invariant((bankCountry === "US" && locale === "en-US") || (bankCountry === "CA" && (locale === "en-CA" || locale === "fr-CA")), "VALIDATION_ERROR", "The selected language is not supported for this bank jurisdiction.", { bankCountry, locale }, "validation.locale");
}

function validateAddress(address: Address | undefined): void {
  if (!address) return;
  cleanText(address.line1, "addressLine1", 120); if (address.line2) cleanText(address.line2, "addressLine2", 120);
  cleanText(address.city, "city", 80); cleanText(address.region, "region", 80); cleanText(address.postalCode, "postalCode", 20);
  invariant(address.country === "US" || address.country === "CA", "VALIDATION_ERROR", "Country must be US or CA.", { field: "country" }, "validation.country");
}

function payeeKey(payee: Pick<Payee, "name" | "address">): string {
  const address = payee.address;
  return [payee.name, address?.line1, address?.line2, address?.city, address?.region, address?.postalCode, address?.country].map((value) => value?.normalize("NFC").trim().toLocaleLowerCase("en") ?? "").join("|");
}

export class CheckPrinterEngine {
  #state: EngineState;
  #deps: EngineDependencies;

  constructor(state: EngineState = createEmptyState(), dependencies: Partial<EngineDependencies> = {}) {
    this.#state = structuredClone(state); this.#deps = { ...defaultDependencies(), ...dependencies }; this.assertInvariants();
  }

  snapshot(): EngineState { return structuredClone(this.#state); }

  #mutate<T>(operation: () => T): T {
    const before = structuredClone(this.#state);
    try { const result = operation(); this.assertInvariants(); return structuredClone(result); }
    catch (error) { this.#state = before; throw error; }
  }

  #audit(action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}): void {
    this.#state.revision++; appendAudit(this.#state.audit, { at: this.#deps.now(), action, entityType, entityId, details: structuredClone(details), stateHash: hashStateCore(this.#state) });
  }

  #account(id: string): Account { const found = this.#state.accounts.find((item) => item.id === id); invariant(found, "NOT_FOUND", "Account not found.", { id }); return found; }
  #bankCountry(account: Account): BankCountry { return account.bankCountry ?? (account.currency === "CAD" ? "CA" : "US"); }
  #payee(id: string): Payee { const found = this.#state.payees.find((item) => item.id === id); invariant(found, "NOT_FOUND", "Payee not found.", { id }); return found; }
  #template(id: string): PaymentTemplate { const found = this.#state.paymentTemplates.find((item) => item.id === id); invariant(found, "NOT_FOUND", "Payment template not found.", { id }); return found; }
  #check(id: string): CheckRecord { const found = this.#state.checks.find((item) => item.id === id); invariant(found, "NOT_FOUND", "Check not found.", { id }); return found; }
  #profile(id: string): CalibrationProfile { const found = this.#state.calibrations.find((item) => item.id === id); invariant(found, "NOT_FOUND", "Calibration profile not found.", { id }); return found; }

  #newUniqueId(reserved: string[] = []): string {
    const id = cleanText(this.#deps.newId(), "identifier", 200);
    const used = new Set([...this.#state.accounts.map((item) => item.id), ...this.#state.payees.map((item) => item.id), ...this.#state.paymentTemplates.map((item) => item.id), ...this.#state.checks.map((item) => item.id), ...this.#state.calibrations.map((item) => item.id), ...this.#state.checks.flatMap((item) => item.printAttempts.flatMap((attempt) => [attempt.id, attempt.documentId]))]);
    invariant(!used.has(id) && !reserved.includes(id), "VALIDATION_ERROR", "Generated identifier is not unique.", { id }); return id;
  }

  #transition(check: CheckRecord, to: CheckStatus): void {
    invariant(CHECK_TRANSITIONS[check.status].includes(to), "INVALID_TRANSITION", `Cannot transition a check from ${check.status} to ${to}.`, { checkId: check.id, from: check.status, to });
    const from = check.status; check.status = to; check.updatedAt = this.#deps.now(); this.#audit("CHECK_STATUS_CHANGED", "check", check.id, { from, to });
  }

  #releaseSheetSlot(attempt: CheckRecord["printAttempts"][number]): void {
    if (attempt.sheetId === undefined || attempt.sheetSlot === undefined) return;
    const sheet = this.#state.stockSheets.find((candidate) => candidate.id === attempt.sheetId);
    if (!sheet) return;
    sheet.usedSlots = sheet.usedSlots.filter((slot) => slot !== attempt.sheetSlot);
    sheet.updatedAt = this.#deps.now();
  }

  #warningKeys(input: Pick<CheckRecord, "accountId" | "payeeId" | "issueDate" | "amountCents">, ignoreCheckId?: string): string[] {
    const warnings: string[] = []; const issueTime = Date.parse(`${input.issueDate}T12:00:00.000Z`); const todayTime = Date.parse(`${this.#deps.now().slice(0, 10)}T12:00:00.000Z`);
    if (Math.abs(issueTime - todayTime) > 366 * 86_400_000) warnings.push("warning.unusualDate");
    if (this.#state.checks.some((check) => check.id !== ignoreCheckId && check.accountId === input.accountId && check.payeeId === input.payeeId && check.issueDate === input.issueDate && check.amountCents === input.amountCents && check.status !== "DELETED")) warnings.push("warning.possibleDuplicate");
    return warnings;
  }

  createAccount(input: { name: string; companyName: string; companyAddress?: Address; currency: Currency; bankCountry?: BankCountry; locale?: AppLocale; nextCheckNumber: number }): Account {
    return this.#mutate(() => {
      validateAddress(input.companyAddress); invariant(input.currency === "USD" || input.currency === "CAD", "VALIDATION_ERROR", "Currency must be USD or CAD.", {}, "validation.currency");
      invariant(Number.isSafeInteger(input.nextCheckNumber) && input.nextCheckNumber > 0 && input.nextCheckNumber <= 999_999_999, "VALIDATION_ERROR", "Next check number is invalid.");
      const bankCountry = input.bankCountry ?? (input.currency === "CAD" ? "CA" : "US"); invariant(bankCountry === "US" || bankCountry === "CA", "VALIDATION_ERROR", "Bank country must be US or CA."); validateJurisdictionCurrency(bankCountry, input.currency); const locale = input.locale ?? (bankCountry === "US" ? "en-US" : "en-CA"); validateLocaleForCountry(bankCountry, locale);
      const now = this.#deps.now(); const account: Account = { id: this.#newUniqueId(), name: cleanText(input.name, "accountName", 100), companyName: cleanText(input.companyName, "companyName", 120), companyAddress: input.companyAddress ? structuredClone(input.companyAddress) : undefined, currency: input.currency, bankCountry, locale, nextCheckNumber: input.nextCheckNumber, numberingState: "VERIFIED", archived: false, createdAt: now, updatedAt: now };
      this.#state.accounts.push(account); this.#audit("ACCOUNT_CREATED", "account", account.id, { currency: account.currency, bankCountry: account.bankCountry, nextCheckNumber: account.nextCheckNumber }); return account;
    });
  }

  updateAccount(id: string, patch: Partial<Pick<Account, "name" | "companyName" | "companyAddress" | "currency" | "bankCountry" | "locale">>): Account {
    return this.#mutate(() => {
      assertOnlyKeys(patch, ["name", "companyName", "companyAddress", "currency", "bankCountry", "locale"]); const account = this.#account(id); const candidate = structuredClone(account);
      if (patch.name !== undefined) candidate.name = cleanText(patch.name, "accountName", 100);
      if (patch.companyName !== undefined) candidate.companyName = cleanText(patch.companyName, "companyName", 120);
      if (patch.companyAddress !== undefined) { validateAddress(patch.companyAddress); candidate.companyAddress = structuredClone(patch.companyAddress); }
      if (patch.currency !== undefined) { invariant(this.#state.checks.every((check) => check.accountId !== id), "VALIDATION_ERROR", "Currency cannot change after a check number is reserved.", {}, "validation.currencyLocked"); invariant(patch.currency === "USD" || patch.currency === "CAD", "VALIDATION_ERROR", "Currency is invalid."); candidate.currency = patch.currency; }
      if (patch.bankCountry !== undefined) { invariant(this.#state.checks.every((check) => check.accountId !== id), "VALIDATION_ERROR", "Bank country cannot change after a check number is reserved."); invariant(patch.bankCountry === "US" || patch.bankCountry === "CA", "VALIDATION_ERROR", "Bank country is invalid."); candidate.bankCountry = patch.bankCountry; }
      if (patch.locale !== undefined) candidate.locale = patch.locale;
      validateJurisdictionCurrency(this.#bankCountry(candidate), candidate.currency); validateLocaleForCountry(this.#bankCountry(candidate), candidate.locale);
      candidate.updatedAt = this.#deps.now(); Object.assign(account, candidate); this.#audit("ACCOUNT_UPDATED", "account", id, { fields: Object.keys(patch).sort() }); return account;
    });
  }

  setNextCheckNumber(id: string, nextCheckNumber: number): Account {
    return this.#mutate(() => {
      const account = this.#account(id); const reservedMaximum = Math.max(0, ...this.#state.checks.filter((check) => check.accountId === id).map((check) => check.checkNumber));
      invariant(Number.isSafeInteger(nextCheckNumber) && nextCheckNumber > reservedMaximum && nextCheckNumber <= 999_999_999, "VALIDATION_ERROR", "Next check number must exceed every reserved number.", { reservedMaximum });
      const from = account.nextCheckNumber; account.nextCheckNumber = nextCheckNumber; account.numberingState = "VERIFIED"; account.updatedAt = this.#deps.now(); this.#audit("NEXT_CHECK_NUMBER_CHANGED", "account", id, { from, to: nextCheckNumber }); return account;
    });
  }

  archiveAccount(id: string, archived = true): Account {
    return this.#mutate(() => { const account = this.#account(id); invariant(!this.#state.checks.some((check) => check.accountId === id && check.status === "PRINT_QUEUED"), "INVALID_TRANSITION", "An account with a queued check cannot be archived."); account.archived = archived; account.updatedAt = this.#deps.now(); this.#audit(archived ? "ACCOUNT_ARCHIVED" : "ACCOUNT_RESTORED", "account", id); return account; });
  }

  createPayee(input: { name: string; address?: Address; defaultMemo?: string }): Payee {
    return this.#mutate(() => { validateAddress(input.address); const name = cleanText(input.name, "payee", 80); assertHelveticaPrintable(name); const defaultMemo = input.defaultMemo ? cleanText(input.defaultMemo, "memo", 55) : undefined; if (defaultMemo) assertHelveticaPrintable(defaultMemo); const now = this.#deps.now(); const payee: Payee = { id: this.#newUniqueId(), name, address: input.address ? structuredClone(input.address) : undefined, defaultMemo, archived: false, createdAt: now, updatedAt: now }; this.#state.payees.push(payee); this.#audit("PAYEE_CREATED", "payee", payee.id); return payee; });
  }

  updatePayee(id: string, patch: Partial<Pick<Payee, "name" | "address" | "defaultMemo">>): Payee {
    return this.#mutate(() => { assertOnlyKeys(patch, ["name", "address", "defaultMemo"]); const payee = this.#payee(id); const candidate = structuredClone(payee); if (patch.name !== undefined) { candidate.name = cleanText(patch.name, "payee", 80); assertHelveticaPrintable(candidate.name); } if (patch.address !== undefined) { validateAddress(patch.address); candidate.address = structuredClone(patch.address); } if (patch.defaultMemo !== undefined) { candidate.defaultMemo = cleanText(patch.defaultMemo, "memo", 55, true) || undefined; if (candidate.defaultMemo) assertHelveticaPrintable(candidate.defaultMemo); } candidate.updatedAt = this.#deps.now(); Object.assign(payee, candidate); this.#audit("PAYEE_UPDATED", "payee", id, { fields: Object.keys(patch).sort() }); return payee; });
  }

  archivePayee(id: string, archived = true): Payee {
    return this.#mutate(() => { const payee = this.#payee(id); invariant(!this.#state.checks.some((check) => check.payeeId === id && check.status === "PRINT_QUEUED"), "INVALID_TRANSITION", "A payee on a queued check cannot be archived."); payee.archived = archived; payee.updatedAt = this.#deps.now(); this.#audit(archived ? "PAYEE_ARCHIVED" : "PAYEE_RESTORED", "payee", id); return payee; });
  }

  createPaymentTemplate(input: { name: string; accountId: string; payeeId: string; amountCents?: number; memo?: string; category?: string }): PaymentTemplate {
    return this.#mutate(() => {
      const account = this.#account(input.accountId); const payee = this.#payee(input.payeeId); invariant(!account.archived && !payee.archived, "VALIDATION_ERROR", "Archived profiles cannot be used by a payment template."); if (input.amountCents !== undefined) validateAmountCents(input.amountCents);
      const now = this.#deps.now(); const template: PaymentTemplate = { id: this.#newUniqueId(), name: cleanText(input.name, "templateName", 100), accountId: account.id, payeeId: payee.id, amountCents: input.amountCents, memo: cleanText(input.memo ?? payee.defaultMemo ?? "", "memo", 55, true), category: cleanText(input.category ?? "UNCATEGORIZED", "category", 80), archived: false, createdAt: now, updatedAt: now };
      this.#state.paymentTemplates.push(template); this.#audit("PAYMENT_TEMPLATE_CREATED", "payment_template", template.id, { accountId: account.id, payeeId: payee.id }); return template;
    });
  }

  updatePaymentTemplate(id: string, patch: Partial<Pick<PaymentTemplate, "name" | "accountId" | "payeeId" | "memo" | "category">> & { amountCents?: number | null }): PaymentTemplate {
    return this.#mutate(() => {
      assertOnlyKeys(patch, ["name", "accountId", "payeeId", "amountCents", "memo", "category"]); const template = this.#template(id); const candidate = structuredClone(template);
      if (patch.name !== undefined) candidate.name = cleanText(patch.name, "templateName", 100);
      if (patch.accountId !== undefined) { const account = this.#account(patch.accountId); invariant(!account.archived, "VALIDATION_ERROR", "Archived accounts cannot be used by a payment template."); candidate.accountId = account.id; }
      if (patch.payeeId !== undefined) { const payee = this.#payee(patch.payeeId); invariant(!payee.archived, "VALIDATION_ERROR", "Archived payees cannot be used by a payment template."); candidate.payeeId = payee.id; }
      if (patch.amountCents !== undefined) { if (patch.amountCents === null) candidate.amountCents = undefined; else { validateAmountCents(patch.amountCents); candidate.amountCents = patch.amountCents; } }
      if (patch.memo !== undefined) candidate.memo = cleanText(patch.memo, "memo", 55, true);
      if (patch.category !== undefined) candidate.category = cleanText(patch.category, "category", 80);
      candidate.updatedAt = this.#deps.now(); Object.assign(template, candidate); this.#audit("PAYMENT_TEMPLATE_UPDATED", "payment_template", id, { fields: Object.keys(patch).sort() }); return template;
    });
  }

  archivePaymentTemplate(id: string, archived = true): PaymentTemplate {
    return this.#mutate(() => { const template = this.#template(id); template.archived = archived; template.updatedAt = this.#deps.now(); this.#audit(archived ? "PAYMENT_TEMPLATE_ARCHIVED" : "PAYMENT_TEMPLATE_RESTORED", "payment_template", id); return template; });
  }

  createDraftFromTemplate(templateId: string, input: { issueDate: string; amountCents?: number; checkNumber?: number }): CheckRecord {
    const template = structuredClone(this.#template(templateId)); invariant(!template.archived, "VALIDATION_ERROR", "Archived payment templates cannot create checks."); const amountCents = input.amountCents ?? template.amountCents; invariant(amountCents !== undefined, "VALIDATION_ERROR", "Enter an amount for this payment template.", {}, "validation.amount");
    return this.createDraft({ accountId: template.accountId, payeeId: template.payeeId, issueDate: input.issueDate, amountCents, memo: template.memo, category: template.category, checkNumber: input.checkNumber });
  }

  duplicateCheck(checkId: string, input: { issueDate: string; checkNumber?: number }): CheckRecord {
    const original = structuredClone(this.#check(checkId)); invariant(original.status !== "DELETED", "INVALID_TRANSITION", "A deleted draft cannot be duplicated.");
    return this.createDraft({ accountId: original.accountId, payeeId: original.payeeId, issueDate: input.issueDate, amountCents: original.amountCents, memo: original.memo, category: original.category, checkNumber: input.checkNumber });
  }

  importPayees(csv: string, accountId?: string): { created: Payee[]; skipped: number } {
    return this.#mutate(() => {
      const defaultCountry = accountId ? this.#bankCountry(this.#account(accountId)) : undefined; const imported = importPayeesCsv(csv, defaultCountry); invariant(imported.length <= 10_000, "CSV_LIMIT_EXCEEDED", "A single import may contain at most 10,000 payees.");
      const known = new Set(this.#state.payees.map(payeeKey)); const created: Payee[] = []; let skipped = 0;
      for (const row of imported) {
        const address = row.line1 && row.city && row.region && row.postalCode && row.country ? { line1: row.line1, line2: row.line2, city: row.city, region: row.region, postalCode: row.postalCode, country: row.country } : undefined;
        validateAddress(address); const now = this.#deps.now(); const name = cleanText(row.name, "payee", 80); assertHelveticaPrintable(name); const defaultMemo = row.defaultMemo ? cleanText(row.defaultMemo, "memo", 55) : undefined; if (defaultMemo) assertHelveticaPrintable(defaultMemo); const candidate: Payee = { id: this.#newUniqueId(), name, address, defaultMemo, archived: false, createdAt: now, updatedAt: now };
        const key = payeeKey(candidate); if (known.has(key)) { skipped++; continue; } known.add(key); this.#state.payees.push(candidate); created.push(candidate);
      }
      this.#audit("PAYEES_IMPORTED", "payee_batch", this.#newUniqueId(), { createdIds: created.map((item) => item.id), skipped }); return { created, skipped };
    });
  }

  createCalibration(input: { accountId: string; name: string; printerKey: string; stockKey?: string; layout: LayoutKind; printCheckNumber?: boolean; dateFormat?: CalibrationProfile["dateFormat"]; amountWordsCurrencyLabel?: boolean; amountWordsFill?: boolean; xOffsetPt?: number; yOffsetPt?: number; scalePercent?: number; fieldAdjustments?: FieldAdjustmentPatch; stubAdjustments?: StubAdjustmentPatch }): CalibrationProfile {
    return this.#mutate(() => {
      const account = this.#account(input.accountId); invariant(Object.hasOwn(STOCK_KEYS, input.layout), "VALIDATION_ERROR", "Unsupported check layout."); const now = this.#deps.now();
      const stockKey = cleanText(input.stockKey ?? STOCK_KEYS[input.layout], "stockKey", 120); invariant(stockKey === STOCK_KEYS[input.layout], "VALIDATION_ERROR", "This release supports only its measured built-in stock template.", { expected: STOCK_KEYS[input.layout], actual: stockKey }, "validation.stockKey");
      const bankCountry = this.#bankCountry(account); const profile: CalibrationProfile = { id: this.#newUniqueId(), accountId: account.id, name: cleanText(input.name, "calibrationName", 100), printerKey: cleanText(input.printerKey, "printer", 200), stockKey, layout: input.layout, printCheckNumber: input.printCheckNumber ?? false, dateFormat: input.dateFormat ?? (bankCountry === "US" ? "MM/DD/YYYY" : "YYYY-MM-DD"), amountWordsCurrencyLabel: input.amountWordsCurrencyLabel ?? true, amountWordsFill: input.amountWordsFill ?? true, xOffsetPt: input.xOffsetPt ?? 0, yOffsetPt: input.yOffsetPt ?? 0, scalePercent: input.scalePercent ?? 100, fieldAdjustments: mergeAdjustmentRecord(defaultFieldAdjustments(), input.fieldAdjustments, CALIBRATION_FIELD_KEYS), stubAdjustments: mergeAdjustmentRecord(defaultStubAdjustments(), input.stubAdjustments, VOUCHER_STUB_KEYS), createdAt: now, updatedAt: now };
      validateDateFormatForCountry(bankCountry, profile.dateFormat); validateCalibrationForLayout(profile); this.#state.calibrations.push(profile); this.#audit("CALIBRATION_CREATED", "calibration", profile.id, { accountId: account.id, layout: profile.layout, stockKey: profile.stockKey }); return profile;
    });
  }

  updateCalibration(id: string, patch: Partial<Pick<CalibrationProfile, "name" | "printerKey" | "stockKey" | "printCheckNumber" | "dateFormat" | "amountWordsCurrencyLabel" | "amountWordsFill" | "xOffsetPt" | "yOffsetPt" | "scalePercent">> & { fieldAdjustments?: FieldAdjustmentPatch; stubAdjustments?: StubAdjustmentPatch }): CalibrationProfile {
    return this.#mutate(() => {
      const allowed = ["name", "printerKey", "stockKey", "printCheckNumber", "dateFormat", "amountWordsCurrencyLabel", "amountWordsFill", "xOffsetPt", "yOffsetPt", "scalePercent", "fieldAdjustments", "stubAdjustments"] as const; assertOnlyKeys(patch, allowed);
      const profile = this.#profile(id); invariant(!this.#state.checks.some((check) => check.printAttempts.some((attempt) => attempt.calibrationProfileId === id) || (check.status === "READY" && check.readyCalibrationProfileId === id)), "INVALID_TRANSITION", "A calibration profile used by a ready check or print attempt is immutable; create a new profile instead.", { profileId: id }); const candidate = structuredClone(profile); Object.assign(candidate, patch); candidate.fieldAdjustments = mergeAdjustmentRecord(profile.fieldAdjustments, patch.fieldAdjustments, CALIBRATION_FIELD_KEYS) as FieldAdjustments; candidate.stubAdjustments = mergeAdjustmentRecord(profile.stubAdjustments, patch.stubAdjustments, VOUCHER_STUB_KEYS) as StubAdjustments;
      if (patch.name !== undefined) candidate.name = cleanText(patch.name, "calibrationName", 100); if (patch.printerKey !== undefined) candidate.printerKey = cleanText(patch.printerKey, "printer", 200); if (patch.stockKey !== undefined) { candidate.stockKey = cleanText(patch.stockKey, "stockKey", 120); invariant(candidate.stockKey === STOCK_KEYS[candidate.layout], "VALIDATION_ERROR", "This release supports only its measured built-in stock template.", { expected: STOCK_KEYS[candidate.layout], actual: candidate.stockKey }, "validation.stockKey"); }
      validateDateFormatForCountry(this.#bankCountry(this.#account(profile.accountId)), candidate.dateFormat); candidate.updatedAt = this.#deps.now(); validateCalibrationForLayout(candidate); Object.assign(profile, candidate); this.#audit("CALIBRATION_UPDATED", "calibration", id, { fields: Object.keys(patch).sort() }); return profile;
    });
  }

  createDraft(input: { accountId: string; payeeId: string; issueDate: string; amountCents: number; memo?: string; category?: string; checkNumber?: number }): CheckRecord {
    return this.#mutate(() => {
      const account = this.#account(input.accountId); const payee = this.#payee(input.payeeId); invariant(!account.archived && !payee.archived, "VALIDATION_ERROR", "Archived profiles cannot issue checks."); invariant(account.numberingState === "VERIFIED", "INVALID_TRANSITION", "Confirm the next physical check number before issuing from a restored backup.", { accountId: account.id }, "validation.numberingConfirmation"); validateAmountCents(input.amountCents); invariant(validIsoDate(input.issueDate), "VALIDATION_ERROR", "Issue date must be a real ISO calendar date.");
      const checkNumber = input.checkNumber ?? account.nextCheckNumber; invariant(Number.isSafeInteger(checkNumber) && checkNumber > 0 && checkNumber <= 999_999_999, "VALIDATION_ERROR", "Check number is invalid."); invariant(!this.#state.checks.some((check) => check.accountId === account.id && check.checkNumber === checkNumber), "DUPLICATE_CHECK_NUMBER", "Check number has already been reserved for this account.", { checkNumber });
      const warnings = this.#warningKeys({ accountId: account.id, payeeId: payee.id, issueDate: input.issueDate, amountCents: input.amountCents });
      const memo = cleanText(input.memo ?? payee.defaultMemo ?? "", "memo", 55, true); assertHelveticaPrintable(memo); const now = this.#deps.now(); const check: CheckRecord = { id: this.#newUniqueId(), accountId: account.id, payeeId: payee.id, payeeSnapshot: { name: payee.name, address: payee.address ? structuredClone(payee.address) : undefined }, accountSnapshot: { name: account.name, companyName: account.companyName, companyAddress: account.companyAddress ? structuredClone(account.companyAddress) : undefined, locale: account.locale }, checkNumber, issueDate: input.issueDate, amountCents: input.amountCents, currency: account.currency, locale: account.locale, memo, category: cleanText(input.category ?? "UNCATEGORIZED", "category", 80), status: "DRAFT", warningKeys: warnings, printAttempts: [], createdAt: now, updatedAt: now };
      this.#state.checks.push(check); account.nextCheckNumber = Math.max(account.nextCheckNumber, checkNumber + 1); account.updatedAt = now; this.#audit("CHECK_CREATED", "check", check.id, { accountId: check.accountId, checkNumber, amountCents: check.amountCents, warningKeys: warnings }); return check;
    });
  }

  updateDraft(id: string, patch: Partial<Pick<CheckRecord, "payeeId" | "issueDate" | "amountCents" | "memo" | "category">>): CheckRecord {
    return this.#mutate(() => { assertOnlyKeys(patch, ["payeeId", "issueDate", "amountCents", "memo", "category"]); const check = this.#check(id); invariant(check.status === "DRAFT", "INVALID_TRANSITION", "Only draft checks can be edited."); const candidate = structuredClone(check); if (patch.payeeId !== undefined) { const payee = this.#payee(patch.payeeId); invariant(!payee.archived, "VALIDATION_ERROR", "Archived payees cannot be used."); candidate.payeeId = payee.id; candidate.payeeSnapshot = { name: payee.name, address: payee.address ? structuredClone(payee.address) : undefined }; } if (patch.issueDate !== undefined) { invariant(validIsoDate(patch.issueDate), "VALIDATION_ERROR", "Issue date must be a real ISO calendar date.", {}, "validation.date"); candidate.issueDate = patch.issueDate; } if (patch.amountCents !== undefined) { validateAmountCents(patch.amountCents); candidate.amountCents = patch.amountCents; } if (patch.memo !== undefined) { candidate.memo = cleanText(patch.memo, "memo", 55, true); assertHelveticaPrintable(candidate.memo); } if (patch.category !== undefined) candidate.category = cleanText(patch.category, "category", 80); candidate.warningKeys = this.#warningKeys(candidate, check.id); candidate.updatedAt = this.#deps.now(); Object.assign(check, candidate); this.#audit("CHECK_UPDATED", "check", id, { fields: Object.keys(patch).sort(), warningKeys: candidate.warningKeys }); return check; });
  }

  markReady(id: string, calibrationProfileId?: string): CheckRecord {
    return this.#mutate(() => {
      const check = this.#check(id);
      invariant(check.status === "DRAFT", "INVALID_TRANSITION", "Only a draft check can be marked ready.");
      const candidates = this.#state.calibrations.filter((profile) => profile.accountId === check.accountId);
      const profile = calibrationProfileId ? this.#profile(calibrationProfileId) : candidates[0];
      invariant(profile && profile.accountId === check.accountId, "VALIDATION_ERROR", "A calibration profile for this account is required before a check can be marked ready.", { accountId: check.accountId }, "validation.calibration");
      const account = this.#account(check.accountId);
      buildCheckPrintPlan({ checks: [check], payees: this.#state.payees, profile, bankCountry: this.#bankCountry(account), locale: check.locale, documentId: `validation-${check.id}`, generatedAt: this.#deps.now(), startSlot: 0 });
      check.readyCalibrationProfileId = profile.id;
      this.#transition(check, "READY");
      return check;
    });
  }
  returnToDraft(id: string): CheckRecord { return this.#mutate(() => { const check = this.#check(id); check.readyCalibrationProfileId = undefined; this.#transition(check, "DRAFT"); return check; }); }

  queuePrint(checkIds: string[], calibrationProfileId: string, printerKey: string, stockKey: string, startSlot = 0, sheetIds: string[] = []): { plan: PrintPlan; planHash: string; attemptIds: string[] } {
    return this.#mutate(() => {
      invariant(checkIds.length > 0 && new Set(checkIds).size === checkIds.length, "VALIDATION_ERROR", "Check selection must be non-empty and unique."); const profile = this.#profile(calibrationProfileId); invariant(profile.printerKey === printerKey, "VALIDATION_ERROR", "Selected printer does not match the calibration profile.", { expected: profile.printerKey, actual: printerKey }, "validation.printer"); invariant(profile.stockKey === stockKey, "VALIDATION_ERROR", "Selected stock does not match the calibration profile.", { expected: profile.stockKey, actual: stockKey }, "validation.stockKey");
      const checks = checkIds.map((id) => this.#check(id)); for (const check of checks) { invariant(check.status === "READY", "INVALID_TRANSITION", "Only ready checks can be queued.", { checkId: check.id }); invariant(check.readyCalibrationProfileId === profile.id, "INVALID_TRANSITION", "The check must be returned to draft and marked ready with this exact calibration profile before queueing.", { checkId: check.id, readyCalibrationProfileId: check.readyCalibrationProfileId, requestedCalibrationProfileId: profile.id }, "validation.calibration"); } const accountIds = new Set(checks.map((check) => check.accountId)); invariant(accountIds.size === 1 && accountIds.has(profile.accountId), "VALIDATION_ERROR", "Every check in a plan must use the calibration profile's account.", { accountIds: [...accountIds], profileAccountId: profile.accountId }, "validation.accountStockMismatch");
      invariant(this.#account(profile.accountId).numberingState === "VERIFIED", "INVALID_TRANSITION", "Confirm the next physical check number before printing from restored data.", { accountId: profile.accountId }, "validation.numberingConfirmation");
      if (profile.layout !== "THREE_UP") { invariant(checks.length === 1 && startSlot === 0, "VALIDATION_ERROR", "Voucher layout prints one check per page."); invariant(sheetIds.length === 0, "VALIDATION_ERROR", "Voucher stock does not use reusable sheet identifiers.", {}, "validation.sheetIds"); }
      const pageCount = profile.layout === "THREE_UP" ? Math.ceil((startSlot + checks.length) / 3) : 0;
      let normalizedSheetIds = sheetIds;
      if (profile.layout === "THREE_UP") {
        normalizedSheetIds = sheetIds.map((sheetId) => cleanText(sheetId, "sheetId", 120));
        invariant(normalizedSheetIds.length === pageCount && new Set(normalizedSheetIds).size === normalizedSheetIds.length, "VALIDATION_ERROR", "Provide one unique physical sheet identifier for each three-up page.", { requiredSheets: pageCount, suppliedSheets: normalizedSheetIds.length }, "validation.sheetIds");
        checks.forEach((_check, index) => {
          const absoluteSlot = startSlot + index; const pageIndex = Math.floor(absoluteSlot / 3); const slot = absoluteSlot % 3; const sheetId = normalizedSheetIds[pageIndex]; const existing = this.#state.stockSheets.find((sheet) => sheet.id === sheetId);
          if (existing) invariant(existing.accountId === profile.accountId && existing.calibrationProfileId === profile.id && existing.stockKey === stockKey && !existing.usedSlots.includes(slot), "INVALID_TRANSITION", "This physical sheet slot is already used or belongs to another stock profile.", { sheetId, slot }, "validation.sheetSlotUsed");
        });
      }
      if (this.#state.entitlement.kind === "FREE") { const queuedReservations = this.#state.checks.filter((candidate) => candidate.status === "PRINT_QUEUED" && !candidate.replacementForCheckId).length; const newCharges = checks.filter((check) => !check.replacementForCheckId).length; if (this.#state.freeUsageCount + queuedReservations + newCharges > FREE_CHECK_LIMIT) throw new DomainError("ENTITLEMENT_REQUIRED", "Free mode allows three live checks to be queued or confirmed.", { limit: FREE_CHECK_LIMIT }, this.#state.freeUsageBasis === "PORTABLE_RESTORE_CONSERVATIVE" ? "entitlement.restoreConservative" : "entitlement.limitReached"); }
      invariant(new Set(checks.map((check) => check.locale)).size === 1, "VALIDATION_ERROR", "Every check in one print plan must use the same language."); const now = this.#deps.now(); const documentId = this.#newUniqueId(); const plan = buildCheckPrintPlan({ checks, payees: this.#state.payees, profile, bankCountry: this.#bankCountry(this.#account(profile.accountId)), locale: checks[0].locale, documentId, generatedAt: now, startSlot, sheetIds: normalizedSheetIds }); const planHash = hashPrintPlan(plan); const attemptIds: string[] = [];
      for (const [index, check] of checks.entries()) { const attemptId = this.#newUniqueId([documentId, ...attemptIds]); attemptIds.push(attemptId); const absoluteSlot = startSlot + index; const pageIndex = Math.floor(absoluteSlot / 3); const sheetId = profile.layout === "THREE_UP" ? normalizedSheetIds[pageIndex] : undefined; const sheetSlot = profile.layout === "THREE_UP" ? absoluteSlot % 3 : undefined; check.printAttempts.push({ id: attemptId, documentId, calibrationProfileId, layout: profile.layout, printerKey, stockKey, planHash, queuedAt: now, status: "QUEUED", sheetId, sheetSlot }); if (sheetId !== undefined && sheetSlot !== undefined) { let sheet = this.#state.stockSheets.find((candidate) => candidate.id === sheetId); if (!sheet) { sheet = { id: sheetId, accountId: profile.accountId, calibrationProfileId: profile.id, stockKey, usedSlots: [], createdAt: now, updatedAt: now }; this.#state.stockSheets.push(sheet); } sheet.usedSlots.push(sheetSlot); sheet.usedSlots.sort(); sheet.updatedAt = now; } this.#transition(check, "PRINT_QUEUED"); }
      this.#audit("PRINT_PLAN_CREATED", "print_plan", documentId, { checkIds, attemptIds, calibrationProfileId, printerKey, stockKey, startSlot, sheetIds: normalizedSheetIds, planHash }); return { plan, planHash, attemptIds };
    });
  }

  confirmPrint(checkId: string, attemptId: string, documentId: string, planHash: string): CheckRecord {
    return this.#mutate(() => { const matchingDocument = this.#state.checks.filter((candidate) => candidate.printAttempts.some((attempt) => attempt.documentId === documentId && attempt.status === "QUEUED")); invariant(matchingDocument.length === 1, "INVALID_TRANSITION", "Multi-check documents must be resolved atomically through the document outcome API.", { documentId }); const check = this.#check(checkId); invariant(check.status === "PRINT_QUEUED", "INVALID_TRANSITION", "Check is not queued for printing."); const attempt = check.printAttempts.find((item) => item.id === attemptId); invariant(attempt?.status === "QUEUED" && attempt.documentId === documentId && attempt.planHash === planHash, "INVALID_TRANSITION", "Print confirmation does not match the pending immutable document."); attempt.status = "CONFIRMED"; attempt.completedAt = this.#deps.now(); if (!check.replacementForCheckId) this.#state.freeUsageCount = Math.min(FREE_CHECK_LIMIT, this.#state.freeUsageCount + 1); this.#transition(check, "PRINTED"); return check; });
  }

  failPrint(checkId: string, attemptId: string, documentId: string, planHash: string, disposition: PrintFailureDisposition, failureCode: string, deliveryEvidence?: "HOST_CANCELLED_BEFORE_SUBMIT" | "HOST_CONFIRMED_NO_OUTPUT"): CheckRecord {
    return this.#mutate(() => { const matchingDocument = this.#state.checks.filter((candidate) => candidate.printAttempts.some((attempt) => attempt.documentId === documentId && attempt.status === "QUEUED")); invariant(matchingDocument.length === 1, "INVALID_TRANSITION", "Multi-check documents must be resolved atomically through the document outcome API.", { documentId }); const check = this.#check(checkId); invariant(check.status === "PRINT_QUEUED", "INVALID_TRANSITION", "Check is not queued for printing."); const attempt = check.printAttempts.find((item) => item.id === attemptId); invariant(attempt?.status === "QUEUED" && attempt.documentId === documentId && attempt.planHash === planHash, "INVALID_TRANSITION", "Print failure does not match the pending immutable document."); invariant(disposition === "NOT_SENT" || disposition === "UNKNOWN", "VALIDATION_ERROR", "Print failure disposition is invalid."); if (disposition === "NOT_SENT") invariant(deliveryEvidence === "HOST_CANCELLED_BEFORE_SUBMIT" || deliveryEvidence === "HOST_CONFIRMED_NO_OUTPUT", "VALIDATION_ERROR", "Nothing-printed outcomes require trusted host evidence.", {}, "validation.notPrintedEvidence"); const code = cleanText(failureCode, "failureCode", 80); attempt.completedAt = this.#deps.now(); attempt.failureCode = code; if (disposition === "NOT_SENT") { attempt.status = "FAILED"; this.#releaseSheetSlot(attempt); this.#transition(check, "READY"); } else { attempt.status = "MISPRINTED"; if (!check.warningKeys.includes("warning.secureOriginal")) check.warningKeys.push("warning.secureOriginal"); if (!check.replacementForCheckId) this.#state.freeUsageCount = Math.min(FREE_CHECK_LIMIT, this.#state.freeUsageCount + 1); this.#transition(check, "MISPRINTED"); } return check; });
  }

  resolvePrintOutcome(checkId: string, attemptId: string, documentId: string, planHash: string, outcome: NativePrintOutcome): CheckRecord {
    if (outcome.kind === "PRINTED_CORRECTLY") return this.confirmPrint(checkId, attemptId, documentId, planHash);
    if (outcome.kind === "PAPER_MARKED_WITH_PROBLEM") return this.failPrint(checkId, attemptId, documentId, planHash, "UNKNOWN", outcome.reasonCode);
    return this.failPrint(checkId, attemptId, documentId, planHash, "NOT_SENT", outcome.reasonCode, outcome.deliveryEvidence);
  }

  resolvePrintDocumentOutcome(documentId: string, planHash: string, outcome: NativePrintOutcome): CheckRecord[] {
    return this.#mutate(() => {
      const pending = this.#state.checks.map((check) => ({ check, attempt: check.printAttempts.find((attempt) => attempt.documentId === documentId && attempt.status === "QUEUED") })).filter((item): item is { check: CheckRecord; attempt: NonNullable<typeof item.attempt> } => Boolean(item.attempt));
      invariant(pending.length > 0, "INVALID_TRANSITION", "No queued checks match this print document.", { documentId });
      invariant(pending.every(({ check, attempt }) => check.status === "PRINT_QUEUED" && attempt.planHash === planHash), "INVALID_TRANSITION", "The batch outcome does not match the pending immutable document.", { documentId, planHash });
      const now = this.#deps.now();
      if (outcome.kind === "NOT_PRINTED") invariant(outcome.deliveryEvidence === "HOST_CANCELLED_BEFORE_SUBMIT" || outcome.deliveryEvidence === "HOST_CONFIRMED_NO_OUTPUT", "VALIDATION_ERROR", "Nothing-printed outcomes require trusted host evidence.", {}, "validation.notPrintedEvidence");
      const failureCode = outcome.kind === "PRINTED_CORRECTLY" ? undefined : cleanText(outcome.reasonCode, "failureCode", 80);
      for (const { check, attempt } of pending) {
        attempt.completedAt = now;
        if (outcome.kind === "PRINTED_CORRECTLY") {
          attempt.status = "CONFIRMED";
          if (!check.replacementForCheckId) this.#state.freeUsageCount = Math.min(FREE_CHECK_LIMIT, this.#state.freeUsageCount + 1);
          this.#transition(check, "PRINTED");
        } else if (outcome.kind === "PAPER_MARKED_WITH_PROBLEM") {
          attempt.status = "MISPRINTED"; attempt.failureCode = failureCode;
          if (!check.warningKeys.includes("warning.secureOriginal")) check.warningKeys.push("warning.secureOriginal");
          if (!check.replacementForCheckId) this.#state.freeUsageCount = Math.min(FREE_CHECK_LIMIT, this.#state.freeUsageCount + 1);
          this.#transition(check, "MISPRINTED");
        } else {
          attempt.status = "FAILED"; attempt.failureCode = failureCode;
          this.#releaseSheetSlot(attempt);
          this.#transition(check, "READY");
        }
      }
      this.#audit("PRINT_DOCUMENT_OUTCOME_RESOLVED", "print_plan", documentId, { checkIds: pending.map(({ check }) => check.id), outcome: outcome.kind, planHash });
      return pending.map(({ check }) => check);
    });
  }

  markMisprinted(checkId: string, reason: string): CheckRecord {
    return this.#mutate(() => { const check = this.#check(checkId); invariant(check.status === "PRINTED" && !check.clearedDate, "INVALID_TRANSITION", "Only an uncleared printed check can be marked misprinted."); const attempt = [...check.printAttempts].reverse().find((item) => item.status === "CONFIRMED"); invariant(attempt, "INVALID_TRANSITION", "No confirmed print attempt exists."); attempt.status = "MISPRINTED"; attempt.failureCode = cleanText(reason, "misprintReason", 120); if (!check.warningKeys.includes("warning.secureOriginal")) check.warningKeys.push("warning.secureOriginal"); this.#transition(check, "MISPRINTED"); return check; });
  }

  confirmMisprintedAsPrinted(checkId: string): CheckRecord {
    return this.#mutate(() => { const check = this.#check(checkId); invariant(check.status === "MISPRINTED" && !check.replacedByCheckId && !check.clearedDate, "INVALID_TRANSITION", "Only an unresolved spoiled check can be confirmed as printed."); const attempt = [...check.printAttempts].reverse().find((item) => item.status === "MISPRINTED"); invariant(attempt, "INVALID_TRANSITION", "No spoiled print attempt exists."); attempt.status = "CONFIRMED"; attempt.failureCode = undefined; attempt.completedAt = this.#deps.now(); check.warningKeys = check.warningKeys.filter((key) => key !== "warning.secureOriginal"); this.#transition(check, "PRINTED"); this.#audit("MISPRINT_CONFIRMED_PRINTED", "check", check.id); return check; });
  }

  replaceMisprinted(checkId: string, replacementCheckNumber?: number): CheckRecord {
    return this.#mutate(() => { const original = this.#check(checkId); invariant(original.status === "MISPRINTED" && !original.clearedDate && !original.replacedByCheckId, "INVALID_TRANSITION", "Only an unreplaced, uncleared misprint can be replaced."); const account = this.#account(original.accountId); invariant(account.numberingState === "VERIFIED", "INVALID_TRANSITION", "Confirm the next physical check number before replacing a misprint.", { accountId: account.id }, "validation.numberingConfirmation"); const number = replacementCheckNumber ?? account.nextCheckNumber; invariant(Number.isSafeInteger(number) && number > 0 && number <= 999_999_999 && !this.#state.checks.some((check) => check.accountId === account.id && check.checkNumber === number), "DUPLICATE_CHECK_NUMBER", "Replacement check number is invalid or already reserved.", { checkNumber: number }); const now = this.#deps.now(); const replacement: CheckRecord = { id: this.#newUniqueId(), accountId: original.accountId, payeeId: original.payeeId, payeeSnapshot: structuredClone(original.payeeSnapshot), accountSnapshot: structuredClone(original.accountSnapshot), checkNumber: number, issueDate: original.issueDate, amountCents: original.amountCents, currency: original.currency, locale: original.locale, memo: original.memo, category: original.category, status: "DRAFT", warningKeys: [], replacementForCheckId: original.id, printAttempts: [], createdAt: now, updatedAt: now }; original.replacedByCheckId = replacement.id; original.voidReasonCode = "MISPRINT_REPLACED"; original.updatedAt = now; this.#transition(original, "VOIDED"); this.#state.checks.push(replacement); account.nextCheckNumber = Math.max(account.nextCheckNumber, number + 1); account.updatedAt = now; this.#audit("MISPRINT_REPLACEMENT_CREATED", "check", replacement.id, { originalCheckId: original.id, originalNumber: original.checkNumber, replacementNumber: number }); return replacement; });
  }

  voidCheck(checkId: string, reason: string): CheckRecord {
    return this.#mutate(() => { const check = this.#check(checkId); invariant(check.status !== "PRINT_QUEUED" && check.status !== "VOIDED" && check.status !== "DELETED" && !check.clearedDate, "INVALID_TRANSITION", "Check cannot be voided in its current state."); check.voidReason = cleanText(reason, "voidReason", 120); check.voidReasonCode = "USER_VOID"; this.#transition(check, "VOIDED"); return check; });
  }

  setCleared(checkId: string, cleared: boolean, clearedDate?: string): CheckRecord {
    return this.#mutate(() => { const check = this.#check(checkId); invariant(check.status === "PRINTED", "INVALID_TRANSITION", "Only printed checks can be reconciled."); if (cleared) { invariant(Boolean(clearedDate && validIsoDate(clearedDate)), "VALIDATION_ERROR", "A local calendar date is required when marking a check cleared.", { field: "clearedDate" }, "validation.clearedDate"); invariant(clearedDate! >= check.issueDate && clearedDate! <= this.#deps.now().slice(0, 10), "VALIDATION_ERROR", "Cleared date must be on or after the issue date and not in the future.", { issueDate: check.issueDate, maximumDate: this.#deps.now().slice(0, 10) }, "validation.clearedDateRange"); } check.clearedDate = cleared ? clearedDate : undefined; check.updatedAt = this.#deps.now(); this.#audit(cleared ? "CHECK_CLEARED" : "CHECK_UNCLEARED", "check", check.id, { clearedDate: check.clearedDate }); return check; });
  }

  deleteDraft(checkId: string): void { this.#mutate(() => { const check = this.#check(checkId); invariant(check.status === "DRAFT", "INVALID_TRANSITION", "Only a never-printed draft can be deleted."); check.deletedAt = this.#deps.now(); this.#transition(check, "DELETED"); this.#audit("CHECK_DRAFT_DELETED", "check", check.id, { checkNumber: check.checkNumber }); }); }

  raiseNextCheckNumber(accountId: string, minimum: number, reasonCode: "RESTORE_HIGH_WATER" | "HOST_CORRECTION"): Account {
    return this.#mutate(() => { const account = this.#account(accountId); invariant(Number.isSafeInteger(minimum) && minimum > 0 && minimum <= 999_999_999, "VALIDATION_ERROR", "High-water number is invalid."); if (minimum <= account.nextCheckNumber) return account; const from = account.nextCheckNumber; account.nextCheckNumber = minimum; account.updatedAt = this.#deps.now(); this.#audit("NEXT_CHECK_NUMBER_RAISED", "account", accountId, { from, to: minimum, reasonCode }); return account; });
  }

  requireNumberingConfirmation(accountId: string): Account { return this.#mutate(() => { const account = this.#account(accountId); if (account.numberingState === "RESTORE_CONFIRMATION_REQUIRED") return account; account.numberingState = "RESTORE_CONFIRMATION_REQUIRED"; account.updatedAt = this.#deps.now(); this.#audit("NUMBERING_CONFIRMATION_REQUIRED", "account", accountId); return account; }); }

  confirmNextCheckNumber(accountId: string, nextCheckNumber: number): Account {
    return this.#mutate(() => { const account = this.#account(accountId); const reservedMaximum = Math.max(0, ...this.#state.checks.filter((check) => check.accountId === accountId).map((check) => check.checkNumber)); invariant(Number.isSafeInteger(nextCheckNumber) && nextCheckNumber > reservedMaximum && nextCheckNumber <= 999_999_999, "VALIDATION_ERROR", "Confirmed next check number must exceed every reserved number.", { reservedMaximum }, "validation.numberingConfirmation"); const from = account.nextCheckNumber; account.nextCheckNumber = nextCheckNumber; account.numberingState = "VERIFIED"; account.updatedAt = this.#deps.now(); this.#audit("NEXT_CHECK_NUMBER_CONFIRMED", "account", accountId, { from, to: nextCheckNumber }); return account; });
  }

  raiseFreeUsageCount(minimum: number, reasonCode: "RESTORE_HIGH_WATER" | "PORTABLE_RESTORE_CONSERVATIVE"): number { return this.#mutate(() => { invariant(Number.isInteger(minimum) && minimum >= 0 && minimum <= FREE_CHECK_LIMIT, "VALIDATION_ERROR", "Free-usage high-water mark is invalid."); const from = this.#state.freeUsageCount; const previousBasis = this.#state.freeUsageBasis; if (reasonCode === "PORTABLE_RESTORE_CONSERVATIVE") this.#state.freeUsageBasis = "PORTABLE_RESTORE_CONSERVATIVE"; this.#state.freeUsageCount = Math.max(this.#state.freeUsageCount, minimum); if (from !== this.#state.freeUsageCount || previousBasis !== this.#state.freeUsageBasis) this.#audit("FREE_USAGE_RAISED", "entitlement", "current", { from, to: this.#state.freeUsageCount, reasonCode, previousBasis }); return this.#state.freeUsageCount; }); }

  setEntitlement(entitlement: Entitlement): void { this.#mutate(() => { invariant(entitlement.kind === "FREE" || entitlement.kind === "LIFETIME", "VALIDATION_ERROR", "Unknown entitlement."); invariant((entitlement.kind === "FREE" && (entitlement.source === "LOCAL_FREE" || entitlement.source === "TEST")) || (entitlement.kind === "LIFETIME" && (entitlement.source === "MICROSOFT_STORE" || entitlement.source === "TEST")), "VALIDATION_ERROR", "Entitlement kind and verification source do not match."); invariant(validIsoTimestamp(entitlement.verifiedAt), "VALIDATION_ERROR", "Entitlement verification time is invalid."); this.#state.entitlement = structuredClone(entitlement); this.#audit("ENTITLEMENT_UPDATED", "entitlement", "current", { kind: entitlement.kind, source: entitlement.source }); }); }

  calibrationPlan(profileId: string, printerKey: string, locale?: SupportedLocale): PrintPlan { const profile = this.#profile(profileId); invariant(profile.printerKey === printerKey, "VALIDATION_ERROR", "Selected printer does not match the calibration profile."); const account = this.#account(profile.accountId); const resolvedLocale = locale ?? account.locale; validateLocaleForCountry(this.#bankCountry(account), resolvedLocale); return buildCalibrationPlan(profile, account.currency, this.#bankCountry(account), this.#newUniqueId(), this.#deps.now(), resolvedLocale); }
  samplePlan(profileId: string, printerKey: string, locale?: SupportedLocale): PrintPlan { const profile = this.#profile(profileId); invariant(profile.printerKey === printerKey, "VALIDATION_ERROR", "Selected printer does not match the calibration profile."); const account = this.#account(profile.accountId); const resolvedLocale = locale ?? account.locale; validateLocaleForCountry(this.#bankCountry(account), resolvedLocale); return buildSamplePlan(profile, account.currency, this.#bankCountry(account), this.#newUniqueId(), this.#deps.now(), resolvedLocale); }
  exportRegister(accountId?: string, locale: SupportedLocale = "en-US", mode: "SAFE" | "RAW_TRUSTED" = "SAFE"): string { if (accountId) this.#account(accountId); const checks = this.#state.checks.filter((check) => check.status !== "DELETED" && (!accountId || check.accountId === accountId)); return exportRegisterCsv(checks, this.#state.payees, this.#state.accounts, locale, mode); }
  queryRegister(query: RegisterQuery = {}): RegisterRow[] { if (query.accountId) this.#account(query.accountId); return queryRegisterRows(this.#state.checks, this.#state.accounts, this.#state.payees, query); }
  registerReport(query: RegisterQuery = {}, locale: SupportedLocale = "en-US"): RegisterReport { return buildRegisterReport(this.queryRegister(query), locale, this.#deps.now()); }
  exportFilteredRegister(query: RegisterQuery = {}, locale: SupportedLocale = "en-US", mode: "SAFE" | "RAW_TRUSTED" = "SAFE"): string { const ids = this.queryRegister(query).map((row) => row.checkId); const byId = new Map(this.#state.checks.map((check) => [check.id, check])); return exportRegisterCsv(ids.map((id) => byId.get(id)!), this.#state.payees, this.#state.accounts, locale, mode); }

  reconciliation(accountId: string): { outstandingCents: number; clearedCents: number; voidedCents: number; spoiledCents: number; outstandingCount: number; clearedCount: number; voidedCount: number; spoiledCount: number; deletedDraftCount: number; issuedCheckCount: number } {
    const account = this.#account(accountId); const checks = this.#state.checks.filter((check) => check.accountId === account.id); const summary = { outstandingCents: 0, clearedCents: 0, voidedCents: 0, spoiledCents: 0, outstandingCount: 0, clearedCount: 0, voidedCount: 0, spoiledCount: 0, deletedDraftCount: 0, issuedCheckCount: 0 };
    for (const check of checks) { ensureSameCurrency(check.currency, account.currency); if (check.status === "DELETED") { summary.deletedDraftCount++; continue; } if (check.status === "MISPRINTED" || check.printAttempts.some((attempt) => attempt.status === "MISPRINTED")) { summary.spoiledCents += check.amountCents; summary.spoiledCount++; summary.issuedCheckCount++; continue; } if (check.status === "VOIDED") { summary.voidedCents += check.amountCents; summary.voidedCount++; summary.issuedCheckCount++; continue; } if (check.status === "PRINTED" && check.clearedDate) { summary.clearedCents += check.amountCents; summary.clearedCount++; summary.issuedCheckCount++; continue; } if (check.status === "PRINTED") { summary.outstandingCents += check.amountCents; summary.outstandingCount++; summary.issuedCheckCount++; } }
    return summary;
  }

  assertInvariants(): true {
    invariant(this.#state.schemaVersion === 7, "UNSUPPORTED_SCHEMA", "Engine requires schema version 7."); invariant(Number.isInteger(this.#state.freeUsageCount) && this.#state.freeUsageCount >= 0 && this.#state.freeUsageCount <= FREE_CHECK_LIMIT && (this.#state.freeUsageBasis === "COUNTED_OR_GUARDED" || this.#state.freeUsageBasis === "PORTABLE_RESTORE_CONSERVATIVE"), "VALIDATION_ERROR", "Free-usage state is invalid."); verifyAuditChain(this.#state.audit); invariant(this.#state.revision === this.#state.audit.length, "AUDIT_INTEGRITY_FAILURE", "State revision does not match the audit sequence.");
    if (this.#state.audit.length) invariant(this.#state.audit.at(-1)?.stateHash === hashStateCore(this.#state), "AUDIT_INTEGRITY_FAILURE", "Audit terminal state hash does not match current state."); else invariant(this.#state.accounts.length === 0 && this.#state.payees.length === 0 && this.#state.paymentTemplates.length === 0 && this.#state.checks.length === 0 && this.#state.calibrations.length === 0 && this.#state.stockSheets.length === 0 && this.#state.entitlement.kind === "FREE" && this.#state.entitlement.source === "LOCAL_FREE" && this.#state.entitlement.verifiedAt === new Date(0).toISOString(), "AUDIT_INTEGRITY_FAILURE", "Only the canonical empty state may have no audit history.");
    const accountIds = new Set(this.#state.accounts.map((item) => item.id)); const payeeIds = new Set(this.#state.payees.map((item) => item.id)); const templateIds = new Set(this.#state.paymentTemplates.map((item) => item.id)); const checkIds = new Set(this.#state.checks.map((item) => item.id)); const profileIds = new Set(this.#state.calibrations.map((item) => item.id)); const sheetIds = new Set(this.#state.stockSheets.map((item) => item.id)); const attemptIds = new Set(this.#state.checks.flatMap((item) => item.printAttempts.map((attempt) => attempt.id))); const attemptCount = this.#state.checks.reduce((total, item) => total + item.printAttempts.length, 0); const documentIds = new Set(this.#state.checks.flatMap((item) => item.printAttempts.map((attempt) => attempt.documentId))); const allIds = [...accountIds, ...payeeIds, ...templateIds, ...checkIds, ...profileIds, ...attemptIds, ...documentIds];
    invariant(accountIds.size === this.#state.accounts.length && payeeIds.size === this.#state.payees.length && templateIds.size === this.#state.paymentTemplates.length && checkIds.size === this.#state.checks.length && profileIds.size === this.#state.calibrations.length && sheetIds.size === this.#state.stockSheets.length && attemptIds.size === attemptCount && new Set(allIds).size === allIds.length, "VALIDATION_ERROR", "Persisted identifiers must be unique.");
    invariant(((this.#state.entitlement.kind === "FREE" && (this.#state.entitlement.source === "LOCAL_FREE" || this.#state.entitlement.source === "TEST")) || (this.#state.entitlement.kind === "LIFETIME" && (this.#state.entitlement.source === "MICROSOFT_STORE" || this.#state.entitlement.source === "TEST"))) && validIsoTimestamp(this.#state.entitlement.verifiedAt), "VALIDATION_ERROR", "Entitlement fields are invalid.");
    for (const account of this.#state.accounts) { cleanText(account.id, "identifier", 200); cleanText(account.name, "accountName", 100); cleanText(account.companyName, "companyName", 120); validateAddress(account.companyAddress); invariant((account.currency === "USD" || account.currency === "CAD") && (account.bankCountry === undefined || account.bankCountry === "US" || account.bankCountry === "CA") && (account.numberingState === "VERIFIED" || account.numberingState === "RESTORE_CONFIRMATION_REQUIRED") && Number.isSafeInteger(account.nextCheckNumber) && account.nextCheckNumber > 0 && account.nextCheckNumber <= 999_999_999 && validIsoTimestamp(account.createdAt) && validIsoTimestamp(account.updatedAt), "VALIDATION_ERROR", "Account fields are invalid."); validateJurisdictionCurrency(this.#bankCountry(account), account.currency); validateLocaleForCountry(this.#bankCountry(account), account.locale); const maximum = Math.max(0, ...this.#state.checks.filter((check) => check.accountId === account.id).map((check) => check.checkNumber)); invariant(account.nextCheckNumber > maximum, "VALIDATION_ERROR", "Next check number must exceed every reserved number."); }
    for (const payee of this.#state.payees) { cleanText(payee.id, "identifier", 200); cleanText(payee.name, "payee", 80); if (payee.defaultMemo) cleanText(payee.defaultMemo, "memo", 55); validateAddress(payee.address); invariant(validIsoTimestamp(payee.createdAt) && validIsoTimestamp(payee.updatedAt), "VALIDATION_ERROR", "Payee timestamps are invalid."); }
    for (const template of this.#state.paymentTemplates) { invariant(accountIds.has(template.accountId) && payeeIds.has(template.payeeId), "VALIDATION_ERROR", "Payment template references missing profiles."); cleanText(template.id, "identifier", 200); cleanText(template.name, "templateName", 100); if (template.amountCents !== undefined) validateAmountCents(template.amountCents); cleanText(template.memo, "memo", 55, true); cleanText(template.category, "category", 80); invariant(typeof template.archived === "boolean" && validIsoTimestamp(template.createdAt) && validIsoTimestamp(template.updatedAt), "VALIDATION_ERROR", "Payment template fields are invalid."); }
    for (const profile of this.#state.calibrations) { invariant(accountIds.has(profile.accountId), "VALIDATION_ERROR", "Calibration references a missing account."); cleanText(profile.id, "identifier", 200); cleanText(profile.name, "calibrationName", 100); cleanText(profile.printerKey, "printer", 200); cleanText(profile.stockKey, "stockKey", 120); invariant(Object.hasOwn(STOCK_KEYS, profile.layout) && profile.stockKey === STOCK_KEYS[profile.layout] && typeof profile.printCheckNumber === "boolean" && typeof profile.amountWordsCurrencyLabel === "boolean" && typeof profile.amountWordsFill === "boolean" && validIsoTimestamp(profile.createdAt) && validIsoTimestamp(profile.updatedAt), "VALIDATION_ERROR", "Calibration fields are invalid."); validateDateFormatForCountry(this.#bankCountry(this.#account(profile.accountId)), profile.dateFormat); validateCalibrationForLayout(profile); }
    for (const sheet of this.#state.stockSheets) { cleanText(sheet.id, "sheetId", 120); invariant(accountIds.has(sheet.accountId) && profileIds.has(sheet.calibrationProfileId) && this.#profile(sheet.calibrationProfileId).accountId === sheet.accountId && this.#profile(sheet.calibrationProfileId).stockKey === sheet.stockKey && new Set(sheet.usedSlots).size === sheet.usedSlots.length && sheet.usedSlots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < 3) && validIsoTimestamp(sheet.createdAt) && validIsoTimestamp(sheet.updatedAt), "VALIDATION_ERROR", "Three-up sheet ledger is invalid."); }
    const numbers = new Set<string>();
    for (const check of this.#state.checks) {
      invariant(accountIds.has(check.accountId) && payeeIds.has(check.payeeId), "VALIDATION_ERROR", "Checks must reference existing profiles."); validateAmountCents(check.amountCents); cleanText(check.id, "identifier", 200); cleanText(check.memo, "memo", 55, true); cleanText(check.category, "category", 80); cleanText(check.payeeSnapshot?.name, "payee", 80); validateAddress(check.payeeSnapshot?.address); cleanText(check.accountSnapshot?.name, "accountName", 100); cleanText(check.accountSnapshot?.companyName, "companyName", 120); validateAddress(check.accountSnapshot?.companyAddress); invariant(validIsoDate(check.issueDate) && validIsoTimestamp(check.createdAt) && validIsoTimestamp(check.updatedAt) && Number.isSafeInteger(check.checkNumber) && check.checkNumber > 0 && check.checkNumber <= 999_999_999 && ["DRAFT", "READY", "PRINT_QUEUED", "PRINTED", "MISPRINTED", "VOIDED", "DELETED"].includes(check.status), "VALIDATION_ERROR", "Check fields are invalid."); validateLocaleForCountry(this.#bankCountry(this.#account(check.accountId)), check.locale); invariant(check.accountSnapshot.locale === check.locale, "VALIDATION_ERROR", "Check locale snapshot is inconsistent."); ensureSameCurrency(check.currency, this.#account(check.accountId).currency); const numberKey = `${check.accountId}:${check.checkNumber}`; invariant(!numbers.has(numberKey), "DUPLICATE_CHECK_NUMBER", "Check number is duplicated within an account."); numbers.add(numberKey);
      invariant(Array.isArray(check.warningKeys) && check.warningKeys.every((key) => typeof key === "string"), "VALIDATION_ERROR", "Check warning keys are invalid."); if (["READY", "PRINT_QUEUED", "PRINTED", "MISPRINTED"].includes(check.status)) { invariant(Boolean(check.readyCalibrationProfileId && profileIds.has(check.readyCalibrationProfileId)), "VALIDATION_ERROR", "A printable check must retain the calibration profile used for Ready validation."); const readyProfile = this.#profile(check.readyCalibrationProfileId!); invariant(readyProfile.accountId === check.accountId, "VALIDATION_ERROR", "The Ready calibration profile must belong to the check account."); } if (check.clearedDate) invariant(check.status === "PRINTED" && validIsoDate(check.clearedDate) && check.clearedDate >= check.issueDate, "VALIDATION_ERROR", "Cleared date is invalid."); if (check.status === "DELETED") invariant(Boolean(check.deletedAt && validIsoTimestamp(check.deletedAt)) && check.printAttempts.length === 0, "VALIDATION_ERROR", "Deleted drafts must be unprinted and timestamped."); if (check.status === "VOIDED") invariant(Boolean(check.voidReason || check.voidReasonCode), "VALIDATION_ERROR", "Voided checks require a reason.");
      const queued = check.printAttempts.filter((attempt) => attempt.status === "QUEUED").length; invariant(queued <= 1 && (check.status === "PRINT_QUEUED") === (queued === 1), "VALIDATION_ERROR", "Queued-attempt invariant failed."); const latest = check.printAttempts.at(-1); if (check.status === "DRAFT" || check.status === "READY") invariant(check.printAttempts.every((attempt) => attempt.status === "FAILED"), "VALIDATION_ERROR", "Draft and ready checks may retain only not-sent attempts."); if (check.status === "PRINT_QUEUED") invariant(latest?.status === "QUEUED", "VALIDATION_ERROR", "Queued checks require a queued latest attempt."); if (check.status === "PRINTED") invariant(latest?.status === "CONFIRMED", "VALIDATION_ERROR", "Printed checks require a confirmed latest attempt."); if (check.status === "MISPRINTED") invariant(latest?.status === "MISPRINTED", "VALIDATION_ERROR", "Misprinted checks require a spoiled latest attempt.");
      for (const attempt of check.printAttempts) { invariant(["QUEUED", "CONFIRMED", "FAILED", "MISPRINTED"].includes(attempt.status) && validIsoTimestamp(attempt.queuedAt) && (attempt.status === "QUEUED" ? !attempt.completedAt : Boolean(attempt.completedAt && validIsoTimestamp(attempt.completedAt))) && Boolean(attempt.documentId && attempt.calibrationProfileId && cleanText(attempt.printerKey, "printer", 200) && cleanText(attempt.stockKey, "stockKey", 120) && attempt.planHash.match(/^[a-f0-9]{64}$/)) && Object.hasOwn(STOCK_KEYS, attempt.layout) && profileIds.has(attempt.calibrationProfileId), "VALIDATION_ERROR", "Print attempt fields are invalid."); const profile = this.#profile(attempt.calibrationProfileId); invariant(profile.accountId === check.accountId && profile.printerKey === attempt.printerKey && profile.stockKey === attempt.stockKey, "VALIDATION_ERROR", "Print attempt profile binding is invalid."); if (attempt.status === "FAILED" || attempt.status === "MISPRINTED") invariant(Boolean(attempt.failureCode), "VALIDATION_ERROR", "Failed or spoiled attempts require a reason."); }
      if (check.replacementForCheckId) { const original = this.#state.checks.find((item) => item.id === check.replacementForCheckId); invariant(original?.replacedByCheckId === check.id, "VALIDATION_ERROR", "Replacement link is not reciprocal."); } if (check.replacedByCheckId) { const replacement = this.#state.checks.find((item) => item.id === check.replacedByCheckId); invariant(replacement?.replacementForCheckId === check.id && check.status === "VOIDED", "VALIDATION_ERROR", "Original replacement link is invalid."); }
    }
    return true;
  }
}
