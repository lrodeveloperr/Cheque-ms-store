import type { ExactPrintJob, NativePrintOutcome, PrinterDescriptor } from "../../../src/host-contract.ts";
import type { RegisterQuery, RegisterReport, RegisterRow } from "../../../src/register.ts";
import type {
  Account,
  AppLocale,
  BankCountry,
  CalibrationProfile,
  CheckRecord,
  Currency,
  EngineState,
  LayoutKind,
  Payee,
  PrintPlan,
} from "../../../src/types.ts";
import type { CommerceSnapshot } from "../product/entitlement.ts";
import type { AppRoute } from "../product/navigation.ts";

export interface UiMessage {
  readonly key: string;
  readonly parameters?: Readonly<Record<string, string | number>>;
}

export type UiOperationResult<T = undefined> =
  | { readonly ok: true; readonly value: T; readonly message?: UiMessage }
  | {
      readonly ok: false;
      readonly kind: "BLOCKED" | "NOT_AVAILABLE" | "VALIDATION" | "FAILURE";
      readonly message: UiMessage;
      readonly code?: string;
      readonly retryable?: boolean;
      readonly details?: Readonly<Record<string, unknown>>;
    };

export interface OnboardingProgress {
  readonly preprintedStockConfirmed: boolean;
  readonly accountId?: string;
  readonly layout?: LayoutKind;
  readonly printerKey?: string;
  readonly stockKey?: string;
  readonly startSlot: 0 | 1 | 2;
  readonly calibrationProfileId?: string;
  readonly completedAt?: string;
}

export interface PendingPrintReference {
  readonly documentId: string;
  readonly planHash: string;
  readonly checkIds: readonly string[];
  readonly attemptIds: readonly string[];
  readonly printerKey: string;
  readonly stockKey: string;
}

export interface UiSessionState {
  readonly version: 1;
  readonly route: AppRoute;
  readonly locale: AppLocale;
  readonly selectedAccountId?: string;
  readonly selectedCalibrationProfileId?: string;
  readonly selectedPrinterKey?: string;
  readonly selectedStockKey?: string;
  readonly startSlot: 0 | 1 | 2;
  readonly activeDraftId?: string;
  readonly lastCompletedCheckId?: string;
  readonly onboarding: OnboardingProgress;
  readonly registerQuery: RegisterQuery;
}

export interface UiStateStore {
  load(): Promise<UiSessionState | undefined>;
  save(value: UiSessionState): Promise<void>;
}

export class MemoryUiStateStore implements UiStateStore {
  #value?: UiSessionState;

  constructor(value?: UiSessionState) {
    this.#value = value ? structuredClone(value) : undefined;
  }

  async load(): Promise<UiSessionState | undefined> {
    return this.#value ? structuredClone(this.#value) : undefined;
  }

  async save(value: UiSessionState): Promise<void> {
    this.#value = structuredClone(value);
  }
}

export type ReadinessCode =
  | "READY"
  | "ACCOUNT_REQUIRED"
  | "NUMBER_CONFIRMATION_REQUIRED"
  | "CALIBRATION_REQUIRED"
  | "PRINTER_REQUIRED"
  | "PENDING_PRINT_OUTCOME";

export interface SetupChecklistItem {
  readonly id: "STOCK" | "ACCOUNT" | "LAYOUT" | "PRINTER" | "CALIBRATION";
  readonly titleKey: string;
  readonly complete: boolean;
  readonly route: AppRoute;
}

export interface HomeViewModel {
  readonly kind: "HOME";
  readonly route: "HOME";
  readonly readiness: ReadinessCode;
  readonly readinessMessage: UiMessage;
  readonly selectedAccount?: Account;
  readonly selectedProfile?: CalibrationProfile;
  readonly pendingPrint?: PendingPrintReference;
  readonly nextCheckNumber?: number;
  readonly freeUsed: number;
  readonly freeRemaining: number;
  readonly commerce: CommerceSnapshot;
  readonly recentChecks: readonly CheckRecord[];
  readonly checklist: readonly SetupChecklistItem[];
  readonly canCreateCheque: boolean;
}

