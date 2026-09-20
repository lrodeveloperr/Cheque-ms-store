export type AriaLiveMode = "off" | "polite" | "assertive";
export type AccessibleRole = "alert" | "button" | "dialog" | "link" | "menuitem" | "status";
export type AccessibilityStateKind = "IDLE" | "LOADING" | "EMPTY" | "WARNING" | "ERROR" | "SUCCESS";
export type NavigationKey = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp" | "End" | "Home";

export interface AccessibilityAction {
  readonly id: string;
  readonly labelKey: string;
  readonly descriptionKey?: string;
  readonly role: Extract<AccessibleRole, "button" | "link" | "menuitem">;
  readonly shortcut?: string;
  readonly destructive: boolean;
  readonly confirmationTitleKey?: string;
  readonly confirmationBodyKey?: string;
  readonly disabledReasonKey?: string;
  readonly restoresFocus: boolean;
}

export interface StateAnnouncement {
  readonly role: Extract<AccessibleRole, "alert" | "status">;
  readonly live: Exclude<AriaLiveMode, "off">;
  readonly atomic: true;
  readonly focusTarget: "error-summary" | "page-heading" | null;
}

export interface LandmarkDefinition {
  readonly id: string;
  readonly kind: "navigation" | "main" | "complementary" | "search";
  readonly labelKey: string;
}

export interface RegisterColumnAccessibility {
  readonly id: "number" | "date" | "payee" | "account" | "amount" | "status";
  readonly labelKey: string;
  readonly sortable: boolean;
}

export interface FocusableTarget {
  readonly disabled?: boolean;
  readonly isConnected?: boolean;
  focus(options?: Readonly<{ preventScroll?: boolean }>): void;
}

export interface DisplayPreferenceInput {
  readonly forcedColors: boolean;
  readonly reducedMotion: boolean;
  readonly textScale: number;
}

export interface DisplayPreferences {
  readonly forcedColors: boolean;
  readonly reducedMotion: boolean;
  readonly textScale: number;
  readonly classes: readonly string[];
}

export const OPERATIONS_DESK_LANDMARKS: readonly LandmarkDefinition[] = Object.freeze([
  { id: "primary-sidebar", kind: "navigation", labelKey: "a11y.sidebar" },
  { id: "workspace-main", kind: "main", labelKey: "a11y.workspace" },
  { id: "workspace-search", kind: "search", labelKey: "a11y.search" },
  { id: "readiness-panel", kind: "complementary", labelKey: "a11y.readiness" },
]);

export const REGISTER_COLUMNS: readonly RegisterColumnAccessibility[] = Object.freeze([
  { id: "number", labelKey: "register.column.number", sortable: true },
  { id: "date", labelKey: "register.column.date", sortable: true },
  { id: "payee", labelKey: "register.column.payee", sortable: true },
  { id: "account", labelKey: "register.column.account", sortable: true },
  { id: "amount", labelKey: "register.column.amount", sortable: true },
  { id: "status", labelKey: "register.column.status", sortable: true },
]);

