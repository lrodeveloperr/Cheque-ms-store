export type CustomerStateKind =
  | "IDLE"
  | "LOADING"
  | "EMPTY"
  | "WARNING"
  | "ERROR"
  | "SUCCESS";

export type CustomerFeature =
  | "STARTUP"
  | "HOME"
  | "ACCOUNT"
  | "PRINTER"
  | "CALIBRATION"
  | "PAYEE"
  | "CHEQUE"
  | "PDF"
  | "PRINT"
  | "REGISTER"
  | "BACKUP"
  | "RESTORE"
  | "PURCHASE"
  | "LICENSE";

export interface CustomerStateDefinition {
  id: string;
  feature: CustomerFeature;
  kind: CustomerStateKind;
  titleKey: string;
  bodyKey: string;
  primaryActionKey?: string;
  secondaryActionKey?: string;
  blocksPrimaryWorkflow: boolean;
}

type FeatureCopy = Record<CustomerStateKind, Omit<CustomerStateDefinition, "id" | "feature" | "kind">>;

function featureStates(feature: CustomerFeature, copy: FeatureCopy): CustomerStateDefinition[] {
  return (Object.keys(copy) as CustomerStateKind[]).map((kind) => ({
    id: `${feature}.${kind}`,
    feature,
    kind,
    ...copy[kind],
  }));
}

function standard(prefix: string, actionKey: string): FeatureCopy {
  return {
    IDLE: { titleKey: "state.common.idle.title", bodyKey: `${prefix}.idle.body`, primaryActionKey: actionKey, blocksPrimaryWorkflow: false },
    LOADING: { titleKey: "state.common.loading.title", bodyKey: `${prefix}.loading.body`, blocksPrimaryWorkflow: true },
    EMPTY: { titleKey: "state.common.empty.title", bodyKey: `${prefix}.empty.body`, primaryActionKey: actionKey, blocksPrimaryWorkflow: false },
    WARNING: { titleKey: "state.common.warning.title", bodyKey: `${prefix}.warning.body`, primaryActionKey: "action.review", secondaryActionKey: "action.cancel", blocksPrimaryWorkflow: true },
    ERROR: { titleKey: "state.common.error.title", bodyKey: `${prefix}.error.body`, primaryActionKey: "action.tryAgain", secondaryActionKey: "action.help", blocksPrimaryWorkflow: true },
    SUCCESS: { titleKey: "state.common.success.title", bodyKey: `${prefix}.success.body`, primaryActionKey: "action.done", blocksPrimaryWorkflow: false },
  };
}

export const CUSTOMER_STATE_MODEL: readonly CustomerStateDefinition[] = Object.freeze([
  ...featureStates("STARTUP", standard("state.startup", "action.openApp")),
  ...featureStates("HOME", standard("state.home", "action.newCheque")),
  ...featureStates("ACCOUNT", standard("state.account", "action.addAccount")),
  ...featureStates("PRINTER", standard("state.printer", "action.choosePrinter")),
  ...featureStates("CALIBRATION", standard("state.calibration", "action.printCalibration")),
  ...featureStates("PAYEE", standard("state.payee", "action.addPayee")),
  ...featureStates("CHEQUE", standard("state.cheque", "action.newCheque")),
  ...featureStates("PDF", standard("state.pdf", "action.savePdf")),
  ...featureStates("PRINT", standard("state.print", "action.print")),
  ...featureStates("REGISTER", standard("state.register", "action.clearFilters")),
  ...featureStates("BACKUP", standard("state.backup", "action.createBackup")),
  ...featureStates("RESTORE", standard("state.restore", "action.restoreBackup")),
  ...featureStates("PURCHASE", standard("state.purchase", "action.buyLifetime")),
  ...featureStates("LICENSE", standard("state.license", "action.restorePurchase")),
]);

export function getCustomerState(id: string): CustomerStateDefinition {
  const result = CUSTOMER_STATE_MODEL.find((state) => state.id === id);
  if (!result) throw new Error(`Unknown customer state: ${id}`);
  return result;
}
