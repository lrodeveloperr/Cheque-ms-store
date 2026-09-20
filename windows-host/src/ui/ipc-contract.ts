import type { NativePrintOutcome } from "../../../src/host-contract.ts";
import type { AppLocale, LayoutKind } from "../../../src/types.ts";
import type { RegisterQuery } from "../../../src/register.ts";
import type { AppViewModel, CreateAccountInput, UiOperationResult, UiSessionState } from "./app-model.ts";
import type { UiCatalogBundle } from "./i18n.ts";

export interface UiEnvelope {
  readonly model: AppViewModel;
  readonly session: UiSessionState;
}

export interface UiActionRequest {
  readonly name: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface UiActionResponse {
  readonly result: UiOperationResult<unknown>;
  readonly envelope: UiEnvelope;
}

export interface WorksBienDesktopBridge {
  readonly platform: "win32";
  getVersion(): Promise<string>;
  signalReady(): Promise<void>;
  getUiCatalogs(): Promise<UiCatalogBundle>;
  initializeUi(): Promise<UiEnvelope>;
  performUiAction(request: UiActionRequest): Promise<UiActionResponse>;
}

// Compile-time documentation for payloads accepted by the main-process dispatcher.
export interface UiActionPayloads {
  NAVIGATE: { route: string };
  ACKNOWLEDGE_STOCK: Record<string, never>;
  SAVE_ONBOARDING_ACCOUNT: CreateAccountInput;
  CHOOSE_LAYOUT: { layout: LayoutKind; startSlot?: 0 | 1 | 2 };
  CHOOSE_PRINTER: { printerKey: string };
  SAVE_ONBOARDING_CALIBRATION: { name: string };
  BEGIN_CHEQUE: { payeeQuery?: string };
  CREATE_CHEQUE: { payeeId: string; issueDate: string; amountCents: number; memo?: string; category?: string };
  UPDATE_CHEQUE: Readonly<Record<string, unknown>>;
  REVIEW_CHEQUE: Record<string, never>;
  EDIT_REVIEWED_CHEQUE: Record<string, never>;
  OPEN_OUTPUT: Record<string, never>;
  QUEUE_LIVE_OUTPUT: Record<string, never>;
  SAVE_QUEUED_PDF: Record<string, never>;
  PRINT_QUEUED: Record<string, never>;
  RECORD_OUTCOME: { outcome: NativePrintOutcome };
  SET_REGISTER_QUERY: { query: RegisterQuery };
  SET_LOCALE: { locale: AppLocale };
}
