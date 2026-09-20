export type ShellStateKind = "IDLE" | "LOADING" | "EMPTY" | "WARNING" | "ERROR" | "SUCCESS";
export type ShellMessageKind = "INFORMATION" | "WARNING" | "ERROR" | "SUCCESS";
export type ShellModalResult = "confirm" | "cancel";

export interface ShellAction {
  readonly label: string;
  readonly command: string;
}

export interface ShellState {
  readonly kind: ShellStateKind;
  readonly title: string;
  readonly body: string;
  readonly primaryAction?: ShellAction;
  readonly secondaryAction?: ShellAction;
}

export interface ShellModalOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: "INFORMATION" | "WARNING" | "DANGER";
  readonly destructive?: boolean;
}

export interface NavigationRequestDetail {
  readonly route: string;
  readonly source: "navigation" | "action" | "keyboard";
}

export interface CommandRequestDetail {
  readonly command: string;
  readonly source: "button" | "keyboard" | "state";
}

export function applyOperationsDeskLocalization(localizer: UiLocalizer, root: Document = document): void {
  root.documentElement.lang = localizer.locale;
  root.documentElement.dir = "ltr";
  root.title = localizer.text("app.name");
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = localizer.text(key);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-count]")) {
    const key = element.dataset.i18nCount;
    const count = Number(element.dataset.i18nCountValue);
    if (key && Number.isFinite(count)) element.textContent = localizer.count(key, count);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute("aria-label", localizer.text(key));
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-route-title]")) {
    const key = element.dataset.i18nRouteTitle;
    if (key) element.dataset.routeTitle = localizer.text(key);
  }
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required shell element is missing: ${selector}`);
  return element;
}

function dispatchNavigation(detail: NavigationRequestDetail): boolean {
  return window.dispatchEvent(new CustomEvent<NavigationRequestDetail>("worksbien:navigate", { detail, cancelable: true }));
}

function dispatchCommand(detail: CommandRequestDetail): boolean {
  return window.dispatchEvent(new CustomEvent<CommandRequestDetail>("worksbien:command", { detail, cancelable: true }));
}

export class OperationsDeskShell {
  readonly #root: HTMLElement;
  readonly #workspace: HTMLElement;
  readonly #stateSurface: HTMLElement;
  readonly #modal: HTMLDialogElement;
  readonly #announcer: HTMLElement;
  readonly #toastRegion: HTMLElement;
  readonly #busyLayer: HTMLElement;
  #modalResolver?: (result: ShellModalResult) => void;
  #modalReturnFocus?: HTMLElement;
  #localizer?: UiLocalizer;
  #activeRoute = "HOME";

  constructor(root: Document = document) {
    this.#root = requiredElement<HTMLElement>(root, "#app-shell");
    this.#workspace = requiredElement<HTMLElement>(root, "#workspace-outlet");
    this.#stateSurface = requiredElement<HTMLElement>(root, "#shell-state-surface");
    this.#modal = requiredElement<HTMLDialogElement>(root, "#shell-modal");
    this.#announcer = requiredElement<HTMLElement>(root, "#shell-announcer");
    this.#toastRegion = requiredElement<HTMLElement>(root, "#toast-region");
    this.#busyLayer = requiredElement<HTMLElement>(root, "#busy-layer");
    this.#bindShellEvents(root);
  }

  get activeRoute(): string { return this.#activeRoute; }
  get workspaceOutlet(): HTMLElement { return this.#workspace; }

  setLocalizer(localizer: UiLocalizer): void {
    this.#localizer = localizer;
    applyOperationsDeskLocalization(localizer);
    this.navigate(this.#activeRoute, { focus: false });
  }

  navigate(route: string, options: { title?: string; focus?: boolean } = {}): void {
    this.#activeRoute = route;
    this.#root.dataset.route = route;
    const navigationItems = document.querySelectorAll<HTMLElement>("[data-route-target]");
    const primaryRoute = route.startsWith("SETTINGS_")
      ? "SETTINGS"
      : route.startsWith("CHEQUE_")
        ? "CHEQUES"
        : route;
    for (const item of navigationItems) {
      if (item.closest(".primary-nav")) {
        if (item.dataset.routeTarget === primaryRoute) item.setAttribute("aria-current", "page");
        else item.removeAttribute("aria-current");
      }
    }
    const source = document.querySelector<HTMLElement>(`[data-route-target="${CSS.escape(route)}"]`);
    const title = options.title ?? source?.dataset.routeTitle;
    if (title) {
      requiredElement(document, "#page-title").textContent = title;
      document.title = `${title} — ${this.#localizer?.text("app.name") ?? "Check Printer & Check Writer"}`;
    }
    this.clearState();
    if (options.focus !== false) this.#workspace.focus({ preventScroll: true });
  }

  setAccountContext(label: string): void {
    requiredElement(document, "#account-context").textContent = label;
  }

  setLicenceStatus(value: string, detail: string): void {
    requiredElement(document, "#licence-status-value").textContent = value;
    requiredElement(document, "#licence-status-detail").textContent = detail;
  }

  setBusy(busy: boolean, label?: string): void {
    const resolvedLabel = label ?? this.#localizer?.text("state.common.loading.title") ?? "Working…";
    requiredElement(document, "#busy-label").textContent = resolvedLabel;
    this.#busyLayer.hidden = !busy;
    requiredElement(document, "#main-frame").setAttribute("aria-busy", String(busy));
    if (busy) this.announce(resolvedLabel, "polite");
  }

  showState(state: ShellState): void {
    this.#workspace.hidden = true;
    this.#stateSurface.hidden = false;
    this.#stateSurface.dataset.kind = state.kind;
    const urgent = state.kind === "ERROR" || state.kind === "WARNING";
    this.#stateSurface.setAttribute("role", urgent ? "alert" : "status");
    this.#stateSurface.setAttribute("aria-live", urgent ? "assertive" : "polite");
    requiredElement(this.#stateSurface, "#state-title").textContent = state.title;
    requiredElement(this.#stateSurface, "#state-body").textContent = state.body;
    this.#configureStateAction("#state-primary", state.primaryAction);
    this.#configureStateAction("#state-secondary", state.secondaryAction);
    this.#stateSurface.focus({ preventScroll: true });
    this.announce(`${state.title}. ${state.body}`, state.kind === "ERROR" ? "assertive" : "polite");
  }

  clearState(): void {
    this.#stateSurface.hidden = true;
    this.#workspace.hidden = false;
  }

  showBanner(kind: Exclude<ShellMessageKind, "INFORMATION">, title: string, body: string): void {
    const banner = requiredElement<HTMLElement>(document, "#status-banner");
    banner.dataset.kind = kind;
    banner.setAttribute("role", kind === "ERROR" ? "alert" : "status");
    requiredElement(banner, "#status-banner-title").textContent = title;
    requiredElement(banner, "#status-banner-body").textContent = body;
    banner.hidden = false;
  }

  dismissBanner(): void {
    requiredElement<HTMLElement>(document, "#status-banner").hidden = true;
  }

  async openModal(options: ShellModalOptions): Promise<ShellModalResult> {
    if (this.#modal.open) this.closeModal("cancel");
    this.#modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    requiredElement(this.#modal, "#modal-title").textContent = options.title;
    requiredElement(this.#modal, "#modal-body").textContent = options.body;
    const confirm = requiredElement<HTMLButtonElement>(this.#modal, "#modal-confirm");
    const cancel = requiredElement<HTMLButtonElement>(this.#modal, "#modal-cancel");
    confirm.textContent = options.confirmLabel ?? this.#localizer?.text("action.continue") ?? "Continue";
    cancel.textContent = options.cancelLabel ?? this.#localizer?.text("action.cancel") ?? "Cancel";
    confirm.className = `button ${options.destructive ? "button-danger" : "button-primary"}`;
    this.#modal.dataset.tone = options.tone ?? (options.destructive ? "DANGER" : "INFORMATION");
    requiredElement(this.#modal, "#modal-icon").textContent = options.destructive ? "!" : "i";
    this.#modal.showModal();
    cancel.focus();
    return new Promise<ShellModalResult>((resolve) => { this.#modalResolver = resolve; });
  }

  closeModal(result: ShellModalResult = "cancel"): void {
    if (this.#modal.open) {
      this.#modal.close(result);
      return;
    }
    const resolve = this.#modalResolver;
    this.#modalResolver = undefined;
    resolve?.(result);
    this.#restoreModalFocus();
  }

  toast(message: string, kind: ShellMessageKind = "INFORMATION", durationMs = 4200): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.kind = kind;
    toast.setAttribute("role", kind === "ERROR" ? "alert" : "status");
    toast.textContent = message;
    this.#toastRegion.append(toast);
    window.setTimeout(() => toast.remove(), Math.max(1200, durationMs));
  }

  announce(message: string, priority: "polite" | "assertive" = "polite"): void {
    this.#announcer.setAttribute("aria-live", priority);
    this.#announcer.textContent = "";
    window.setTimeout(() => { this.#announcer.textContent = message; }, 20);
  }

  #configureStateAction(selector: string, action?: ShellAction): void {
    const button = requiredElement<HTMLButtonElement>(this.#stateSurface, selector);
    button.hidden = !action;
    button.textContent = action?.label ?? "";
    if (action) button.dataset.stateCommand = action.command;
    else delete button.dataset.stateCommand;
  }

  #requestNavigation(route: string, source: NavigationRequestDetail["source"], title?: string): void {
    if (dispatchNavigation({ route, source })) this.navigate(route, { title });
  }

  #bindShellEvents(root: Document): void {
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const routeButton = target?.closest<HTMLElement>("[data-route-target]");
      if (routeButton?.dataset.routeTarget) {
        this.#requestNavigation(routeButton.dataset.routeTarget, routeButton.closest(".primary-nav") ? "navigation" : "action", routeButton.dataset.routeTitle);
        return;
      }
      const commandButton = target?.closest<HTMLElement>("[data-command]");
      if (commandButton?.dataset.command) {
        if (commandButton.dataset.command === "DISMISS_BANNER") this.dismissBanner();
        dispatchCommand({ command: commandButton.dataset.command, source: "button" });
        return;
      }
      const stateButton = target?.closest<HTMLElement>("[data-state-command]");
      if (stateButton?.dataset.stateCommand) dispatchCommand({ command: stateButton.dataset.stateCommand, source: "state" });
    });

    const navigation = [...root.querySelectorAll<HTMLButtonElement>(".primary-nav .nav-item")];
    for (const [index, item] of navigation.entries()) {
      item.addEventListener("keydown", (event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowDown") next = (index + 1) % navigation.length;
        if (event.key === "ArrowUp") next = (index - 1 + navigation.length) % navigation.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = navigation.length - 1;
        navigation[next]?.focus();
      });
    }

    this.#modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.closeModal("cancel");
    });
    this.#modal.addEventListener("close", () => {
      const result: ShellModalResult = this.#modal.returnValue === "confirm" ? "confirm" : "cancel";
      const resolve = this.#modalResolver;
      this.#modalResolver = undefined;
      resolve?.(result);
      this.#restoreModalFocus();
    });
  }

  #restoreModalFocus(): void {
    const target = this.#modalReturnFocus;
    this.#modalReturnFocus = undefined;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
}

export function bootstrapOperationsDeskShell(root: Document = document): OperationsDeskShell {
  return new OperationsDeskShell(root);
}
import type { UiLocalizer } from "./i18n.ts";
