import assert from "node:assert/strict";
import test from "node:test";
import { CheckPrinterEngine } from "../src/engine.ts";
import { inspectPdfArtifact } from "../src/pdf-integrity.ts";
import { renderPdfArtifact } from "../src/pdf-renderer-core.ts";
import { localize } from "../src/localization.ts";
import type { AppLocale, BankCountry, Currency, LayoutKind } from "../src/types.ts";

const jurisdictions: Array<{ bankCountry: BankCountry; currency: Currency; locale: AppLocale }> = [
  { bankCountry: "US", currency: "USD", locale: "en-US" },
  { bankCountry: "CA", currency: "CAD", locale: "en-CA" },
  { bankCountry: "CA", currency: "USD", locale: "en-CA" },
  { bankCountry: "CA", currency: "CAD", locale: "fr-CA" },
  { bankCountry: "CA", currency: "USD", locale: "fr-CA" }
];
const layouts: LayoutKind[] = ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"];

function deps(prefix: string) {
  let id = 0;
  return { now: () => "2026-09-19T12:00:00.000Z", newId: () => `${prefix}-${++id}` };
}

test("the full country, currency, locale, and stock matrix produces inspectable PDFs", () => {
  for (const jurisdiction of jurisdictions) for (const layout of layouts) {
    const prefix = `${jurisdiction.bankCountry}-${jurisdiction.currency}-${jurisdiction.locale}-${layout}`;
    const engine = new CheckPrinterEngine(undefined, deps(prefix));
    engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-19T12:00:00.000Z" });
    const account = engine.createAccount({ name: prefix, companyName: "WorksBien Verification", ...jurisdiction, nextCheckNumber: 1001 });
    const payee = engine.createPayee({ name: jurisdiction.locale === "fr-CA" ? "Fournitures Québec" : "Northwind Supplies", defaultMemo: jurisdiction.locale === "fr-CA" ? "Facture 1042" : "Invoice 1042" });
    const profile = engine.createCalibration({ accountId: account.id, name: prefix, printerKey: prefix, layout, printCheckNumber: true });
    const count = layout === "THREE_UP" ? 3 : 1; const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 123_456 + index });
      engine.markReady(check.id, profile.id); ids.push(check.id);
    }
    const plan = engine.queuePrint(ids, profile.id, profile.printerKey, profile.stockKey, 0, layout === "THREE_UP" ? [`${prefix}-sheet`] : []).plan;
    const production = renderPdfArtifact(plan, localize);
    assert.equal(inspectPdfArtifact(production, plan).productionFurnitureAbsent, true, prefix);
    const preview = renderPdfArtifact(plan, localize, "preview");
    assert.equal(inspectPdfArtifact(preview, plan).pageCount, plan.pages.length, prefix);
    const sample = engine.samplePlan(profile.id, profile.printerKey, jurisdiction.locale);
    assert.equal(inspectPdfArtifact(renderPdfArtifact(sample, localize), sample).embeddedFonts, true, prefix);
  }
});

test("content boundaries either render safely or refuse before queueing", () => {
  for (const jurisdiction of jurisdictions) {
    const engine = new CheckPrinterEngine(undefined, deps(`edge-${jurisdiction.locale}-${jurisdiction.currency}`));
    engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-19T12:00:00.000Z" });
    const account = engine.createAccount({ name: "Edges", companyName: "WorksBien Verification", ...jurisdiction, nextCheckNumber: 1 });
    const profile = engine.createCalibration({ accountId: account.id, name: "Edges", printerKey: "edges", layout: "VOUCHER_TOP" });
    const cases = [
      { amountCents: 1, payee: "A", memo: "", expectReady: true },
      { amountCents: 123_456, payee: "Québec & O'Neil Supplies", memo: "Invoice 1042", expectReady: true },
      { amountCents: 123_456, payee: "Ordinary Supplier", memo: "M".repeat(55), expectReady: false },
      { amountCents: 99_999_999_999, payee: "W".repeat(80), memo: "", expectReady: false }
    ];
    for (const edge of cases) {
      const payee = engine.createPayee({ name: edge.payee });
      const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: edge.amountCents, memo: edge.memo });
      if (!edge.expectReady) {
        assert.throws(() => engine.markReady(check.id, profile.id), /DoesNotFit|does not fit|validation\./u);
        assert.equal(engine.snapshot().checks.find((item) => item.id === check.id)?.status, "DRAFT");
      } else {
        engine.markReady(check.id, profile.id);
        const plan = engine.queuePrint([check.id], profile.id, profile.printerKey, profile.stockKey).plan;
        inspectPdfArtifact(renderPdfArtifact(plan, localize), plan);
      }
    }
  }
});
