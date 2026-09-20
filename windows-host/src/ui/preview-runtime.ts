import type { AppRoute } from "../product/navigation.ts";
import type { CommerceSnapshot } from "../product/entitlement.ts";
import type {
  Account,
  CalibrationProfile,
  CheckRecord,
  Payee,
  PrintPlan,
} from "../../../src/types.ts";
import type { AppViewModel, UiSessionState } from "./app-model.ts";
import type { UiEnvelope } from "./ipc-contract.ts";

const instant = "2026-09-19T12:00:00.000Z";
const account: Account = {
  id: "preview-account",
  name: "Operating account",
  companyName: "WorksBien Browser Test",
  currency: "USD",
  bankCountry: "US",
  locale: "en-US",
  nextCheckNumber: 1004,
  numberingState: "VERIFIED",
  archived: false,
  createdAt: instant,
  updatedAt: instant,
};
const payees: Payee[] = [
  { id: "payee-1", name: "Northwind Supplies", defaultMemo: "Invoice 1042", archived: false, createdAt: instant, updatedAt: instant },
  { id: "payee-2", name: "Contoso Office Services", defaultMemo: "Office services", archived: false, createdAt: instant, updatedAt: instant },
];
const profile: CalibrationProfile = {
  id: "preview-profile",
  accountId: account.id,
  name: "Microsoft Print to PDF · Voucher top",
  printerKey: "Microsoft Print to PDF",
  stockKey: "WB-VOUCHER-TOP-LETTER-3.5-3.5-4.0",
  layout: "VOUCHER_TOP",
  printCheckNumber: true,
  dateFormat: "MM/DD/YYYY",
  amountWordsCurrencyLabel: true,
  amountWordsFill: true,
  xOffsetPt: 0,
  yOffsetPt: 0,
  scalePercent: 100,
  fieldAdjustments: {
    checkNumber: { xPt: 0, yPt: 0 }, date: { xPt: 0, yPt: 0 }, payee: { xPt: 0, yPt: 0 },
    amountNumeric: { xPt: 0, yPt: 0 }, amountWords: { xPt: 0, yPt: 0 }, memo: { xPt: 0, yPt: 0 },
  },
  stubAdjustments: { first: { xPt: 0, yPt: 0 }, second: { xPt: 0, yPt: 0 } },
  createdAt: instant,
  updatedAt: instant,
};
const checks: CheckRecord[] = [
  {
    id: "check-1", accountId: account.id, payeeId: payees[0]!.id,
    payeeSnapshot: { name: payees[0]!.name }, accountSnapshot: { name: account.name, companyName: account.companyName, locale: account.locale },
    checkNumber: 1003, issueDate: "2026-09-18", amountCents: 123456, currency: "USD", locale: "en-US",
    memo: "Invoice 1042", category: "Supplies", status: "PRINTED", warningKeys: [], clearedDate: undefined,
    printAttempts: [], createdAt: instant, updatedAt: instant,
  },
  {
    id: "check-2", accountId: account.id, payeeId: payees[1]!.id,
    payeeSnapshot: { name: payees[1]!.name }, accountSnapshot: { name: account.name, companyName: account.companyName, locale: account.locale },
    checkNumber: 1002, issueDate: "2026-09-15", amountCents: 48800, currency: "USD", locale: "en-US",
    memo: "September service", category: "Services", status: "PRINTED", warningKeys: [], clearedDate: "2026-09-17",
    printAttempts: [], createdAt: instant, updatedAt: "2026-09-17T10:00:00.000Z",
  },
];
const draft: CheckRecord = {
  ...checks[0]!, id: "draft-1", checkNumber: 1004, issueDate: "2026-09-19", amountCents: 12345,
  payeeSnapshot: { name: "Northwind Supplies" }, memo: "Sample only", status: "DRAFT", clearedDate: undefined,
};
const plan: PrintPlan = {
  version: 4,
  documentId: "preview-document",
  documentKind: "CHECKS",
  currency: "USD",
  locale: "en-US",
  bankCountry: "US",
  layout: "VOUCHER_TOP",
  calibrationProfileId: profile.id,
  accountId: account.id,
  printerKey: profile.printerKey,
  stockKey: profile.stockKey,
  startSlot: 0,
  sheetIds: [],
  checkIds: [draft.id],
  generatedAt: instant,
  warningKeys: [],
  pages: [{ widthPt: 612, heightPt: 792, elements: [
    { kind: "text", role: "check_number", text: "1004", xPt: 528, yPt: 21, widthPt: 55, heightPt: 12, fontSizePt: 9, fontFamily: "WorksBienSans", align: "right" },
    { kind: "text", role: "date", text: "09/19/2026", xPt: 450, yPt: 58, widthPt: 110, heightPt: 14, fontSizePt: 10, fontFamily: "WorksBienSans", align: "right" },
    { kind: "text", role: "payee", text: "Northwind Supplies", xPt: 72, yPt: 105, widthPt: 355, heightPt: 16, fontSizePt: 11, fontFamily: "WorksBienSans", align: "left" },
    { kind: "text", role: "amount_numeric", text: "$123.45", xPt: 461, yPt: 104, widthPt: 100, heightPt: 16, fontSizePt: 11, fontFamily: "WorksBienSans", align: "right" },
    { kind: "text", role: "amount_words", text: "*** One Hundred Twenty-Three and 45/100 Dollars ***", xPt: 31, yPt: 145, widthPt: 530, heightPt: 14, fontSizePt: 9, fontFamily: "WorksBienSans", align: "left" },
    { kind: "text", role: "memo", text: "Sample only", xPt: 72, yPt: 202, widthPt: 250, heightPt: 13, fontSizePt: 9, fontFamily: "WorksBienSans", align: "left" },
    { kind: "text", role: "stub", text: "1004 | 09/19/2026 | Northwind Supplies | $123.45 | Sample only", xPt: 31, yPt: 395, widthPt: 550, heightPt: 13, fontSizePt: 8, fontFamily: "WorksBienSans", align: "left" },
    { kind: "text", role: "stub", text: "1004 | 09/19/2026 | Northwind Supplies | $123.45 | Sample only", xPt: 31, yPt: 646, widthPt: 550, heightPt: 13, fontSizePt: 8, fontFamily: "WorksBienSans", align: "left" },
  ] }],
};

