import type { PrinterDescriptor } from "../../../../src/host-contract.ts";
import type { EngineState } from "../../../../src/types.ts";
import type { AppRoute } from "../../product/navigation.ts";
import type {
  OnboardingProgress,
  OnboardingViewModel,
  SetupChecklistItem,
  UiSessionState,
} from "../app-model.ts";

export function setupChecklist(
  state: EngineState,
  progress: OnboardingProgress,
): readonly SetupChecklistItem[] {
  const account = state.accounts.find((candidate) => candidate.id === progress.accountId && !candidate.archived);
  const profile = state.calibrations.find(
    (candidate) =>
      candidate.id === progress.calibrationProfileId &&
      candidate.accountId === account?.id,
  );
  return [
    { id: "STOCK", titleKey: "onboarding.preprinted.title", complete: progress.preprintedStockConfirmed, route: "ONBOARDING_STOCK" },
    { id: "ACCOUNT", titleKey: "route.accountSetup", complete: Boolean(account), route: "ONBOARDING_ACCOUNT" },
    { id: "LAYOUT", titleKey: "route.stockLayout", complete: Boolean(progress.layout && progress.stockKey), route: "ONBOARDING_LAYOUT" },
    { id: "PRINTER", titleKey: "route.printerSetup", complete: Boolean(progress.printerKey), route: "ONBOARDING_PRINTER" },
    { id: "CALIBRATION", titleKey: "route.calibration", complete: Boolean(profile), route: "ONBOARDING_CALIBRATION" },
  ];
}

export function onboardingComplete(state: EngineState, session: UiSessionState): boolean {
  return setupChecklist(state, session.onboarding).every((item) => item.complete);
}

export function nextOnboardingRoute(
  state: EngineState,
  session: UiSessionState,
): OnboardingViewModel["route"] | "HOME" {
  const firstIncomplete = setupChecklist(state, session.onboarding).find((item) => !item.complete);
  if (!firstIncomplete) return "HOME";
  if (firstIncomplete.id === "STOCK" && session.route === "ONBOARDING_WELCOME") return "ONBOARDING_WELCOME";
  return firstIncomplete.route as OnboardingViewModel["route"];
}

export function onboardingModel(
  route: OnboardingViewModel["route"],
  state: EngineState,
  session: UiSessionState,
  printers: readonly PrinterDescriptor[],
): OnboardingViewModel {
  return {
    kind: "ONBOARDING",
    route,
    progress: session.onboarding,
    checklist: setupChecklist(state, session.onboarding),
    printers,
    accounts: state.accounts.filter((account) => !account.archived),
    profiles: state.calibrations.filter((profile) => !session.selectedAccountId || profile.accountId === session.selectedAccountId),
  };
}

export function isOnboardingRoute(route: AppRoute): route is OnboardingViewModel["route"] {
  return route.startsWith("ONBOARDING_");
}
