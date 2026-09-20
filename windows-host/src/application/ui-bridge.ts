import { CheckPrinterEngine, createEmptyState } from "../../../src/engine.ts";
import { DomainError } from "../../../src/errors.ts";
import { exactPrintJob, type ExactPrintJob, type NativePrintOutcome, type PrinterDescriptor } from "../../../src/host-contract.ts";
import { hashPrintPlan, STOCK_KEYS } from "../../../src/calibration.ts";
import type { RegisterQuery, RegisterReport, RegisterRow } from "../../../src/register.ts";
import type {
  Account,
  Address,
  AppLocale,
  BankCountry,
  CalibrationProfile,
  CheckRecord,
  Currency,
  EngineState,
  LayoutKind,
  Payee,
} from "../../../src/types.ts";
import type {
  BackupIntent,
  CreateAccountInput,
  CreateCalibrationInput,
  CreateChequeInput,
  ExactPreviewMetadata,
  QueueLiveInput,
  ReconciliationSummary,
  RestoreIntent,
  UiBridgeCapabilities,
  UiOperationResult,
} from "../ui/app-model.ts";
import type { CommerceActionResult, CommerceSnapshot } from "../product/entitlement.ts";
import type { LaunchHostLocale } from "../product/product-identity.ts";
import type { PreUiApplication } from "./pre-ui-host.ts";

export interface UiHostFilePort {
  createBackup(intent: BackupIntent): Promise<void>;
  restoreBackup(intent: RestoreIntent): Promise<void>;
  writeText(destinationPath: string, contents: string): Promise<void>;
}

