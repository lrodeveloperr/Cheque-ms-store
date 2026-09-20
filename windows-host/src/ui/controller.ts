import type { ExactPrintJob, NativePrintOutcome, PrinterDescriptor } from "../../../src/host-contract.ts";
import type { RegisterQuery } from "../../../src/register.ts";
import type {
  Account,
  Address,
  AppLocale,
  CalibrationProfile,
  CheckRecord,
  LayoutKind,
  Payee,
} from "../../../src/types.ts";
import type { UiApplicationBridge } from "../application/ui-bridge.ts";
import type { AppRoute } from "../product/navigation.ts";
import type {
  AppViewModel,
  BackupIntent,
  CreateAccountInput,
  CreateChequeInput,
  ExactPreviewMetadata,
  RestoreIntent,
  UiMessage,
  UiOperationResult,
  UiSessionState,
  UiStateStore,
} from "./app-model.ts";
import {
  cloneUiSession,
  initialUiSession,
  pendingPrintFromState,
} from "./app-model.ts";
import { chequeEditorModel, chequeReviewModel, chequesModel } from "./features/cheques.ts";
import { homeModel } from "./features/home.ts";
import {
  isOnboardingRoute,
  nextOnboardingRoute,
  onboardingComplete,
  onboardingModel,
} from "./features/onboarding.ts";
import { outputModel, printOutcomeModel } from "./features/output.ts";
import { registerModel } from "./features/register.ts";
import { evaluateRouteGuard } from "./features/route-guards.ts";
import { isSettingsRoute, payeesModel, settingsModel } from "./features/settings.ts";

const UI_STOCK_KEYS: Readonly<Record<LayoutKind, string>> = Object.freeze({
  VOUCHER_TOP: "WB-VOUCHER-TOP-LETTER-3.5-3.5-4.0",
  VOUCHER_MIDDLE: "WB-VOUCHER-MIDDLE-LETTER-3.5-3.5-4.0",
  VOUCHER_BOTTOM: "WB-VOUCHER-BOTTOM-LETTER-3.5-4.0-3.5",
  THREE_UP: "WB-THREE-UP-LETTER-3.5-WITH-0.167-GAPS",
});

export type UiModelListener = (model: AppViewModel, session: UiSessionState) => void;

export interface UiControllerOptions {
  readonly locale?: AppLocale;
  readonly now?: () => string;
}

export class UiWorkflowController {
  readonly #bridge: UiApplicationBridge;
  readonly #stateStore: UiStateStore;
  readonly #now: () => string;
  #session: UiSessionState;
  #printers: readonly PrinterDescriptor[] = [];
  #preview?: ExactPreviewMetadata;
  #liveJob?: ExactPrintJob;
  #payeeQuery = "";
  #selectedPayeeId?: string;
  #listeners = new Set<UiModelListener>();
  #operationTail: Promise<void> = Promise.resolve();

  constructor(bridge: UiApplicationBridge, stateStore: UiStateStore, options: UiControllerOptions = {}) {
    this.#bridge = bridge;
    this.#stateStore = stateStore;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#session = initialUiSession(options.locale);
  }

