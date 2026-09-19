import { createHash } from "node:crypto";
import { hashPrintPlan } from "../../../src/calibration.ts";
import type { ExactPrintJob, NativePrintOutcome, PrinterDescriptor, WindowsPrintAdapter } from "../../../src/host-contract.ts";
import { inspectPdfArtifact } from "../../../src/pdf-integrity.ts";
import { renderPdfArtifact, type PdfIntegrityRecord, type PdfLocalizer } from "../../../src/pdf-renderer-core.ts";
import type { NativePrintSettings, NativePrintTransport, PdfFileWriter, PrintOutcomeConfirmer, UnknownLetterCapabilityConfirmer } from "./contracts.ts";
import { requirePdfPath } from "./paths.ts";

const LETTER_NAMES = new Set(["letter", "na_letter_8.5x11in", "8.5x11", "8.5 x 11"]);

type LetterCapability = "VERIFIED" | "UNSUPPORTED" | "UNKNOWN";

function letterCapability(paperSizes: readonly string[] | undefined): LetterCapability {
  if (paperSizes === undefined || paperSizes.length === 0) return "UNKNOWN";
  return paperSizes.some((value) => LETTER_NAMES.has(value.trim().toLocaleLowerCase("en-US"))) ? "VERIFIED" : "UNSUPPORTED";
}

function requireExactJob(job: ExactPrintJob): void {
  if (job.paper !== "LETTER" || job.scalePercent !== 100 || job.fitToPage !== false) {
    throw new Error("Only Letter, actual-size, no-fit print jobs are allowed.");
  }
  if (job.plan.printerKey !== job.printerKey) throw new Error("The queued printer differs from the selected printer.");
  if (hashPrintPlan(job.plan) !== job.planHash) throw new Error("The print plan changed after it was queued.");
  if (job.plan.pages.length === 0 || job.plan.pages.some((page) => page.widthPt !== 612 || page.heightPt !== 792)) {
    throw new Error("Every printed page must be exact US Letter (612 x 792 points).");
  }
}

export class WindowsPdfPrintPlatform implements WindowsPrintAdapter {
  readonly #transport: NativePrintTransport;
  readonly #fileWriter: PdfFileWriter;
  readonly #confirmOutcome: PrintOutcomeConfirmer;
  readonly #confirmUnknownLetter: UnknownLetterCapabilityConfirmer;
  readonly #localize: PdfLocalizer;

  constructor(options: {
    transport: NativePrintTransport;
    fileWriter: PdfFileWriter;
    confirmOutcome: PrintOutcomeConfirmer;
    confirmUnknownLetter: UnknownLetterCapabilityConfirmer;
    localize: PdfLocalizer;
  }) {
    this.#transport = options.transport;
    this.#fileWriter = options.fileWriter;
    this.#confirmOutcome = options.confirmOutcome;
    this.#confirmUnknownLetter = options.confirmUnknownLetter;
    this.#localize = options.localize;
  }

  #descriptors(printers: readonly Awaited<ReturnType<NativePrintTransport["listPrinters"]>>[number][]): PrinterDescriptor[] {
    const seen = new Set<string>();
    return printers.flatMap((printer) => {
      const key = printer.name.trim();
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{
        key,
        displayName: printer.displayName?.trim() || key,
        isDefault: printer.isDefault === true,
        supportsLetter: letterCapability(printer.paperSizes) === "VERIFIED"
      }];
    }).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.displayName.localeCompare(right.displayName));
  }

  async listPrinters(): Promise<PrinterDescriptor[]> {
    return this.#descriptors(await this.#transport.listPrinters());
  }

  async savePdf(job: ExactPrintJob, destinationPath: string): Promise<PdfIntegrityRecord> {
    requireExactJob(job);
    const artifact = renderPdfArtifact(job.plan, this.#localize);
    inspectPdfArtifact(artifact, job.plan);
    if (artifact.integrity.planHash !== job.planHash) throw new Error("Rendered PDF does not match the queued plan.");
    const actualHash = createHash("sha256").update(artifact.bytes).digest("hex");
    if (actualHash !== artifact.integrity.pdfSha256) throw new Error("Rendered PDF integrity evidence is inconsistent.");
    await this.#fileWriter.writeAtomically(requirePdfPath(destinationPath), artifact.bytes);
    return artifact.integrity;
  }

  async print(job: ExactPrintJob): Promise<NativePrintOutcome> {
    requireExactJob(job);
    const nativePrinters = await this.#transport.listPrinters();
    const nativePrinter = nativePrinters.find((candidate) => candidate.name.trim() === job.printerKey);
    const known = this.#descriptors(nativePrinters);
    const printer = known.find((candidate) => candidate.key === job.printerKey);
    if (!printer) return { kind: "NOT_PRINTED", reasonCode: "PRINTER_NOT_FOUND", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" };
    const capability = letterCapability(nativePrinter?.paperSizes);
    if (capability === "UNSUPPORTED") return { kind: "NOT_PRINTED", reasonCode: "LETTER_NOT_SUPPORTED", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" };
    if (capability === "UNKNOWN" && !await this.#confirmUnknownLetter.confirmUnverifiedLetterCapability(printer)) {
      return { kind: "NOT_PRINTED", reasonCode: "LETTER_SUPPORT_NOT_CONFIRMED", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" };
    }

    const artifact = renderPdfArtifact(job.plan, this.#localize);
    inspectPdfArtifact(artifact, job.plan);
    if (artifact.integrity.planHash !== job.planHash) throw new Error("Rendered PDF does not match the queued plan.");
    const actualHash = createHash("sha256").update(artifact.bytes).digest("hex");
    if (actualHash !== artifact.integrity.pdfSha256) throw new Error("Rendered PDF integrity evidence is inconsistent.");
    const settings: NativePrintSettings = {
      printerName: job.printerKey,
      paper: "LETTER",
      scalePercent: 100,
      fitToPage: false,
      margins: "NONE",
      copies: 1
    };
    const submission = await this.#transport.submitPdf(artifact.bytes, settings);
    if (submission.kind === "REJECTED" && submission.cancelledBeforeSubmit) {
      return {
        kind: "NOT_PRINTED",
        reasonCode: submission.reason,
        deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT"
      };
    }
    if (submission.kind === "REJECTED") return { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: submission.reason };
    return this.#confirmOutcome.confirmPhysicalOutcome(job, submission);
  }
}