export interface OnboardingViewModel {
  readonly kind: "ONBOARDING";
  readonly route:
    | "ONBOARDING_WELCOME"
    | "ONBOARDING_STOCK"
    | "ONBOARDING_ACCOUNT"
    | "ONBOARDING_LAYOUT"
    | "ONBOARDING_PRINTER"
    | "ONBOARDING_CALIBRATION";
  readonly progress: OnboardingProgress;
  readonly checklist: readonly SetupChecklistItem[];
  readonly printers: readonly PrinterDescriptor[];
  readonly accounts: readonly Account[];
  readonly profiles: readonly CalibrationProfile[];
}

export interface ChequesViewModel {
  readonly kind: "CHEQUES";
  readonly route: "CHEQUES";
  readonly drafts: readonly CheckRecord[];
  readonly ready: readonly CheckRecord[];
  readonly unresolved: readonly CheckRecord[];
  readonly recent: readonly CheckRecord[];
}

export interface ChequeEditorViewModel {
  readonly kind: "CHEQUE_EDITOR";
  readonly route: "CHEQUE_NEW";
  readonly account?: Account;
  readonly draft?: CheckRecord;
  readonly payees: readonly Payee[];
  readonly suggestedPayees: readonly Payee[];
  readonly checkNumber?: number;
  readonly canContinue: boolean;
}

export interface ExactPreviewMetadata {
  readonly job: ExactPrintJob;
  readonly plan: PrintPlan;
  readonly pageCount: number;
  readonly paper: "LETTER";
  readonly scalePercent: 100;
  readonly fitToPage: false;
  readonly checkIds: readonly string[];
  readonly warningKeys: readonly string[];
  readonly fieldRoles: readonly string[];
}

export interface ChequeReviewViewModel {
  readonly kind: "CHEQUE_REVIEW";
  readonly route: "CHEQUE_REVIEW";
  readonly check?: CheckRecord;
  readonly account?: Account;
  readonly payee?: Payee;
  readonly profile?: CalibrationProfile;
  readonly preview?: ExactPreviewMetadata;
  readonly warnings: readonly UiMessage[];
  readonly canQueue: boolean;
}

export interface OutputViewModel {
  readonly kind: "CHEQUE_OUTPUT";
  readonly route: "CHEQUE_OUTPUT";
  readonly check?: CheckRecord;
  readonly profile?: CalibrationProfile;
  readonly pendingPrint?: PendingPrintReference;
  readonly printers: readonly PrinterDescriptor[];
  readonly selectedPrinterKey?: string;
  readonly selectedStockKey?: string;
  readonly startSlot: 0 | 1 | 2;
  readonly commerce: CommerceSnapshot;
  readonly liveJobReady: boolean;
}

export interface PrintOutcomeViewModel {
  readonly kind: "PRINT_OUTCOME";
  readonly route: "PRINT_OUTCOME";
  readonly pendingPrint?: PendingPrintReference;
  readonly checks: readonly CheckRecord[];
  readonly outcomes: readonly NativePrintOutcome["kind"][];
}

export interface RegisterViewModel {
  readonly kind: "REGISTER";
  readonly route: "REGISTER";
  readonly query: RegisterQuery;
  readonly rows: readonly RegisterRow[];
  readonly report: RegisterReport;
  readonly selectedAccount?: Account;
  readonly reconciliation?: ReconciliationSummary;
}

export interface ReconciliationSummary {
  readonly outstandingCents: number;
  readonly clearedCents: number;
  readonly voidedCents: number;
  readonly spoiledCents: number;
  readonly outstandingCount: number;
  readonly clearedCount: number;
  readonly voidedCount: number;
  readonly spoiledCount: number;
  readonly deletedDraftCount: number;
  readonly issuedCheckCount: number;
}

export interface PayeesViewModel {
  readonly kind: "PAYEES";
  readonly route: "PAYEES" | "PAYEE_EDIT";
  readonly payees: readonly Payee[];
  readonly selectedPayee?: Payee;
}

