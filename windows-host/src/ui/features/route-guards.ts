import type { EngineState } from "../../../../src/types.ts";
import { ROUTES, type AppRoute, type RouteGuard } from "../../product/navigation.ts";
import type { UiMessage, UiSessionState } from "../app-model.ts";
import { pendingPrintFromState } from "../app-model.ts";
import { onboardingComplete } from "./onboarding.ts";

export type RouteGuardDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly guard: RouteGuard; readonly message: UiMessage; readonly redirect: AppRoute };

export function evaluateRouteGuard(
  route: AppRoute,
  state: EngineState,
  session: UiSessionState,
): RouteGuardDecision {
  const definition = ROUTES.find((candidate) => candidate.id === route);
  if (!definition) return { allowed: false, guard: "NONE", message: { key: "ui.route.unknown" }, redirect: "HOME" };
  const complete = onboardingComplete(state, session);
  const fail = (messageKey: string, redirect: AppRoute): RouteGuardDecision => ({
    allowed: false,
    guard: definition.guard,
    message: { key: messageKey },
    redirect,
  });
  if (definition.guard === "NONE") return { allowed: true };
  if (definition.guard === "ONBOARDING_INCOMPLETE") {
    return complete ? fail("ui.route.onboardingComplete", "HOME") : { allowed: true };
  }
  if (definition.guard === "ONBOARDING_COMPLETE") {
    return complete ? { allowed: true } : fail("ui.route.setupRequired", "ONBOARDING_WELCOME");
  }
  if (definition.guard === "ACCOUNT_EXISTS") {
    const account = state.accounts.find((candidate) => candidate.id === session.selectedAccountId && !candidate.archived);
    return account ? { allowed: true } : fail("ui.route.accountRequired", "SETTINGS_ACCOUNTS");
  }
  if (definition.guard === "DRAFT_EXISTS") {
    const draft = state.checks.find(
      (candidate) =>
        candidate.id === session.activeDraftId &&
        (candidate.status === "DRAFT" || candidate.status === "READY" || candidate.status === "PRINT_QUEUED"),
    );
    return draft ? { allowed: true } : fail("ui.route.draftRequired", "CHEQUES");
  }
  if (definition.guard === "DURABLE_JOB_QUEUED") {
    return pendingPrintFromState(state)
      ? { allowed: true }
      : fail("ui.route.pendingPrintRequired", "CHEQUES");
  }
  return { allowed: true };
}
