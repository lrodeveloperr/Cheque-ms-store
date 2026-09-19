import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { localize } from "../src/localization.ts";
import { renderPdfArtifact, type PdfIntegrityRecord, type PdfRenderMode } from "../src/pdf-renderer-core.ts";
import type { PrintPlan } from "../src/types.ts";

export type { PdfIntegrityRecord, PdfRenderMode } from "../src/pdf-renderer-core.ts";

export function renderPrintPlanPdfArtifact(plan: PrintPlan, mode?: PdfRenderMode) {
  return renderPdfArtifact(plan, localize, mode);
}

export function renderPrintPlanPdf(plan: PrintPlan, mode?: PdfRenderMode): Buffer {
  return Buffer.from(renderPrintPlanPdfArtifact(plan, mode).bytes);
}

export async function writePrintPlanPdf(path: string, plan: PrintPlan, mode?: PdfRenderMode): Promise<PdfIntegrityRecord> {
  await mkdir(dirname(path), { recursive: true });
  const artifact = renderPrintPlanPdfArtifact(plan, mode);
  await writeFile(path, artifact.bytes);
  return artifact.integrity;
}
