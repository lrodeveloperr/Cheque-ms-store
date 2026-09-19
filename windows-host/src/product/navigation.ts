export type AppRoute =
  | "STARTUP"
  | "ONBOARDING_WELCOME"
  | "ONBOARDING_STOCK"
  | "ONBOARDING_ACCOUNT"
  | "ONBOARDING_LAYOUT"
  | "ONBOARDING_PRINTER"
  | "ONBOARDING_CALIBRATION"
  | "HOME"
  | "CHEQUES"
  | "CHEQUE_NEW"
  | "CHEQUE_REVIEW"
  | "CHEQUE_OUTPUT"
  | "PRINT_OUTCOME"
  | "CHEQUE_SUCCESS"
  | "REGISTER"
  | "PAYEES"
  | "PAYEE_EDIT"
  | "SETTINGS"
  | "SETTINGS_ACCOUNTS"
  | "SETTINGS_STOCK"
  | "SETTINGS_CALIBRATION"
  | "SETTINGS_BACKUP"
  | "SETTINGS_LANGUAGE"
  | "SETTINGS_PURCHASE"
  | "SETTINGS_PRIVACY"
  | "HELP";

export type RouteGuard =
  | "NONE"
  | "ONBOARDING_INCOMPLETE"
  | "ONBOARDING_COMPLETE"
  | "ACCOUNT_EXISTS"
  | "DRAFT_EXISTS"
  | "DURABLE_JOB_QUEUED";

export interface RouteDefinition {
  id: AppRoute;
  titleKey: string;
  parent?: AppRoute;
  guard: RouteGuard;
  primaryNavigation: boolean;
  modal: boolean;
}

export const ROUTES: readonly RouteDefinition[] = Object.freeze([
  { id: "STARTUP", titleKey: "route.startup", guard: "NONE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_WELCOME", titleKey: "route.welcome", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_STOCK", titleKey: "route.stockCheck", parent: "ONBOARDING_WELCOME", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_ACCOUNT", titleKey: "route.accountSetup", parent: "ONBOARDING_STOCK", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_LAYOUT", titleKey: "route.stockLayout", parent: "ONBOARDING_ACCOUNT", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_PRINTER", titleKey: "route.printerSetup", parent: "ONBOARDING_LAYOUT", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "ONBOARDING_CALIBRATION", titleKey: "route.calibration", parent: "ONBOARDING_PRINTER", guard: "ONBOARDING_INCOMPLETE", primaryNavigation: false, modal: false },
  { id: "HOME", titleKey: "nav.home", guard: "ONBOARDING_COMPLETE", primaryNavigation: true, modal: false },
  { id: "CHEQUES", titleKey: "nav.cheques", guard: "ONBOARDING_COMPLETE", primaryNavigation: true, modal: false },
  { id: "CHEQUE_NEW", titleKey: "route.newCheque", parent: "CHEQUES", guard: "ACCOUNT_EXISTS", primaryNavigation: false, modal: false },
  { id: "CHEQUE_REVIEW", titleKey: "route.reviewCheque", parent: "CHEQUE_NEW", guard: "DRAFT_EXISTS", primaryNavigation: false, modal: false },
  { id: "CHEQUE_OUTPUT", titleKey: "route.chooseOutput", parent: "CHEQUE_REVIEW", guard: "DRAFT_EXISTS", primaryNavigation: false, modal: true },
  { id: "PRINT_OUTCOME", titleKey: "route.printOutcome", parent: "CHEQUE_OUTPUT", guard: "DURABLE_JOB_QUEUED", primaryNavigation: false, modal: true },
  { id: "CHEQUE_SUCCESS", titleKey: "route.chequeComplete", parent: "CHEQUES", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "REGISTER", titleKey: "nav.register", guard: "ONBOARDING_COMPLETE", primaryNavigation: true, modal: false },
  { id: "PAYEES", titleKey: "nav.payees", guard: "ONBOARDING_COMPLETE", primaryNavigation: true, modal: false },
  { id: "PAYEE_EDIT", titleKey: "route.payee", parent: "PAYEES", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: true },
  { id: "SETTINGS", titleKey: "nav.settings", guard: "ONBOARDING_COMPLETE", primaryNavigation: true, modal: false },
  { id: "SETTINGS_ACCOUNTS", titleKey: "settings.accounts", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_STOCK", titleKey: "settings.stock", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_CALIBRATION", titleKey: "settings.calibration", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_BACKUP", titleKey: "settings.backup", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_LANGUAGE", titleKey: "settings.language", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_PURCHASE", titleKey: "settings.purchase", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "SETTINGS_PRIVACY", titleKey: "settings.privacy", parent: "SETTINGS", guard: "ONBOARDING_COMPLETE", primaryNavigation: false, modal: false },
  { id: "HELP", titleKey: "nav.help", guard: "NONE", primaryNavigation: false, modal: false },
]);

export const PRIMARY_NAVIGATION: readonly AppRoute[] = Object.freeze([
  "HOME",
  "CHEQUES",
  "REGISTER",
  "PAYEES",
  "SETTINGS",
]);

export const ONBOARDING_FLOW: readonly AppRoute[] = Object.freeze([
  "ONBOARDING_WELCOME",
  "ONBOARDING_STOCK",
  "ONBOARDING_ACCOUNT",
  "ONBOARDING_LAYOUT",
  "ONBOARDING_PRINTER",
  "ONBOARDING_CALIBRATION",
  "HOME",
]);

export const FIRST_LIVE_CHEQUE_FLOW: readonly AppRoute[] = Object.freeze([
  "HOME",
  "CHEQUE_NEW",
  "CHEQUE_REVIEW",
  "CHEQUE_OUTPUT",
  "PRINT_OUTCOME",
  "CHEQUE_SUCCESS",
  "REGISTER",
]);

export const SAVE_PDF_FLOW: readonly AppRoute[] = Object.freeze([
  "HOME",
  "CHEQUE_NEW",
  "CHEQUE_REVIEW",
  "CHEQUE_OUTPUT",
  "CHEQUE_SUCCESS",
]);

export const RESTORE_FLOW: readonly AppRoute[] = Object.freeze([
  "SETTINGS",
  "SETTINGS_BACKUP",
  "SETTINGS_ACCOUNTS",
  "HOME",
]);
