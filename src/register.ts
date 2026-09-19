import { invariant } from "./errors.ts";
import { localize, type SupportedLocale } from "./localization.ts";
import type { Account, CheckRecord, CheckStatus, Currency, Payee } from "./types.ts";

export type RegisterSortField = "issueDate" | "checkNumber" | "payee" | "amount" | "status";
export type SortDirection = "ASC" | "DESC";

export interface RegisterQuery {
  accountId?: string;
  statuses?: CheckStatus[];
  issueDateFrom?: string;
  issueDateTo?: string;
  payeeQuery?: string;
  minimumAmountCents?: number;
  maximumAmountCents?: number;
  category?: string;
  includeDeleted?: boolean;
  sortBy?: RegisterSortField;
  direction?: SortDirection;
}

export interface RegisterRow {
  checkId: string;
  accountId: string;
  accountName: string;
  checkNumber: number;
  issueDate: string;
  payeeName: string;
  amountCents: number;
  currency: CheckRecord["currency"];
  memo: string;
  category: string;
  status: CheckStatus;
  clearedDate?: string;
}

export interface RegisterReport {
  locale: SupportedLocale;
  generatedAt: string;
  title: string;
  columns: Array<{ key: keyof RegisterRow; label: string }>;
  rows: RegisterRow[];
  totals: {
    rowCount: number;
    byCurrency: Partial<Record<Currency, {
      totalCents: number;
      outstandingCents: number;
      clearedCents: number;
      voidedCents: number;
      spoiledCents: number;
    }>>;
  };
  disclaimer: string;
}

const VALID_STATUSES = new Set<CheckStatus>(["DRAFT", "READY", "PRINT_QUEUED", "PRINTED", "MISPRINTED", "VOIDED", "DELETED"]);

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function searchable(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").trim();
}

export function effectiveRegisterStatus(check: CheckRecord): CheckStatus {
  return check.status === "VOIDED" && check.printAttempts.some((attempt) => attempt.status === "MISPRINTED") ? "MISPRINTED" : check.status;
}

function rowFor(check: CheckRecord, accounts: Account[], payees: Payee[]): RegisterRow {
  const account = accounts.find((candidate) => candidate.id === check.accountId);
  const payee = payees.find((candidate) => candidate.id === check.payeeId);
  return {
    checkId: check.id,
    accountId: check.accountId,
    accountName: check.accountSnapshot?.name ?? account?.name ?? "",
    checkNumber: check.checkNumber,
    issueDate: check.issueDate,
    payeeName: check.payeeSnapshot?.name ?? payee?.name ?? "",
    amountCents: check.amountCents,
    currency: check.currency,
    memo: check.memo,
    category: check.category,
    status: effectiveRegisterStatus(check),
    clearedDate: check.clearedDate
  };
}