  get session(): UiSessionState { return cloneUiSession(this.#session); }
  get capabilities() { return this.#bridge.capabilities; }

  subscribe(listener: UiModelListener): () => void {
    this.#listeners.add(listener);
    listener(this.view(), this.session);
    return () => this.#listeners.delete(listener);
  }

  async initialize(): Promise<AppViewModel> {
    return this.#runExclusive(async () => {
      const restored = await this.#stateStore.load();
      if (restored?.version === 1) this.#session = restored;
      const firstLaunch = restored === undefined;
      const state = this.#bridge.snapshot();
      this.#reconcileSelections(state);
      const pending = pendingPrintFromState(state);
      if (pending) {
        this.#session = { ...this.#session, route: "PRINT_OUTCOME", activeDraftId: pending.checkIds[0] };
      } else if (!onboardingComplete(state, this.#session)) {
        const next = firstLaunch ? "ONBOARDING_WELCOME" : nextOnboardingRoute(state, this.#session);
        this.#session = { ...this.#session, route: next === "HOME" ? "HOME" : next };
      } else if (this.#session.route === "STARTUP" || isOnboardingRoute(this.#session.route)) {
        this.#session = { ...this.#session, route: "HOME" };
      }
      await this.#persistAndNotify();
      return this.view();
    });
  }

  view(): AppViewModel {
    const state = this.#bridge.snapshot();
    const commerce = this.#bridge.commerceSnapshot();
    const route = this.#session.route;
    if (isOnboardingRoute(route)) return onboardingModel(route, state, this.#session, this.#printers);
    if (route === "HOME") return homeModel(state, this.#session, commerce);
    if (route === "CHEQUES") return chequesModel(state);
    if (route === "CHEQUE_NEW") return chequeEditorModel(state, this.#session, this.#payeeQuery);
    if (route === "CHEQUE_REVIEW") return chequeReviewModel(state, this.#session, this.#preview);
    if (route === "CHEQUE_OUTPUT") return outputModel(state, this.#session, commerce, this.#printers, Boolean(this.#liveJob));
    if (route === "PRINT_OUTCOME") return printOutcomeModel(state);
    if (route === "REGISTER") return registerModel(this.#bridge, state, this.#session);
    if (route === "PAYEES" || route === "PAYEE_EDIT") return payeesModel(state, this.#session.locale, this.#selectedPayeeId);
    if (isSettingsRoute(route)) return settingsModel(route, state, this.#session, commerce, this.#printers, this.#bridge.capabilities);
    return { kind: "GENERIC", route, message: { key: this.#routeMessageKey(route) } };
  }

  async navigate(route: AppRoute): Promise<UiOperationResult<AppViewModel>> {
    return this.#runExclusive(async () => {
      const decision = evaluateRouteGuard(route, this.#bridge.snapshot(), this.#session);
      if (!decision.allowed) {
        return { ok: false, kind: "BLOCKED", code: decision.guard, message: decision.message, details: { redirect: decision.redirect } };
      }
      this.#session = { ...this.#session, route };
      await this.#persistAndNotify();
      return { ok: true, value: this.view() };
    });
  }

  async acknowledgePreprintedStock(): Promise<UiOperationResult<AppViewModel>> {
    return this.#runAction(async () => {
      this.#session = {
        ...this.#session,
        route: "ONBOARDING_ACCOUNT",
        onboarding: { ...this.#session.onboarding, preprintedStockConfirmed: true },
      };
      return this.view();
    });
  }

  async saveOnboardingAccount(input: CreateAccountInput): Promise<UiOperationResult<Account>> {
    return this.#runAction(async () => {
      const account = await this.#bridge.createAccount(input);
      this.#session = {
        ...this.#session,
        route: "ONBOARDING_LAYOUT",
        locale: account.locale,
        selectedAccountId: account.id,
        onboarding: { ...this.#session.onboarding, accountId: account.id },
      };
      return account;
    });
  }

  async chooseOnboardingLayout(layout: LayoutKind, startSlot: 0 | 1 | 2 = 0): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      // Windows printer enumeration can block inside the native spooler before
      // Electron returns a promise. Never make it part of app startup; defer it
      // until the workflow actually needs a printer.
      try { this.#printers = await this.#bridge.listPrinters(); } catch { this.#printers = []; }
      const normalizedSlot = layout === "THREE_UP" ? startSlot : 0;
      this.#session = {
        ...this.#session,
        route: "ONBOARDING_PRINTER",
        selectedStockKey: UI_STOCK_KEYS[layout],
        startSlot: normalizedSlot,
        onboarding: {
          ...this.#session.onboarding,
          layout,
          stockKey: UI_STOCK_KEYS[layout],
          startSlot: normalizedSlot,
        },
      };
      return undefined;
    });
  }

  async selectOnboardingPrinter(printerKey: string): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      const printer = this.#printers.find((candidate) => candidate.key === printerKey);
      if (!printer) return this.#fail("VALIDATION", "error.printerUnavailable", "PRINTER_NOT_FOUND");
      this.#session = {
        ...this.#session,
        route: "ONBOARDING_CALIBRATION",
        selectedPrinterKey: printer.key,
        onboarding: { ...this.#session.onboarding, printerKey: printer.key },
      };
      return undefined;
    });
  }

  async saveOnboardingCalibration(name: string): Promise<UiOperationResult<CalibrationProfile>> {
    return this.#runAction(async () => {
      const { accountId, layout, printerKey } = this.#session.onboarding;
      if (!accountId || !layout || !printerKey) return this.#fail("BLOCKED", "ui.route.setupRequired", "SETUP_INCOMPLETE");
      const profile = await this.#bridge.createCalibration({ accountId, layout, printerKey, name });
      this.#session = {
        ...this.#session,
        route: "HOME",
        selectedCalibrationProfileId: profile.id,
        selectedPrinterKey: profile.printerKey,
        selectedStockKey: profile.stockKey,
        onboarding: { ...this.#session.onboarding, calibrationProfileId: profile.id, completedAt: this.#now() },
      };
      return profile;
    });
  }

