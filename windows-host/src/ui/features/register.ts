import type { RegisterQuery, RegisterReport, RegisterRow } from "../../../../src/register.ts";
import type { EngineState } from "../../../../src/types.ts";
import type { RegisterViewModel, UiSessionState } from "../app-model.ts";

export interface RegisterProjectionSource {
  queryRegister(query: RegisterQuery): readonly RegisterRow[];
  registerReport(query: RegisterQuery, locale: UiSessionState["locale"]): RegisterReport;
  reconciliation(accountId: string): NonNullable<RegisterViewModel["reconciliation"]>;
}

export function registerModel(source: RegisterProjectionSource, state: EngineState, session: UiSessionState): RegisterViewModel {
  const selectedAccount = state.accounts.find((candidate) => candidate.id === session.selectedAccountId);
  const query = {
    ...session.registerQuery,
    accountId: session.registerQuery.accountId ?? selectedAccount?.id,
  };
  return {
    kind: "REGISTER",
    route: "REGISTER",
    query,
    rows: source.queryRegister(query),
    report: source.registerReport(query, session.locale),
    selectedAccount,
    reconciliation: selectedAccount ? source.reconciliation(selectedAccount.id) : undefined,
  };
}