export function queryRegister(checks: CheckRecord[], accounts: Account[], payees: Payee[], query: RegisterQuery = {}): RegisterRow[] {
  if (query.issueDateFrom !== undefined) invariant(validIsoDate(query.issueDateFrom), "VALIDATION_ERROR", "Register start date is invalid.", { field: "issueDateFrom" }, "validation.date");
  if (query.issueDateTo !== undefined) invariant(validIsoDate(query.issueDateTo), "VALIDATION_ERROR", "Register end date is invalid.", { field: "issueDateTo" }, "validation.date");
  if (query.issueDateFrom && query.issueDateTo) invariant(query.issueDateFrom <= query.issueDateTo, "VALIDATION_ERROR", "Register date range is reversed.", { field: "issueDateFrom" }, "validation.date");
  if (query.statuses !== undefined) invariant(query.statuses.length > 0 && query.statuses.every((status) => VALID_STATUSES.has(status)), "VALIDATION_ERROR", "Register status filter is invalid.", { field: "statuses" });
  if (query.minimumAmountCents !== undefined) invariant(Number.isSafeInteger(query.minimumAmountCents) && query.minimumAmountCents >= 0, "VALIDATION_ERROR", "Register minimum amount is invalid.", { field: "minimumAmountCents" }, "validation.amount");
  if (query.maximumAmountCents !== undefined) invariant(Number.isSafeInteger(query.maximumAmountCents) && query.maximumAmountCents >= 0, "VALIDATION_ERROR", "Register maximum amount is invalid.", { field: "maximumAmountCents" }, "validation.amount");
  if (query.minimumAmountCents !== undefined && query.maximumAmountCents !== undefined) invariant(query.minimumAmountCents <= query.maximumAmountCents, "VALIDATION_ERROR", "Register amount range is reversed.", {}, "validation.amount");
  const sortBy = query.sortBy ?? "issueDate";
  const direction = query.direction ?? "DESC";
  invariant(["issueDate", "checkNumber", "payee", "amount", "status"].includes(sortBy), "VALIDATION_ERROR", "Register sort field is invalid.");
  invariant(direction === "ASC" || direction === "DESC", "VALIDATION_ERROR", "Register sort direction is invalid.");
  const needle = query.payeeQuery ? searchable(query.payeeQuery) : "";
  const category = query.category ? searchable(query.category) : "";
  const rows = checks
    .filter((check) => query.includeDeleted || check.status !== "DELETED")
    .filter((check) => !query.accountId || check.accountId === query.accountId)
    .filter((check) => !query.statuses || query.statuses.includes(effectiveRegisterStatus(check)))
    .filter((check) => !query.issueDateFrom || check.issueDate >= query.issueDateFrom)
    .filter((check) => !query.issueDateTo || check.issueDate <= query.issueDateTo)
    .filter((check) => query.minimumAmountCents === undefined || check.amountCents >= query.minimumAmountCents)
    .filter((check) => query.maximumAmountCents === undefined || check.amountCents <= query.maximumAmountCents)
    .map((check) => rowFor(check, accounts, payees))
    .filter((row) => !needle || searchable(row.payeeName).includes(needle))
    .filter((row) => !category || searchable(row.category) === category);

  const value = (row: RegisterRow): string | number => {
    if (sortBy === "checkNumber") return row.checkNumber;
    if (sortBy === "payee") return searchable(row.payeeName);
    if (sortBy === "amount") return row.amountCents;
    if (sortBy === "status") return row.status;
    return row.issueDate;
  };
  rows.sort((left, right) => {
    const a = value(left); const b = value(right);
    const primary = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "en");
    const stable = primary || left.checkNumber - right.checkNumber || left.checkId.localeCompare(right.checkId, "en");
    return direction === "ASC" ? stable : -stable;
  });
  return rows;
}

export function buildRegisterReport(rows: RegisterRow[], locale: SupportedLocale, generatedAt: string): RegisterReport {
  invariant(!Number.isNaN(Date.parse(generatedAt)) && new Date(generatedAt).toISOString() === generatedAt, "VALIDATION_ERROR", "Register report timestamp is invalid.");
  const totals: RegisterReport["totals"] = { rowCount: rows.length, byCurrency: {} };
  for (const row of rows) {
    const currencyTotals = totals.byCurrency[row.currency] ??= { totalCents: 0, outstandingCents: 0, clearedCents: 0, voidedCents: 0, spoiledCents: 0 };
    if (row.status !== "DELETED") currencyTotals.totalCents += row.amountCents;
    if (row.status === "PRINTED" && row.clearedDate) currencyTotals.clearedCents += row.amountCents;
    else if (row.status === "PRINTED") currencyTotals.outstandingCents += row.amountCents;
    else if (row.status === "VOIDED") currencyTotals.voidedCents += row.amountCents;
    else if (row.status === "MISPRINTED") currencyTotals.spoiledCents += row.amountCents;
  }
  return {
    locale,
    generatedAt,
    title: localize(locale, "report.registerTitle"),
    columns: [
      { key: "accountName", label: localize(locale, "csv.account") },
      { key: "checkNumber", label: localize(locale, "csv.checkNumber") },
      { key: "issueDate", label: localize(locale, "csv.date") },
      { key: "payeeName", label: localize(locale, "csv.payee") },
      { key: "amountCents", label: localize(locale, "csv.amount") },
      { key: "currency", label: localize(locale, "csv.currency") },
      { key: "memo", label: localize(locale, "csv.memo") },
      { key: "category", label: localize(locale, "csv.category") },
      { key: "status", label: localize(locale, "csv.status") },
      { key: "clearedDate", label: localize(locale, "csv.dateCleared") }
    ],
    rows: structuredClone(rows),
    totals,
    disclaimer: localize(locale, "report.notBankBalance")
  };
}
