import type { CheckStatus, PrintElement } from "../../../src/types.ts";
import type {
  AppViewModel,
  ChequeEditorViewModel,
  ChequeReviewViewModel,
  ChequesViewModel,
  HomeViewModel,
  OnboardingViewModel,
  OutputViewModel,
  PayeesViewModel,
  PrintOutcomeViewModel,
  RegisterViewModel,
  SettingsViewModel,
  UiMessage,
  UiSessionState,
} from "./app-model.ts";
import type { UiLocalizer } from "./i18n.ts";
import type { OperationsDeskShell } from "./shell.ts";

export interface RenderContext {
  readonly shell: OperationsDeskShell;
  readonly localizer: UiLocalizer;
  readonly model: AppViewModel;
  readonly session: UiSessionState;
}

const ROUTE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  HOME: "dashboard.topbar",
  CHEQUES: "nav.cheques",
  CHEQUE_NEW: "route.newCheque",
  CHEQUE_REVIEW: "route.reviewCheque",
  CHEQUE_OUTPUT: "route.chooseOutput",
  PRINT_OUTCOME: "route.printOutcome",
  CHEQUE_SUCCESS: "route.chequeComplete",
  REGISTER: "register.title",
  PAYEES: "payee.title",
  PAYEE_EDIT: "route.payee",
  SETTINGS: "nav.settings",
  SETTINGS_ACCOUNTS: "settings.accounts",
  SETTINGS_STOCK: "settings.stock",
  SETTINGS_CALIBRATION: "settings.calibration",
  SETTINGS_BACKUP: "settings.backup",
  SETTINGS_LANGUAGE: "settings.language",
  SETTINGS_PURCHASE: "settings.purchase",
  SETTINGS_PRIVACY: "settings.privacy",
  HELP: "help.title",
  ONBOARDING_WELCOME: "route.welcome",
  ONBOARDING_STOCK: "route.stockCheck",
  ONBOARDING_ACCOUNT: "route.accountSetup",
  ONBOARDING_LAYOUT: "route.stockLayout",
  ONBOARDING_PRINTER: "route.printerSetup",
  ONBOARDING_CALIBRATION: "route.calibration",
});

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function t(localizer: UiLocalizer, key: string, fallback = key, parameters?: Readonly<Record<string, string | number>>): string {
  try { return localizer.text(key, parameters); } catch { return fallback; }
}

function message(localizer: UiLocalizer, value: UiMessage): string {
  return t(localizer, value.key, value.key, value.parameters);
}

function icon(name: string): string {
  return `<i class="ti ti-${escapeHtml(name)}" aria-hidden="true"></i>`;
}

function actionButton(label: string, action: string, tone: "primary" | "secondary" | "danger" = "secondary", attributes = ""): string {
  return `<button class="button button-${tone}" type="button" data-ui-action="${escapeHtml(action)}" ${attributes}>${label}</button>`;
}

function routeButton(label: string, route: string, tone: "primary" | "secondary" = "secondary"): string {
  return `<button class="button button-${tone}" type="button" data-route-target="${escapeHtml(route)}">${label}</button>`;
}

function heading(title: string, subtitle: string, actions = ""): string {
  return `<div class="workspace-title workspace-title-row"><div><p>${subtitle}</p><h2>${title}</h2></div><div class="page-actions">${actions}</div></div>`;
}

function emptyPanel(title: string, body: string, action = ""): string {
  return `<section class="panel"><div class="empty-message"><span class="empty-icon" aria-hidden="true">#</span><strong>${title}</strong><p>${body}</p>${action}</div></section>`;
}

function statusLabel(localizer: UiLocalizer, status: CheckStatus): string {
  const key: Readonly<Record<CheckStatus, string>> = {
    DRAFT: "cheque.status.draft",
    READY: "cheque.status.ready",
    PRINT_QUEUED: "cheque.status.queued",
    PRINTED: "cheque.status.printed",
    MISPRINTED: "cheque.status.spoiled",
    VOIDED: "cheque.status.voided",
    DELETED: "action.delete",
  };
  return t(localizer, key[status], status);
}

function statusBadge(localizer: UiLocalizer, status: CheckStatus): string {
  return `<span class="status-chip" data-status="${status}">${escapeHtml(statusLabel(localizer, status))}</span>`;
}

function checkRows(
  localizer: UiLocalizer,
  checks: readonly {
    id: string;
    checkNumber: number;
    issueDate: string;
    payeeSnapshot: { name: string };
    amountCents: number;
    currency: "USD" | "CAD";
    status: CheckStatus;
  }[],
  actions = false,
): string {
  return checks.map((check) => `<tr>
    <td class="mono">${escapeHtml(check.checkNumber)}</td>
    <td>${escapeHtml(localizer.date(check.issueDate))}</td>
    <td><strong>${escapeHtml(check.payeeSnapshot.name)}</strong></td>
    <td class="numeric">${escapeHtml(localizer.moneyFromMinorUnits(check.amountCents, check.currency))}</td>
    <td>${statusBadge(localizer, check.status)}</td>
    ${actions ? `<td class="row-actions">${actionButton(t(localizer, "action.duplicate", "Duplicate"), "DUPLICATE_CHEQUE", "secondary", `data-check-id="${escapeHtml(check.id)}"`)}${check.status === "DRAFT" ? actionButton(t(localizer, "action.delete", "Delete"), "DELETE_DRAFT", "secondary", `data-check-id="${escapeHtml(check.id)}"`) : ""}</td>` : ""}
  </tr>`).join("");
}

