import {
  LAUNCH_HOST_LOCALES,
  type LaunchHostLocale,
} from "./product-identity.ts";

export type MessageCatalog = Readonly<Record<string, string>>;
export type MessageCatalogs = Readonly<Record<LaunchHostLocale, MessageCatalog>>;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]!).sort();
}

export function validateHostCatalogs(catalogs: MessageCatalogs): string[] {
  const failures: string[] = [];
  const base = catalogs["en-US"];
  const baseKeys = Object.keys(base).sort();
  for (const locale of LAUNCH_HOST_LOCALES) {
    const catalog = catalogs[locale];
    const keys = Object.keys(catalog).sort();
    for (const key of baseKeys) {
      if (!(key in catalog)) failures.push(`${locale}:missing:${key}`);
      else if (catalog[key]!.trim().length === 0) failures.push(`${locale}:empty:${key}`);
      else if (
        placeholders(catalog[key]!).join("|") !==
        placeholders(base[key]!).join("|")
      ) {
        failures.push(`${locale}:placeholders:${key}`);
      }
    }
    for (const key of keys) {
      if (!(key in base)) failures.push(`${locale}:extra:${key}`);
    }
  }
  return failures;
}

export function formatHostMessage(
  catalogs: MessageCatalogs,
  locale: LaunchHostLocale,
  key: string,
  parameters: Readonly<Record<string, string | number>> = {},
): string {
  const template = catalogs[locale][key] ?? catalogs["en-US"][key];
  if (!template) throw new Error(`Missing localized message: ${key}`);
  const required = placeholders(template);
  for (const name of required) {
    if (!(name in parameters)) throw new Error(`Missing parameter ${name} for ${key}`);
  }
  return template.replace(PLACEHOLDER, (_match, name: string) =>
    String(parameters[name]),
  );
}

export function formatLocalDate(
  locale: LaunchHostLocale,
  date: Date,
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function formatLocalNumber(
  locale: LaunchHostLocale,
  value: number,
): string {
  return new Intl.NumberFormat(locale).format(value);
}
