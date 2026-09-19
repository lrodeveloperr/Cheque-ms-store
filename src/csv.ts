import { DomainError } from "./errors.ts";
import { effectiveRegisterStatus } from "./register.ts";
import type { Account, CheckRecord, Payee } from "./types.ts";
import { localize, type SupportedLocale } from "./localization.ts";

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 10_001;
const MAX_COLUMNS = 32;

function csvError(message: string, details: Record<string, unknown> = {}): never {
  throw new DomainError("CSV_MALFORMED", message, details, details.row !== undefined && details.column !== undefined ? "csv.malformedLocation" : "error.CSV_MALFORMED");
}

export function parseCsv(input: string, requestedDelimiter?: "," | ";"): string[][] {
  const source = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const firstLine = source.split(/\r?\n/u, 1)[0] ?? "";
  const delimiter = requestedDelimiter ?? ((firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",");
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV exceeds the 1 MB limit.");
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let afterQuote = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; afterQuote = true; }
      else field += char;
    } else if (afterQuote) {
      if (char === delimiter) { row.push(field); field = ""; afterQuote = false; }
      else if (char === "\n") { row.push(field); if (row.length > MAX_COLUMNS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many columns.", { row: rows.length + 1 }); field = ""; rows.push(row); row = []; afterQuote = false; }
      else if (char !== "\r") csvError("Unexpected character after a quoted field.", { row: rows.length + 1, column: row.length + 1 });
    } else if (char === '"') {
      if (field.length) csvError("Quote appeared inside an unquoted field.", { row: rows.length + 1, column: row.length + 1 });
      quoted = true;
    } else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); if (row.length > MAX_COLUMNS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many columns.", { row: rows.length + 1 }); field = ""; rows.push(row); row = []; }
    else field += char;
    if (row.length > MAX_COLUMNS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many columns.", { row: rows.length + 1 });
    if (rows.length > MAX_ROWS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many rows.");
  }
  if (quoted) csvError("CSV contains an unterminated quoted field.", { row: rows.length + 1, column: row.length + 1 });
  if (field.length || row.length || afterQuote) { row.push(field); if (row.length > MAX_COLUMNS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many columns."); rows.push(row); }
  if (rows.length > MAX_ROWS) throw new DomainError("CSV_LIMIT_EXCEEDED", "CSV has too many rows.");
  return rows;
}

export type CsvSafetyMode = "SAFE" | "RAW_TRUSTED";

function encodeCell(value: string, mode: CsvSafetyMode, delimiter: "," | ";"): string {
  let output = value;
  if (mode === "SAFE" && (/^[\s]*[=+\-@]/u.test(output) || /^[\s]*[\t\r]/u.test(output))) output = `'${output}`;
  return output.includes(delimiter) || /["\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
}

export function toCsv(rows: string[][], mode: CsvSafetyMode = "SAFE", includeBom = false, delimiter: "," | ";" = ","): string {
  const body = rows.map((row) => row.map((value) => encodeCell(value, mode, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
  return includeBom ? `\uFEFF${body}` : body;
}

export interface ImportedPayee { name: string; line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: "US" | "CA"; defaultMemo?: string; }

type CanonicalHeader = "name" | "line1" | "line2" | "city" | "region" | "postalcode" | "country" | "defaultmemo";
const HEADER_ALIASES: Record<string, CanonicalHeader> = {
  name: "name", nom: "name", payee: "name", address: "line1", adresse: "line1", address1: "line1", line1: "line1", address2: "line2", line2: "line2",
  city: "city", ville: "city", region: "region", state: "region", province: "region", postalcode: "postalcode", codepostal: "postalcode", postal: "postalcode", zip: "postalcode", zipcode: "postalcode",
  country: "country", pays: "country", memo: "defaultmemo", note: "defaultmemo", defaultmemo: "defaultmemo", notepardefaut: "defaultmemo", notepardéfaut: "defaultmemo"
};

function normalizedHeader(value: string): string { return value.trim().toLocaleLowerCase("en").replace(/[ _-]+/g, ""); }

function normalizedCountry(value: string, row: number, column: number): "US" | "CA" | undefined {
  const country = value.trim().toLocaleLowerCase("en").replace(/[.\s]+/g, "");
  if (!country) return undefined;
  if (["us", "usa", "unitedstates", "unitedstatesofamerica"].includes(country)) return "US";
  if (["ca", "can", "canada"].includes(country)) return "CA";
  return csvError("Country must be US, United States, CA, or Canada.", { row, column });
}

function importText(value: string | undefined, field: CanonicalHeader, maximum: number, row: number, column: number, required = false): string | undefined {
  const normalized = (value ?? "").normalize("NFC");
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(normalized)) csvError("A text field contains a control, formatting, line-separator, or paragraph-separator character.", { row, column, field });
  const clean = normalized.trim();
  if ((required && !clean) || clean.length > maximum) csvError("A text field is empty or too long.", { row, column, field, maximum });
  return clean || undefined;
}

export function importPayeesCsv(input: string, defaultCountry?: "US" | "CA"): ImportedPayee[] {
  const rows = parseCsv(input); if (!rows.length) return [];
  const headers = rows[0].map((header, index) => { const alias = HEADER_ALIASES[normalizedHeader(header)]; if (!alias) csvError("Payee CSV contains an unknown header.", { row: 1, column: index + 1, header }); return alias; });
  if (!headers.includes("name")) csvError("Payee CSV requires a name column.", { row: 1, column: 1 });
  if (new Set(headers).size !== headers.length) csvError("Payee CSV contains duplicated header meanings.", { row: 1 });
  return rows.slice(1).filter((row) => row.some((value) => value.length > 0)).map((row, rowIndex) => {
    const csvRow = rowIndex + 2; if (row.length !== headers.length) csvError("Payee CSV row width does not match its header.", { row: csvRow, column: row.length + 1 });
    const object = Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""])) as Partial<Record<CanonicalHeader, string>>;
    const column = (field: CanonicalHeader) => headers.indexOf(field) + 1;
    const name = importText(object.name, "name", 80, csvRow, column("name"), true)!;
    const country = normalizedCountry(object.country ?? "", csvRow, Math.max(1, headers.indexOf("country") + 1)) ?? defaultCountry;
    const addressFields = [object.line1, object.city, object.region, object.postalcode, country];
    if (addressFields.some(Boolean) && !addressFields.every(Boolean)) {
      const required: CanonicalHeader[] = ["line1", "city", "region", "postalcode", "country"];
      const missing = required.find((key) => key === "country" ? !country : !object[key]);
      csvError("A complete address requires address, city, state/province, ZIP/postal code, and country.", { row: csvRow, column: headers.indexOf(missing!) + 1, field: missing });
    }
    return { name, line1: importText(object.line1, "line1", 120, csvRow, column("line1")), line2: importText(object.line2, "line2", 120, csvRow, column("line2")), city: importText(object.city, "city", 80, csvRow, column("city")), region: importText(object.region, "region", 80, csvRow, column("region")), postalCode: importText(object.postalcode, "postalcode", 20, csvRow, column("postalcode")), country, defaultMemo: importText(object.defaultmemo, "defaultmemo", 55, csvRow, column("defaultmemo")) };
  });
}

function decimalAmount(cents: number, locale: SupportedLocale): string { const value = (cents / 100).toFixed(2); return locale === "fr-CA" ? value.replace(".", ",") : value; }

export function exportRegisterCsv(checks: CheckRecord[], payees: Payee[], accounts: Account[], locale: SupportedLocale = "en-US", mode: CsvSafetyMode = "SAFE"): string {
  const keys = ["account", "checkNumber", "date", "payee", "amount", "currency", "memo", "category", "status", "dateCleared"];
  const rows = [keys.map((key) => localize(locale, `csv.${key}`))];
  for (const check of checks) {
    const payee = payees.find((candidate) => candidate.id === check.payeeId); const account = accounts.find((candidate) => candidate.id === check.accountId);
    rows.push([check.accountSnapshot?.name ?? account?.name ?? localize(locale, "csv.missingAccount"), String(check.checkNumber), check.issueDate, check.payeeSnapshot?.name ?? payee?.name ?? localize(locale, "csv.missingPayee"), decimalAmount(check.amountCents, locale), check.currency, check.memo, check.category === "UNCATEGORIZED" ? localize(locale, "category.UNCATEGORIZED") : check.category, localize(locale, `status.${effectiveRegisterStatus(check)}`), check.clearedDate ?? ""]);
  }
  return toCsv(rows, mode, true, locale === "fr-CA" ? ";" : ",");
}