function commerce(): CommerceSnapshot {
  return {
    entitlement: "FREE" as const,
    verification: "FREE" as const,
    price: { formattedPrice: "$19.99", currencyCode: "USD", fetchedAt: instant },
    messageKey: "purchase.status.free",
    canStartNewLivePrint: true,
    canResolveQueuedPrint: true,
  };
}

export function previewEnvelope(route: AppRoute = "HOME", locale: UiSessionState["locale"] = "en-US"): UiEnvelope {
  const session: UiSessionState = {
    version: 1,
    route,
    locale,
    selectedAccountId: account.id,
    selectedCalibrationProfileId: profile.id,
    selectedPrinterKey: profile.printerKey,
    selectedStockKey: profile.stockKey,
    startSlot: 0,
    activeDraftId: draft.id,
    onboarding: { preprintedStockConfirmed: true, accountId: account.id, layout: profile.layout, printerKey: profile.printerKey, stockKey: profile.stockKey, startSlot: 0, calibrationProfileId: profile.id, completedAt: instant },
    registerQuery: {},
  };
  let model: AppViewModel;
  if (route === "HOME") model = {
    kind: "HOME", route, readiness: "READY", readinessMessage: { key: "home.ready" }, selectedAccount: account,
    selectedProfile: profile, nextCheckNumber: account.nextCheckNumber, freeUsed: 1, freeRemaining: 2, commerce: commerce(),
    recentChecks: checks, checklist: [
      { id: "STOCK", titleKey: "settings.stock", complete: true, route: "SETTINGS_STOCK" },
      { id: "ACCOUNT", titleKey: "settings.accounts", complete: true, route: "SETTINGS_ACCOUNTS" },
      { id: "CALIBRATION", titleKey: "settings.calibration", complete: true, route: "SETTINGS_CALIBRATION" },
    ], canCreateCheque: true,
  };
  else if (route === "CHEQUES") model = { kind: "CHEQUES", route, drafts: [draft], ready: [], unresolved: [], recent: checks };
  else if (route === "CHEQUE_NEW") model = { kind: "CHEQUE_EDITOR", route, account, draft, payees, suggestedPayees: payees, checkNumber: draft.checkNumber, canContinue: true };
  else if (route === "CHEQUE_REVIEW") model = { kind: "CHEQUE_REVIEW", route, check: { ...draft, status: "READY", readyCalibrationProfileId: profile.id }, account, payee: payees[0], profile, preview: { job: { plan, planHash: "preview", printerKey: profile.printerKey, paper: "LETTER", scalePercent: 100, fitToPage: false }, plan, pageCount: 1, paper: "LETTER", scalePercent: 100, fitToPage: false, checkIds: [draft.id], warningKeys: [], fieldRoles: ["date", "payee", "amount_numeric", "amount_words", "memo"] }, warnings: [], canQueue: true };
  else if (route === "CHEQUE_OUTPUT") model = { kind: "CHEQUE_OUTPUT", route, check: draft, profile, printers: [{ key: profile.printerKey, displayName: profile.printerKey, isDefault: true, supportsLetter: true }], selectedPrinterKey: profile.printerKey, selectedStockKey: profile.stockKey, startSlot: 0, commerce: commerce(), liveJobReady: true };
  else if (route === "PRINT_OUTCOME") model = { kind: "PRINT_OUTCOME", route, pendingPrint: { documentId: plan.documentId, planHash: "preview", checkIds: [draft.id], attemptIds: ["preview-attempt"], printerKey: profile.printerKey, stockKey: profile.stockKey }, checks: [draft], outcomes: ["PRINTED_CORRECTLY", "PAPER_MARKED_WITH_PROBLEM", "NOT_PRINTED"] };
  else if (route === "REGISTER") model = { kind: "REGISTER", route, query: {}, rows: checks.map((check) => ({ checkId: check.id, accountId: account.id, accountName: account.name, checkNumber: check.checkNumber, issueDate: check.issueDate, payeeName: check.payeeSnapshot.name, amountCents: check.amountCents, currency: check.currency, memo: check.memo, category: check.category, status: check.status, clearedDate: check.clearedDate })), report: { locale, generatedAt: instant, title: "Register", columns: [], rows: [], totals: { rowCount: 2, byCurrency: { USD: { totalCents: 172256, outstandingCents: 123456, clearedCents: 48800, voidedCents: 0, spoiledCents: 0 } } }, disclaimer: "" }, selectedAccount: account, reconciliation: { outstandingCents: 123456, clearedCents: 48800, voidedCents: 0, spoiledCents: 0, outstandingCount: 1, clearedCount: 1, voidedCount: 0, spoiledCount: 0, deletedDraftCount: 0, issuedCheckCount: 2 } };
  else if (route === "PAYEES" || route === "PAYEE_EDIT") model = { kind: "PAYEES", route, payees, selectedPayee: route === "PAYEE_EDIT" ? payees[0] : undefined };
  else if (route === "SETTINGS" || route.startsWith("SETTINGS_")) model = { kind: "SETTINGS", route: route as Extract<AppViewModel, { kind: "SETTINGS" }>["route"], accounts: [account], profiles: [profile], printers: [{ key: profile.printerKey, displayName: profile.printerKey, isDefault: true, supportsLetter: true }], locale, commerce: commerce(), capabilities: { nativePrinting: true, savePdf: true, backupRestore: true, fileExport: true, storeCommerce: false, developmentFixture: true } };
  else if (route.startsWith("ONBOARDING_")) model = { kind: "ONBOARDING", route: route as Extract<AppViewModel, { kind: "ONBOARDING" }>["route"], progress: session.onboarding, checklist: [], printers: [{ key: profile.printerKey, displayName: profile.printerKey, isDefault: true, supportsLetter: true }], accounts: [], profiles: [] };
  else model = { kind: "GENERIC", route, message: { key: route === "CHEQUE_SUCCESS" ? "state.print.success.body" : route === "HELP" ? "help.title" : "state.common.idle.body" } };
  return { model, session };
}
