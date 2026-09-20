import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  ACCESSIBILITY_QA_CHECKLIST,
  ACCESSIBLE_ACTIONS,
  FocusRestorationStack,
  OPERATIONS_DESK_LANDMARKS,
  REGISTER_COLUMNS,
  filterAnnouncementKey,
  isKeyboardActivation,
  nextRovingIndex,
  nextSortDirection,
  normalizeDisplayPreferences,
  readinessMetricLabelKey,
  sortAnnouncementKey,
  stateAnnouncement,
  validateAccessibilityContracts,
} from "../../src/ui/accessibility.ts";
import {
  assembleUiCatalog,
  compareUiText,
  createUiLocalizer,
  findHardCodedLocaleSensitiveLiterals,
  formatUiCurrency,
  formatUiDate,
  formatUiMoneyFromMinorUnits,
  normalizeUiSearch,
  resolveUiLocale,
  validateUiCatalogs,
  type UiCatalog,
  type UiCatalogBundle,
} from "../../src/ui/i18n.ts";

const localizationDirectory = join(process.cwd(), "localization");

function catalog(file: string): UiCatalog {
  return JSON.parse(readFileSync(join(localizationDirectory, file), "utf8")) as UiCatalog;
}

const catalogs: UiCatalogBundle = Object.freeze({
  enUS: catalog("en-US.json"),
  enCAOverrides: catalog("en-CA.overrides.json"),
  frCA: catalog("fr-CA.json"),
});

test("UI catalogs have complete key and placeholder parity", () => {
  assert.deepEqual(validateUiCatalogs(catalogs), []);
  assert.deepEqual(Object.keys(catalogs.enUS).sort(), Object.keys(catalogs.frCA).sort());
  assert.ok(Object.keys(catalogs.enUS).length >= 500, "catalog covers every locked UI workflow");
});

test("Canadian English inherits the base and replaces cheque terminology", () => {
  const merged = assembleUiCatalog(catalogs, "en-CA");
  assert.equal(merged["nav.cheques"], "Cheques");
  assert.equal(merged["register.title"], "Cheque register");
  assert.equal(merged["action.cancel"], "Cancel");
  assert.equal(Object.keys(merged).length, Object.keys(catalogs.enUS).length);
});

test("locale resolution is deterministic and falls back safely", () => {
  assert.equal(resolveUiLocale("en_CA"), "en-CA");
  assert.equal(resolveUiLocale("fr"), "fr-CA");
  assert.equal(resolveUiLocale("fr-FR"), "fr-CA");
  assert.equal(resolveUiLocale("es-US"), "en-US");
  assert.equal(resolveUiLocale(undefined), "en-US");
});

test("messages interpolate required placeholders and pluralize counts", () => {
  const us = createUiLocalizer(catalogs, "en-US");
  const ca = createUiLocalizer(catalogs, "en-CA");
  const fr = createUiLocalizer(catalogs, "fr-CA");
  assert.equal(us.count("register.results", 1), "1 check");
  assert.equal(us.count("register.results", 8), "8 checks");
  assert.equal(ca.count("register.results", 8), "8 cheques");
  assert.equal(fr.count("register.results", 1), "1 chèque");
  assert.equal(fr.count("register.results", 8), "8 chèques");
  assert.equal(fr.text("a11y.pageLoaded", { page: "Registre" }), "Page chargée : Registre.");
  assert.throws(() => fr.text("a11y.pageLoaded"), /Missing localization parameter: page/);
});

test("date, number and currency display always use locale-aware formatters", () => {
  const usDate = formatUiDate("en-US", "2026-09-18");
  const frDate = formatUiDate("fr-CA", "2026-09-18");
  assert.notEqual(usDate, frDate);
  assert.match(frDate, /18/);
  assert.match(frDate, /2026/);
  assert.throws(() => formatUiDate("en-US", "2026-02-30"), /Invalid calendar date/);

  assert.match(formatUiCurrency("en-US", 1234.56, "USD"), /1,234\.56/);
  assert.match(formatUiCurrency("fr-CA", 1234.56, "CAD"), /1[\s\u00a0\u202f]234,56/);
  assert.match(formatUiCurrency("en-CA", 1234.56, "USD"), /US\$/);
  assert.equal(formatUiMoneyFromMinorUnits("en-US", 123456, "USD"), "$1,234.56");
  assert.ok(compareUiText("fr-CA", "Équipement 2", "Equipement 10") < 0);
  assert.equal(normalizeUiSearch("  ÉQUIPEMENT  ", "fr-CA"), "equipement");
});

test("catalogs contain no hard-coded date, decimal or currency display examples", () => {
  assert.deepEqual(findHardCodedLocaleSensitiveLiterals(catalogs.enUS), []);
  assert.deepEqual(findHardCodedLocaleSensitiveLiterals(catalogs.frCA), []);
});

