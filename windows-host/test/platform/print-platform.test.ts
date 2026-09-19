import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { hashPrintPlan } from "../../../src/calibration.ts";
import type { ExactPrintJob, NativePrintOutcome } from "../../../src/host-contract.ts";
import type { PrintPlan } from "../../../src/types.ts";
import type { NativePrinterInfo, NativePrintSettings, NativePrintTransport, PdfFileWriter, PrintOutcomeConfirmer, PrintSubmission, UnknownLetterCapabilityConfirmer } from "../../src/platform/contracts.ts";
import { WindowsPdfPrintPlatform } from "../../src/platform/print-platform.ts";

function plan(printerKey = "printer-1"): PrintPlan {
  return {
    version: 4,
    documentId: "document-1",
    documentKind: "CHECKS",
    currency: "USD",
    locale: "en-US",
    bankCountry: "US",
    layout: "VOUCHER_TOP",
    calibrationProfileId: "calibration-1",
    accountId: "account-1",
    printerKey,
    stockKey: "TOP_VOUCHER_STANDARD",
    startSlot: 0,
    sheetIds: ["sheet-1"],
    pages: [{ widthPt: 612, heightPt: 792, elements: [] }],
    checkIds: ["check-1"],
    generatedAt: "2026-09-19T00:00:00.000Z",
    warningKeys: []
  };
}

function job(printerKey = "printer-1"): ExactPrintJob {
  const value = plan(printerKey);
  return { plan: value, planHash: hashPrintPlan(value), printerKey, paper: "LETTER", scalePercent: 100, fitToPage: false };
}

class FakeTransport implements NativePrintTransport {
  printers: NativePrinterInfo[] = [{ name: "printer-1", displayName: "Office", isDefault: true, paperSizes: ["Letter"] }];
  bytes?: Uint8Array;
  settings?: NativePrintSettings;
  submission: PrintSubmission = { kind: "SUBMITTED", jobId: "spool-1" };
  async listPrinters() { return this.printers; }
  async submitPdf(bytes: Uint8Array, settings: NativePrintSettings) { this.bytes = bytes; this.settings = settings; return this.submission; }
}

class FakeWriter implements PdfFileWriter {
  bytes?: Uint8Array;
  path?: string;
  async writeAtomically(path: string, bytes: Uint8Array): Promise<void> { this.path = path; this.bytes = bytes; }
}

class FakeConfirmer implements PrintOutcomeConfirmer {
  calls = 0;
  outcome: NativePrintOutcome = { kind: "PRINTED_CORRECTLY" };
  async confirmPhysicalOutcome(): Promise<NativePrintOutcome> { this.calls += 1; return this.outcome; }
}

class FakeCapabilityConfirmer implements UnknownLetterCapabilityConfirmer {
  allow = false;
  calls = 0;
  async confirmUnverifiedLetterCapability(): Promise<boolean> { this.calls += 1; return this.allow; }
}

function platform(transport = new FakeTransport(), writer = new FakeWriter(), confirmer = new FakeConfirmer(), capability = new FakeCapabilityConfirmer()) {
  return { adapter: new WindowsPdfPrintPlatform({ transport, fileWriter: writer, confirmOutcome: confirmer, confirmUnknownLetter: capability, localize: (_locale, key) => key }), transport, writer, confirmer, capability };
}

test("saves the locked renderer's exact validated PDF bytes", async () => {
  const setup = platform();
  const destination = resolve("checks.pdf");
  const integrity = await setup.adapter.savePdf(job(), destination);
  assert.equal(setup.writer.path, destination);
  assert.ok(setup.writer.bytes);
  assert.equal(createHash("sha256").update(setup.writer.bytes!).digest("hex"), integrity.pdfSha256);
  assert.equal(integrity.mediaBox.join("x"), "0x0x612x792");
  assert.equal(integrity.printScaling, "None");
});

test("submits exact Letter/100%/no-fit settings and waits for physical confirmation", async () => {
  const setup = platform();
  assert.deepEqual(await setup.adapter.print(job()), { kind: "PRINTED_CORRECTLY" });
  assert.deepEqual(setup.transport.settings, { printerName: "printer-1", paper: "LETTER", scalePercent: 100, fitToPage: false, margins: "NONE", copies: 1 });
  assert.ok(Buffer.from(setup.transport.bytes!).subarray(0, 8).toString("latin1").startsWith("%PDF-1.7"));
  assert.equal(setup.confirmer.calls, 1);
});

test("does not submit to a missing or known non-Letter printer", async () => {
  const missing = platform();
  missing.transport.printers = [];
  assert.deepEqual(await missing.adapter.print(job()), { kind: "NOT_PRINTED", reasonCode: "PRINTER_NOT_FOUND", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" });
  assert.equal(missing.transport.bytes, undefined);

  const incompatible = platform();
  incompatible.transport.printers = [{ name: "printer-1", displayName: "Label", isDefault: true, paperSizes: ["A4"] }];
  assert.deepEqual(await incompatible.adapter.print(job()), { kind: "NOT_PRINTED", reasonCode: "LETTER_NOT_SUPPORTED", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" });
});

test("reports unknown Letter support as unverified and requires explicit confirmation", async () => {
  const setup = platform();
  setup.transport.printers = [{ name: "printer-1", displayName: "Unknown", isDefault: true }];
  assert.equal((await setup.adapter.listPrinters())[0]?.supportsLetter, false);
  assert.deepEqual(await setup.adapter.print(job()), { kind: "NOT_PRINTED", reasonCode: "LETTER_SUPPORT_NOT_CONFIRMED", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" });
  setup.capability.allow = true;
  assert.deepEqual(await setup.adapter.print(job()), { kind: "PRINTED_CORRECTLY" });
});

test("routes ambiguous spooler failure to the marked-paper path", async () => {
  const setup = platform();
  setup.transport.submission = { kind: "REJECTED", reason: "Print job failed", cancelledBeforeSubmit: false };
  assert.deepEqual(await setup.adapter.print(job()), { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: "Print job failed" });
  assert.equal(setup.confirmer.calls, 0);
});

test("refuses tampered plans before writing or printing", async () => {
  const setup = platform();
  const value = job();
  value.plan.generatedAt = "2026-09-20T00:00:00.000Z";
  await assert.rejects(setup.adapter.savePdf(value, resolve("bad.pdf")), /changed after it was queued/i);
  assert.equal(setup.writer.bytes, undefined);
});
