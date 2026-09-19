import type { ExactPrintJob, NativePrintOutcome, PrinterDescriptor } from "../../../src/host-contract.ts";
import type { PdfIntegrityRecord } from "../../../src/pdf-renderer-core.ts";
import type { EngineState, Entitlement, PrintPlan } from "../../../src/types.ts";
import type { InstanceLock, RestoreResult } from "../../../src/persistence.ts";

export interface SafeStoragePort {
  isEncryptionAvailable(): Promise<boolean>;
  encryptString(value: string): Promise<Uint8Array>;
  decryptString(value: Uint8Array): Promise<{ value: string; shouldReEncrypt: boolean }>;
}

export interface SecretStorePort {
  getOrCreateStorageSecret(): Promise<string>;
}

export interface StateStorePort {
  acquireInstanceLock(path: string): Promise<InstanceLock>;
  recoverInterruptedSave(path: string, secret: string): Promise<"NONE" | "PROMOTED_TEMP" | "DISCARDED_TEMP">;
  load(path: string, secret: string): Promise<EngineState>;
  save(path: string, state: EngineState, secret: string, expectedRevision?: number): Promise<void>;
  createBackup(sourcePath: string, backupPath: string, sourceSecret: string, recoveryPassphrase: string): Promise<void>;
  restoreBackup(backupPath: string, destinationPath: string, backupPassphrase: string, destinationSecret: string, expectedRevision?: number): Promise<RestoreResult>;
  queuePrintDurably(path: string, secret: string, expectedRevision: number, input: {
    checkIds: string[];
    calibrationProfileId: string;
    printerKey: string;
    stockKey: string;
    startSlot?: number;
    sheetIds?: string[];
  }): Promise<{ state: EngineState; plan: PrintPlan; planHash: string; attemptIds: string[] }>;
}

export interface AppPaths {
  readonly dataDirectory: string;
  readonly stateFile: string;
  readonly secureSecretFile: string;
  readonly guardDirectory: string;
  readonly temporaryDirectory: string;
}

export interface NativePrinterInfo {
  readonly name: string;
  readonly displayName?: string;
  readonly isDefault?: boolean;
  readonly status?: number;
  readonly paperSizes?: readonly string[];
}

export interface NativePrintSettings {
  readonly printerName: string;
  readonly paper: "LETTER";
  readonly scalePercent: 100;
  readonly fitToPage: false;
  readonly margins: "NONE";
  readonly copies: 1;
}

export type PrintSubmission =
  | { readonly kind: "SUBMITTED"; readonly jobId?: string }
  | { readonly kind: "REJECTED"; readonly reason: string; readonly cancelledBeforeSubmit: boolean };

export interface NativePrintTransport {
  listPrinters(): Promise<readonly NativePrinterInfo[]>;
  submitPdf(pdfBytes: Uint8Array, settings: NativePrintSettings): Promise<PrintSubmission>;
}

/** Physical success cannot be inferred from a spooler callback; the host must ask the operator. */
export interface PrintOutcomeConfirmer {
  confirmPhysicalOutcome(job: ExactPrintJob, submission: Extract<PrintSubmission, { kind: "SUBMITTED" }>): Promise<NativePrintOutcome>;
}

export interface UnknownLetterCapabilityConfirmer {
  confirmUnverifiedLetterCapability(printer: PrinterDescriptor): Promise<boolean>;
}

export interface PdfFileWriter {
  writeAtomically(destinationPath: string, bytes: Uint8Array): Promise<void>;
}

export interface SavePdfResult {
  readonly destinationPath: string;
  readonly integrity: PdfIntegrityRecord;
}

export interface SingleInstanceAppPort {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  releaseSingleInstanceLock(): void;
  quit(): void;
  onSecondInstance(listener: () => void): void;
}

export interface SingleInstanceLease {
  readonly isPrimary: boolean;
  release(): void;
}

export interface PlatformSession {
  readonly state: EngineState;
  readonly secret: string;
  readonly recovery: "NONE" | "PROMOTED_TEMP" | "DISCARDED_TEMP";
  save(nextState: EngineState, expectedRevision?: number): Promise<void>;
  createBackup(destinationPath: string, recoveryPassphrase: string): Promise<void>;
  restoreBackup(sourcePath: string, backupPassphrase: string, expectedRevision?: number): Promise<RestoreResult>;
  queuePrint(input: {
    checkIds: string[];
    calibrationProfileId: string;
    printerKey: string;
    stockKey: string;
    startSlot?: number;
    sheetIds?: string[];
  }, expectedRevision?: number): Promise<{ state: EngineState; plan: PrintPlan; planHash: string; attemptIds: string[] }>;
  close(): Promise<void>;
}

export type InitialStateFactory = (entitlement: Entitlement) => EngineState;

export interface WindowsPrintPlatform {
  listPrinters(): Promise<PrinterDescriptor[]>;
  savePdf(job: ExactPrintJob, destinationPath: string): Promise<PdfIntegrityRecord>;
  print(job: ExactPrintJob): Promise<NativePrintOutcome>;
}
