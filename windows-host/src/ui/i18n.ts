export const UI_LOCALES = ["en-US", "en-CA", "fr-CA"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];
export type UiCurrency = "USD" | "CAD";
export type UiCatalog = Readonly<Record<string, string>>;

export interface UiCatalogBundle {
  readonly enUS: UiCatalog;
  readonly enCAOverrides: UiCatalog;
  readonly frCA: UiCatalog;
}

export interface UiLocalizer {
  readonly locale: UiLocale;
  readonly catalog: UiCatalog;
  text(key: string, parameters?: Readonly<Record<string, string | number>>): string;
  count(key: string, count: number, parameters?: Readonly<Record<string, string | number>>): string;
  date(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  currency(value: number, currency: UiCurrency): string;
  moneyFromMinorUnits(minorUnits: number, currency: UiCurrency): string;
  compare(left: string, right: string, options?: Intl.CollatorOptions): number;
}

export interface CatalogValidationIssue {
  readonly code:
    | "EMPTY_VALUE"
    | "EXTRA_KEY"
    | "INVALID_KEY"
    | "MISSING_KEY"
    | "PLACEHOLDER_MISMATCH"
    | "PLURAL_PAIR_MISSING";
  readonly locale: UiLocale;
  readonly key: string;
  readonly detail: string;
}

const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function placeholderNames(value: string): readonly string[] {
  return [...value.matchAll(PLACEHOLDER_PATTERN)]
    .map((match) => match[1]!)
    .sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function resolveUiLocale(requested?: string | null): UiLocale {
  if (!requested) return "en-US";
  const normalized = requested.trim().replace("_", "-").toLowerCase();
  if (normalized === "en-ca") return "en-CA";
  if (normalized === "fr-ca" || normalized === "fr" || normalized.startsWith("fr-")) return "fr-CA";
  if (normalized === "en-us" || normalized === "en" || normalized.startsWith("en-")) return "en-US";
  return "en-US";
}

export function assembleUiCatalog(bundle: UiCatalogBundle, locale: UiLocale): UiCatalog {
  if (locale === "en-CA") return Object.freeze({ ...bundle.enUS, ...bundle.enCAOverrides });
  if (locale === "fr-CA") return bundle.frCA;
  return bundle.enUS;
}

export function interpolateUiMessage(
  template: string,
  parameters: Readonly<Record<string, string | number>> = {},
): string {
  const required = placeholderNames(template);
  for (const name of required) {
    if (!(name in parameters)) throw new Error(`Missing localization parameter: ${name}`);
  }
  return template.replace(PLACEHOLDER_PATTERN, (_match, name: string) => String(parameters[name]));
}

function dateParts(value: Date | string | number): { date: Date; dateOnly: boolean } {
  if (typeof value === "string") {
    const match = DATE_ONLY_PATTERN.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        throw new Error(`Invalid calendar date: ${value}`);
      }
      return { date, dateOnly: true };
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date value");
  return { date, dateOnly: false };
}

export function formatUiDate(
  locale: UiLocale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const parsed = dateParts(value);
  const defaults: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(locale, {
    ...defaults,
    ...options,
    ...(parsed.dateOnly ? { timeZone: "UTC" } : {}),
  }).format(parsed.date);
}

export function formatUiNumber(
  locale: UiLocale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) throw new Error("Number must be finite");
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatUiCurrency(locale: UiLocale, value: number, currency: UiCurrency): string {
  return formatUiNumber(locale, value, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatUiMoneyFromMinorUnits(
  locale: UiLocale,
  minorUnits: number,
  currency: UiCurrency,
): string {
  if (!Number.isSafeInteger(minorUnits)) throw new Error("Minor-unit amount must be a safe integer");
  return formatUiCurrency(locale, minorUnits / 100, currency);
}

export function compareUiText(
  locale: UiLocale,
  left: string,
  right: string,
  options: Intl.CollatorOptions = {},
): number {
  return new Intl.Collator(locale, { sensitivity: "base", numeric: true, ...options }).compare(left, right);
}

export function normalizeUiSearch(value: string, locale: UiLocale): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase(locale)
    .trim();
}

function pluralCandidateKeys(key: string, locale: UiLocale, count: number): readonly string[] {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one"
    ? [`${key}.one`, `${key}.other`, `${key}.many`]
    : [`${key}.${category}`, `${key}.other`, `${key}.many`];
}

export function createUiLocalizer(bundle: UiCatalogBundle, requestedLocale?: string | null): UiLocalizer {
  const locale = resolveUiLocale(requestedLocale);
  const catalog = assembleUiCatalog(bundle, locale);

  const text = (
    key: string,
    parameters: Readonly<Record<string, string | number>> = {},
  ): string => {
    const template = catalog[key] ?? bundle.enUS[key];
    if (!template) throw new Error(`Missing localized UI message: ${key}`);
    return interpolateUiMessage(template, parameters);
  };

  const localizer: UiLocalizer = {
    locale,
    catalog,
    text,
    count(key: string, count: number, parameters: Readonly<Record<string, string | number>> = {}) {
      const candidate = pluralCandidateKeys(key, locale, count).find((item) => item in catalog || item in bundle.enUS);
      if (!candidate) throw new Error(`Missing pluralized UI message: ${key}`);
      return text(candidate, { ...parameters, count });
    },
    date: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) =>
      formatUiDate(locale, value, options),
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      formatUiNumber(locale, value, options),
    currency: (value: number, currency: UiCurrency) => formatUiCurrency(locale, value, currency),
    moneyFromMinorUnits: (minorUnits: number, currency: UiCurrency) =>
      formatUiMoneyFromMinorUnits(locale, minorUnits, currency),
    compare: (left: string, right: string, options?: Intl.CollatorOptions) =>
      compareUiText(locale, left, right, options),
  };
  return Object.freeze(localizer);
}

export function validateUiCatalogs(bundle: UiCatalogBundle): readonly CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const baseKeys = Object.keys(bundle.enUS).sort();
  const baseKeySet = new Set(baseKeys);
  const catalogs: readonly [UiLocale, UiCatalog][] = [
    ["en-US", bundle.enUS],
    ["en-CA", assembleUiCatalog(bundle, "en-CA")],
    ["fr-CA", bundle.frCA],
  ];

  for (const key of Object.keys(bundle.enCAOverrides)) {
    if (!baseKeySet.has(key)) {
      issues.push({ code: "EXTRA_KEY", locale: "en-CA", key, detail: "Override key is absent from en-US." });
    }
  }

  for (const [locale, catalog] of catalogs) {
    for (const key of baseKeys) {
      const value = catalog[key];
      if (value === undefined) {
        issues.push({ code: "MISSING_KEY", locale, key, detail: "Key is required by the en-US catalog." });
        continue;
      }
      if (value.trim().length === 0) {
        issues.push({ code: "EMPTY_VALUE", locale, key, detail: "Localized value is blank." });
      }
      if (!sameStrings(placeholderNames(bundle.enUS[key]!), placeholderNames(value))) {
        issues.push({ code: "PLACEHOLDER_MISMATCH", locale, key, detail: "Placeholders differ from en-US." });
      }
    }
    for (const key of Object.keys(catalog)) {
      if (!KEY_PATTERN.test(key)) {
        issues.push({ code: "INVALID_KEY", locale, key, detail: "Key must be dot-separated and stable." });
      }
      if (!baseKeySet.has(key)) {
        issues.push({ code: "EXTRA_KEY", locale, key, detail: "Key is absent from en-US." });
      }
    }
    for (const key of baseKeys.filter((item) => item.endsWith(".one"))) {
      const root = key.slice(0, -4);
      if (!(`${root}.other` in catalog) && !(`${root}.many` in catalog)) {
        issues.push({ code: "PLURAL_PAIR_MISSING", locale, key: root, detail: "A .one key requires .other or .many." });
      }
    }
  }
  return Object.freeze(issues);
}

export interface LocaleSensitiveLiteralFinding {
  readonly key: string;
  readonly kind: "CURRENCY" | "DATE" | "DECIMAL";
  readonly value: string;
}

/** Keeps examples out of catalog strings so values are always rendered through Intl. */
export function findHardCodedLocaleSensitiveLiterals(
  catalog: UiCatalog,
): readonly LocaleSensitiveLiteralFinding[] {
  const findings: LocaleSensitiveLiteralFinding[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (/[$€£]\s?\d/.test(value)) findings.push({ key, kind: "CURRENCY", value });
    if (/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(value)) findings.push({ key, kind: "DATE", value });
    if (/\b\d+[.,]\d{2}\b/.test(value)) findings.push({ key, kind: "DECIMAL", value });
  }
  return Object.freeze(findings);
}