function renderHome(model: HomeViewModel, localizer: UiLocalizer): string {
  const account = model.selectedAccount;
  const profile = model.selectedProfile;
  const ready = model.readiness === "READY";
  const setupAction = model.canCreateCheque
    ? ""
    : routeButton(t(localizer, "action.openSettings", "Open settings"), model.readiness === "ACCOUNT_REQUIRED" ? "SETTINGS_ACCOUNTS" : "SETTINGS_CALIBRATION", "primary");
  const recent = model.recentChecks.length > 0
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t(localizer, "register.column.number", "Number")}</th><th>${t(localizer, "register.column.date", "Date")}</th><th>${t(localizer, "register.column.payee", "Payee")}</th><th class="numeric">${t(localizer, "register.column.amount", "Amount")}</th><th>${t(localizer, "register.column.status", "Status")}</th></tr></thead><tbody>${checkRows(localizer, model.recentChecks)}</tbody></table></div>`
    : `<div class="empty-message compact-empty"><span class="empty-icon" aria-hidden="true">#</span><strong>${t(localizer, "empty.recent", "No recent check activity.")}</strong><p>${t(localizer, "empty.register", "Printed, voided and spoiled checks will appear here.")}</p></div>`;
  const stockName = profile?.layout === "VOUCHER_TOP"
    ? t(localizer, "onboarding.slot.top", "Top")
    : profile?.layout === "VOUCHER_MIDDLE"
      ? t(localizer, "onboarding.slot.middle", "Middle")
      : profile?.layout === "VOUCHER_BOTTOM"
        ? t(localizer, "onboarding.slot.bottom", "Bottom")
        : profile?.layout === "THREE_UP"
          ? t(localizer, "onboarding.layout.threeUp", "Three checks")
          : "—";
  return `${heading(
    t(localizer, "dashboard.title", "Operations desk"),
    t(localizer, "dashboard.subtitle", "Prepare, print and reconcile business checks."),
    setupAction,
  )}
  <div class="readiness-row"><span class="readiness-pill" data-ready="${ready}">${escapeHtml(message(localizer, model.readinessMessage))}</span><span>${t(localizer, "app.dataSaved", "Changes save automatically on this device.")}</span></div>
  <section class="metric-grid" aria-label="${escapeHtml(t(localizer, "a11y.readiness", "Print readiness summary"))}">
    <article class="metric-card"><span>${t(localizer, "dashboard.metric.nextNumber", "Next physical number")}</span><strong>${escapeHtml(model.nextCheckNumber ?? "—")}</strong><small>${escapeHtml(account?.currency ?? "")}</small></article>
    <article class="metric-card"><span>${t(localizer, "dashboard.metric.printer", "Printer")}</span><strong>${profile ? t(localizer, "printer.available", "Available") : "—"}</strong><small>${escapeHtml(profile?.printerKey ?? t(localizer, "action.choosePrinter", "Choose printer"))}</small></article>
    <article class="metric-card"><span>${t(localizer, "dashboard.metric.stock", "Stock layout")}</span><strong>${escapeHtml(stockName)}</strong><small>${profile ? `Letter · ${escapeHtml(profile.layout.replaceAll("_", " "))}` : escapeHtml(t(localizer, "empty.stock", "Add a stock profile"))}</small></article>
    <article class="metric-card"><span>${t(localizer, "dashboard.metric.freeRemaining", "Free checks remaining")}</span><strong>${model.commerce.entitlement === "LIFETIME" ? "∞" : escapeHtml(model.freeRemaining)}</strong><small>${model.commerce.entitlement === "LIFETIME" ? t(localizer, "home.lifetime", "Lifetime Unlock active") : escapeHtml(t(localizer, model.freeRemaining === 1 ? "home.freeRemaining.one" : model.freeRemaining === 0 ? "home.freeRemaining.none" : "home.freeRemaining.other", `${model.freeRemaining} remain`, { count: model.freeRemaining }))}</small></article>
  </section>
  <div class="dashboard-grid">
    <section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "dashboard.activity", "Recent activity")}</h2><p>${t(localizer, "register.empty", "Printed checks will appear here automatically.")}</p></div>${routeButton(t(localizer, "action.viewRegister", "View register"), "REGISTER")}</div>${recent}</section>
    <aside class="panel setup-panel"><div class="panel-heading"><div><h2>${t(localizer, "dashboard.readiness", "Print readiness")}</h2><p>${ready ? t(localizer, "dashboard.allReady", "Account, stock and printer are ready.") : t(localizer, "dashboard.notReady", "Complete the items below.")}</p></div></div>
      <ol class="setup-list">${model.checklist.map((item, index) => `<li><span class="setup-index">${index + 1}</span><div><strong>${escapeHtml(t(localizer, item.titleKey, item.id))}</strong><small>${item.complete ? t(localizer, "state.common.success.title", "Complete") : t(localizer, "a11y.required", "Required")}</small></div><span class="setup-badge" data-complete="${item.complete}">${item.complete ? "✓" : "!"}</span></li>`).join("")}</ol>
    </aside>
  </div>`;
}

function onboardingStep(model: OnboardingViewModel): number {
  return ["ONBOARDING_WELCOME", "ONBOARDING_STOCK", "ONBOARDING_ACCOUNT", "ONBOARDING_LAYOUT", "ONBOARDING_PRINTER", "ONBOARDING_CALIBRATION"].indexOf(model.route) + 1;
}

