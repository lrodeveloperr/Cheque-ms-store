import { DomainError, invariant } from "./errors.ts";
import type { SupportedLocale } from "./localization.ts";
import type { Currency } from "./types.ts";

const MAX_CENTS = 99_999_999_999;

export function parseAmountToCents(value: string): number {
  invariant(/^\d{1,9}(?:\.\d{1,2})?$/.test(value), "VALIDATION_ERROR", "Amount must be a positive decimal with at most two fraction digits.");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  validateAmountCents(cents);
  return cents;
}

export function validateAmountCents(cents: number): void {
  invariant(Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS, "VALIDATION_ERROR", "Amount must be between 0.01 and 999,999,999.99.");
}

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)], "Hundred");
    n %= 100;
  }
  if (n >= 20) {
    const ones = n % 10;
    parts.push(ones ? `${TENS[Math.floor(n / 10)]}-${ONES[ones]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

function integerToEnglishWords(n: number): string {
  if (n === 0) return "Zero";
  const groups: Array<[number, string]> = [[1_000_000, "Million"], [1_000, "Thousand"], [1, ""]];
  const parts: string[] = [];
  for (const [size, label] of groups) {
    const group = Math.floor(n / size);
    if (group) {
      parts.push(underThousand(group));
      if (label) parts.push(label);
      n %= size;
    }
  }
  return parts.join(" ");
}

const FRENCH_SMALL = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"] as const;

function underHundredFrench(value: number): string {
  if (value <= 16) return FRENCH_SMALL[value];
  if (value < 20) return `dix-${FRENCH_SMALL[value - 10]}`;
  if (value < 70) {
    const tens = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"][Math.floor(value / 10)];
    const ones = value % 10;
    if (!ones) return tens;
    return ones === 1 ? `${tens} et un` : `${tens}-${FRENCH_SMALL[ones]}`;
  }
  if (value < 80) {
    const remainder = value - 60;
    return remainder === 11 ? "soixante et onze" : `soixante-${underHundredFrench(remainder)}`;
  }
  const remainder = value - 80;
  if (!remainder) return "quatre-vingts";
  return `quatre-vingt-${underHundredFrench(remainder)}`;
}

function underThousandFrench(value: number): string {
  if (value < 100) return underHundredFrench(value);
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  const prefix = hundreds === 1 ? "cent" : `${FRENCH_SMALL[hundreds]} cent${remainder ? "" : "s"}`;
  return remainder ? `${prefix} ${underHundredFrench(remainder)}` : prefix;
}

function integerToFrenchWords(value: number): string {
  if (value === 0) return FRENCH_SMALL[0];
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  if (millions) parts.push(millions === 1 ? "un million" : `${underThousandFrench(millions)} millions`);
  value %= 1_000_000;
  const thousands = Math.floor(value / 1_000);
  if (thousands) {
    let words = thousands === 1 ? "" : underThousandFrench(thousands);
    if (words.endsWith("cents")) words = words.slice(0, -1);
    if (words.endsWith("quatre-vingts")) words = words.slice(0, -1);
    parts.push(words ? `${words} mille` : "mille");
  }
  value %= 1_000;
  if (value) parts.push(underThousandFrench(value));
  return parts.join(" ");
}

export function amountToWords(cents: number, currency: Currency, locale: SupportedLocale = "en-US"): string {
  validateAmountCents(cents);
  const whole = Math.floor(cents / 100);
  const fraction = String(cents % 100).padStart(2, "0");
  if (locale === "fr-CA") {
    const label = whole === 1 ? (currency === "USD" ? "dollar US" : "dollar canadien") : (currency === "USD" ? "dollars US" : "dollars canadiens");
    return `${integerToFrenchWords(whole)} ${label} et ${fraction}/100`;
  }
  const label = currency === "USD" ? "Dollars" : "Canadian Dollars";
  return `${integerToEnglishWords(whole)} and ${fraction}/100 ${label}`;
}

export function formatAmount(cents: number, currency: Currency, locale: SupportedLocale = currency === "CAD" ? "en-CA" : "en-US"): string {
  validateAmountCents(cents);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function ensureSameCurrency(checkCurrency: Currency, accountCurrency: Currency): void {
  if (checkCurrency !== accountCurrency) throw new DomainError("VALIDATION_ERROR", "Check currency must match its account.");
}
