import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NativePrinterInfo, NativePrintSettings, NativePrintTransport, PrintSubmission, SafeStoragePort, SingleInstanceAppPort } from "./contracts.ts";

interface AsyncDecryptResult { result: string; shouldReEncrypt: boolean }

export interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  isAsyncEncryptionAvailable?: () => Promise<boolean>;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  encryptStringAsync?: (value: string) => Promise<Buffer>;
  decryptStringAsync?: (value: Buffer) => Promise<AsyncDecryptResult>;
}

/** Uses Electron's DPAPI-backed safeStorage when running on Windows. */
export class ElectronSafeStoragePort implements SafeStoragePort {
  readonly #safeStorage: ElectronSafeStorageLike;

  constructor(safeStorage: ElectronSafeStorageLike) { this.#safeStorage = safeStorage; }

  async isEncryptionAvailable(): Promise<boolean> {
    if (this.#safeStorage.isAsyncEncryptionAvailable) return this.#safeStorage.isAsyncEncryptionAvailable();
    return this.#safeStorage.isEncryptionAvailable();
  }

  async encryptString(value: string): Promise<Uint8Array> {
    return this.#safeStorage.encryptStringAsync ? this.#safeStorage.encryptStringAsync(value) : this.#safeStorage.encryptString(value);
  }

  async decryptString(value: Uint8Array): Promise<{ value: string; shouldReEncrypt: boolean }> {
    if (this.#safeStorage.decryptStringAsync) {
      const decrypted = await this.#safeStorage.decryptStringAsync(Buffer.from(value));
      return { value: decrypted.result, shouldReEncrypt: decrypted.shouldReEncrypt };
    }
    return { value: this.#safeStorage.decryptString(Buffer.from(value)), shouldReEncrypt: false };
  }
}

interface ElectronPrinterInfo {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: number;
}

interface ElectronWebContentsLike {
  getPrintersAsync(): Promise<ElectronPrinterInfo[]>;
  print(options: {
    silent: boolean;
    printBackground: boolean;
    deviceName: string;
    color: boolean;
    margins: { marginType: "none" };
    landscape: boolean;
    scaleFactor: number;
    pagesPerSheet: number;
    collate: boolean;
    copies: number;
    pageSize: "Letter";
  }, callback: (success: boolean, failureReason: string) => void): void;
}

interface ElectronBrowserWindowLike {
  readonly webContents: ElectronWebContentsLike;
  loadFile(path: string): Promise<void>;
  destroy(): void;
}

export interface ElectronBrowserWindowConstructor {
  new (options: Record<string, unknown>): ElectronBrowserWindowLike;
}

/**
 * Sends the locked renderer's PDF bytes to Chromium's native Windows print path.
 * It never calls printToPDF and therefore never substitutes a second PDF render.
 */
export class ElectronNativePrintTransport implements NativePrintTransport {
  readonly #BrowserWindow: ElectronBrowserWindowConstructor;
  readonly #temporaryDirectory: string;

  constructor(BrowserWindow: ElectronBrowserWindowConstructor, temporaryDirectory: string) {
    this.#BrowserWindow = BrowserWindow;
    this.#temporaryDirectory = temporaryDirectory;
  }

  #window(): ElectronBrowserWindowLike {
    return new this.#BrowserWindow({
      show: false,
      width: 612,
      height: 792,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true }
    });
  }

  async listPrinters(): Promise<readonly NativePrinterInfo[]> {
    const window = this.#window();
    try { return await window.webContents.getPrintersAsync(); }
    finally { window.destroy(); }
  }

  async submitPdf(pdfBytes: Uint8Array, settings: NativePrintSettings): Promise<PrintSubmission> {
    if (settings.paper !== "LETTER" || settings.scalePercent !== 100 || settings.fitToPage !== false || settings.margins !== "NONE" || settings.copies !== 1) {
      throw new Error("Electron print transport received non-exact print settings.");
    }
    await mkdir(this.#temporaryDirectory, { recursive: true });
    const pdfPath = join(this.#temporaryDirectory, `print-${randomUUID()}.pdf`);
    await writeFile(pdfPath, pdfBytes, { mode: 0o600, flag: "wx" });
    const window = this.#window();
    try {
      try { await window.loadFile(pdfPath); }
      catch (error) {
        return { kind: "REJECTED", reason: error instanceof Error ? error.message : "PDF_LOAD_FAILED", cancelledBeforeSubmit: true };
      }
      return await new Promise<PrintSubmission>((resolve) => {
        let settled = false;
        const finish = (result: PrintSubmission) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(result); };
        const timeout = setTimeout(() => finish({ kind: "REJECTED", reason: "PRINT_SUBMISSION_TIMEOUT", cancelledBeforeSubmit: false }), 30_000);
        try {
          window.webContents.print({
            silent: true,
            printBackground: true,
            deviceName: settings.printerName,
            color: false,
            margins: { marginType: "none" },
            landscape: false,
            scaleFactor: 100,
            pagesPerSheet: 1,
            collate: true,
            copies: 1,
            pageSize: "Letter"
          }, (success, failureReason) => finish(success
            ? { kind: "SUBMITTED" }
            : { kind: "REJECTED", reason: failureReason || "PRINT_SUBMISSION_FAILED", cancelledBeforeSubmit: false }));
        } catch (error) {
          finish({ kind: "REJECTED", reason: error instanceof Error ? error.message : "PRINT_SUBMISSION_FAILED", cancelledBeforeSubmit: false });
        }
      });
    } finally {
      window.destroy();
      await unlink(pdfPath).catch(() => undefined);
    }
  }
}

interface ElectronAppLike {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  releaseSingleInstanceLock(): void;
  quit(): void;
  on(event: "second-instance", listener: () => void): void;
}

export class ElectronSingleInstanceAppPort implements SingleInstanceAppPort {
  readonly #app: ElectronAppLike;
  constructor(app: ElectronAppLike) { this.#app = app; }
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean { return this.#app.requestSingleInstanceLock(additionalData); }
  releaseSingleInstanceLock(): void { this.#app.releaseSingleInstanceLock(); }
  quit(): void { this.#app.quit(); }
  onSecondInstance(listener: () => void): void { this.#app.on("second-instance", listener); }
}
