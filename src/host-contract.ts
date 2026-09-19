import { hashPrintPlan } from "./calibration.ts";
import { invariant } from "./errors.ts";
import type { PdfIntegrityRecord } from "./pdf-renderer-core.ts";
import type { Entitlement, PrintPlan } from "./types.ts";

export type NativePrintOutcome =
  | { kind: "PRINTED_CORRECTLY" }
  | { kind: "PAPER_MARKED_WITH_PROBLEM"; reasonCode: string }
  | { kind: "NOT_PRINTED"; reasonCode: string; deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" | "HOST_CONFIRMED_NO_OUTPUT" };

export interface PrinterDescriptor {
  key: string;
  displayName: string;
  isDefault: boolean;
  supportsLetter: boolean;
}

export interface ExactPrintJob {
  plan: PrintPlan;
  planHash: string;
  printerKey: string;
  paper: "LETTER";
  scalePercent: 100;
  fitToPage: false;
}

export interface WindowsPrintAdapter {
  listPrinters(): Promise<PrinterDescriptor[]>;
  savePdf(job: ExactPrintJob, destinationPath: string): Promise<PdfIntegrityRecord>;
  print(job: ExactPrintJob): Promise<NativePrintOutcome>;
}

export interface MicrosoftStoreEntitlementAdapter {
  refreshLifetimeEntitlement(): Promise<Entitlement>;
  purchaseLifetime(): Promise<Entitlement>;
  restoreLifetime(): Promise<Entitlement>;
}

export function exactPrintJob(plan: PrintPlan, selectedPrinterKey: string, expectedPlanHash: string): ExactPrintJob {
  invariant(plan.pages.length > 0 && plan.pages.every((page) => page.widthPt === 612 && page.heightPt === 792), "VALIDATION_ERROR", "Only exact US Letter print plans are supported.");
  invariant(plan.printerKey === selectedPrinterKey, "VALIDATION_ERROR", "Selected printer does not match the immutable print plan.", { expected: plan.printerKey, actual: selectedPrinterKey }, "validation.printer");
  const actualPlanHash = hashPrintPlan(plan); invariant(actualPlanHash === expectedPlanHash, "VALIDATION_ERROR", "Printable content no longer matches the durably queued plan.", { expectedPlanHash, actualPlanHash }, "validation.printPlanChanged");
  return { plan: structuredClone(plan), planHash: actualPlanHash, printerKey: selectedPrinterKey, paper: "LETTER", scalePercent: 100, fitToPage: false };
}
