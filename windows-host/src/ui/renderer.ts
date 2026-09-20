import { normalizeDisplayPreferences } from "./accessibility.ts";
import { createUiLocalizer, type UiCatalogBundle, type UiLocale, type UiLocalizer } from "./i18n.ts";
import type { UiActionRequest, UiActionResponse, UiEnvelope, WorksBienDesktopBridge } from "./ipc-contract.ts";
import { previewEnvelope } from "./preview-runtime.ts";
import { bootstrapOperationsDeskShell, type CommandRequestDetail, type NavigationRequestDetail, type OperationsDeskShell } from "./shell.ts";
import { renderOperationsView } from "./view-renderer.ts";

declare global {
  interface Window {
    operationsDeskShell: OperationsDeskShell;
    operationsDeskI18n?: UiLocalizer;
    setOperationsDeskLocale(locale: UiLocale): boolean;
    setOperationsDeskTextScale(scale: number): void;
    worksbienHost?: WorksBienDesktopBridge;
  }
  interface WindowEventMap {
    "worksbien:navigate": CustomEvent<NavigationRequestDetail>;
    "worksbien:command": CustomEvent<CommandRequestDetail>;
    "worksbien:host-ready": CustomEvent<{ readonly version: string }>;
    "worksbien:locale-changed": CustomEvent<{ readonly locale: UiLocale }>;
  }
}

const shell = bootstrapOperationsDeskShell();
window.operationsDeskShell = shell;
let catalogBundle: UiCatalogBundle | undefined;
let localizer: UiLocalizer | undefined;
let envelope: UiEnvelope | undefined;
let operationTail: Promise<void> = Promise.resolve();

function setLocale(locale: UiLocale): boolean {
  if (!catalogBundle) return false;
  localizer = createUiLocalizer(catalogBundle, locale);
  window.operationsDeskI18n = localizer;
  shell.setLocalizer(localizer);
  if (envelope) renderOperationsView({ shell, localizer, ...envelope });
  window.dispatchEvent(new CustomEvent("worksbien:locale-changed", { detail: { locale: localizer.locale } }));
  return true;
}

function localizedText(key: string, fallback: string, parameters?: Readonly<Record<string, string | number>>): string {
  try { return localizer?.text(key, parameters) ?? fallback; }
  catch { return fallback; }
}

function localizedMessage(value: { key: string; parameters?: Readonly<Record<string, string | number>> }): string {
  return localizedText(value.key, value.key, value.parameters);
}

window.setOperationsDeskLocale = setLocale;

