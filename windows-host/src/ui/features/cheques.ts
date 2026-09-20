import type { EngineState, Payee } from "../../../../src/types.ts";
import type {
  ChequeEditorViewModel,
  ChequeReviewViewModel,
  ChequesViewModel,
  ExactPreviewMetadata,
  UiMessage,
  UiSessionState,
} from "../app-model.ts";

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").trim();
}

export function searchPayees(state: EngineState, query = "", locale: UiSessionState["locale"] = "en-US"): readonly Payee[] {
  const needle = normalized(query);
  return state.payees
    .filter((payee) => !payee.archived)
    .filter((payee) => !needle || normalized(payee.name).includes(needle))
    .sort((left, right) => left.name.localeCompare(right.name, locale));
}

export function chequesModel(state: EngineState): ChequesViewModel {
  const active = state.checks.filter((check) => check.status !== "DELETED");
  return {
    kind: "CHEQUES",
    route: "CHEQUES",
    drafts: active.filter((check) => check.status === "DRAFT"),
    ready: active.filter((check) => check.status === "READY"),
    unresolved: active.filter((check) => check.status === "PRINT_QUEUED" || check.status === "MISPRINTED"),
    recent: active.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 20),
  };
}

export function chequeEditorModel(
  state: EngineState,
  session: UiSessionState,
  payeeQuery = "",
): ChequeEditorViewModel {
  const account = state.accounts.find((candidate) => candidate.id === session.selectedAccountId && !candidate.archived);
  const draft = state.checks.find((candidate) => candidate.id === session.activeDraftId && candidate.status === "DRAFT");
  return {
    kind: "CHEQUE_EDITOR",
    route: "CHEQUE_NEW",
    account,
    draft,
    payees: searchPayees(state, "", session.locale),
    suggestedPayees: searchPayees(state, payeeQuery, session.locale).slice(0, 10),
    checkNumber: draft?.checkNumber ?? account?.nextCheckNumber,
    canContinue: Boolean(account && draft),
  };
}

export function chequeReviewModel(
  state: EngineState,
  session: UiSessionState,
  preview?: ExactPreviewMetadata,
): ChequeReviewViewModel {
  const check = state.checks.find((candidate) => candidate.id === session.activeDraftId);
  const account = state.accounts.find((candidate) => candidate.id === check?.accountId);
  const payee = state.payees.find((candidate) => candidate.id === check?.payeeId);
  const profile = state.calibrations.find((candidate) => candidate.id === check?.readyCalibrationProfileId);
  const warnings: UiMessage[] = (check?.warningKeys ?? []).map((key) => ({ key }));
  return {
    kind: "CHEQUE_REVIEW",
    route: "CHEQUE_REVIEW",
    check,
    account,
    payee,
    profile,
    preview,
    warnings,
    canQueue: Boolean(check?.status === "READY" && profile && preview),
  };
}
