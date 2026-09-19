import { readFile } from "node:fs/promises";
import type {
  MessageCatalog,
  MessageCatalogs,
} from "./localization.ts";
import { validateHostCatalogs } from "./localization.ts";

async function readCatalog(relativePath: string): Promise<MessageCatalog> {
  const url = new URL(`../../localization/${relativePath}`, import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(url, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid message catalog: ${relativePath}`);
  }
  const catalog: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`Invalid message value: ${relativePath}:${key}`);
    }
    catalog[key] = value;
  }
  return Object.freeze(catalog);
}

export async function loadHostCatalogs(): Promise<MessageCatalogs> {
  const [enUS, enCAOverrides, frCA] = await Promise.all([
    readCatalog("en-US.json"),
    readCatalog("en-CA.overrides.json"),
    readCatalog("fr-CA.json"),
  ]);
  const catalogs: MessageCatalogs = Object.freeze({
    "en-US": enUS,
    "en-CA": Object.freeze({ ...enUS, ...enCAOverrides }),
    "fr-CA": frCA,
  });
  const failures = validateHostCatalogs(catalogs);
  if (failures.length > 0) {
    throw new Error(`Invalid host localization:\n${failures.join("\n")}`);
  }
  return catalogs;
}
