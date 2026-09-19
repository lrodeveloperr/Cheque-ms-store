import assert from "node:assert/strict";
import test from "node:test";
import { buildRegisterReport, queryRegister } from "../src/register.ts";
import type { CheckRecord } from "../src/types.ts";
import { fixture } from "./test-helpers.ts";

test("register query filters snapshots deterministically and ignores accents", () => {
  const { engine, account } = fixture();
  const jose = engine.createPayee({ name: "José Québec" });
  const a = engine.createDraft({ accountId: account.id, payeeId: jose.id, issueDate: "2026-09-18", amountCents: 5_000, category: "Rent" });
  const b = engine.createDraft({ accountId: account.id, payeeId: jose.id, issueDate: "2026-10-18", amountCents: 6_000, category: "Rent" });
  const snapshot = engine.snapshot();
  const rows = queryRegister(snapshot.checks, snapshot.accounts, snapshot.payees, { payeeQuery: "jose quebec", category: "rent", issueDateFrom: "2026-09-01", issueDateTo: "2026-09-30" });
  assert.deepEqual(rows.map((row) => row.checkId), [a.id]);
  assert.equal(queryRegister(snapshot.checks, snapshot.accounts, snapshot.payees, { sortBy: "amount", direction: "DESC" })[0].checkId, b.id);
});

test("register report separates totals and warns that it is not a bank balance", () => {
  const rows = [
    { checkId: "a", accountId: "x", accountName: "Operating", checkNumber: 1, issueDate: "2026-09-18", payeeName: "A", amountCents: 100, currency: "CAD", memo: "", category: "UNCATEGORIZED", status: "PRINTED", clearedDate: undefined },
    { checkId: "b", accountId: "x", accountName: "Operating", checkNumber: 2, issueDate: "2026-09-18", payeeName: "B", amountCents: 200, currency: "CAD", memo: "", category: "UNCATEGORIZED", status: "PRINTED", clearedDate: "2026-09-19" },
    { checkId: "c", accountId: "x", accountName: "Operating", checkNumber: 3, issueDate: "2026-09-18", payeeName: "C", amountCents: 300, currency: "CAD", memo: "", category: "UNCATEGORIZED", status: "VOIDED", clearedDate: undefined },
    { checkId: "d", accountId: "x", accountName: "Operating", checkNumber: 4, issueDate: "2026-09-18", payeeName: "D", amountCents: 400, currency: "CAD", memo: "", category: "UNCATEGORIZED", status: "MISPRINTED", clearedDate: undefined }
  ] satisfies Array<Parameters<typeof buildRegisterReport>[0][number]>;
  const report = buildRegisterReport(rows, "fr-CA", "2026-09-19T12:00:00.000Z");
  assert.deepEqual(report.totals, { rowCount: 4, byCurrency: { CAD: { totalCents: 1_000, outstandingCents: 100, clearedCents: 200, voidedCents: 300, spoiledCents: 400 } } });
  assert.match(report.title, /registre/i); assert.match(report.disclaimer, /solde bancaire/i);
});

test("register reports never add USD and CAD together", () => {
  const base = { accountId: "x", accountName: "Operating", issueDate: "2026-09-18", payeeName: "A", memo: "", category: "UNCATEGORIZED", status: "PRINTED" as const, clearedDate: undefined };
  const report = buildRegisterReport([
    { ...base, checkId: "usd", checkNumber: 1, amountCents: 100, currency: "USD" },
    { ...base, checkId: "cad", checkNumber: 2, amountCents: 200, currency: "CAD" }
  ], "en-CA", "2026-09-19T12:00:00.000Z");
  assert.equal(report.totals.byCurrency.USD?.totalCents, 100);
  assert.equal(report.totals.byCurrency.CAD?.totalCents, 200);
});

test("register query rejects reversed and malformed ranges", () => {
  const empty: CheckRecord[] = [];
  assert.throws(() => queryRegister(empty, [], [], { issueDateFrom: "2026-10-01", issueDateTo: "2026-09-01" }));
  assert.throws(() => queryRegister(empty, [], [], { statuses: [] }));
  assert.throws(() => queryRegister(empty, [], [], { minimumAmountCents: 2, maximumAmountCents: 1 }));
});
