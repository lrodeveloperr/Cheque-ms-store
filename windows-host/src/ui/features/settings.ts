import type { PrinterDescriptor } from "../../../../src/host-contract.ts";
import type { CommerceSnapshot } from "../../product/entitlement.ts";
import type { EngineState } from "../../../../src/types.ts";
import type { PayeesViewModel, SettingsViewModel, UiBridgeCapabilities, UiSessionState } from "../app-model.ts";

export function payeesModel(
  state: EngineState,
  locale: UiSessionState["locale"],
  selectedPayeeId?: string,
): PayeesViewModel {
  return {
    kind: "PAYEES",
    route: selectedPayeeId ? "PAYEE_EDIT" : "PAYEES",
    payees: state.payees
      .filter((payee) => !payee.archived)
      .sort((left, right) => left.name.localeCompare(right.name, locale)),
    selectedPayee: state.payees.find((payee) => payee.id === selectedPayeeId),
  };
}

export function settingsModel(
  route: SettingsViewModel["route"],
  state: EngineState,
  session: UiSessionState,
  commerce: CommerceSnapshot,
  printers: readonly PrinterDescriptor[],
  capabilities: UiBridgeCapabilities,
): SettingsViewModel {
  return {
    kind: "SETTINGS",
    route,
    accounts: state.accounts,
    profiles: state.calibrations,
    printers,
    locale: session.locale,
    commerce,
    capabilities,
  };
}

export function isSettingsRoute(route: string): route is SettingsViewModel["route"] {
  return route === "SETTINGS" || route.startsWith("SETTINGS_");
}
