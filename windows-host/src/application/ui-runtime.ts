import type { NativePrintOutcome } from "../../../src/host-contract.ts";
import type { RegisterQuery } from "../../../src/register.ts";
import type { Address, AppLocale, LayoutKind } from "../../../src/types.ts";
import type { AppRoute } from "../product/navigation.ts";
import type {
  CreateAccountInput,
  UiOperationResult,
} from "../ui/app-model.ts";
import {
  nothingPrinted,
  paperMarkedWithProblem,
  printedCorrectly,
  UiWorkflowController,
} from "../ui/controller.ts";
import type { UiActionRequest, UiActionResponse, UiEnvelope } from "../ui/ipc-contract.ts";

export interface UiRuntimeFilePicker {
  savePdf(suggestedName: string): Promise<string | undefined>;
  saveCsv(suggestedName: string): Promise<string | undefined>;
  saveBackup(suggestedName: string): Promise<string | undefined>;
  openBackup(): Promise<string | undefined>;
}

function cancelled<T = undefined>(): UiOperationResult<T> {
  return {
    ok: false,
    kind: "BLOCKED",
    code: "USER_CANCELLED",
    message: { key: "state.common.idle.body" },
  };
}

function payload(request: UiActionRequest): Record<string, unknown> {
  return request.payload ? { ...request.payload } : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export class DesktopUiRuntime {
  readonly #controller: UiWorkflowController;
  readonly #files: UiRuntimeFilePicker;

  constructor(controller: UiWorkflowController, files: UiRuntimeFilePicker) {
    this.#controller = controller;
    this.#files = files;
  }

  async initialize(): Promise<UiEnvelope> {
    await this.#controller.initialize();
    return this.#envelope();
  }

  async perform(request: UiActionRequest): Promise<UiActionResponse> {
    const input = payload(request);
    let result: UiOperationResult<unknown>;
    switch (request.name) {
      case "NAVIGATE":
        result = await this.#controller.navigate(text(input.route) as AppRoute);
        break;
      case "ACKNOWLEDGE_STOCK":
        result = await this.#controller.acknowledgePreprintedStock();
        break;
      case "SAVE_ONBOARDING_ACCOUNT":
        result = await this.#controller.saveOnboardingAccount(input as unknown as CreateAccountInput);
        break;
      case "CHOOSE_LAYOUT":
        result = await this.#controller.chooseOnboardingLayout(
          text(input.layout) as LayoutKind,
          integer(input.startSlot, 0) as 0 | 1 | 2,
        );
        break;
      case "CHOOSE_PRINTER":
        result = await this.#controller.selectOnboardingPrinter(text(input.printerKey));
        break;
      case "SAVE_ONBOARDING_CALIBRATION":
        result = await this.#controller.saveOnboardingCalibration(text(input.name));
        break;
      case "BEGIN_CHEQUE":
        result = await this.#controller.beginCheque(text(input.payeeQuery));
        break;
      case "CREATE_CHEQUE":
        result = await this.#controller.createCheque({
          payeeId: text(input.payeeId),
          issueDate: text(input.issueDate),
          amountCents: integer(input.amountCents),
          memo: optionalText(input.memo),
          category: optionalText(input.category),
        });
        break;
      case "UPDATE_CHEQUE": {
        const patch = { ...input };
        delete patch.id;
        result = await this.#controller.updateCheque(patch);
        break;
      }
      case "REVIEW_CHEQUE":
        result = await this.#controller.reviewCheque();
        break;
      case "EDIT_REVIEWED_CHEQUE":
        result = await this.#controller.editReviewedCheque();
        break;
      case "OPEN_OUTPUT":
        result = await this.#controller.openOutput();
        break;
      case "QUEUE_LIVE_OUTPUT":
        result = await this.#controller.queueLiveOutput();
        break;
      case "SAVE_QUEUED_PDF": {
        const path = await this.#files.savePdf(`WorksBien-check-${Date.now()}.pdf`);
        result = path ? await this.#controller.saveQueuedPdf(path) : cancelled();
        break;
      }
      case "PRINT_QUEUED":
        result = await this.#controller.printQueued();
        break;
      case "RECORD_OUTCOME":
        result = await this.#controller.recordPendingOutcome(this.#outcome(input));
        break;
      case "REPLACE_SPOILED":
        result = await this.#controller.replaceSpoiled(text(input.checkId));
        break;
      case "CONFIRM_SPOILED_PRINTED":
        result = await this.#controller.confirmSpoiledAsPrinted(text(input.checkId));
        break;
      case "DUPLICATE_CHEQUE":
        result = await this.#controller.duplicateCheque(text(input.checkId), text(input.issueDate));
        break;
      case "DELETE_DRAFT":
        result = await this.#controller.deleteDraft(text(input.checkId));
        break;
      case "VOID_CHEQUE":
        result = await this.#controller.voidCheque(text(input.checkId), text(input.reason));
        break;
      case "SET_REGISTER_QUERY":
        result = await this.#controller.setRegisterQuery(input.query as RegisterQuery);
        break;
      case "CLEAR_REGISTER_FILTERS":
        result = await this.#controller.clearRegisterFilters();
        break;
      case "SAVE_REGISTER_CSV": {
        const path = await this.#files.saveCsv("WorksBien-check-register.csv");
        result = path ? await this.#controller.saveRegisterCsv(path) : cancelled();
        break;
      }
      case "MARK_CLEARED":
        result = await this.#controller.markCleared(
          text(input.checkId),
          boolean(input.cleared),
          optionalText(input.clearedDate),
        );
        break;
      case "CREATE_PAYEE":
        result = await this.#controller.createPayee({
          name: text(input.name),
          defaultMemo: optionalText(input.defaultMemo),
          address: input.address as Address | undefined,
        });
        break;
      case "UPDATE_PAYEE":
        result = await this.#controller.updatePayee(text(input.id), {
          name: optionalText(input.name),
          defaultMemo: optionalText(input.defaultMemo),
          address: input.address as Address | undefined,
        });
        break;
      case "ARCHIVE_PAYEE":
        result = await this.#controller.archivePayee(text(input.id), boolean(input.archived, true));
        break;
      case "IMPORT_PAYEES":
        result = await this.#controller.importPayees(text(input.csv));
        break;
      case "CREATE_ACCOUNT":
        result = await this.#controller.createAccount(input as unknown as CreateAccountInput);
        break;
      case "UPDATE_ACCOUNT": {
        const id = text(input.id);
        const patch = { ...input };
        delete patch.id;
        result = await this.#controller.updateAccount(id, patch);
        break;
      }
      case "CONFIRM_CHECK_NUMBER":
        result = await this.#controller.confirmNextCheckNumber(text(input.id), integer(input.number));
        break;
      case "SET_CHECK_NUMBER":
        result = await this.#controller.setNextCheckNumber(text(input.id), integer(input.number));
        break;
      case "ARCHIVE_ACCOUNT":
        result = await this.#controller.archiveAccount(text(input.id), boolean(input.archived, true));
        break;
      case "SELECT_ACCOUNT":
        result = await this.#controller.selectAccount(text(input.accountId));
        break;
      case "CREATE_CALIBRATION":
        result = await this.#controller.createCalibration({
          accountId: text(input.accountId),
          name: text(input.name),
          printerKey: text(input.printerKey),
          layout: text(input.layout) as LayoutKind,
        });
        break;
      case "UPDATE_CALIBRATION": {
        const id = text(input.id);
        const patch = { ...input };
        delete patch.id;
        result = await this.#controller.updateCalibration(id, patch);
        break;
      }
      case "SELECT_CALIBRATION":
        result = await this.#controller.selectCalibrationProfile(text(input.profileId));
        break;
      case "SELECT_OUTPUT_SETTINGS":
        result = await this.#controller.selectOutputSettings({
          profileId: text(input.profileId),
          printerKey: text(input.printerKey),
          startSlot: integer(input.startSlot, 0) as 0 | 1 | 2,
        });
        break;
      case "REFRESH_PRINTERS":
        result = await this.#controller.refreshPrinters();
        break;
      case "CREATE_BACKUP": {
        const path = await this.#files.saveBackup("WorksBien-checks-backup.wbc");
        result = path
          ? await this.#controller.createBackup({ destinationPath: path, recoveryPassphrase: text(input.passphrase) })
          : cancelled();
        break;
      }
      case "RESTORE_BACKUP": {
        const path = await this.#files.openBackup();
        result = path
          ? await this.#controller.restoreBackup({ sourcePath: path, backupPassphrase: text(input.passphrase) })
          : cancelled();
        if (result.ok) await this.#controller.initialize();
        break;
      }
      case "PURCHASE_LIFETIME":
        result = await this.#controller.purchaseLifetime();
        break;
      case "RESTORE_LIFETIME":
        result = await this.#controller.restoreLifetime();
        break;
      case "REFRESH_COMMERCE":
        result = await this.#controller.refreshCommerce();
        break;
      case "SET_LOCALE":
        result = await this.#controller.setLocale(text(input.locale) as AppLocale);
        break;
      case "SAVE_SAMPLE_PDF":
        result = await this.#saveNonNegotiable("sample");
        break;
      case "PRINT_SAMPLE":
        result = await this.#printNonNegotiable("sample");
        break;
      case "SAVE_CALIBRATION_PDF":
        result = await this.#saveNonNegotiable("calibration");
        break;
      case "PRINT_CALIBRATION":
        result = await this.#printNonNegotiable("calibration");
        break;
      case "SET_PAYEE_QUERY":
        this.#controller.setPayeeQuery(text(input.query));
        result = { ok: true, value: undefined };
        break;
      case "SELECT_PAYEE":
        this.#controller.setSelectedPayee(optionalText(input.payeeId));
        result = { ok: true, value: undefined };
        break;
      default:
        result = {
          ok: false,
          kind: "NOT_AVAILABLE",
          code: "UNKNOWN_UI_ACTION",
          message: { key: "ui.route.unknown" },
        };
    }
    return { result, envelope: this.#envelope() };
  }

  #envelope(): UiEnvelope {
    return { model: this.#controller.view(), session: this.#controller.session };
  }

  #outcome(input: Record<string, unknown>): NativePrintOutcome {
    const kind = text(input.kind);
    if (kind === "PRINTED_CORRECTLY") return printedCorrectly();
    if (kind === "PAPER_MARKED_WITH_PROBLEM") {
      return paperMarkedWithProblem(optionalText(input.reasonCode) ?? "OPERATOR_REPORTED_PROBLEM");
    }
    return nothingPrinted(
      optionalText(input.reasonCode) ?? "OPERATOR_CONFIRMED_NO_OUTPUT",
      input.deliveryEvidence === "HOST_CANCELLED_BEFORE_SUBMIT"
        ? "HOST_CANCELLED_BEFORE_SUBMIT"
        : "HOST_CONFIRMED_NO_OUTPUT",
    );
  }

  async #saveNonNegotiable(kind: "sample" | "calibration"): Promise<UiOperationResult<unknown>> {
    const jobResult = kind === "sample"
      ? await this.#controller.sampleJob()
      : await this.#controller.calibrationJob();
    if (!jobResult.ok) return jobResult;
    const path = await this.#files.savePdf(
      kind === "sample" ? "WorksBien-non-negotiable-sample.pdf" : "WorksBien-calibration-ruler.pdf",
    );
    return path ? this.#controller.saveNonNegotiablePdf(jobResult.value, path) : cancelled();
  }

  async #printNonNegotiable(kind: "sample" | "calibration"): Promise<UiOperationResult<unknown>> {
    const jobResult = kind === "sample"
      ? await this.#controller.sampleJob()
      : await this.#controller.calibrationJob();
    if (!jobResult.ok) return jobResult;
    return this.#controller.printNonNegotiable(jobResult.value);
  }
}
