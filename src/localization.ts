import { readFileSync } from "node:fs";
import type { AppLocale } from "./types.ts";

export type SupportedLocale = AppLocale;

const catalogs: Record<SupportedLocale, Record<string, string>> = {
  "en-US": JSON.parse(readFileSync(new URL("../localization/en-US.json", import.meta.url), "utf8")),
  "en-CA": JSON.parse(readFileSync(new URL("../localization/en-CA.json", import.meta.url), "utf8")),
  "fr-CA": JSON.parse(readFileSync(new URL("../localization/fr-CA.json", import.meta.url), "utf8"))
};

export function localize(locale: SupportedLocale, key: string, parameters: Record<string, unknown> = {}): string {
  const template = catalogs[locale][key] ?? catalogs["en-US"][key] ?? key;
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => {
    const value = parameters[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export function keysForLocale(locale: SupportedLocale): string[] {
  return Object.keys(catalogs[locale]).sort();
}