export interface SettingsViewModel {
  readonly kind: "SETTINGS";
  readonly route:
    | "SETTINGS"
    | "SETTINGS_ACCOUNTS"
    | "SETTINGS_STOCK"
    | "SETTINGS_CALIBRATION"
    | "SETTINGS_BACKUP"
    | "SETTINGS_LANGUAGE"
    | "SETTINGS_PURCHASE"
    | "SETTINGS_PRIVACY";
  readonly accounts: readonly Account[];
  readonly profiles: readonly CalibrationProfile[];
  readonly printers: readonly PrinterDescriptor[];
  readonly locale: AppLocale;
  readonly commerce: CommerceSnapshot;
  readonly capabilities: UiBridgeCapabilities;
}

export interface GenericViewModel {
  readonly kind: "GENERIC";
  readonly route: AppRoute;
  readonly message: UiMessage;
}

export type AppViewModel =
  | HomeViewModel
  | OnboardingViewModel
  | ChequesViewModel
  | ChequeEditorViewModel
  | ChequeReviewViewModel
  | OutputViewModel
  | PrintOutcomeViewModel
  | RegisterViewModel
  | PayeesViewModel
  | SettingsViewModel
  | GenericViewModel;

export interface UiBridgeCapabilities {
  readonly nativePrinting: boolean;
  readonly savePdf: boolean;
  readonly backupRestore: boolean;
  readonly fileExport: boolean;
  readonly storeCommerce: boolean;
  readonly developmentFixture: boolean;
}

export interface CreateAccountInput {
  readonly name: string;
  readonly companyName: string;
  readonly currency: Currency;
  readonly bankCountry: BankCountry;
  readonly locale: AppLocale;
  readonly nextCheckNumber: number;
}

export interface CreateChequeInput {
  readonly accountId: string;
  readonly payeeId: string;
  readonly issueDate: string;
  readonly amountCents: number;
  readonly memo?: string;
  readonly category?: string;
}

export interface CreateCalibrationInput {
  readonly accountId: string;
  readonly name: string;
  readonly printerKey: string;
  readonly layout: LayoutKind;
}

export interface QueueLiveInput {
  readonly checkIds: readonly string[];
  readonly calibrationProfileId: string;
  readonly printerKey: string;
  readonly stockKey: string;
  readonly startSlot: 0 | 1 | 2;
  readonly sheetIds?: readonly string[];
}

export interface BackupIntent {
  readonly destinationPath: string;
  readonly recoveryPassphrase: string;
}

export interface RestoreIntent {
  readonly sourcePath: string;
  readonly backupPassphrase: string;
}

export function initialUiSession(locale: AppLocale = "en-US"): UiSessionState {
  return {
    version: 1,
    route: "STARTUP",
    locale,
    startSlot: 0,
    onboarding: {
      preprintedStockConfirmed: false,
      startSlot: 0,
    },
    registerQuery: {},
  };
}

export function cloneUiSession(value: UiSessionState): UiSessionState {
  return structuredClone(value);
}

export function pendingPrintFromState(state: EngineState): PendingPrintReference | undefined {
  const queued = state.checks.flatMap((check) =>
    check.printAttempts
      .filter((attempt) => attempt.status === "QUEUED")
      .map((attempt) => ({ check, attempt })),
  );
  if (queued.length === 0) return undefined;
  queued.sort((left, right) => left.attempt.queuedAt.localeCompare(right.attempt.queuedAt));
  const latest = queued.at(-1)!;
  const document = queued.filter(
    ({ attempt }) =>
      attempt.documentId === latest.attempt.documentId &&
      attempt.planHash === latest.attempt.planHash,
  );
  return {
    documentId: latest.attempt.documentId,
    planHash: latest.attempt.planHash,
    checkIds: document.map(({ check }) => check.id),
    attemptIds: document.map(({ attempt }) => attempt.id),
    printerKey: latest.attempt.printerKey,
    stockKey: latest.attempt.stockKey,
  };
}
