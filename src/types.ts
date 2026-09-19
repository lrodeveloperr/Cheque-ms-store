export type Currency = "USD" | "CAD";
export type BankCountry = "US" | "CA";
export type AppLocale = "en-US" | "en-CA" | "fr-CA";
export type CheckStatus = "DRAFT" | "READY" | "PRINT_QUEUED" | "PRINTED" | "MISPRINTED" | "VOIDED" | "DELETED";
export type PrintAttemptStatus = "QUEUED" | "CONFIRMED" | "FAILED" | "MISPRINTED";
export type PrintFailureDisposition = "NOT_SENT" | "UNKNOWN";
export type LayoutKind = "VOUCHER_TOP" | "VOUCHER_MIDDLE" | "VOUCHER_BOTTOM" | "THREE_UP";
export type EntitlementKind = "FREE" | "LIFETIME";
export type DateFormat = "MM/DD/YYYY" | "YYYY-MM-DD" | "DD/MM/YYYY";
export type NumberingState = "VERIFIED" | "RESTORE_CONFIRMATION_REQUIRED";
export type FreeUsageBasis = "COUNTED_OR_GUARDED" | "PORTABLE_RESTORE_CONSERVATIVE";
export type CalibrationField = "checkNumber" | "date" | "payee" | "amountNumeric" | "amountWords" | "memo";
export type VoucherStub = "first" | "second";

export interface CalibrationOffset {
  xPt: number;
  yPt: number;
}

export type FieldAdjustments = Record<CalibrationField, CalibrationOffset>;
export type StubAdjustments = Record<VoucherStub, CalibrationOffset>;

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: "US" | "CA";
}

export interface Account {
  id: string;
  name: string;
  companyName: string;
  companyAddress?: Address;
  currency: Currency;
  bankCountry?: BankCountry;
  locale: AppLocale;
  nextCheckNumber: number;
  numberingState: NumberingState;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Payee {
  id: string;
  name: string;
  address?: Address;
  defaultMemo?: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTemplate {
  id: string;
  name: string;
  accountId: string;
  payeeId: string;
  amountCents?: number;
  memo: string;
  category: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrintAttempt {
  id: string;
  documentId: string;
  calibrationProfileId: string;
  layout: LayoutKind;
  printerKey: string;
  stockKey: string;
  planHash: string;
  queuedAt: string;
  status: PrintAttemptStatus;
  completedAt?: string;
  failureCode?: string;
  sheetId?: string;
  sheetSlot?: number;
}

export interface StockSheetUsage {
  id: string;
  accountId: string;
  calibrationProfileId: string;
  stockKey: string;
  usedSlots: number[];
  createdAt: string;
  updatedAt: string;
}

export interface CheckRecord {
  id: string;
  accountId: string;
  payeeId: string;
  payeeSnapshot: { name: string; address?: Address };
  accountSnapshot: { name: string; companyName: string; companyAddress?: Address; locale: AppLocale };
  checkNumber: number;
  issueDate: string;
  amountCents: number;
  currency: Currency;
  locale: AppLocale;
  memo: string;
  category: string;
  status: CheckStatus;
  readyCalibrationProfileId?: string;
  warningKeys: string[];
  clearedDate?: string;
  voidReason?: string;
  voidReasonCode?: "USER_VOID" | "MISPRINT_REPLACED" | "LEGACY_SAMPLE_QUARANTINED";
  deletedAt?: string;
  replacementForCheckId?: string;
  replacedByCheckId?: string;
  printAttempts: PrintAttempt[];
  createdAt: string;
  updatedAt: string;
}

export interface CalibrationProfile {
  id: string;
  accountId: string;
  name: string;
  printerKey: string;
  stockKey: string;
  layout: LayoutKind;
  printCheckNumber: boolean;
  dateFormat: DateFormat;
  amountWordsCurrencyLabel: boolean;
  amountWordsFill: boolean;
  xOffsetPt: number;
  yOffsetPt: number;
  scalePercent: number;
  fieldAdjustments: FieldAdjustments;
  stubAdjustments: StubAdjustments;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  sequence: number;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  stateHash: string;
  previousHash: string;
  hash: string;
}

export interface Entitlement {
  kind: EntitlementKind;
  source: "LOCAL_FREE" | "MICROSOFT_STORE" | "TEST";
  verifiedAt: string;
}

export interface EngineState {
  schemaVersion: 7;
  revision: number;
  freeUsageCount: number;
  freeUsageBasis: FreeUsageBasis;
  accounts: Account[];
  payees: Payee[];
  paymentTemplates: PaymentTemplate[];
  checks: CheckRecord[];
  calibrations: CalibrationProfile[];
  stockSheets: StockSheetUsage[];
  audit: AuditEntry[];
  entitlement: Entitlement;
}

export interface TextElement {
  kind: "text";
  role: "date" | "payee" | "amount_numeric" | "amount_words" | "memo" | "check_number" | "stub" | "calibration" | "overlay";
  text: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  fontSizePt: number;
  fontFamily: "WorksBienSans";
  align: "left" | "right" | "center";
}

export interface LineElement {
  kind: "line";
  role: "calibration";
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
  strokeWidthPt: number;
}

export type PrintElement = TextElement | LineElement;

export interface PrintPage {
  widthPt: 612;
  heightPt: 792;
  elements: PrintElement[];
}

export interface PrintPlan {
  version: 4;
  documentId: string;
  documentKind: "CHECKS" | "CALIBRATION" | "SAMPLE";
  currency: Currency;
  locale: AppLocale;
  bankCountry: BankCountry;
  layout: LayoutKind;
  calibrationProfileId: string;
  accountId?: string;
  printerKey: string;
  stockKey: string;
  startSlot: number;
  sheetIds: string[];
  pages: PrintPage[];
  checkIds: string[];
  generatedAt: string;
  warningKeys: string[];
}

export interface EngineDependencies {
  now: () => string;
  newId: () => string;
}