const forcedColours = window.matchMedia("(forced-colors: active)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let requestedTextScale = 1;

function applyDisplayPreferences(): void {
  const preferences = normalizeDisplayPreferences({
    forcedColors: forcedColours.matches,
    reducedMotion: reducedMotion.matches,
    textScale: requestedTextScale,
  });
  document.documentElement.classList.remove("forced-colors", "reduced-motion", "text-scale-enlarged", "text-scale-200");
  document.documentElement.classList.add(...preferences.classes);
}

window.setOperationsDeskTextScale = (scale: number) => {
  requestedTextScale = scale;
  applyDisplayPreferences();
};
forcedColours.addEventListener("change", applyDisplayPreferences);
reducedMotion.addEventListener("change", applyDisplayPreferences);
applyDisplayPreferences();

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function render(next: UiEnvelope): void {
  envelope = next;
  if (!localizer) return;
  if (localizer.locale !== next.session.locale) {
    setLocale(next.session.locale);
    return;
  }
  renderOperationsView({ shell, localizer, ...next });
  shell.announce(localizedText("a11y.pageLoaded", `${next.model.route} loaded.`, { page: localizedText("app.name", next.model.route) }));
}

function runSerial(operation: () => Promise<void>): void {
  operationTail = operationTail.then(operation, operation);
}

async function perform(request: UiActionRequest, options: { quiet?: boolean } = {}): Promise<UiActionResponse | undefined> {
  const host = window.worksbienHost;
  if (!host) {
    const nextRoute = request.name === "NAVIGATE"
      ? String(request.payload?.route ?? "HOME")
      : request.name === "BEGIN_CHEQUE" ? "CHEQUE_NEW"
        : request.name === "OPEN_OUTPUT" ? "CHEQUE_OUTPUT"
          : request.name === "EDIT_REVIEWED_CHEQUE" ? "CHEQUE_NEW"
            : request.name === "QUEUE_LIVE_OUTPUT" ? "CHEQUE_OUTPUT"
              : request.name === "REVIEW_CHEQUE" ? "CHEQUE_REVIEW"
                : request.name === "SELECT_PAYEE" ? (request.payload?.payeeId ? "PAYEE_EDIT" : "PAYEES")
                  : request.name === "SET_LOCALE" ? envelope?.model.route ?? "HOME"
                    : undefined;
    if (request.name === "SET_LOCALE" && request.payload?.locale) setLocale(String(request.payload.locale) as UiLocale);
    if (nextRoute) render(previewEnvelope(nextRoute as Parameters<typeof previewEnvelope>[0], localizer?.locale));
    else shell.toast(localizedText("ui.notAvailable.nativePrint", "This action is available in the Windows app."), "WARNING");
    return undefined;
  }
  shell.setBusy(true);
  try {
    const response = await host.performUiAction(request);
    render(response.envelope);
    if (!response.result.ok) {
      if (response.result.code !== "USER_CANCELLED") {
        shell.showBanner(
          response.result.kind === "FAILURE" ? "ERROR" : "WARNING",
          localizedText(response.result.kind === "FAILURE" ? "state.common.error.title" : "state.common.warning.title", "Review required"),
          localizedMessage(response.result.message),
        );
      }
    } else if (!options.quiet) {
      const text = response.result.message
        ? localizedMessage(response.result.message)
        : localizedText("toast.saved", "Saved on this device.");
      shell.toast(text, "SUCCESS");
    }
    return response;
  } catch {
    shell.showBanner(
      "ERROR",
      localizedText("state.common.error.title", "Could not complete the action"),
      localizedText("error.generic", "Something went wrong. Your previous data is unchanged."),
    );
    return undefined;
  } finally {
    shell.setBusy(false);
  }
}

function formValues(form: HTMLFormElement): Record<string, string> {
  const result: Record<string, string> = {};
  const data = new FormData(form);
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function cents(value: string): number {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return 0;
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function accountPayload(values: Record<string, string>): Readonly<Record<string, unknown>> {
  const bankCountry = values.bankCountry === "CA" ? "CA" : "US";
  return {
    name: values.name ?? "",
    companyName: values.companyName ?? "",
    bankCountry,
    currency: bankCountry === "CA" ? "CAD" : "USD",
    locale: bankCountry === "CA" ? (values.locale === "fr-CA" ? "fr-CA" : "en-CA") : "en-US",
    nextCheckNumber: Number(values.nextCheckNumber),
  };
}

async function submitForm(form: HTMLFormElement, requestedAction: string): Promise<void> {
  const values = formValues(form);
  const kind = form.dataset.uiForm;
  if (kind === "ONBOARDING_ACCOUNT") {
    await perform({ name: "SAVE_ONBOARDING_ACCOUNT", payload: accountPayload(values) });
  } else if (kind === "ONBOARDING_LAYOUT") {
    await perform({ name: "CHOOSE_LAYOUT", payload: { layout: values.layout, startSlot: Number(values.startSlot) } });
  } else if (kind === "ONBOARDING_PRINTER") {
    await perform({ name: "CHOOSE_PRINTER", payload: { printerKey: values.printerKey } });
  } else if (kind === "ONBOARDING_CALIBRATION") {
    await perform({ name: "SAVE_ONBOARDING_CALIBRATION", payload: { name: values.name } });
  } else if (kind === "CHEQUE_EDITOR") {
    const payload = {
      payeeId: values.payeeId,
      issueDate: values.issueDate,
      amountCents: cents(values.amount ?? ""),
      memo: values.memo,
      category: values.category,
    };
    const saved = await perform(
      { name: form.dataset.draft === "true" ? "UPDATE_CHEQUE" : "CREATE_CHEQUE", payload },
      { quiet: true },
    );
    if (saved?.result.ok && requestedAction === "SUBMIT_REVIEW") await perform({ name: "REVIEW_CHEQUE" }, { quiet: true });
  } else if (kind === "REGISTER_FILTER") {
    await perform({ name: "SET_REGISTER_QUERY", payload: { query: {
      payeeQuery: values.payeeQuery || undefined,
      issueDateFrom: values.issueDateFrom || undefined,
      issueDateTo: values.issueDateTo || undefined,
    } } }, { quiet: true });
  } else if (kind === "PAYEE") {
    const id = form.dataset.payeeId;
    await perform({ name: id ? "UPDATE_PAYEE" : "CREATE_PAYEE", payload: { id, name: values.name, defaultMemo: values.defaultMemo } });
  } else if (kind === "ACCOUNT") {
    await perform({ name: "CREATE_ACCOUNT", payload: accountPayload(values) });
  } else if (kind === "CALIBRATION") {
    await perform({ name: "CREATE_CALIBRATION", payload: {
      accountId: values.accountId,
      name: values.name,
      printerKey: values.printerKey,
      layout: values.layout,
    } });
  } else if (kind === "BACKUP") {
    if ((values.passphrase ?? "").length < 12) {
      shell.showBanner("WARNING", localizedText("state.common.warning.title", "Review required"), localizedText("error.backupTooShort", "Use at least 12 characters."));
    } else if (values.passphrase !== values.confirmPassphrase) {
      shell.showBanner("WARNING", localizedText("state.common.warning.title", "Review required"), localizedText("error.backupMismatch", "The passphrases do not match."));
    } else await perform({ name: "CREATE_BACKUP", payload: { passphrase: values.passphrase } });
  } else if (kind === "RESTORE") {
    const confirmed = await shell.openModal({
      title: localizedText("confirm.restore.title", "Restore this backup?"),
      body: localizedText("confirm.restore.body", "Current local records may be replaced."),
      confirmLabel: localizedText("action.restoreBackup", "Restore backup"),
      destructive: true,
    });
    if (confirmed === "confirm") await perform({ name: "RESTORE_BACKUP", payload: { passphrase: values.passphrase } });
  } else if (kind === "LANGUAGE") {
    await perform({ name: "SET_LOCALE", payload: { locale: values.locale } });
  }
}

async function confirmDestructive(titleKey: string, bodyKey: string, confirmKey: string): Promise<boolean> {
  return (await shell.openModal({
    title: localizedText(titleKey, "Confirm this action?"),
    body: localizedText(bodyKey, "Review this action before continuing."),
    confirmLabel: localizedText(confirmKey, "Continue"),
    destructive: true,
  })) === "confirm";
}

async function handleUiAction(element: HTMLElement): Promise<void> {
  const action = element.dataset.uiAction ?? "";
  if (action === "SUBMIT" || action === "SUBMIT_REVIEW" || action === "SUBMIT_SAVE") {
    const form = element.closest<HTMLFormElement>("form");
    if (form && form.reportValidity()) await submitForm(form, action);
    return;
  }
  if (action === "ONBOARDING_START") await perform({ name: "NAVIGATE", payload: { route: "ONBOARDING_STOCK" } }, { quiet: true });
  else if (action === "ACKNOWLEDGE_STOCK") await perform({ name: "ACKNOWLEDGE_STOCK" }, { quiet: true });
  else if (action === "REFRESH_PRINTERS") await perform({ name: "REFRESH_PRINTERS" });
  else if (action === "OPEN_OUTPUT") await perform({ name: "OPEN_OUTPUT" }, { quiet: true });
  else if (action === "EDIT_REVIEWED_CHEQUE") await perform({ name: "EDIT_REVIEWED_CHEQUE" }, { quiet: true });
  else if (action === "QUEUE_LIVE_OUTPUT") await perform({ name: "QUEUE_LIVE_OUTPUT" }, { quiet: true });
  else if (action === "SAVE_QUEUED_PDF") await perform({ name: "SAVE_QUEUED_PDF" });
  else if (action === "PRINT_QUEUED") await perform({ name: "PRINT_QUEUED" });
  else if (action === "SAVE_SAMPLE_PDF") await perform({ name: "SAVE_SAMPLE_PDF" });
  else if (action === "PRINT_SAMPLE") await perform({ name: "PRINT_SAMPLE" });
  else if (action === "SAVE_CALIBRATION_PDF") await perform({ name: "SAVE_CALIBRATION_PDF" });
  else if (action === "PRINT_CALIBRATION") await perform({ name: "PRINT_CALIBRATION" });
  else if (action === "SAVE_REGISTER_CSV") await perform({ name: "SAVE_REGISTER_CSV" });
  else if (action === "CLEAR_REGISTER_FILTERS") await perform({ name: "CLEAR_REGISTER_FILTERS" }, { quiet: true });
  else if (action === "OUTCOME_CORRECT") await perform({ name: "RECORD_OUTCOME", payload: { kind: "PRINTED_CORRECTLY" } });
  else if (action === "OUTCOME_PROBLEM") {
    if (await confirmDestructive("confirm.spoiled.title", "confirm.spoiled.body", "action.confirm")) {
      await perform({ name: "RECORD_OUTCOME", payload: { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: "OPERATOR_REPORTED_PROBLEM" } });
    }
  } else if (action === "OUTCOME_NONE") {
    const confirmed = await shell.openModal({
      title: localizedText("print.outcome.none", "Nothing printed"),
      body: localizedText("print.outcome.noneHelp", "Use this only when no output was produced."),
      confirmLabel: localizedText("action.confirm", "Confirm"),
      tone: "WARNING",
    });
    if (confirmed === "confirm") await perform({ name: "RECORD_OUTCOME", payload: { kind: "NOT_PRINTED", deliveryEvidence: "HOST_CONFIRMED_NO_OUTPUT" } });
  } else if (action === "DELETE_DRAFT") {
    if (await confirmDestructive("confirm.deleteDraft.title", "confirm.deleteDraft.body", "action.deleteDraft")) {
      await perform({ name: "DELETE_DRAFT", payload: { checkId: element.dataset.checkId } });
    }
  } else if (action === "DUPLICATE_CHEQUE") {
    await perform({ name: "DUPLICATE_CHEQUE", payload: { checkId: element.dataset.checkId, issueDate: new Date().toISOString().slice(0, 10) } });
  } else if (action === "TOGGLE_CLEARED") {
    const cleared = element.dataset.cleared !== "true";
    await perform({ name: "MARK_CLEARED", payload: { checkId: element.dataset.checkId, cleared, clearedDate: cleared ? new Date().toISOString().slice(0, 10) : undefined } });
  } else if (action === "SELECT_PAYEE") {
    await perform({ name: "SELECT_PAYEE", payload: { payeeId: element.dataset.payeeId } }, { quiet: true });
  } else if (action === "CLEAR_PAYEE_SELECTION") {
    await perform({ name: "SELECT_PAYEE", payload: {} }, { quiet: true });
  } else if (action === "ARCHIVE_PAYEE") {
    if (await confirmDestructive("confirm.archivePayee.title", "confirm.archivePayee.body", "action.archivePayee")) {
      await perform({ name: "ARCHIVE_PAYEE", payload: { id: element.dataset.payeeId, archived: true } });
    }
  } else if (action === "ARCHIVE_ACCOUNT") {
    if (await confirmDestructive("confirm.archiveAccount.title", "confirm.archiveAccount.body", "action.archiveAccount")) {
      await perform({ name: "ARCHIVE_ACCOUNT", payload: { id: element.dataset.accountId, archived: true } });
    }
  } else if (action === "CONFIRM_CHECK_NUMBER") {
    await perform({ name: "CONFIRM_CHECK_NUMBER", payload: { id: element.dataset.accountId, number: Number(element.dataset.number) } });
  } else if (action === "SELECT_CALIBRATION") {
    await perform({ name: "SELECT_CALIBRATION", payload: { profileId: element.dataset.profileId } });
  } else if (action === "PURCHASE_LIFETIME") await perform({ name: "PURCHASE_LIFETIME" });
  else if (action === "RESTORE_LIFETIME") await perform({ name: "RESTORE_LIFETIME" });
}

window.addEventListener("worksbien:navigate", (event) => {
  event.preventDefault();
  runSerial(async () => {
    const route = event.detail.route;
    if (route === "CHEQUE_NEW") await perform({ name: "BEGIN_CHEQUE" }, { quiet: true });
    else await perform({ name: "NAVIGATE", payload: { route } }, { quiet: true });
  });
});

window.addEventListener("worksbien:command", (event) => {
  if (event.detail.command === "DISMISS_BANNER") return;
  event.preventDefault();
  runSerial(async () => {
    if (event.detail.command === "OPEN_SEARCH") {
      await perform({ name: "NAVIGATE", payload: { route: "REGISTER" } }, { quiet: true });
      document.querySelector<HTMLInputElement>('input[name="payeeQuery"]')?.focus();
    } else if (event.detail.command === "PRINT_SAMPLE") await perform({ name: "PRINT_SAMPLE" });
  });
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-ui-action]") : null;
  if (!target) return;
  event.preventDefault();
  runSerial(() => handleUiAction(target));
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target instanceof HTMLFormElement ? event.target : undefined;
  if (form?.reportValidity()) runSerial(() => submitForm(form, "SUBMIT"));
});

document.addEventListener("change", (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || input.dataset.uiFile !== "IMPORT_PAYEES" || !input.files?.[0]) return;
  const file = input.files[0];
  runSerial(async () => {
    const csv = await file.text();
    await perform({ name: "IMPORT_PAYEES", payload: { csv } });
  });
});

window.addEventListener("keydown", (event) => {
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent<CommandRequestDetail>("worksbien:command", { detail: { command: "OPEN_SEARCH", source: "keyboard" }, cancelable: true }));
  } else if (commandKey && event.key.toLowerCase() === "n" && !isEditableTarget(event.target)) {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent<NavigationRequestDetail>("worksbien:navigate", { detail: { route: "CHEQUE_NEW", source: "keyboard" }, cancelable: true }));
  }
});

