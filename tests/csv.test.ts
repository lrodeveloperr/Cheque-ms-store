import assert from "node:assert/strict";
import test from "node:test";
import { importPayeesCsv, parseCsv, toCsv } from "../src/csv.ts";
import { DomainError } from "../src/errors.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import { dependencies } from "./test-helpers.ts";

test("round trips quoted CSV and offers safe and trusted export modes", () => {
  const cells = ["Smith, Inc.", '=HYPERLINK("bad")', "\t=cmd", "'-Smith Hardware", "Line\nBreak"];
  const safe = parseCsv(toCsv([cells], "SAFE"))[0]; assert.deepEqual(safe, ["Smith, Inc.", `'=HYPERLINK("bad")`, "'\t=cmd", "'-Smith Hardware", "Line\nBreak"]);
  const raw = parseCsv(toCsv([cells], "RAW_TRUSTED"))[0]; assert.deepEqual(raw, cells);
  assert.equal(parseCsv(`\uFEFF${toCsv([["name"], ["José"]])}`)[1][0], "José");
});

test("accepts common North American header and country aliases", () => {
  const ca = importPayeesCsv("Payee,Address,City,Province,Postal Code,Country,Default Memo\r\nAlice,1 Main St,Toronto,ON,M1A 1A1,Canada,Invoice\r\n")[0]; assert.equal(ca.country, "CA"); assert.equal(ca.region, "ON");
  const us = importPayeesCsv("Name,Address1,City,State,Zip,Country\r\nBob,2 Main St,Buffalo,NY,14201,United States\r\n")[0]; assert.equal(us.country, "US");
});

test("supports French-Canadian Excel separators and an account country default", () => {
  const engine = new CheckPrinterEngine(undefined, dependencies()); const account = engine.createAccount({ name: "Canada", companyName: "Exemple", bankCountry: "CA", currency: "CAD", locale: "fr-CA", nextCheckNumber: 1 });
  const imported = engine.importPayees("Nom;Adresse;Ville;Province;Code postal\r\nAtelier Québec;1 rue Principale;Québec;QC;G1A 1A1\r\n", account.id);
  assert.equal(imported.created[0].address?.country, "CA");
  const check = engine.createDraft({ accountId: account.id, payeeId: imported.created[0].id, issueDate: "2026-09-19", amountCents: 12345 });
  const csv = engine.exportRegister(account.id, "fr-CA");
  assert.match(csv, /;123,45;/); engine.deleteDraft(check.id);
  const french = importPayeesCsv("Nom;Adresse;Ville;Province;Code postal;Pays;Note par défaut\r\nMaison;2 rue;Montréal;QC;H1A 1A1;Canada;Facture\r\n")[0]; assert.equal(french.country, "CA"); assert.equal(french.defaultMemo, "Facture");
});

test("reports malformed CSV with row and column evidence", () => {
  for (const csv of ["name,secret\r\nAlice,x\r\n", "name,name\r\nAlice,Bob\r\n", "name\r\nAlice,Ignored\r\n", 'a,"unterminated', 'a,"closed"garbage', "name,line1\r\nAlice,1 Main St\r\n"]) {
    assert.throws(() => importPayeesCsv(csv), (error: unknown) => error instanceof DomainError && Object.hasOwn(error.details, "row"));
  }
  assert.throws(() => importPayeesCsv("name,country\r\nAlice,Mexico\r\n"), (error: unknown) => error instanceof DomainError && error.details.row === 2 && error.details.column === 2 && /row 2, column 2/.test(error.localizedMessage("en-US")));
  assert.throws(() => importPayeesCsv(`name\r\n${"x".repeat(81)}\r\n`), (error: unknown) => error instanceof DomainError && error.details.row === 2 && error.details.column === 1);
  assert.throws(() => importPayeesCsv("name\r\nAlice\u2028Bob\r\n"), (error: unknown) => error instanceof DomainError && error.details.row === 2 && error.details.column === 1);
});

test("enforces parser safety limits without rejecting 10,000 payee rows", () => {
  assert.equal(parseCsv(`${Array.from({ length: 32 }, (_, index) => `c${index}`).join(",")}\r\n`)[0].length, 32);
  assert.throws(() => parseCsv(`${Array.from({ length: 33 }, (_, index) => `c${index}`).join(",")}\r\n`));
  assert.equal(parseCsv(`name\n${"x\n".repeat(10_000)}`).length, 10_001); assert.throws(() => parseCsv(`name\n${"x\n".repeat(10_001)}`)); assert.throws(() => parseCsv("x".repeat(1_000_001)));
});