export interface UiApplicationBridge {
  readonly capabilities: UiBridgeCapabilities;
  snapshot(): EngineState;
  commerceSnapshot(): CommerceSnapshot;
  listPrinters(): Promise<readonly PrinterDescriptor[]>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(id: string, patch: Partial<Pick<Account, "name" | "companyName" | "companyAddress" | "currency" | "bankCountry" | "locale">>): Promise<Account>;
  setNextCheckNumber(id: string, nextCheckNumber: number): Promise<Account>;
  confirmNextCheckNumber(id: string, nextCheckNumber: number): Promise<Account>;
  archiveAccount(id: string, archived?: boolean): Promise<Account>;
  createPayee(input: { name: string; address?: Address; defaultMemo?: string }): Promise<Payee>;
  updatePayee(id: string, patch: Partial<Pick<Payee, "name" | "address" | "defaultMemo">>): Promise<Payee>;
  archivePayee(id: string, archived?: boolean): Promise<Payee>;
  importPayees(csv: string, accountId?: string): Promise<{ created: Payee[]; skipped: number }>;
  createCalibration(input: CreateCalibrationInput): Promise<CalibrationProfile>;
  updateCalibration(id: string, patch: Parameters<CheckPrinterEngine["updateCalibration"]>[1]): Promise<CalibrationProfile>;
  createDraft(input: CreateChequeInput): Promise<CheckRecord>;
  updateDraft(id: string, patch: Parameters<CheckPrinterEngine["updateDraft"]>[1]): Promise<CheckRecord>;
  duplicateCheck(id: string, issueDate: string): Promise<CheckRecord>;
  deleteDraft(id: string): Promise<void>;
  markReady(id: string, calibrationProfileId: string): Promise<CheckRecord>;
  returnToDraft(id: string): Promise<CheckRecord>;
  previewLive(input: QueueLiveInput): Promise<ExactPreviewMetadata>;
  queueLive(input: QueueLiveInput): Promise<
    | { allowed: false; reason: string; messageKey: string }
    | { allowed: true; job: ExactPrintJob; attemptIds: readonly string[] }
  >;
  saveLivePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>>;
  printLive(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>>;
  resolvePrintOutcome(documentId: string, planHash: string, outcome: NativePrintOutcome): Promise<readonly CheckRecord[]>;
  replaceMisprinted(checkId: string): Promise<CheckRecord>;
  confirmMisprintedAsPrinted(checkId: string): Promise<CheckRecord>;
  voidCheck(checkId: string, reason: string): Promise<CheckRecord>;
  setCleared(checkId: string, cleared: boolean, clearedDate?: string): Promise<CheckRecord>;
  sampleJob(profileId: string, printerKey: string, locale?: AppLocale): Promise<ExactPrintJob>;
  calibrationJob(profileId: string, printerKey: string, locale?: AppLocale): Promise<ExactPrintJob>;
  saveNonNegotiablePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>>;
  printNonNegotiable(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>>;
  exportRegister(query: RegisterQuery, locale: AppLocale): string;
  saveRegisterExport(query: RegisterQuery, locale: AppLocale, destinationPath: string): Promise<UiOperationResult>;
  createBackup(intent: BackupIntent): Promise<UiOperationResult>;
  restoreBackup(intent: RestoreIntent): Promise<UiOperationResult>;
  initializeCommerce(): Promise<CommerceSnapshot>;
  refreshCommerce(): Promise<CommerceSnapshot>;
  purchaseLifetime(locale: LaunchHostLocale): Promise<CommerceActionResult>;
  restoreLifetime(): Promise<CommerceActionResult>;
  queryRegister(query: RegisterQuery): readonly RegisterRow[];
  registerReport(query: RegisterQuery, locale: AppLocale): RegisterReport;
  reconciliation(accountId: string): ReconciliationSummary;
}

function unavailable<T = undefined>(key: string, code: string): UiOperationResult<T> {
  return { ok: false, kind: "NOT_AVAILABLE", code, message: { key } };
}

function previewEngine(state: EngineState): CheckPrinterEngine {
  let sequence = 0;
  const instant = state.audit.at(-1)?.at ?? "2026-09-19T12:00:00.000Z";
  return new CheckPrinterEngine(state, {
    now: () => instant,
    newId: () => `ui-preview-${++sequence}`,
  });
}

function previewMetadata(job: ExactPrintJob): ExactPreviewMetadata {
  const fieldRoles = new Set<string>();
  for (const page of job.plan.pages) {
    for (const element of page.elements) {
      if (element.kind === "text") fieldRoles.add(element.role);
    }
  }
  return {
    job,
    plan: job.plan,
    pageCount: job.plan.pages.length,
    paper: job.paper,
    scalePercent: job.scalePercent,
    fitToPage: job.fitToPage,
    checkIds: job.plan.checkIds,
    warningKeys: job.plan.warningKeys,
    fieldRoles: [...fieldRoles].sort(),
  };
}

abstract class BaseUiBridge implements UiApplicationBridge {
  abstract readonly capabilities: UiBridgeCapabilities;
  abstract snapshot(): EngineState;
  abstract commerceSnapshot(): CommerceSnapshot;
  abstract listPrinters(): Promise<readonly PrinterDescriptor[]>;
  protected abstract mutate<T>(operation: (engine: CheckPrinterEngine) => T): Promise<T>;
  abstract queueLive(input: QueueLiveInput): ReturnType<UiApplicationBridge["queueLive"]>;
  abstract saveLivePdf(job: ExactPrintJob, destinationPath: string): ReturnType<UiApplicationBridge["saveLivePdf"]>;
  abstract printLive(job: ExactPrintJob): ReturnType<UiApplicationBridge["printLive"]>;
  abstract saveNonNegotiablePdf(job: ExactPrintJob, destinationPath: string): ReturnType<UiApplicationBridge["saveNonNegotiablePdf"]>;
  abstract printNonNegotiable(job: ExactPrintJob): ReturnType<UiApplicationBridge["printNonNegotiable"]>;
  abstract initializeCommerce(): Promise<CommerceSnapshot>;
  abstract refreshCommerce(): Promise<CommerceSnapshot>;
  abstract purchaseLifetime(locale: LaunchHostLocale): Promise<CommerceActionResult>;
  abstract restoreLifetime(): Promise<CommerceActionResult>;

  createAccount(input: CreateAccountInput): Promise<Account> {
    return this.mutate((engine) => engine.createAccount(input));
  }
  updateAccount(id: string, patch: Partial<Pick<Account, "name" | "companyName" | "companyAddress" | "currency" | "bankCountry" | "locale">>): Promise<Account> {
    return this.mutate((engine) => engine.updateAccount(id, patch));
  }
  setNextCheckNumber(id: string, nextCheckNumber: number): Promise<Account> {
    return this.mutate((engine) => engine.setNextCheckNumber(id, nextCheckNumber));
  }
  confirmNextCheckNumber(id: string, nextCheckNumber: number): Promise<Account> {
    return this.mutate((engine) => engine.confirmNextCheckNumber(id, nextCheckNumber));
  }
  archiveAccount(id: string, archived = true): Promise<Account> {
    return this.mutate((engine) => engine.archiveAccount(id, archived));
  }
  createPayee(input: { name: string; address?: Address; defaultMemo?: string }): Promise<Payee> {
    return this.mutate((engine) => engine.createPayee(input));
  }
  updatePayee(id: string, patch: Partial<Pick<Payee, "name" | "address" | "defaultMemo">>): Promise<Payee> {
    return this.mutate((engine) => engine.updatePayee(id, patch));
  }
  archivePayee(id: string, archived = true): Promise<Payee> {
    return this.mutate((engine) => engine.archivePayee(id, archived));
  }
  importPayees(csv: string, accountId?: string): Promise<{ created: Payee[]; skipped: number }> {
    return this.mutate((engine) => engine.importPayees(csv, accountId));
  }
  createCalibration(input: CreateCalibrationInput): Promise<CalibrationProfile> {
    return this.mutate((engine) => engine.createCalibration(input));
  }
  updateCalibration(id: string, patch: Parameters<CheckPrinterEngine["updateCalibration"]>[1]): Promise<CalibrationProfile> {
    return this.mutate((engine) => engine.updateCalibration(id, patch));
  }
  createDraft(input: CreateChequeInput): Promise<CheckRecord> {
    return this.mutate((engine) => engine.createDraft(input));
  }
  updateDraft(id: string, patch: Parameters<CheckPrinterEngine["updateDraft"]>[1]): Promise<CheckRecord> {
    return this.mutate((engine) => engine.updateDraft(id, patch));
  }
  duplicateCheck(id: string, issueDate: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.duplicateCheck(id, { issueDate }));
  }
  async deleteDraft(id: string): Promise<void> {
    await this.mutate((engine) => engine.deleteDraft(id));
  }
  markReady(id: string, calibrationProfileId: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.markReady(id, calibrationProfileId));
  }
  returnToDraft(id: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.returnToDraft(id));
  }
  async previewLive(input: QueueLiveInput): Promise<ExactPreviewMetadata> {
    const engine = previewEngine(this.snapshot());
    const queued = engine.queuePrint(
      [...input.checkIds],
      input.calibrationProfileId,
      input.printerKey,
      input.stockKey,
      input.startSlot,
      input.sheetIds ? [...input.sheetIds] : [],
    );
    return previewMetadata(exactPrintJob(queued.plan, input.printerKey, queued.planHash));
  }
  resolvePrintOutcome(documentId: string, planHash: string, outcome: NativePrintOutcome): Promise<readonly CheckRecord[]> {
    return this.mutate((engine) => engine.resolvePrintDocumentOutcome(documentId, planHash, outcome));
  }
  replaceMisprinted(checkId: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.replaceMisprinted(checkId));
  }
  confirmMisprintedAsPrinted(checkId: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.confirmMisprintedAsPrinted(checkId));
  }
  voidCheck(checkId: string, reason: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.voidCheck(checkId, reason));
  }
  setCleared(checkId: string, cleared: boolean, clearedDate?: string): Promise<CheckRecord> {
    return this.mutate((engine) => engine.setCleared(checkId, cleared, clearedDate));
  }
  async sampleJob(profileId: string, printerKey: string, locale?: AppLocale): Promise<ExactPrintJob> {
    const engine = previewEngine(this.snapshot());
    const plan = engine.samplePlan(profileId, printerKey, locale);
    return exactPrintJob(plan, printerKey, hashPrintPlan(plan));
  }
  async calibrationJob(profileId: string, printerKey: string, locale?: AppLocale): Promise<ExactPrintJob> {
    const engine = previewEngine(this.snapshot());
    const plan = engine.calibrationPlan(profileId, printerKey, locale);
    return exactPrintJob(plan, printerKey, hashPrintPlan(plan));
  }
  exportRegister(query: RegisterQuery, locale: AppLocale): string {
    return previewEngine(this.snapshot()).exportFilteredRegister(query, locale);
  }
  queryRegister(query: RegisterQuery): readonly RegisterRow[] {
    return previewEngine(this.snapshot()).queryRegister(query);
  }
  registerReport(query: RegisterQuery, locale: AppLocale): RegisterReport {
    return previewEngine(this.snapshot()).registerReport(query, locale);
  }
  reconciliation(accountId: string): ReconciliationSummary {
    return previewEngine(this.snapshot()).reconciliation(accountId);
  }
  async saveRegisterExport(_query: RegisterQuery, _locale: AppLocale, _destinationPath: string): Promise<UiOperationResult> {
    return unavailable("ui.notAvailable.fileExport", "FILE_EXPORT_PORT_REQUIRED");
  }
  async createBackup(_intent: BackupIntent): Promise<UiOperationResult> {
    return unavailable("ui.notAvailable.backup", "BACKUP_PORT_REQUIRED");
  }
  async restoreBackup(_intent: RestoreIntent): Promise<UiOperationResult> {
    return unavailable("ui.notAvailable.restore", "RESTORE_PORT_REQUIRED");
  }
}

