import type { PrinterDescriptor } from "../../../../src/host-contract.ts";
import type { CommerceSnapshot } from "../../product/entitlement.ts";
import type { EngineState } from "../../../../src/types.ts";
import type { OutputViewModel, PrintOutcomeViewModel, UiSessionState } from "../app-model.ts";
import { pendingPrintFromState } from "../app-model.ts";

export function outputModel(
  state: EngineState,
  session: UiSessionState,
  commerce: CommerceSnapshot,
  printers: readonly PrinterDescriptor[],
  liveJobReady: boolean,
): OutputViewModel {
  const check = state.checks.find((candidate) => candidate.id === session.activeDraftId);
  const profile = state.calibrations.find(
    (candidate) => candidate.id === (check?.readyCalibrationProfileId ?? session.selectedCalibrationProfileId),
  );
  return {
    kind: "CHEQUE_OUTPUT",
    route: "CHEQUE_OUTPUT",
    check,
    profile,
    pendingPrint: pendingPrintFromState(state),
    printers,
    selectedPrinterKey: session.selectedPrinterKey ?? profile?.printerKey,
    selectedStockKey: session.selectedStockKey ?? profile?.stockKey,
    startSlot: session.startSlot,
    commerce,
    liveJobReady,
  };
}

export function printOutcomeModel(state: EngineState): PrintOutcomeViewModel {
  const pendingPrint = pendingPrintFromState(state);
  return {
    kind: "PRINT_OUTCOME",
    route: "PRINT_OUTCOME",
    pendingPrint,
    checks: pendingPrint
      ? state.checks.filter((check) => pendingPrint.checkIds.includes(check.id))
      : [],
    outcomes: ["PRINTED_CORRECTLY", "PAPER_MARKED_WITH_PROBLEM", "NOT_PRINTED"],
  };
}