test("UI presentation code does not hand-format locale-sensitive display values", () => {
  const presentationFiles = [
    "src/ui/renderer.ts",
    "src/ui/shell.ts",
    "src/ui/features/home.ts",
    "src/ui/features/cheques.ts",
    "src/ui/features/output.ts",
    "src/ui/features/register.ts",
    "src/ui/features/settings.ts",
  ];
  const forbidden = [
    /\.toLocaleDateString\s*\(/,
    /\.toLocaleString\s*\(/,
    /\.toFixed\s*\(\s*2\s*\)/,
    /(?:USD|CAD|\$)\s*\+\s*(?:amount|value|total)/i,
    /(?:amount|value|total)\s*\+\s*(?:"|'|`)\$/i,
  ];
  for (const file of presentationFiles) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must use the i18n formatter layer`);
    }
  }
});

test("French-Canadian operational and cheque terminology is intentional", () => {
  const fr = catalogs.frCA;
  assert.equal(fr["dashboard.title"], "Centre des opérations");
  assert.equal(fr["cheque.payee"], "Payez à l’ordre de");
  assert.equal(fr["register.cleared"], "Compensés");
  assert.equal(fr["register.spoiled"], "Gâchés");
  assert.equal(fr["cheque.memo"], "Note");
  assert.equal(fr["onboarding.layout.top"], "Chèque en haut avec deux talons");
  for (const key of ["dashboard.subtitle", "help.paper", "register.title", "print.outcome.title"]) {
    assert.doesNotMatch(fr[key]!, /\bcheck\b/i);
  }
});

test("Operations Desk landmarks, table columns and actions have accessible metadata", () => {
  const merged = assembleUiCatalog(catalogs, "en-CA");
  assert.deepEqual(validateAccessibilityContracts((key) => key in merged), []);
  assert.equal(new Set(OPERATIONS_DESK_LANDMARKS.map(({ id }) => id)).size, OPERATIONS_DESK_LANDMARKS.length);
  assert.equal(REGISTER_COLUMNS.length, 6);
  assert.ok(REGISTER_COLUMNS.every(({ sortable }) => sortable));
  assert.ok(ACCESSIBLE_ACTIONS.filter(({ destructive }) => destructive).every(
    ({ confirmationTitleKey, confirmationBodyKey }) => confirmationTitleKey && confirmationBodyKey,
  ));
  assert.equal(readinessMetricLabelKey("nextNumber"), "a11y.metric.nextNumber");
});

test("state announcements differentiate urgent and routine changes", () => {
  assert.deepEqual(stateAnnouncement("ERROR"), {
    role: "alert",
    live: "assertive",
    atomic: true,
    focusTarget: "error-summary",
  });
  assert.equal(stateAnnouncement("WARNING").role, "alert");
  assert.equal(stateAnnouncement("SUCCESS").live, "polite");
  assert.equal(stateAnnouncement("LOADING").focusTarget, null);
});

test("keyboard helpers support activation, tables, tabs and sidebar navigation", () => {
  assert.equal(isKeyboardActivation("Enter"), true);
  assert.equal(isKeyboardActivation(" "), true);
  assert.equal(isKeyboardActivation("Escape"), false);
  assert.equal(nextRovingIndex(0, 5, "ArrowUp", "vertical"), 4);
  assert.equal(nextRovingIndex(4, 5, "ArrowDown", "vertical"), 0);
  assert.equal(nextRovingIndex(2, 5, "Home"), 0);
  assert.equal(nextRovingIndex(2, 5, "End"), 4);
  assert.equal(nextRovingIndex(2, 5, "ArrowDown", "horizontal"), 2);
  assert.equal(nextSortDirection("none"), "ascending");
  assert.equal(nextSortDirection("ascending"), "descending");
  assert.equal(sortAnnouncementKey("descending"), "a11y.sort.descending");
  assert.equal(filterAnnouncementKey(1), "a11y.filterResult.one");
  assert.equal(filterAnnouncementKey(0), "a11y.filterResult.other");
});

test("focus restoration skips missing or disabled triggers", () => {
  const focused: string[] = [];
  const stack = new FocusRestorationStack();
  stack.remember("new-check");
  stack.remember("disabled-menu");
  assert.equal(stack.restore((id) => ({
    disabled: id === "disabled-menu",
    isConnected: true,
    focus: () => focused.push(id),
  })), true);
  assert.deepEqual(focused, ["new-check"]);
  assert.equal(stack.restore(() => null), false);
});

test("high contrast, reduced motion and 200 percent text preferences are explicit", () => {
  assert.deepEqual(normalizeDisplayPreferences({ forcedColors: true, reducedMotion: true, textScale: 3 }), {
    forcedColors: true,
    reducedMotion: true,
    textScale: 2,
    classes: ["forced-colors", "reduced-motion", "text-scale-200"],
  });
  assert.ok(ACCESSIBILITY_QA_CHECKLIST.some((item) => item.includes("200% text")));
  assert.ok(ACCESSIBILITY_QA_CHECKLIST.some((item) => item.includes("forced-colours")));
  assert.ok(ACCESSIBILITY_QA_CHECKLIST.some((item) => item.includes("Reduced-motion")));
});