window.addEventListener("error", () => {
  shell.toast(localizedText("error.generic", "Something went wrong. Your previous data is unchanged."), "ERROR", 7000);
});

window.addEventListener("unhandledrejection", () => {
  shell.toast(localizedText("error.generic", "Something went wrong. Your previous data is unchanged."), "ERROR", 7000);
});

async function browserCatalogs(): Promise<UiCatalogBundle | undefined> {
  try {
    const [enUS, enCAOverrides, frCA] = await Promise.all([
      fetch("../../localization/en-US.json").then((response) => response.json()),
      fetch("../../localization/en-CA.overrides.json").then((response) => response.json()),
      fetch("../../localization/fr-CA.json").then((response) => response.json()),
    ]);
    return { enUS, enCAOverrides, frCA } as UiCatalogBundle;
  } catch { return undefined; }
}

async function initializeHost(): Promise<void> {
  const host = window.worksbienHost;
  shell.setBusy(true, "Loading…");
  if (!host) {
    document.documentElement.dataset.host = "preview";
    catalogBundle = await browserCatalogs();
    if (catalogBundle) {
      setLocale(navigator.language as UiLocale);
      render(previewEnvelope("HOME", localizer?.locale));
    }
    shell.setBusy(false);
    return;
  }
  try {
    const [version, catalogs, initial] = await Promise.all([
      host.getVersion(),
      host.getUiCatalogs(),
      host.initializeUi(),
    ]);
    catalogBundle = catalogs;
    setLocale(initial.session.locale);
    render(initial);
    const versionElement = document.querySelector<HTMLElement>("#application-version");
    if (versionElement) versionElement.textContent = `${localizedText("app.name", "Check Printer & Check Writer")} · ${version}`;
    document.documentElement.dataset.host = host.platform;
    await host.signalReady();
    window.dispatchEvent(new CustomEvent("worksbien:host-ready", { detail: { version } }));
  } catch {
    shell.showState({
      kind: "ERROR",
      title: localizedText("state.startup.error.body", "The app could not open its local data."),
      body: localizedText("error.storageDamaged", "Local data could not be verified. Restore a verified backup."),
    });
  } finally {
    shell.setBusy(false);
  }
}

void initializeHost();