export class PreUiApplicationBridge extends BaseUiBridge {
  readonly #application: PreUiApplication;
  readonly #files?: UiHostFilePort;
  readonly capabilities: UiBridgeCapabilities;

  constructor(application: PreUiApplication, files?: UiHostFilePort) {
    super();
    this.#application = application;
    this.#files = files;
    this.capabilities = Object.freeze({
      nativePrinting: true,
      savePdf: true,
      backupRestore: Boolean(files),
      fileExport: Boolean(files),
      storeCommerce: true,
      developmentFixture: false,
    });
  }

  snapshot(): EngineState { return this.#application.engine.snapshot(); }
  commerceSnapshot(): CommerceSnapshot { return this.#application.commerce.snapshot(); }
  listPrinters(): Promise<readonly PrinterDescriptor[]> { return this.#application.services.printPlatform.listPrinters(); }

  protected async mutate<T>(operation: (engine: CheckPrinterEngine) => T): Promise<T> {
    const expectedRevision = this.#application.engine.snapshot().revision;
    const result = operation(this.#application.engine);
    await this.#application.commit(expectedRevision);
    return structuredClone(result);
  }

  async queueLive(input: QueueLiveInput): ReturnType<UiApplicationBridge["queueLive"]> {
    const queued = await this.#application.queueLivePrint({
      checkIds: [...input.checkIds],
      calibrationProfileId: input.calibrationProfileId,
      printerKey: input.printerKey,
      stockKey: input.stockKey,
      startSlot: input.startSlot,
      sheetIds: input.sheetIds ? [...input.sheetIds] : undefined,
    });
    if (!queued.allowed) {
      return { allowed: false, reason: queued.decision.reason, messageKey: queued.decision.messageKey };
    }
    return { allowed: true, job: queued.job, attemptIds: queued.attemptIds };
  }

  async saveLivePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> {
    const integrity = await this.#application.services.printPlatform.savePdf(job, destinationPath);
    return { ok: true, value: { pdfSha256: integrity.pdfSha256 }, message: { key: "state.pdf.success.body" } };
  }

  async printLive(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>> {
    const outcome = await this.#application.services.printPlatform.print(job);
    await this.resolvePrintOutcome(job.plan.documentId, job.planHash, outcome);
    return { ok: true, value: outcome };
  }

  saveNonNegotiablePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> {
    return this.saveLivePdf(job, destinationPath);
  }

  async printNonNegotiable(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>> {
    const outcome = await this.#application.services.printPlatform.print(job);
    return { ok: true, value: outcome };
  }

  async saveRegisterExport(query: RegisterQuery, locale: AppLocale, destinationPath: string): Promise<UiOperationResult> {
    if (!this.#files) return super.saveRegisterExport(query, locale, destinationPath);
    await this.#files.writeText(destinationPath, this.exportRegister(query, locale));
    return { ok: true, value: undefined, message: { key: "ui.register.exportSuccess" } };
  }

  async createBackup(intent: BackupIntent): Promise<UiOperationResult> {
    if (!this.#files) return super.createBackup(intent);
    await this.#files.createBackup(intent);
    return { ok: true, value: undefined, message: { key: "backup.success" } };
  }

  async restoreBackup(intent: RestoreIntent): Promise<UiOperationResult> {
    if (!this.#files) return super.restoreBackup(intent);
    await this.#files.restoreBackup(intent);
    return { ok: true, value: undefined, message: { key: "restore.success" } };
  }

  initializeCommerce(): Promise<CommerceSnapshot> { return this.#application.initializeCommerce(); }
  refreshCommerce(): Promise<CommerceSnapshot> { return this.#application.refreshCommerce(); }
  purchaseLifetime(locale: LaunchHostLocale): Promise<CommerceActionResult> { return this.#application.purchaseLifetime(locale); }
  restoreLifetime(): Promise<CommerceActionResult> { return this.#application.restoreLifetime(); }
}

export interface MemoryUiBridgeOptions {
  readonly state?: EngineState;
  readonly printers?: readonly PrinterDescriptor[];
  readonly commerce?: CommerceSnapshot;
  readonly now?: () => string;
}

export class MemoryUiApplicationBridge extends BaseUiBridge {
  readonly capabilities: UiBridgeCapabilities = Object.freeze({
    nativePrinting: false,
    savePdf: false,
    backupRestore: false,
    fileExport: false,
    storeCommerce: false,
    developmentFixture: true,
  });
  #engine: CheckPrinterEngine;
  readonly #printers: readonly PrinterDescriptor[];
  #commerce: CommerceSnapshot;
  readonly #now: () => string;

  constructor(options: MemoryUiBridgeOptions = {}) {
    super();
    this.#now = options.now ?? (() => "2026-09-19T12:00:00.000Z");
    let sequence = 0;
    this.#engine = new CheckPrinterEngine(options.state ?? createEmptyState(), {
      now: this.#now,
      newId: () => `ui-fixture-${++sequence}`,
    });
    this.#printers = options.printers ?? [{ key: "Microsoft Print to PDF", displayName: "Microsoft Print to PDF", isDefault: true, supportsLetter: true }];
    this.#commerce = options.commerce ?? {
      entitlement: "FREE",
      verification: "FREE",
      price: { formattedPrice: "$19.99", currencyCode: "USD", fetchedAt: this.#now() },
      messageKey: "purchase.status.free",
      canStartNewLivePrint: true,
      canResolveQueuedPrint: true,
    };
  }

  snapshot(): EngineState { return this.#engine.snapshot(); }
  commerceSnapshot(): CommerceSnapshot { return structuredClone(this.#commerce); }
  async listPrinters(): Promise<readonly PrinterDescriptor[]> { return structuredClone(this.#printers); }
  protected async mutate<T>(operation: (engine: CheckPrinterEngine) => T): Promise<T> { return operation(this.#engine); }

  async queueLive(input: QueueLiveInput): ReturnType<UiApplicationBridge["queueLive"]> {
    try {
      const queued = this.#engine.queuePrint(
        [...input.checkIds], input.calibrationProfileId, input.printerKey, input.stockKey,
        input.startSlot, input.sheetIds ? [...input.sheetIds] : [],
      );
      return { allowed: true, job: exactPrintJob(queued.plan, input.printerKey, queued.planHash), attemptIds: queued.attemptIds };
    } catch (error) {
      if (error instanceof DomainError && error.code === "ENTITLEMENT_REQUIRED") {
        return { allowed: false, reason: "LIFETIME_REQUIRED", messageKey: "purchase.freeLimitReached" };
      }
      throw error;
    }
  }

  async saveLivePdf(_job: ExactPrintJob, _destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> {
    return unavailable("ui.notAvailable.savePdf", "DEVELOPMENT_FIXTURE_NO_FILES");
  }
  async printLive(_job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>> {
    return unavailable("ui.notAvailable.nativePrint", "DEVELOPMENT_FIXTURE_NO_PRINTER");
  }
  saveNonNegotiablePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> { return this.saveLivePdf(job, destinationPath); }
  printNonNegotiable(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>> { return this.printLive(job); }
  async initializeCommerce(): Promise<CommerceSnapshot> { return this.commerceSnapshot(); }
  async refreshCommerce(): Promise<CommerceSnapshot> { return this.commerceSnapshot(); }
  async purchaseLifetime(_locale: LaunchHostLocale): Promise<CommerceActionResult> {
    return { status: "FAILED", errorCode: "PACKAGE_IDENTITY_MISSING", retryable: false, snapshot: this.commerceSnapshot() };
  }
  async restoreLifetime(): Promise<CommerceActionResult> {
    return { status: "FAILED", errorCode: "PACKAGE_IDENTITY_MISSING", retryable: false, snapshot: this.commerceSnapshot() };
  }
}

export function createDevelopmentUiBridge(
  country: BankCountry = "US",
  locale: AppLocale = country === "US" ? "en-US" : "en-CA",
): MemoryUiApplicationBridge {
  let sequence = 0;
  const now = () => "2026-09-19T12:00:00.000Z";
  const engine = new CheckPrinterEngine(createEmptyState(), {
    now,
    newId: () => `ui-demo-${++sequence}`,
  });
  engine.setEntitlement({ kind: "FREE", source: "TEST", verifiedAt: now() });
  const currency: Currency = country === "US" ? "USD" : "CAD";
  const account = engine.createAccount({
    name: "Operating account",
    companyName: "WorksBien Browser Test",
    currency,
    bankCountry: country,
    locale,
    nextCheckNumber: 1001,
  });
  const payee = engine.createPayee({ name: "Northwind Supplies", defaultMemo: "Invoice 1042" });
  engine.createPayee({ name: "Contoso Office Services" });
  engine.createCalibration({
    accountId: account.id,
    name: "Microsoft Print to PDF · Voucher top",
    printerKey: "Microsoft Print to PDF",
    stockKey: STOCK_KEYS.VOUCHER_TOP,
    layout: "VOUCHER_TOP",
  });
  const historical = engine.createDraft({
    accountId: account.id,
    payeeId: payee.id,
    issueDate: "2026-09-18",
    amountCents: 123_456,
    memo: "Invoice 1042",
    category: "Supplies",
  });
  engine.deleteDraft(historical.id);
  return new MemoryUiApplicationBridge({ state: engine.snapshot(), now });
}

export function isDomainFailure(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
