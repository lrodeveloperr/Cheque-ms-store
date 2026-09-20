import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ElectronBrowserWindowConstructor } from "../../src/platform/electron-adapters.ts";
import { ElectronNativePrintTransport } from "../../src/platform/electron-adapters.ts";

test("Electron transport loads the supplied PDF and uses exact native print options", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-print-"));
  let loaded = Buffer.alloc(0);
  let options: Record<string, unknown> | undefined;
  let destroyed = false;
  class FakeWindow {
    webContents = {
      getPrintersAsync: async () => [{ name: "system-name", displayName: "Office", isDefault: true }],
      print: (value: Record<string, unknown>, callback: (success: boolean, reason: string) => void) => { options = value; callback(true, ""); }
    };
    async loadFile(path: string) { loaded = await readFile(path); }
    destroy() { destroyed = true; }
  }
  const transport = new ElectronNativePrintTransport(FakeWindow as unknown as ElectronBrowserWindowConstructor, directory);
  assert.deepEqual(await transport.listPrinters(), [{ name: "system-name", displayName: "Office", isDefault: true }]);
  const bytes = Buffer.from("%PDF-1.7\nlocked");
  assert.deepEqual(await transport.submitPdf(bytes, { printerName: "system-name", paper: "LETTER", scalePercent: 100, fitToPage: false, margins: "NONE", copies: 1 }), { kind: "SUBMITTED" });
  assert.deepEqual(loaded, bytes);
  assert.deepEqual(options, {
    silent: true, printBackground: true, deviceName: "system-name", color: false,
    margins: { marginType: "none" }, landscape: false, scaleFactor: 100,
    pagesPerSheet: 1, collate: true, copies: 1, pageSize: "Letter"
  });
  assert.equal(destroyed, true);
});

test("Electron callback failure is treated as delivery-unknown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-print-"));
  class FailingWindow {
    webContents = {
      getPrintersAsync: async () => [],
      print: (_value: Record<string, unknown>, callback: (success: boolean, reason: string) => void) => callback(false, "Print job failed")
    };
    async loadFile() {}
    destroy() {}
  }
  const transport = new ElectronNativePrintTransport(FailingWindow as unknown as ElectronBrowserWindowConstructor, directory);
  assert.deepEqual(await transport.submitPdf(Buffer.from("%PDF-1.7"), { printerName: "p", paper: "LETTER", scalePercent: 100, fitToPage: false, margins: "NONE", copies: 1 }), {
    kind: "REJECTED", reason: "Print job failed", cancelledBeforeSubmit: false
  });
});

test("Electron printer discovery is bounded and destroys its hidden window", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worksbien-print-"));
  let destroyed = false;
  class HangingWindow {
    webContents = {
      getPrintersAsync: () => new Promise<never>(() => undefined),
      print: () => undefined,
    };
    async loadFile() {}
    destroy() { destroyed = true; }
  }
  const transport = new ElectronNativePrintTransport(
    HangingWindow as unknown as ElectronBrowserWindowConstructor,
    directory,
    { printerDiscoveryTimeoutMs: 10 },
  );

  await assert.rejects(transport.listPrinters(), /printer discovery timed out/i);
  assert.equal(destroyed, true);
});