function renderOnboarding(model: OnboardingViewModel, localizer: UiLocalizer): string {
  const step = onboardingStep(model);
  const progress = `<div class="setup-progress"><span>${escapeHtml(t(localizer, "onboarding.progress", `Setup step ${step} of 6`, { current: step, total: 6 }))}</span><progress value="${step}" max="6"></progress></div>`;
  let content = "";
  if (model.route === "ONBOARDING_WELCOME") {
    content = `<div class="hero-icon">${icon("printer")}</div><h2>${t(localizer, "onboarding.title", "Print business checks on preprinted stock")}</h2><p>${t(localizer, "onboarding.subtitle", "Create exact PDFs and keep a private register.")}</p><div class="callout">${icon("shield-lock")}<div><strong>${t(localizer, "onboarding.noBankConnection", "This app does not connect to your bank or move money.")}</strong><span>${t(localizer, "privacy.localOnly", "Records stay encrypted on this device.")}</span></div></div>${actionButton(t(localizer, "action.startSetup", "Start setup"), "ONBOARDING_START", "primary")}`;
  } else if (model.route === "ONBOARDING_STOCK") {
    content = `<div class="hero-icon">${icon("file-certificate")}</div><h2>${t(localizer, "onboarding.preprinted.title", "Preprinted check stock is required")}</h2><p>${t(localizer, "onboarding.preprinted.body", "Your stock must already contain bank identity and MICR information.")}</p><ul class="check-list"><li>${t(localizer, "onboarding.noLetterhead", "Ordinary letterhead is not check stock.")}</li><li>${t(localizer, "terms.preprinted", "For compatible preprinted business check stock only.")}</li></ul>${actionButton(t(localizer, "action.confirm", "Confirm"), "ACKNOWLEDGE_STOCK", "primary")}`;
  } else if (model.route === "ONBOARDING_ACCOUNT") {
    content = `<h2>${t(localizer, "route.accountSetup", "Account setup")}</h2><p>${t(localizer, "account.numberPrivacy", "Do not enter routing or online-banking credentials.")}</p>
      <form class="form-grid" data-ui-form="ONBOARDING_ACCOUNT">
        <label>${t(localizer, "onboarding.accountName", "Account nickname")}<input name="name" required maxlength="80" autocomplete="off"></label>
        <label>${t(localizer, "onboarding.companyName", "Company or payor name")}<input name="companyName" required maxlength="120" autocomplete="organization"></label>
        <label>${t(localizer, "onboarding.country", "Where is the bank account held?")}<select name="bankCountry" required><option value="US">${t(localizer, "onboarding.country.us", "United States")}</option><option value="CA">${t(localizer, "onboarding.country.ca", "Canada")}</option></select></label>
        <label>${t(localizer, "onboarding.currency", "Check currency")}<select name="currency" required><option value="USD">${t(localizer, "onboarding.currency.usd", "US dollar (USD)")}</option><option value="CAD">${t(localizer, "onboarding.currency.cad", "Canadian dollar (CAD)")}</option></select></label>
        <label>${t(localizer, "language.title", "App language")}<select name="locale"><option value="en-US">${t(localizer, "language.enUS", "English (United States)")}</option><option value="en-CA">${t(localizer, "language.enCA", "English (Canada)")}</option><option value="fr-CA">${t(localizer, "language.frCA", "Français (Canada)")}</option></select></label>
        <label>${t(localizer, "onboarding.nextNumber", "Next physical check number")}<input name="nextCheckNumber" type="number" min="1" step="1" required></label>
        <div class="form-actions span-all">${actionButton(t(localizer, "action.continue", "Continue"), "SUBMIT", "primary")}</div>
      </form>`;
  } else if (model.route === "ONBOARDING_LAYOUT") {
    const cards = [
      ["VOUCHER_TOP", "onboarding.layout.top", "layout-top"],
      ["VOUCHER_MIDDLE", "onboarding.layout.middle", "layout-middle"],
      ["VOUCHER_BOTTOM", "onboarding.layout.bottom", "layout-bottom"],
      ["THREE_UP", "onboarding.layout.threeUp", "layout-three"],
    ].map(([value, key, css]) => `<label class="choice-card"><input type="radio" name="layout" value="${value}" ${value === "VOUCHER_TOP" ? "checked" : ""}><span class="stock-diagram ${css}" aria-hidden="true"><i></i><i></i><i></i></span><strong>${t(localizer, key, value)}</strong></label>`).join("");
    content = `<h2>${t(localizer, "onboarding.layout", "Choose the layout that matches your stock")}</h2><form data-ui-form="ONBOARDING_LAYOUT"><div class="choice-grid">${cards}</div><label class="inline-field">${t(localizer, "onboarding.slot", "First unused position")}<select name="startSlot"><option value="0">${t(localizer, "onboarding.slot.top", "Top")}</option><option value="1">${t(localizer, "onboarding.slot.middle", "Middle")}</option><option value="2">${t(localizer, "onboarding.slot.bottom", "Bottom")}</option></select></label><div class="form-actions">${actionButton(t(localizer, "action.continue", "Continue"), "SUBMIT", "primary")}</div></form>`;
  } else if (model.route === "ONBOARDING_PRINTER") {
    content = `<h2>${t(localizer, "onboarding.printer", "Choose the printer used for this stock")}</h2><p>${t(localizer, "state.printer.idle.body", "Choose a Windows printer or Microsoft Print to PDF.")}</p><form data-ui-form="ONBOARDING_PRINTER"><label>${t(localizer, "printer.title", "Printer")}<select name="printerKey" required>${model.printers.map((printer) => `<option value="${escapeHtml(printer.key)}">${escapeHtml(printer.displayName)}${printer.isDefault ? ` · ${t(localizer, "printer.windowsDefault", "Windows default")}` : ""}</option>`).join("")}</select></label><div class="form-actions">${actionButton(t(localizer, "action.continue", "Continue"), "SUBMIT", "primary")}${actionButton(t(localizer, "printer.refresh", "Refresh printers"), "REFRESH_PRINTERS")}</div></form>`;
  } else {
    content = `<h2>${t(localizer, "calibration.title", "Calibration")}</h2><p>${t(localizer, "onboarding.calibration.body", "Print on plain Letter paper at 100% and compare it with your stock.")}</p><div class="callout warning">${icon("ruler-measure")}<div><strong>${t(localizer, "onboarding.sampleReminder", "Use plain paper until alignment is correct.")}</strong><span>${t(localizer, "help.scale", "Choose 100% or Actual size.")}</span></div></div><form data-ui-form="ONBOARDING_CALIBRATION"><label>${t(localizer, "stock.name", "Profile name")}<input name="name" required value="Microsoft Print to PDF · Voucher"></label><div class="form-actions">${actionButton(t(localizer, "action.finishSetup", "Finish setup"), "SUBMIT", "primary")}${actionButton(t(localizer, "action.printCalibration", "Print calibration sheet"), "PRINT_CALIBRATION")}</div></form>`;
  }
  return `${progress}<section class="onboarding-card">${content}</section>`;
}

function renderCheques(model: ChequesViewModel, localizer: UiLocalizer): string {
  const checks = [...model.drafts, ...model.ready, ...model.unresolved, ...model.recent]
    .filter((check, index, all) => all.findIndex((candidate) => candidate.id === check.id) === index);
  const body = checks.length
    ? `<section class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>${t(localizer, "register.column.number", "Number")}</th><th>${t(localizer, "register.column.date", "Date")}</th><th>${t(localizer, "register.column.payee", "Payee")}</th><th class="numeric">${t(localizer, "register.column.amount", "Amount")}</th><th>${t(localizer, "register.column.status", "Status")}</th><th><span class="sr-only">${t(localizer, "dashboard.quickActions", "Actions")}</span></th></tr></thead><tbody>${checkRows(localizer, checks, true)}</tbody></table></div></section>`
    : emptyPanel(t(localizer, "state.common.empty.title", "Nothing here yet"), t(localizer, "state.cheque.empty.body", "Create a new check."));
  return `${heading(t(localizer, "nav.cheques", "Checks"), t(localizer, "state.cheque.idle.body", "Create and manage checks."))}${body}`;
}

function amountInputValue(model: ChequeEditorViewModel): string {
  return model.draft ? (model.draft.amountCents / 100).toFixed(2) : "";
}