  async beginCheque(payeeQuery = ""): Promise<UiOperationResult<AppViewModel>> {
    return this.#runAction(async () => {
      const state = this.#bridge.snapshot();
      if (pendingPrintFromState(state)) return this.#fail("BLOCKED", "home.pendingOutcome", "PENDING_PRINT_OUTCOME");
      const account = state.accounts.find((candidate) => candidate.id === this.#session.selectedAccountId && !candidate.archived);
      if (!account) return this.#fail("BLOCKED", "ui.route.accountRequired", "ACCOUNT_REQUIRED");
      if (account.numberingState !== "VERIFIED") return this.#fail("BLOCKED", "state.account.warning.body", "NUMBER_CONFIRMATION_REQUIRED");
      this.#payeeQuery = payeeQuery;
      this.#preview = undefined;
      this.#liveJob = undefined;
      this.#session = { ...this.#session, route: "CHEQUE_NEW", activeDraftId: undefined };
      return this.view();
    });
  }

  async createCheque(input: Omit<CreateChequeInput, "accountId">): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      const accountId = this.#session.selectedAccountId;
      if (!accountId) return this.#fail("BLOCKED", "ui.route.accountRequired", "ACCOUNT_REQUIRED");
      const draft = await this.#bridge.createDraft({ ...input, accountId });
      this.#session = { ...this.#session, route: "CHEQUE_NEW", activeDraftId: draft.id };
      return draft;
    });
  }

  async updateCheque(patch: Parameters<UiApplicationBridge["updateDraft"]>[1]): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      if (!this.#session.activeDraftId) return this.#fail("BLOCKED", "ui.route.draftRequired", "DRAFT_REQUIRED");
      const check = await this.#bridge.updateDraft(this.#session.activeDraftId, patch);
      this.#preview = undefined;
      return check;
    });
  }

  async reviewCheque(): Promise<UiOperationResult<ExactPreviewMetadata>> {
    return this.#runAction(async () => {
      const checkId = this.#session.activeDraftId;
      const profileId = this.#session.selectedCalibrationProfileId;
      if (!checkId) return this.#fail("BLOCKED", "ui.route.draftRequired", "DRAFT_REQUIRED");
      if (!profileId) return this.#fail("BLOCKED", "state.calibration.empty.body", "CALIBRATION_REQUIRED");
      const ready = await this.#bridge.markReady(checkId, profileId);
      const profile = this.#bridge.snapshot().calibrations.find((candidate) => candidate.id === profileId)!;
      this.#preview = await this.#bridge.previewLive({
        checkIds: [ready.id],
        calibrationProfileId: profile.id,
        printerKey: this.#session.selectedPrinterKey ?? profile.printerKey,
        stockKey: this.#session.selectedStockKey ?? profile.stockKey,
        startSlot: this.#session.startSlot,
      });
      this.#session = { ...this.#session, route: "CHEQUE_REVIEW" };
      return this.#preview;
    });
  }

  async editReviewedCheque(): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      if (!this.#session.activeDraftId) return this.#fail("BLOCKED", "ui.route.draftRequired", "DRAFT_REQUIRED");
      const draft = await this.#bridge.returnToDraft(this.#session.activeDraftId);
      this.#preview = undefined;
      this.#session = { ...this.#session, route: "CHEQUE_NEW" };
      return draft;
    });
  }

  async openOutput(): Promise<UiOperationResult<AppViewModel>> {
    return this.#runAction(async () => {
      if (!this.#preview) return this.#fail("BLOCKED", "ui.route.previewRequired", "PREVIEW_REQUIRED");
      this.#session = { ...this.#session, route: "CHEQUE_OUTPUT" };
      return this.view();
    });
  }

  async queueLiveOutput(): Promise<UiOperationResult<ExactPrintJob>> {
    return this.#runAction(async () => {
      const preview = this.#preview;
      if (!preview) return this.#fail("BLOCKED", "ui.route.previewRequired", "PREVIEW_REQUIRED");
      const queued = await this.#bridge.queueLive({
        checkIds: preview.checkIds,
        calibrationProfileId: preview.plan.calibrationProfileId,
        printerKey: preview.job.printerKey,
        stockKey: preview.plan.stockKey,
        startSlot: preview.plan.startSlot as 0 | 1 | 2,
        sheetIds: preview.plan.sheetIds,
      });
      if (!queued.allowed) return this.#fail("BLOCKED", queued.messageKey, queued.reason);
      this.#liveJob = queued.job;
      this.#session = { ...this.#session, route: "CHEQUE_OUTPUT" };
      return queued.job;
    });
  }

  async saveQueuedPdf(destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> {
    return this.#runAction(async () => {
      if (!this.#liveJob) return this.#fail("BLOCKED", "ui.route.queuedJobRequired", "QUEUED_JOB_REQUIRED");
      const result = await this.#bridge.saveLivePdf(this.#liveJob, destinationPath);
      if (!result.ok) return result;
      this.#session = { ...this.#session, route: "PRINT_OUTCOME" };
      return result.value;
    });
  }

  async printQueued(): Promise<UiOperationResult<NativePrintOutcome>> {
    return this.#runAction(async () => {
      if (!this.#liveJob) return this.#fail("BLOCKED", "ui.route.queuedJobRequired", "QUEUED_JOB_REQUIRED");
      const result = await this.#bridge.printLive(this.#liveJob);
      if (!result.ok) return result;
      this.#liveJob = undefined;
      this.#preview = undefined;
      this.#finishOutcome(result.value);
      return result.value;
    });
  }

  async recordPendingOutcome(outcome: NativePrintOutcome): Promise<UiOperationResult<readonly CheckRecord[]>> {
    return this.#runAction(async () => {
      const pending = pendingPrintFromState(this.#bridge.snapshot());
      if (!pending) return this.#fail("BLOCKED", "ui.route.pendingPrintRequired", "PENDING_PRINT_REQUIRED");
      const checks = await this.#bridge.resolvePrintOutcome(pending.documentId, pending.planHash, outcome);
      this.#liveJob = undefined;
      this.#preview = undefined;
      this.#finishOutcome(outcome, checks.at(-1)?.id);
      return checks;
    });
  }

  async replaceSpoiled(checkId: string): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      const replacement = await this.#bridge.replaceMisprinted(checkId);
      this.#session = { ...this.#session, route: "CHEQUE_NEW", activeDraftId: replacement.id };
      return replacement;
    });
  }

  async confirmSpoiledAsPrinted(checkId: string): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      const check = await this.#bridge.confirmMisprintedAsPrinted(checkId);
      this.#session = { ...this.#session, route: "CHEQUE_SUCCESS", lastCompletedCheckId: check.id };
      return check;
    });
  }

  async duplicateCheque(checkId: string, issueDate: string): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(async () => {
      const check = await this.#bridge.duplicateCheck(checkId, issueDate);
      this.#session = { ...this.#session, route: "CHEQUE_NEW", activeDraftId: check.id };
      return check;
    });
  }

  async deleteDraft(checkId: string): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      await this.#bridge.deleteDraft(checkId);
      this.#session = { ...this.#session, route: "CHEQUES", activeDraftId: undefined };
      return undefined;
    });
  }

  async setRegisterQuery(query: RegisterQuery): Promise<UiOperationResult<AppViewModel>> {
    return this.#runAction(async () => {
      this.#bridge.queryRegister(query);
      this.#session = { ...this.#session, route: "REGISTER", registerQuery: structuredClone(query) };
      return this.view();
    });
  }

  async clearRegisterFilters(): Promise<UiOperationResult<AppViewModel>> {
    return this.setRegisterQuery({});
  }

  exportRegisterCsv(): string {
    return this.#bridge.exportRegister(this.#session.registerQuery, this.#session.locale);
  }

  async saveRegisterCsv(destinationPath: string): Promise<UiOperationResult> {
    return this.#runAction(() => this.#bridge.saveRegisterExport(this.#session.registerQuery, this.#session.locale, destinationPath));
  }

  async markCleared(checkId: string, cleared: boolean, clearedDate?: string): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(() => this.#bridge.setCleared(checkId, cleared, clearedDate));
  }

  async createPayee(input: { name: string; address?: Address; defaultMemo?: string }): Promise<UiOperationResult<Payee>> {
    return this.#runAction(() => this.#bridge.createPayee(input));
  }

  async updatePayee(id: string, patch: Partial<Pick<Payee, "name" | "address" | "defaultMemo">>): Promise<UiOperationResult<Payee>> {
    return this.#runAction(() => this.#bridge.updatePayee(id, patch));
  }

  async archivePayee(id: string, archived = true): Promise<UiOperationResult<Payee>> {
    return this.#runAction(() => this.#bridge.archivePayee(id, archived));
  }

  async importPayees(csv: string): Promise<UiOperationResult<{ created: Payee[]; skipped: number }>> {
    return this.#runAction(() => this.#bridge.importPayees(csv, this.#session.selectedAccountId));
  }

  async createAccount(input: CreateAccountInput): Promise<UiOperationResult<Account>> {
    return this.#runAction(async () => {
      const account = await this.#bridge.createAccount(input);
      this.#session = { ...this.#session, selectedAccountId: account.id };
      return account;
    });
  }

  async updateAccount(id: string, patch: Parameters<UiApplicationBridge["updateAccount"]>[1]): Promise<UiOperationResult<Account>> {
    return this.#runAction(() => this.#bridge.updateAccount(id, patch));
  }

  async confirmNextCheckNumber(id: string, number: number): Promise<UiOperationResult<Account>> {
    return this.#runAction(() => this.#bridge.confirmNextCheckNumber(id, number));
  }

  async archiveAccount(id: string, archived = true): Promise<UiOperationResult<Account>> {
    return this.#runAction(() => this.#bridge.archiveAccount(id, archived));
  }

  async setNextCheckNumber(id: string, number: number): Promise<UiOperationResult<Account>> {
    return this.#runAction(() => this.#bridge.setNextCheckNumber(id, number));
  }

  async createCalibration(input: Parameters<UiApplicationBridge["createCalibration"]>[0]): Promise<UiOperationResult<CalibrationProfile>> {
    return this.#runAction(async () => {
      const profile = await this.#bridge.createCalibration(input);
      this.#session = {
        ...this.#session,
        selectedAccountId: profile.accountId,
        selectedCalibrationProfileId: profile.id,
        selectedPrinterKey: profile.printerKey,
        selectedStockKey: profile.stockKey,
        startSlot: 0,
      };
      return profile;
    });
  }

  async updateCalibration(id: string, patch: Parameters<UiApplicationBridge["updateCalibration"]>[1]): Promise<UiOperationResult<CalibrationProfile>> {
    return this.#runAction(async () => {
      const profile = await this.#bridge.updateCalibration(id, patch);
      if (this.#session.selectedCalibrationProfileId === profile.id) {
        this.#session = {
          ...this.#session,
          selectedPrinterKey: profile.printerKey,
          selectedStockKey: profile.stockKey,
          startSlot: profile.layout === "THREE_UP" ? this.#session.startSlot : 0,
        };
      }
      return profile;
    });
  }

  async selectOutputSettings(input: {
    profileId: string;
    printerKey: string;
    startSlot?: 0 | 1 | 2;
  }): Promise<UiOperationResult<ExactPreviewMetadata | undefined>> {
    return this.#runAction(async () => {
      const profile = this.#bridge.snapshot().calibrations.find((candidate) => candidate.id === input.profileId);
      if (!profile) return this.#fail("VALIDATION", "state.calibration.empty.body", "PROFILE_NOT_FOUND");
      if (profile.printerKey !== input.printerKey) return this.#fail("VALIDATION", "state.printer.warning.body", "PROFILE_PRINTER_MISMATCH");
      const startSlot = profile.layout === "THREE_UP" ? (input.startSlot ?? 0) : 0;
      this.#session = {
        ...this.#session,
        selectedAccountId: profile.accountId,
        selectedCalibrationProfileId: profile.id,
        selectedPrinterKey: profile.printerKey,
        selectedStockKey: profile.stockKey,
        startSlot,
      };
      let check = this.#bridge.snapshot().checks.find((candidate) => candidate.id === this.#session.activeDraftId);
      if (check?.status === "READY") {
        if (check.readyCalibrationProfileId !== profile.id) {
          await this.#bridge.returnToDraft(check.id);
          check = await this.#bridge.markReady(check.id, profile.id);
        }
        this.#preview = await this.#bridge.previewLive({
          checkIds: [check.id],
          calibrationProfileId: profile.id,
          printerKey: profile.printerKey,
          stockKey: profile.stockKey,
          startSlot,
        });
      }
      return this.#preview;
    });
  }

  async refreshPrinters(): Promise<UiOperationResult<readonly PrinterDescriptor[]>> {
    return this.#runAction(async () => {
      this.#printers = await this.#bridge.listPrinters();
      return this.#printers;
    });
  }

  async voidCheque(checkId: string, reason: string): Promise<UiOperationResult<CheckRecord>> {
    return this.#runAction(() => this.#bridge.voidCheck(checkId, reason));
  }

  async selectAccount(accountId: string): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      const state = this.#bridge.snapshot();
      const account = state.accounts.find((candidate) => candidate.id === accountId && !candidate.archived);
      if (!account) return this.#fail("VALIDATION", "ui.route.accountRequired", "ACCOUNT_NOT_FOUND");
      const profile = state.calibrations.find((candidate) => candidate.accountId === account.id);
      this.#session = {
        ...this.#session,
        selectedAccountId: account.id,
        selectedCalibrationProfileId: profile?.id,
        selectedPrinterKey: profile?.printerKey,
        selectedStockKey: profile?.stockKey,
      };
      return undefined;
    });
  }

  async selectCalibrationProfile(profileId: string): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      const profile = this.#bridge.snapshot().calibrations.find((candidate) => candidate.id === profileId);
      if (!profile) return this.#fail("VALIDATION", "state.calibration.empty.body", "PROFILE_NOT_FOUND");
      this.#session = {
        ...this.#session,
        selectedAccountId: profile.accountId,
        selectedCalibrationProfileId: profile.id,
        selectedPrinterKey: profile.printerKey,
        selectedStockKey: profile.stockKey,
        startSlot: profile.layout === "THREE_UP" ? this.#session.startSlot : 0,
      };
      return undefined;
    });
  }

  async createBackup(intent: BackupIntent): Promise<UiOperationResult> {
    return this.#runAction(() => this.#bridge.createBackup(intent));
  }

  async restoreBackup(intent: RestoreIntent): Promise<UiOperationResult> {
    return this.#runAction(() => this.#bridge.restoreBackup(intent));
  }

  async purchaseLifetime(): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      const result = await this.#bridge.purchaseLifetime(this.#session.locale);
      if (result.status === "FAILED") return this.#fail("FAILURE", "purchase.failed", result.errorCode, result.retryable);
      if (result.status === "CANCELLED") return this.#fail("BLOCKED", "purchase.cancelled", "USER_CANCELLED");
      return undefined;
    });
  }

  async restoreLifetime(): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      const result = await this.#bridge.restoreLifetime();
      if (result.status === "FAILED") return this.#fail("FAILURE", "purchase.failed", result.errorCode, result.retryable);
      if (result.status === "NOT_OWNED") return this.#fail("BLOCKED", "purchase.restore.notFound", "NOT_OWNED");
      return undefined;
    });
  }

  async refreshCommerce(): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      await this.#bridge.refreshCommerce();
      return undefined;
    });
  }

  async setLocale(locale: AppLocale): Promise<UiOperationResult> {
    return this.#runAction(async () => {
      this.#session = { ...this.#session, locale };
      return undefined;
    });
  }

  async sampleJob(): Promise<UiOperationResult<ExactPrintJob>> {
    return this.#runAction(async () => {
      const profile = this.#selectedProfile();
      if (!profile) return this.#fail("BLOCKED", "state.calibration.empty.body", "CALIBRATION_REQUIRED");
      return this.#bridge.sampleJob(profile.id, this.#session.selectedPrinterKey ?? profile.printerKey, this.#session.locale);
    });
  }

  async calibrationJob(): Promise<UiOperationResult<ExactPrintJob>> {
    return this.#runAction(async () => {
      const profile = this.#selectedProfile();
      if (!profile) return this.#fail("BLOCKED", "state.calibration.empty.body", "CALIBRATION_REQUIRED");
      return this.#bridge.calibrationJob(profile.id, this.#session.selectedPrinterKey ?? profile.printerKey, this.#session.locale);
    });
  }

  async saveNonNegotiablePdf(job: ExactPrintJob, destinationPath: string): Promise<UiOperationResult<{ pdfSha256: string }>> {
    return this.#runAction(() => this.#bridge.saveNonNegotiablePdf(job, destinationPath));
  }

  async printNonNegotiable(job: ExactPrintJob): Promise<UiOperationResult<NativePrintOutcome>> {
    return this.#runAction(() => this.#bridge.printNonNegotiable(job));
  }

  setPayeeQuery(query: string): void {
    this.#payeeQuery = query;
    this.#notify();
  }

  setSelectedPayee(payeeId?: string): void {
    this.#selectedPayeeId = payeeId;
    this.#session = { ...this.#session, route: payeeId ? "PAYEE_EDIT" : "PAYEES" };
    this.#notify();
  }

  #selectedProfile(): CalibrationProfile | undefined {
    return this.#bridge.snapshot().calibrations.find((candidate) => candidate.id === this.#session.selectedCalibrationProfileId);
  }

  #finishOutcome(outcome: NativePrintOutcome, checkId = this.#session.activeDraftId): void {
    if (outcome.kind === "NOT_PRINTED") {
      this.#session = { ...this.#session, route: "CHEQUES", activeDraftId: checkId };
    } else {
      this.#session = { ...this.#session, route: "CHEQUE_SUCCESS", activeDraftId: undefined, lastCompletedCheckId: checkId };
    }
  }

  #reconcileSelections(state: ReturnType<UiApplicationBridge["snapshot"]>): void {
    const account = state.accounts.find((candidate) => candidate.id === this.#session.selectedAccountId && !candidate.archived)
      ?? state.accounts.find((candidate) => !candidate.archived);
    const profile = state.calibrations.find(
      (candidate) => candidate.id === this.#session.selectedCalibrationProfileId && candidate.accountId === account?.id,
    ) ?? state.calibrations.find((candidate) => candidate.accountId === account?.id);
    const activeDraft = state.checks.find((candidate) => candidate.id === this.#session.activeDraftId && !["DELETED", "VOIDED"].includes(candidate.status));
    const onboardingAccount = state.accounts.find((candidate) => candidate.id === this.#session.onboarding.accountId && !candidate.archived) ?? account;
    const onboardingProfile = state.calibrations.find((candidate) => candidate.id === this.#session.onboarding.calibrationProfileId && candidate.accountId === onboardingAccount?.id) ?? profile;
    this.#session = {
      ...this.#session,
      selectedAccountId: account?.id,
      selectedCalibrationProfileId: profile?.id,
      selectedPrinterKey: profile?.printerKey ?? this.#session.selectedPrinterKey,
      selectedStockKey: profile?.stockKey ?? this.#session.selectedStockKey,
      activeDraftId: activeDraft?.id,
      onboarding: {
        ...this.#session.onboarding,
        accountId: onboardingAccount?.id,
        layout: onboardingProfile?.layout ?? this.#session.onboarding.layout,
        printerKey: onboardingProfile?.printerKey ?? this.#session.onboarding.printerKey,
        stockKey: onboardingProfile?.stockKey ?? this.#session.onboarding.stockKey,
        calibrationProfileId: onboardingProfile?.id,
      },
    };
  }

  async #runAction<T>(action: () => Promise<T | UiOperationResult<T>>): Promise<UiOperationResult<T>> {
    return this.#runExclusive(async () => {
      try {
        const value = await action();
        if (this.#isOperationResult<T>(value)) return value;
        await this.#persistAndNotify();
        return { ok: true, value };
      } catch (error) {
        return this.#errorResult(error);
      }
    });
  }

  async #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release!: () => void;
    this.#operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async #persistAndNotify(): Promise<void> {
    await this.#stateStore.save(this.#session);
    this.#notify();
  }

  #notify(): void {
    const model = this.view();
    const session = this.session;
    for (const listener of this.#listeners) listener(model, session);
  }

  #isOperationResult<T>(value: unknown): value is UiOperationResult<T> {
    return Boolean(value && typeof value === "object" && "ok" in value);
  }

  #fail(
    kind: Extract<UiOperationResult, { ok: false }>["kind"],
    key: string,
    code?: string,
    retryable?: boolean,
  ): Extract<UiOperationResult, { ok: false }> {
    return { ok: false, kind, code, retryable, message: { key } };
  }

  #errorResult(error: unknown): Extract<UiOperationResult, { ok: false }> {
    if (this.#isDomainError(error)) {
      return {
        ok: false,
        kind: "VALIDATION",
        code: error.code,
        message: { key: error.messageKey, parameters: this.#messageParameters(error.details) },
        details: error.details,
      };
    }
    return {
      ok: false,
      kind: "FAILURE",
      code: error instanceof Error ? error.name : "UNKNOWN",
      message: { key: "error.generic" },
    };
  }

  #isDomainError(error: unknown): error is {
    code: string;
    messageKey: string;
    details: Readonly<Record<string, unknown>>;
  } {
    if (!error || typeof error !== "object") return false;
    const candidate = error as Partial<{ code: unknown; messageKey: unknown; details: unknown }>;
    return typeof candidate.code === "string" && typeof candidate.messageKey === "string" && Boolean(candidate.details && typeof candidate.details === "object");
  }

  #messageParameters(details: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number>> {
    return Object.fromEntries(
      Object.entries(details)
        .filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number"),
    );
  }

  #routeMessageKey(route: AppRoute): string {
    if (route === "STARTUP") return "state.startup.loading.body";
    if (route === "CHEQUE_SUCCESS") return "state.print.success.body";
    if (route === "HELP") return "nav.help";
    return "state.common.idle.body";
  }
}

export function printedCorrectly(): NativePrintOutcome {
  return { kind: "PRINTED_CORRECTLY" };
}

export function paperMarkedWithProblem(reasonCode: string): NativePrintOutcome {
  return { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode };
}

export function nothingPrinted(
  reasonCode: string,
  deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" | "HOST_CONFIRMED_NO_OUTPUT",
): NativePrintOutcome {
  return { kind: "NOT_PRINTED", reasonCode, deliveryEvidence };
}
