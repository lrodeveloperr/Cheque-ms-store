import type { CommerceSnapshot } from "../../product/entitlement.ts";
import type { EngineState } from "../../../../src/types.ts";
import type { HomeViewModel, UiSessionState } from "../app-model.ts";
import { pendingPrintFromState } from "../app-model.ts";
import { setupChecklist } from "./onboarding.ts";

export function homeModel(
  state: EngineState,
  session: UiSessionState,
  commerce: CommerceSnapshot,
): HomeViewModel {
  const selectedAccount = state.accounts.find(
    (account) => account.id === session.selectedAccountId && !account.archived,
  ) ?? state.accounts.find((account) => !account.archived);
  const selectedProfile = state.calibrations.find(
    (profile) =>
      profile.id === session.selectedCalibrationProfileId &&
      profile.accountId === selectedAccount?.id,
  ) ?? state.calibrations.find((profile) => profile.accountId === selectedAccount?.id);
  const pendingPrint = pendingPrintFromState(state);
  let readiness: HomeViewModel["readiness"] = "READY";
  let readinessMessage: HomeViewModel["readinessMessage"] = { key: "home.ready" };
  if (!selectedAccount) {
    readiness = "ACCOUNT_REQUIRED";
    readinessMessage = { key: "state.home.empty.body" };
  } else if (selectedAccount.numberingState !== "VERIFIED") {
    readiness = "NUMBER_CONFIRMATION_REQUIRED";
    readinessMessage = { key: "state.account.warning.body" };
  } else if (!selectedProfile) {
    readiness = "CALIBRATION_REQUIRED";
    readinessMessage = { key: "state.calibration.empty.body" };
  } else if (!session.selectedPrinterKey && !selectedProfile.printerKey) {
    readiness = "PRINTER_REQUIRED";
    readinessMessage = { key: "state.printer.empty.body" };
  } else if (pendingPrint) {
    readiness = "PENDING_PRINT_OUTCOME";
    readinessMessage = { key: "home.pendingOutcome" };
  }
  return {
    kind: "HOME",
    route: "HOME",
    readiness,
    readinessMessage,
    selectedAccount,
    selectedProfile,
    pendingPrint,
    nextCheckNumber: selectedAccount?.nextCheckNumber,
    freeUsed: state.freeUsageCount,
    freeRemaining: Math.max(0, 3 - state.freeUsageCount),
    commerce,
    recentChecks: state.checks
      .filter((check) => check.status !== "DELETED")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8),
    checklist: setupChecklist(state, session.onboarding),
    canCreateCheque: readiness === "READY",
  };
}