export const ACCESSIBLE_ACTIONS: readonly AccessibilityAction[] = Object.freeze([
  { id: "new-cheque", labelKey: "action.newCheque", descriptionKey: "home.newChequeHelp", role: "button", shortcut: "Ctrl+N", destructive: false, restoresFocus: false },
  { id: "save-pdf", labelKey: "action.savePdf", descriptionKey: "output.savePdf", role: "button", shortcut: "Ctrl+Shift+S", destructive: false, restoresFocus: true },
  { id: "print", labelKey: "action.print", descriptionKey: "output.nativePrint", role: "button", shortcut: "Ctrl+P", destructive: false, restoresFocus: true },
  { id: "delete-draft", labelKey: "action.deleteDraft", role: "button", destructive: true, confirmationTitleKey: "confirm.deleteDraft.title", confirmationBodyKey: "confirm.deleteDraft.body", restoresFocus: true },
  { id: "archive-payee", labelKey: "action.archivePayee", role: "button", destructive: true, confirmationTitleKey: "confirm.archivePayee.title", confirmationBodyKey: "confirm.archivePayee.body", restoresFocus: true },
  { id: "archive-account", labelKey: "action.archiveAccount", role: "button", destructive: true, confirmationTitleKey: "confirm.archiveAccount.title", confirmationBodyKey: "confirm.archiveAccount.body", restoresFocus: true },
  { id: "restore-backup", labelKey: "action.restoreBackup", descriptionKey: "restore.warning", role: "button", destructive: true, confirmationTitleKey: "confirm.restore.title", confirmationBodyKey: "confirm.restore.body", restoresFocus: true },
  { id: "mark-spoiled", labelKey: "print.outcome.problem", descriptionKey: "print.outcome.problemHelp", role: "button", destructive: true, confirmationTitleKey: "confirm.spoiled.title", confirmationBodyKey: "confirm.spoiled.body", restoresFocus: true },
  { id: "buy-lifetime", labelKey: "action.buyLifetime", descriptionKey: "purchase.summary", role: "button", destructive: false, restoresFocus: true },
  { id: "clear-filters", labelKey: "action.clearFilters", role: "button", destructive: false, restoresFocus: false },
]);

export function stateAnnouncement(kind: AccessibilityStateKind): StateAnnouncement {
  if (kind === "ERROR" || kind === "WARNING") {
    return Object.freeze({ role: "alert", live: "assertive", atomic: true, focusTarget: "error-summary" });
  }
  if (kind === "SUCCESS") {
    return Object.freeze({ role: "status", live: "polite", atomic: true, focusTarget: "page-heading" });
  }
  return Object.freeze({ role: "status", live: "polite", atomic: true, focusTarget: null });
}

