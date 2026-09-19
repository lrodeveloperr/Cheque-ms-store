import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, toCsv } from "../src/csv.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import { dependencies } from "./test-helpers.ts";

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 0x1_0000_0000; };
}

test("10,000 deterministic state-machine sequences preserve invariants", () => {
  const random = rng(0x57B1E9);
  for (let sequence = 0; sequence < 10_000; sequence++) {
    const engine = new CheckPrinterEngine(undefined, dependencies());
    engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-18T00:00:00.000Z" });
    const account = engine.createAccount({ name: "A", companyName: "C", currency: random() > 0.5 ? "USD" : "CAD", nextCheckNumber: 1 });
    const payee = engine.createPayee({ name: "P" }); const profile = engine.createCalibration({ accountId: account.id, name: "P", printerKey: "K", layout: "VOUCHER_TOP" });
    const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 1 + Math.floor(random() * 10_000_000) });
    const action = Math.floor(random() * 5);
    if (action === 0) engine.voidCheck(check.id, "test");
    else {
      engine.markReady(check.id);
      if (action === 1) engine.returnToDraft(check.id);
      else { const queued = engine.queuePrint([check.id], profile.id, "K", profile.stockKey); if (action === 2) engine.failPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash, "NOT_SENT", "test", "HOST_CONFIRMED_NO_OUTPUT"); else { engine.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash); if (action === 4) engine.markMisprinted(check.id, "test"); } }
    }
    assert.equal(engine.assertInvariants(), true);
  }
});

test("100,000 deterministic CSV cases never hang and round-trip generated cells", () => {
  const random = rng(0xC5B2026); const alphabet = 'abc,"\n\r=+-@09 ';
  for (let index = 0; index < 100_000; index++) {
    const cells: string[] = [];
    for (let column = 0; column < 1 + Math.floor(random() * 4); column++) { let value = ""; const length = Math.floor(random() * 12); for (let pos = 0; pos < length; pos++) value += alphabet[Math.floor(random() * alphabet.length)]; cells.push(value); }
    const serialized = toCsv([cells]); const parsed = parseCsv(serialized)[0];
    assert.equal(parsed.length, cells.length);
    cells.forEach((cell, cellIndex) => assert.equal(parsed[cellIndex], /^\s*[=+\-@]/.test(cell) || /^\s*[\t\r]/.test(cell) ? `'${cell}` : cell));
  }
});