function renderChequeEditor(model: ChequeEditorViewModel, localizer: UiLocalizer): string {
  if (!model.account) return emptyPanel(t(localizer, "error.accountRequired", "Choose an account"), t(localizer, "state.account.empty.body", "Add an account first."), routeButton(t(localizer, "action.addAccount", "Add account"), "SETTINGS_ACCOUNTS", "primary"));
  const draft = model.draft;
  const today = new Date().toISOString().slice(0, 10);
  return `${heading(t(localizer, "route.newCheque", "New check"), `${escapeHtml(model.account.name)} · ${escapeHtml(model.account.currency)} · #${escapeHtml(model.checkNumber ?? model.account.nextCheckNumber)}`)}
  <form class="editor-layout" data-ui-form="CHEQUE_EDITOR" data-draft="${draft ? "true" : "false"}">
    <section class="panel form-panel"><div class="panel-heading"><div><h2>${t(localizer, "state.cheque.idle.body", "Enter check details")}</h2><p>${t(localizer, "cheque.unsaved", "Draft changes save automatically.")}</p></div></div><div class="form-grid panel-body">
      <label class="span-all">${t(localizer, "cheque.payee", "Pay to the order of")}<select name="payeeId" required><option value="">${t(localizer, "error.payeeRequired", "Choose a payee")}</option>${model.payees.map((payee) => `<option value="${escapeHtml(payee.id)}" ${payee.id === draft?.payeeId ? "selected" : ""}>${escapeHtml(payee.name)}</option>`).join("")}</select><span class="field-help">${routeButton(t(localizer, "cheque.newPayee", "New payee"), "PAYEES")}</span></label>
      <label>${t(localizer, "cheque.date", "Date")}<input name="issueDate" type="date" required value="${escapeHtml(draft?.issueDate ?? today)}"><span class="field-help">${t(localizer, "cheque.date.help", "Confirm the date required on the physical check.")}</span></label>
      <label>${t(localizer, "cheque.amount", "Amount")}<div class="input-prefix"><span>${escapeHtml(model.account.currency)}</span><input name="amount" inputmode="decimal" required placeholder="0.00" value="${escapeHtml(amountInputValue(model))}"></div><span class="field-help">${t(localizer, "cheque.amount.help", "Enter numbers only.")}</span></label>
      <label class="span-all">${t(localizer, "cheque.memo", "Memo")}<input name="memo" maxlength="55" value="${escapeHtml(draft?.memo ?? "")}"><span class="field-help">${t(localizer, "cheque.memo.help", "Optional. It appears on the check and voucher.")}</span></label>
      <label class="span-all">${t(localizer, "cheque.category", "Category (optional)")}<input name="category" maxlength="80" value="${escapeHtml(draft?.category ?? "")}"></label>
      <div class="form-actions span-all">${actionButton(t(localizer, "action.review", "Review"), "SUBMIT_REVIEW", "primary")}${draft ? actionButton(t(localizer, "action.save", "Save"), "SUBMIT_SAVE") : ""}${routeButton(t(localizer, "action.cancel", "Cancel"), "CHEQUES")}</div>
    </div></section>
    <aside class="panel cheque-summary"><div class="panel-heading"><div><h2>${t(localizer, "cheque.number", "Check number")}</h2><p>${t(localizer, "cheque.numberConfirmation", "Confirm the physical number", { number: model.checkNumber ?? model.account.nextCheckNumber })}</p></div></div><div class="number-display">#${escapeHtml(model.checkNumber ?? model.account.nextCheckNumber)}</div><dl><div><dt>${t(localizer, "cheque.account", "Account")}</dt><dd>${escapeHtml(model.account.name)}</dd></div><div><dt>${t(localizer, "cheque.currency", "Currency")}</dt><dd>${escapeHtml(model.account.currency)}</dd></div></dl></aside>
  </form>`;
}

function previewElement(element: PrintElement): string {
  if (element.kind === "line") {
    const width = Math.hypot(element.x2Pt - element.x1Pt, element.y2Pt - element.y1Pt);
    const angle = Math.atan2(element.y2Pt - element.y1Pt, element.x2Pt - element.x1Pt) * 180 / Math.PI;
    return `<span class="preview-line" style="left:${element.x1Pt}px;top:${element.y1Pt}px;width:${width}px;border-top-width:${element.strokeWidthPt}px;transform:rotate(${angle}deg)"></span>`;
  }
  return `<span class="preview-text" data-role="${escapeHtml(element.role)}" style="left:${element.xPt}px;top:${element.yPt}px;width:${element.widthPt}px;height:${element.heightPt}px;font-size:${element.fontSizePt}px;text-align:${element.align}">${escapeHtml(element.text)}</span>`;
}

function exactPreview(model: ChequeReviewViewModel): string {
  if (!model.preview) return "";
  return `<div class="preview-scroll" tabindex="0"><div class="letter-page" aria-hidden="true">${model.preview.plan.pages[0]?.elements.map(previewElement).join("") ?? ""}</div></div>`;
}

function renderChequeReview(model: ChequeReviewViewModel, localizer: UiLocalizer): string {
  if (!model.check || !model.account) return emptyPanel(t(localizer, "cheque.previewUnavailable", "Preview unavailable"), t(localizer, "ui.route.draftRequired", "Create a draft first."));
  const check = model.check;
  return `${heading(t(localizer, "route.reviewCheque", "Review check"), t(localizer, "cheque.review.body", "Confirm every detail before using check stock."))}
  <div class="review-layout"><section class="panel preview-panel"><div class="panel-heading"><div><h2>${t(localizer, "cheque.preview", "Exact PDF preview")}</h2><p>${t(localizer, "help.pdf", "The saved PDF uses the same locked layout as the print output.")}</p></div><span class="verified-badge">${icon("shield-check")} ${t(localizer, "output.integrityReady", "PDF integrity verified")}</span></div>${exactPreview(model)}</section>
  <aside class="panel review-summary"><div class="panel-heading"><div><h2>${t(localizer, "cheque.review.title", "Review every detail")}</h2></div></div><dl>
    <div><dt>${t(localizer, "cheque.number", "Check number")}</dt><dd>#${escapeHtml(check.checkNumber)}</dd></div>
    <div><dt>${t(localizer, "cheque.date", "Date")}</dt><dd>${escapeHtml(localizer.date(check.issueDate))}</dd></div>
    <div><dt>${t(localizer, "cheque.payee", "Payee")}</dt><dd>${escapeHtml(check.payeeSnapshot.name)}</dd></div>
    <div><dt>${t(localizer, "cheque.amount", "Amount")}</dt><dd>${escapeHtml(localizer.moneyFromMinorUnits(check.amountCents, check.currency))}</dd></div>
    <div><dt>${t(localizer, "cheque.memo", "Memo")}</dt><dd>${escapeHtml(check.memo || "—")}</dd></div>
    <div><dt>${t(localizer, "output.stock", "Stock")}</dt><dd>${escapeHtml(model.profile?.layout ?? "—")}</dd></div>
  </dl>${model.warnings.length ? `<div class="callout warning">${model.warnings.map((warning) => `<span>${escapeHtml(message(localizer, warning))}</span>`).join("")}</div>` : ""}<div class="stack-actions">${actionButton(t(localizer, "action.continue", "Choose output"), "OPEN_OUTPUT", "primary", model.canQueue ? "" : "disabled")}${actionButton(t(localizer, "action.edit", "Edit"), "EDIT_REVIEWED_CHEQUE")}</div></aside></div>`;
}

function renderOutput(model: OutputViewModel, localizer: UiLocalizer): string {
  const profile = model.profile;
  const status = model.liveJobReady
    ? `<div class="callout success">${icon("shield-check")}<div><strong>${t(localizer, "output.integrityReady", "PDF integrity verified")}</strong><span>${t(localizer, "output.liveWarning", "This live PDF can produce a negotiable check.")}</span></div></div>`
    : `<div class="callout warning">${icon("alert-triangle")}<div><strong>${t(localizer, "cheque.review.title", "Review every detail")}</strong><span>${t(localizer, "output.liveWarning", "This live PDF can produce a negotiable check.")}</span></div></div>`;
  return `${heading(t(localizer, "output.title", "Choose a safe output"), t(localizer, "output.actualSizeRequired", "Scale must be 100% or Actual size."))}
  <div class="output-grid"><section class="panel output-primary"><div class="panel-heading"><div><h2>${t(localizer, "output.savePdf", "Save the exact Letter-size PDF")}</h2><p>${t(localizer, "output.noFit", "Turn off Fit and Shrink.")}</p></div></div><div class="panel-body">${status}<dl class="details-grid"><div><dt>${t(localizer, "output.printer", "Selected printer")}</dt><dd>${escapeHtml(model.selectedPrinterKey ?? profile?.printerKey ?? "—")}</dd></div><div><dt>${t(localizer, "output.stock", "Selected stock")}</dt><dd>${escapeHtml(profile?.layout ?? "—")}</dd></div><div><dt>${t(localizer, "output.startSlot", "Starting position")}</dt><dd>${escapeHtml(model.startSlot + 1)}</dd></div></dl><div class="form-actions">${model.liveJobReady ? `${actionButton(`${icon("file-type-pdf")} ${t(localizer, "action.savePdf", "Save PDF")}`, "SAVE_QUEUED_PDF", "primary")}${actionButton(`${icon("printer")} ${t(localizer, "action.print", "Print")}`, "PRINT_QUEUED")}` : actionButton(t(localizer, "action.confirm", "Queue verified output"), "QUEUE_LIVE_OUTPUT", "primary")}${routeButton(t(localizer, "action.back", "Back"), "CHEQUE_REVIEW")}</div></div></section>
  <aside class="panel"><div class="panel-heading"><div><h2>${t(localizer, "output.sample", "Non-negotiable sample")}</h2><p>${t(localizer, "output.sampleHelp", "Samples and calibration sheets are always free.")}</p></div></div><div class="panel-body stack-actions">${actionButton(t(localizer, "action.useSample", "Try a free sample"), "SAVE_SAMPLE_PDF")}${actionButton(t(localizer, "action.printCalibration", "Print calibration sheet"), "SAVE_CALIBRATION_PDF")}</div></aside></div>`;
}

function renderPrintOutcome(model: PrintOutcomeViewModel, localizer: UiLocalizer): string {
  const number = model.checks[0]?.checkNumber;
  return `${heading(t(localizer, "print.outcome.title", "What happened to the physical check?"), number ? `#${escapeHtml(number)}` : t(localizer, "print.awaitingOutcome", "Confirm the physical result."))}
  <div class="outcome-grid">
    <button class="outcome-card success" type="button" data-ui-action="OUTCOME_CORRECT">${icon("circle-check")}<strong>${t(localizer, "print.outcome.correct", "Printed correctly")}</strong><span>${t(localizer, "print.outcome.correctHelp", "Record the check as printed.")}</span></button>
    <button class="outcome-card warning" type="button" data-ui-action="OUTCOME_PROBLEM">${icon("alert-triangle")}<strong>${t(localizer, "print.outcome.problem", "Paper was marked, but something is wrong")}</strong><span>${t(localizer, "print.outcome.problemHelp", "Mark this number as spoiled.")}</span></button>
    <button class="outcome-card" type="button" data-ui-action="OUTCOME_NONE">${icon("printer-off")}<strong>${t(localizer, "print.outcome.none", "Nothing printed")}</strong><span>${t(localizer, "print.outcome.noneHelp", "Use only when no output was produced.")}</span></button>
  </div><div class="callout warning outcome-warning">${icon("shield-exclamation")}<div><strong>${t(localizer, "print.outcome.required", "Choose the result that matches the paper.")}</strong><span>${t(localizer, "print.outcome.unknown", "If paper may have been marked, choose the problem option.")}</span></div></div>`;
}

function renderRegister(model: RegisterViewModel, localizer: UiLocalizer): string {
  const rows = model.rows.map((row) => `<tr><td>${escapeHtml(row.accountName)}</td><td class="mono">${escapeHtml(row.checkNumber)}</td><td>${escapeHtml(localizer.date(row.issueDate))}</td><td><strong>${escapeHtml(row.payeeName)}</strong><small>${escapeHtml(row.memo)}</small></td><td class="numeric">${escapeHtml(localizer.moneyFromMinorUnits(row.amountCents, row.currency))}</td><td>${statusBadge(localizer, row.status)}</td><td>${row.status === "PRINTED" ? actionButton(row.clearedDate ? t(localizer, "register.markNotCleared", "Mark as not cleared") : t(localizer, "register.markCleared", "Mark as cleared"), "TOGGLE_CLEARED", "secondary", `data-check-id="${escapeHtml(row.checkId)}" data-cleared="${Boolean(row.clearedDate)}"`) : ""}</td></tr>`).join("");
  const totals = Object.entries(model.report.totals.byCurrency).map(([currency, value]) => `<article class="metric-card"><span>${escapeHtml(currency)} · ${t(localizer, "register.total.selected", "Selected total")}</span><strong>${escapeHtml(localizer.moneyFromMinorUnits(value?.totalCents ?? 0, currency as "USD" | "CAD"))}</strong><small>${t(localizer, "register.results.other", `${model.rows.length} checks`, { count: model.rows.length })}</small></article>`).join("");
  return `${heading(t(localizer, "register.title", "Check register"), t(localizer, "register.notBalance", "These are check totals, not a bank balance."), actionButton(`${icon("download")} ${t(localizer, "action.exportCsv", "Export CSV")}`, "SAVE_REGISTER_CSV"))}
  <section class="panel filter-panel"><form class="filter-grid" data-ui-form="REGISTER_FILTER"><label>${t(localizer, "register.search", "Search checks")}<input name="payeeQuery" value="${escapeHtml(model.query.payeeQuery ?? "")}" placeholder="${escapeHtml(t(localizer, "register.searchPlaceholder", "Number, payee, account or memo"))}"></label><label>${t(localizer, "register.filter.dateFrom", "From date")}<input type="date" name="issueDateFrom" value="${escapeHtml(model.query.issueDateFrom ?? "")}"></label><label>${t(localizer, "register.filter.dateTo", "To date")}<input type="date" name="issueDateTo" value="${escapeHtml(model.query.issueDateTo ?? "")}"></label><div class="form-actions">${actionButton(t(localizer, "action.apply", "Apply"), "SUBMIT", "primary")}${actionButton(t(localizer, "action.clearFilters", "Clear filters"), "CLEAR_REGISTER_FILTERS")}</div></form></section>
  ${totals ? `<section class="metric-grid register-metrics">${totals}</section>` : ""}
  ${model.rows.length ? `<section class="panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>${t(localizer, "register.column.account", "Account")}</th><th>${t(localizer, "register.column.number", "Number")}</th><th>${t(localizer, "register.column.date", "Date")}</th><th>${t(localizer, "register.column.payee", "Payee")}</th><th class="numeric">${t(localizer, "register.column.amount", "Amount")}</th><th>${t(localizer, "register.column.status", "Status")}</th><th><span class="sr-only">${t(localizer, "dashboard.quickActions", "Actions")}</span></th></tr></thead><tbody>${rows}</tbody></table></div></section>` : emptyPanel(t(localizer, "state.common.empty.title", "Nothing here yet"), t(localizer, "register.empty", "Printed checks will appear here automatically."))}`;
}

function renderPayees(model: PayeesViewModel, localizer: UiLocalizer): string {
  const selected = model.selectedPayee;
  const rows = model.payees.map((payee) => `<tr><td><strong>${escapeHtml(payee.name)}</strong><small>${escapeHtml(payee.defaultMemo ?? "")}</small></td><td>${escapeHtml(payee.address ? `${payee.address.city}, ${payee.address.region}` : "—")}</td><td class="row-actions">${actionButton(t(localizer, "action.edit", "Edit"), "SELECT_PAYEE", "secondary", `data-payee-id="${escapeHtml(payee.id)}"`)}${actionButton(t(localizer, "action.archive", "Archive"), "ARCHIVE_PAYEE", "secondary", `data-payee-id="${escapeHtml(payee.id)}"`)}</td></tr>`).join("");
  return `${heading(t(localizer, "payee.title", "Payees"), t(localizer, "state.payee.idle.body", "Choose a saved payee or add a new one."))}<div class="management-grid"><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "payee.title", "Payees")}</h2><p>${t(localizer, "payee.search", "Search payees")}</p></div></div>${rows ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t(localizer, "payee.name", "Payee name")}</th><th>${t(localizer, "payee.address", "Address")}</th><th><span class="sr-only">${t(localizer, "dashboard.quickActions", "Actions")}</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty-message compact-empty"><strong>${t(localizer, "payee.empty", "Add a payee now.")}</strong></div>`}</section>
  <aside class="panel"><div class="panel-heading"><div><h2>${selected ? t(localizer, "action.edit", "Edit") : t(localizer, "action.addPayee", "Add payee")}</h2><p>${t(localizer, "app.dataSaved", "Changes save automatically.")}</p></div></div><form class="form-grid panel-body" data-ui-form="PAYEE" data-payee-id="${escapeHtml(selected?.id ?? "")}"><label class="span-all">${t(localizer, "payee.name", "Payee name")}<input name="name" required maxlength="80" value="${escapeHtml(selected?.name ?? "")}"></label><label class="span-all">${t(localizer, "payee.defaultMemo", "Default memo (optional)")}<input name="defaultMemo" maxlength="55" value="${escapeHtml(selected?.defaultMemo ?? "")}"></label><div class="form-actions span-all">${actionButton(t(localizer, "action.save", "Save"), "SUBMIT", "primary")}${selected ? actionButton(t(localizer, "action.cancel", "Cancel"), "CLEAR_PAYEE_SELECTION") : ""}</div></form><div class="panel-divider"></div><div class="panel-body"><label class="file-picker">${t(localizer, "payee.import.title", "Import payees from CSV")}<input type="file" accept=".csv,text/csv" data-ui-file="IMPORT_PAYEES"></label></div></aside></div>`;
}

function settingsCards(localizer: UiLocalizer): string {
  const items = [
    ["SETTINGS_ACCOUNTS", "building-bank", "settings.accounts", "state.account.idle.body"],
    ["SETTINGS_STOCK", "file-certificate", "settings.stock", "state.calibration.idle.body"],
    ["SETTINGS_CALIBRATION", "ruler-measure", "settings.calibration", "calibration.instructions"],
    ["SETTINGS_BACKUP", "database-export", "settings.backup", "backup.body"],
    ["SETTINGS_LANGUAGE", "language", "settings.language", "language.restartNotRequired"],
    ["SETTINGS_PURCHASE", "sparkles", "settings.purchase", "purchase.summary"],
    ["SETTINGS_PRIVACY", "shield-lock", "settings.privacy", "privacy.localOnly"],
    ["HELP", "help-circle", "help.title", "help.alignment"],
  ];
  return `<div class="settings-grid">${items.map(([route, iconName, titleKey, bodyKey]) => `<button class="settings-card" type="button" data-route-target="${route}">${icon(iconName)}<span><strong>${t(localizer, titleKey, titleKey)}</strong><small>${t(localizer, bodyKey, bodyKey)}</small></span>${icon("chevron-right")}</button>`).join("")}</div>`;
}

function accountSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  return `<div class="management-grid"><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "account.title", "Accounts")}</h2><p>${t(localizer, "account.numberPrivacy", "Do not enter bank credentials.")}</p></div></div><div class="card-list">${model.accounts.map((account) => `<article class="management-card"><div><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.companyName)} · ${escapeHtml(account.bankCountry ?? "")} · ${escapeHtml(account.currency)}</span></div><div class="number-tag">#${escapeHtml(account.nextCheckNumber)}</div><div class="row-actions">${actionButton(t(localizer, "action.confirmNumber", "Confirm physical number"), "CONFIRM_CHECK_NUMBER", "secondary", `data-account-id="${escapeHtml(account.id)}" data-number="${account.nextCheckNumber}"`)}${actionButton(t(localizer, "action.archive", "Archive"), "ARCHIVE_ACCOUNT", "secondary", `data-account-id="${escapeHtml(account.id)}"`)}</div></article>`).join("") || `<p class="panel-body">${t(localizer, "empty.accounts", "Add an account to start setup.")}</p>`}</div></section><aside class="panel"><div class="panel-heading"><div><h2>${t(localizer, "action.addAccount", "Add account")}</h2></div></div><form class="form-grid panel-body" data-ui-form="ACCOUNT"><label class="span-all">${t(localizer, "account.name", "Account nickname")}<input name="name" required maxlength="80"></label><label class="span-all">${t(localizer, "account.company", "Company name")}<input name="companyName" required maxlength="120"></label><label>${t(localizer, "account.jurisdiction", "Bank jurisdiction")}<select name="bankCountry"><option value="US">${t(localizer, "onboarding.country.us", "United States")}</option><option value="CA">${t(localizer, "onboarding.country.ca", "Canada")}</option></select></label><label>${t(localizer, "account.currency", "Currency")}<select name="currency"><option value="USD">USD</option><option value="CAD">CAD</option></select></label><label>${t(localizer, "language.title", "Language")}<select name="locale"><option value="en-US">${t(localizer, "language.enUS", "English (US)")}</option><option value="en-CA">${t(localizer, "language.enCA", "English (Canada)")}</option><option value="fr-CA">${t(localizer, "language.frCA", "Français (Canada)")}</option></select></label><label>${t(localizer, "account.nextNumber", "Next physical check number")}<input type="number" min="1" step="1" name="nextCheckNumber" required></label><div class="form-actions span-all">${actionButton(t(localizer, "action.save", "Save"), "SUBMIT", "primary")}</div></form></aside></div>`;
}

function stockSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  const cards = model.profiles.map((profile) => `<article class="stock-card"><span class="stock-diagram ${profile.layout === "THREE_UP" ? "layout-three" : profile.layout === "VOUCHER_MIDDLE" ? "layout-middle" : profile.layout === "VOUCHER_BOTTOM" ? "layout-bottom" : "layout-top"}" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>${escapeHtml(profile.name)}</strong><span>${escapeHtml(profile.layout)} · ${escapeHtml(profile.printerKey)}</span><small>${escapeHtml(profile.stockKey)}</small></div>${actionButton(t(localizer, "action.manage", "Manage"), "SELECT_CALIBRATION", "secondary", `data-profile-id="${escapeHtml(profile.id)}"`)}</article>`).join("");
  return cards ? `<div class="stock-grid">${cards}</div>` : emptyPanel(t(localizer, "state.common.empty.title", "Nothing here yet"), t(localizer, "empty.stock", "Add a stock profile and calibrate it."), routeButton(t(localizer, "settings.calibration", "Calibration"), "SETTINGS_CALIBRATION", "primary"));
}

function calibrationSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  return `<div class="management-grid"><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "calibration.title", "Calibration")}</h2><p>${t(localizer, "calibration.instructions", "Print the ruler sheet and measure the difference.")}</p></div></div><div class="panel-body"><div class="callout warning">${icon("ruler-measure")}<div><strong>${t(localizer, "output.actualSizeRequired", "Scale must be 100%.")}</strong><span>${t(localizer, "help.scale", "Turn off Fit and Shrink.")}</span></div></div><div class="form-actions callout-actions">${actionButton(t(localizer, "action.printCalibration", "Print calibration sheet"), "SAVE_CALIBRATION_PDF", "primary")}${actionButton(t(localizer, "action.printSample", "Print free sample"), "SAVE_SAMPLE_PDF")}</div></div></section><aside class="panel"><div class="panel-heading"><div><h2>${t(localizer, "stock.title", "Stock profiles")}</h2></div></div><form class="form-grid panel-body" data-ui-form="CALIBRATION"><label class="span-all">${t(localizer, "account.title", "Account")}<select name="accountId" required>${model.accounts.filter((account) => !account.archived).map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join("")}</select></label><label class="span-all">${t(localizer, "stock.name", "Profile name")}<input name="name" required value="Voucher stock"></label><label class="span-all">${t(localizer, "printer.title", "Printer")}<select name="printerKey" required>${model.printers.map((printer) => `<option value="${escapeHtml(printer.key)}">${escapeHtml(printer.displayName)}</option>`).join("")}</select></label><label class="span-all">${t(localizer, "stock.layout", "Page layout")}<select name="layout"><option value="VOUCHER_TOP">${t(localizer, "onboarding.layout.top", "Check on top")}</option><option value="VOUCHER_MIDDLE">${t(localizer, "onboarding.layout.middle", "Check in middle")}</option><option value="VOUCHER_BOTTOM">${t(localizer, "onboarding.layout.bottom", "Check on bottom")}</option><option value="THREE_UP">${t(localizer, "onboarding.layout.threeUp", "Three checks")}</option></select></label><div class="form-actions span-all">${actionButton(t(localizer, "action.save", "Save"), "SUBMIT", "primary")}</div></form></aside></div>`;
}

function backupSettings(localizer: UiLocalizer): string {
  return `<div class="management-grid"><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "backup.title", "Encrypted backup")}</h2><p>${t(localizer, "backup.body", "Choose a separate backup passphrase.")}</p></div></div><form class="form-grid panel-body" data-ui-form="BACKUP"><label class="span-all">${t(localizer, "backup.passphrase", "Backup passphrase")}<input type="password" name="passphrase" minlength="12" required autocomplete="new-password"></label><label class="span-all">${t(localizer, "backup.confirmPassphrase", "Confirm passphrase")}<input type="password" name="confirmPassphrase" minlength="12" required autocomplete="new-password"></label><p class="field-help span-all">${t(localizer, "backup.passphraseHelp", "Use at least 12 characters.")}</p><div class="form-actions span-all">${actionButton(t(localizer, "action.createBackup", "Create encrypted backup"), "SUBMIT", "primary")}</div></form></section><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "restore.title", "Restore an encrypted backup")}</h2><p>${t(localizer, "restore.warning", "Restoring may replace local records.")}</p></div></div><form class="form-grid panel-body" data-ui-form="RESTORE"><label class="span-all">${t(localizer, "restore.passphrase", "Backup passphrase")}<input type="password" name="passphrase" required autocomplete="current-password"></label><div class="callout warning span-all">${t(localizer, "restore.safetyCopy", "A safety copy will be created before restore.")}</div><div class="form-actions span-all">${actionButton(t(localizer, "action.restoreBackup", "Restore backup"), "SUBMIT", "danger")}</div></form></section></div>`;
}

function languageSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  return `<section class="panel narrow-panel"><div class="panel-heading"><div><h2>${t(localizer, "language.title", "App language")}</h2><p>${t(localizer, "language.restartNotRequired", "The app updates immediately.")}</p></div></div><form class="language-list" data-ui-form="LANGUAGE">${(["en-US", "en-CA", "fr-CA"] as const).map((locale) => `<label class="choice-row"><input type="radio" name="locale" value="${locale}" ${locale === model.locale ? "checked" : ""}><span><strong>${t(localizer, locale === "en-US" ? "language.enUS" : locale === "en-CA" ? "language.enCA" : "language.frCA", locale)}</strong><small>${locale}</small></span></label>`).join("")}<div class="form-actions">${actionButton(t(localizer, "action.apply", "Apply"), "SUBMIT", "primary")}</div></form></section>`;
}

function purchaseSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  const lifetime = model.commerce.entitlement === "LIFETIME";
  const price = model.commerce.price?.formattedPrice;
  return `<section class="purchase-card"><div class="hero-icon">${icon(lifetime ? "rosette-discount-check" : "sparkles")}</div><h2>${lifetime ? t(localizer, "purchase.status.lifetime", "Lifetime Unlock is active.") : t(localizer, "purchase.title", "Lifetime Unlock")}</h2><p>${t(localizer, "purchase.summary", "Print unlimited real checks with a one-time purchase.")}</p>${price ? `<strong class="purchase-price">${escapeHtml(t(localizer, "purchase.price", `One-time purchase: ${price}`, { price }))}</strong>` : `<div class="callout warning">${t(localizer, "purchase.bridgeUnavailable", "Install the Microsoft Store version to buy or restore.")}</div>`}<ul class="check-list"><li>${t(localizer, "purchase.noRenewal", "This is not a subscription.")}</li><li>${t(localizer, "purchase.microsoft", "Payment and licensing are handled by Microsoft Store.")}</li><li>${t(localizer, "purchase.freeDisclosure", "The first 3 real checks are free.")}</li></ul><div class="form-actions">${lifetime ? "" : actionButton(t(localizer, "action.buyLifetime", "Buy Lifetime Unlock"), "PURCHASE_LIFETIME", "primary", price ? "" : "disabled")}${actionButton(t(localizer, "action.restorePurchase", "Restore purchase"), "RESTORE_LIFETIME")}</div></section>`;
}

function privacySettings(localizer: UiLocalizer): string {
  return `<div class="privacy-grid"><article class="panel policy-card policy-card-text"><h2>${t(localizer, "privacy.localOnly", "Check records stay encrypted on this device.")}</h2><p>${t(localizer, "privacy.exportWarning", "Exported files are outside encrypted storage.")}</p></article><article class="panel policy-card">${icon("cloud-off")}<h2>${t(localizer, "privacy.noTracking", "No account, cloud sync, telemetry or advertising.")}</h2><p>${t(localizer, "onboarding.noBankConnection", "This app does not connect to your bank.")}</p></article><article class="panel policy-card policy-card-text"><h2>${t(localizer, "privacy.store", "Microsoft processes Store purchases.")}</h2><p>${t(localizer, "purchase.microsoft", "Payment and licensing are handled by Microsoft Store.")}</p></article><article class="panel policy-card">${icon("file-certificate")}<h2>${t(localizer, "terms.preprinted", "For compatible preprinted business check stock only.")}</h2><p>${t(localizer, "terms.noAcceptanceWarranty", "Your bank decides whether a check is acceptable.")}</p></article></div>`;
}

function helpView(localizer: UiLocalizer): string {
  return `<div class="help-layout"><section class="panel"><div class="panel-heading"><div><h2>${t(localizer, "help.firstCheque", "Print your first check")}</h2></div></div><ol class="numbered-guide"><li>${t(localizer, "help.paper", "Use compatible preprinted business check stock.")}</li><li>${t(localizer, "help.alignment", "Use a plain-paper sample and calibration ruler.")}</li><li>${t(localizer, "help.scale", "Choose 100% or Actual size.")}</li><li>${t(localizer, "help.pdf", "The saved PDF uses the locked print layout.")}</li></ol></section><aside class="panel"><div class="panel-heading"><div><h2>${t(localizer, "help.troubleshooting", "Troubleshooting")}</h2></div></div><div class="panel-body"><div class="callout warning">${icon("info-circle")}<div><strong>${t(localizer, "help.micr", "The app does not print MICR bank information.")}</strong><span>${t(localizer, "onboarding.preprinted.body", "Preprinted stock is required.")}</span></div></div><div class="callout-actions">${routeButton(t(localizer, "settings.calibration", "Printers and calibration"), "SETTINGS_CALIBRATION", "primary")}</div></div></aside></div>`;
}

function renderSettings(model: SettingsViewModel, localizer: UiLocalizer): string {
  const route = model.route;
  const title = t(localizer, ROUTE_TITLES[route] ?? "nav.settings", "Settings");
  let body = settingsCards(localizer);
  if (route === "SETTINGS_ACCOUNTS") body = accountSettings(model, localizer);
  else if (route === "SETTINGS_STOCK") body = stockSettings(model, localizer);
  else if (route === "SETTINGS_CALIBRATION") body = calibrationSettings(model, localizer);
  else if (route === "SETTINGS_BACKUP") body = backupSettings(localizer);
  else if (route === "SETTINGS_LANGUAGE") body = languageSettings(model, localizer);
  else if (route === "SETTINGS_PURCHASE") body = purchaseSettings(model, localizer);
  else if (route === "SETTINGS_PRIVACY") body = privacySettings(localizer);
  return `${heading(title, t(localizer, "app.localOnly", "Local-only workspace"), route === "SETTINGS" ? "" : routeButton(t(localizer, "action.back", "Back"), "SETTINGS"))}${body}`;
}

function renderGeneric(model: AppViewModel, localizer: UiLocalizer): string {
  if (model.kind === "GENERIC" && model.route === "HELP") return `${heading(t(localizer, "help.title", "Printing guide"), t(localizer, "help.alignment", "Calibrate before live printing."))}${helpView(localizer)}`;
  if (model.kind === "GENERIC" && model.route === "CHEQUE_SUCCESS") {
    return `<section class="success-card"><div class="hero-icon success">${icon("circle-check")}</div><h2>${t(localizer, "route.chequeComplete", "Check complete")}</h2><p>${t(localizer, "state.print.success.body", "The outcome was recorded in the register.")}</p><div class="form-actions">${routeButton(t(localizer, "action.newCheque", "New check"), "CHEQUE_NEW", "primary")}${routeButton(t(localizer, "action.viewRegister", "View register"), "REGISTER")}</div></section>`;
  }
  const value = model.kind === "GENERIC" ? message(localizer, model.message) : t(localizer, "state.common.idle.body", "Ready");
  return emptyPanel(t(localizer, "state.common.idle.title", "Ready"), value, routeButton(t(localizer, "nav.home", "Home"), "HOME", "primary"));
}

export function renderOperationsView(context: RenderContext): void {
  const { shell, localizer, model, session } = context;
  const title = t(localizer, ROUTE_TITLES[model.route] ?? "app.name", model.route);
  shell.navigate(model.route, { title, focus: false });
  let html: string;
  if (model.kind === "HOME") html = renderHome(model, localizer);
  else if (model.kind === "ONBOARDING") html = renderOnboarding(model, localizer);
  else if (model.kind === "CHEQUES") html = renderCheques(model, localizer);
  else if (model.kind === "CHEQUE_EDITOR") html = renderChequeEditor(model, localizer);
  else if (model.kind === "CHEQUE_REVIEW") html = renderChequeReview(model, localizer);
  else if (model.kind === "CHEQUE_OUTPUT") html = renderOutput(model, localizer);
  else if (model.kind === "PRINT_OUTCOME") html = renderPrintOutcome(model, localizer);
  else if (model.kind === "REGISTER") html = renderRegister(model, localizer);
  else if (model.kind === "PAYEES") html = renderPayees(model, localizer);
  else if (model.kind === "SETTINGS") html = renderSettings(model, localizer);
  else html = renderGeneric(model, localizer);
  shell.workspaceOutlet.innerHTML = html;
  const account = "selectedAccount" in model ? model.selectedAccount : undefined;
  shell.setAccountContext(account?.name ?? t(localizer, "app.localOnly", "Local-only workspace"));
  const freeRemaining = model.kind === "HOME" ? model.freeRemaining : undefined;
  const lifetime = "commerce" in model && model.commerce.entitlement === "LIFETIME";
  shell.setLicenceStatus(
    lifetime ? t(localizer, "purchase.status.lifetime", "Lifetime Unlock is active.") : freeRemaining === undefined ? t(localizer, "purchase.status.free", "Free mode") : t(localizer, freeRemaining === 1 ? "home.freeRemaining.one" : freeRemaining === 0 ? "home.freeRemaining.none" : "home.freeRemaining.other", `${freeRemaining} remain`, { count: freeRemaining }),
    t(localizer, "purchase.freeDisclosure", "The first 3 real checks are free."),
  );
  document.documentElement.lang = session.locale;
  shell.clearState();
}