export function isKeyboardActivation(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

export function nextRovingIndex(
  currentIndex: number,
  itemCount: number,
  key: NavigationKey,
  orientation: "horizontal" | "vertical" | "both" = "both",
): number {
  if (!Number.isInteger(itemCount) || itemCount < 1) return -1;
  const current = Math.min(Math.max(currentIndex, 0), itemCount - 1);
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  const previous = key === "ArrowLeft" || key === "ArrowUp";
  const next = key === "ArrowRight" || key === "ArrowDown";
  if (orientation === "horizontal" && (key === "ArrowUp" || key === "ArrowDown")) return current;
  if (orientation === "vertical" && (key === "ArrowLeft" || key === "ArrowRight")) return current;
  if (previous) return (current - 1 + itemCount) % itemCount;
  if (next) return (current + 1) % itemCount;
  return current;
}

export type SortDirection = "none" | "ascending" | "descending";

export function nextSortDirection(current: SortDirection): Exclude<SortDirection, "none"> {
  return current === "ascending" ? "descending" : "ascending";
}

export function sortAnnouncementKey(direction: Exclude<SortDirection, "none">): string {
  return direction === "ascending" ? "a11y.sort.ascending" : "a11y.sort.descending";
}

export function filterAnnouncementKey(resultCount: number): "a11y.filterResult.one" | "a11y.filterResult.other" {
  return resultCount === 1 ? "a11y.filterResult.one" : "a11y.filterResult.other";
}

export function readinessMetricLabelKey(
  metric: "account" | "printer" | "stock" | "nextNumber" | "freeRemaining" | "pendingOutcome",
): string {
  return `a11y.metric.${metric}`;
}

export class FocusRestorationStack {
  readonly #ids: string[] = [];

  remember(id: string | null | undefined): void {
    if (id && id.trim()) this.#ids.push(id);
  }

  discard(): string | undefined {
    return this.#ids.pop();
  }

  restore(resolve: (id: string) => FocusableTarget | null | undefined): boolean {
    while (this.#ids.length > 0) {
      const id = this.#ids.pop()!;
      const target = resolve(id);
      if (!target || target.disabled || target.isConnected === false) continue;
      target.focus({ preventScroll: true });
      return true;
    }
    return false;
  }
}

export function normalizeDisplayPreferences(input: DisplayPreferenceInput): DisplayPreferences {
  const textScale = Math.min(2, Math.max(1, Number.isFinite(input.textScale) ? input.textScale : 1));
  const classes: string[] = [];
  if (input.forcedColors) classes.push("forced-colors");
  if (input.reducedMotion) classes.push("reduced-motion");
  if (textScale >= 2) classes.push("text-scale-200");
  else if (textScale > 1) classes.push("text-scale-enlarged");
  return Object.freeze({ ...input, textScale, classes: Object.freeze(classes) });
}

export interface AccessibilityContractIssue {
  readonly id: string;
  readonly detail: string;
}

export function validateAccessibilityContracts(
  hasMessageKey: (key: string) => boolean,
): readonly AccessibilityContractIssue[] {
  const issues: AccessibilityContractIssue[] = [];
  const landmarkIds = new Set<string>();
  for (const landmark of OPERATIONS_DESK_LANDMARKS) {
    if (landmarkIds.has(landmark.id)) issues.push({ id: landmark.id, detail: "Landmark id is duplicated." });
    landmarkIds.add(landmark.id);
    if (!hasMessageKey(landmark.labelKey)) issues.push({ id: landmark.id, detail: `Missing ${landmark.labelKey}.` });
  }
  for (const action of ACCESSIBLE_ACTIONS) {
    if (!hasMessageKey(action.labelKey)) issues.push({ id: action.id, detail: `Missing ${action.labelKey}.` });
    if (action.descriptionKey && !hasMessageKey(action.descriptionKey)) {
      issues.push({ id: action.id, detail: `Missing ${action.descriptionKey}.` });
    }
    if (action.destructive && (!action.confirmationTitleKey || !action.confirmationBodyKey)) {
      issues.push({ id: action.id, detail: "Destructive action needs a titled confirmation." });
    }
    for (const key of [action.confirmationTitleKey, action.confirmationBodyKey, action.disabledReasonKey]) {
      if (key && !hasMessageKey(key)) issues.push({ id: action.id, detail: `Missing ${key}.` });
    }
  }
  for (const column of REGISTER_COLUMNS) {
    if (!hasMessageKey(column.labelKey)) issues.push({ id: column.id, detail: `Missing ${column.labelKey}.` });
  }
  return Object.freeze(issues);
}

export const ACCESSIBILITY_QA_CHECKLIST = Object.freeze([
  "A11Y-001: Every route has one programmatic page heading and the main landmark is labelled.",
  "A11Y-002: Sidebar navigation, workspace search and readiness panels have unique landmark labels.",
  "A11Y-003: Every function is usable by keyboard; focus order follows the visual Operations Desk order.",
  "A11Y-004: Opening a dialog moves focus inside; closing or cancelling restores focus to its trigger.",
  "A11Y-005: Errors and warnings use an assertive alert and move focus to a linked error summary.",
  "A11Y-006: Success, loading, filter and sort changes are announced politely without stealing focus.",
  "A11Y-007: Destructive actions name the record, explain the consequence and require explicit confirmation.",
  "A11Y-008: Register headers expose sort state; filters announce result counts; rows remain navigable at 200% text.",
  "A11Y-009: Compact readiness metrics expose full text labels and state, never colour alone.",
  "A11Y-010: Windows forced-colours mode preserves borders, focus indicators, status and selected navigation.",
  "A11Y-011: At 200% text, controls reflow without clipped text, overlap or horizontal page scrolling.",
  "A11Y-012: Reduced-motion mode removes non-essential transitions and preserves immediate state feedback.",
  "A11Y-013: Form errors identify their fields with aria-describedby and remain visible after submission.",
  "A11Y-014: PDF preview has a text summary; cheque data is not communicated only through the canvas.",
  "A11Y-015: Print outcome choices include consequence text before activation.",
]);
