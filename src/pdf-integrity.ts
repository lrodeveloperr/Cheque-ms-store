import { NORTH_AMERICAN_TOP_CHEQUE, STOCK_LAYOUTS } from "./calibration.ts";
import { PDF_FONT_CAP_HEIGHT_RATIO } from "./pdf-font.ts";
import { CANADIAN_PREVIEW_DATE_PATTERN, type RenderedPdfArtifact } from "./pdf-renderer-core.ts";
import type { PrintPlan } from "./types.ts";

export interface PdfInspection {
  pageCount: number;
  exactLetter: true;
  embeddedFonts: true;
  printScalingNone: true;
  fixedPageBoxes: true;
  micrBandClear: true;
  productionFurnitureAbsent: true;
  canadianDateClearancePt: number;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PDF integrity failure: ${message}`);
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function inspectPdfArtifact(artifact: RenderedPdfArtifact, plan: PrintPlan): PdfInspection {
  const raw = Buffer.from(artifact.bytes).toString("latin1");
  requireCondition(raw.startsWith("%PDF-1.7"), "unexpected PDF version");
  requireCondition(artifact.integrity.planHash.length === 64 && artifact.integrity.pdfSha256.length === 64, "missing SHA-256 evidence");
  requireCondition(artifact.integrity.checkIds.join("\u0000") === plan.checkIds.join("\u0000"), "check IDs differ from the rendered plan");
  requireCondition(artifact.integrity.pageCount === plan.pages.length, "page count differs from the rendered plan");
  requireCondition((raw.match(/\/Type \/Page\b/g) ?? []).length === plan.pages.length, "PDF page tree count is wrong");
  requireCondition((raw.match(/\/MediaBox \[0 0 612 792\]/g) ?? []).length === plan.pages.length, "MediaBox is not exact Letter");
  requireCondition((raw.match(/\/CropBox \[0 0 612 792\]/g) ?? []).length === plan.pages.length, "CropBox differs from MediaBox");
  requireCondition((raw.match(/\/TrimBox \[0 0 612 792\]/g) ?? []).length === plan.pages.length, "TrimBox differs from MediaBox");
  requireCondition((raw.match(/\/Rotate 0/g) ?? []).length === plan.pages.length, "page rotation is not fixed at zero");
  requireCondition(raw.includes("/PrintScaling /None") && raw.includes("/PickTrayByPDFSize true"), "actual-size viewer preferences are absent");
  requireCondition((raw.match(/\/FontFile2 /g) ?? []).length === 2, "both approved fonts must be embedded");
  requireCondition(!raw.includes("/Encrypt") && !raw.includes("/AcroForm") && !raw.includes("/JavaScript"), "active or encrypted PDF content is prohibited");

  for (const page of plan.pages) {
    for (const element of page.elements) {
      if (element.kind === "line") continue;
      requireCondition(element.xPt >= 0 && element.yPt >= 0 && element.xPt + element.widthPt <= 612 && element.yPt + element.heightPt <= 792, `${element.role} leaves the page`);
    }
  }
  const layout = STOCK_LAYOUTS[plan.layout];
  for (const page of plan.pages) for (const origin of layout.origins) {
    const band = { x: 0, y: origin.y + NORTH_AMERICAN_TOP_CHEQUE.micrClearBand.topPt, width: 612, height: NORTH_AMERICAN_TOP_CHEQUE.micrClearBand.heightPt };
    for (const element of page.elements) {
      if (element.kind !== "text") continue;
      requireCondition(!intersects({ x: element.xPt, y: element.yPt, width: element.widthPt, height: element.heightPt }, band), `${element.role} enters the MICR band`);
    }
  }

  let productionFurnitureAbsent = true;
  if (artifact.integrity.renderMode === "production") {
    productionFurnitureAbsent = !raw.includes("WORKSBIEN BROWSER TEST") && !raw.includes("CHECK PREVIEW") && !raw.includes("Y Y Y Y M M D D") && !raw.includes("A A A A M M J J") && !raw.includes("SAMPLE ");
    requireCondition(productionFurnitureAbsent, "production PDF contains sample or simulated-stock furniture");
  }

  const amountTop = NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.yPt;
  const datePatternInkBottom = CANADIAN_PREVIEW_DATE_PATTERN.yPt + CANADIAN_PREVIEW_DATE_PATTERN.fontSizePt * PDF_FONT_CAP_HEIGHT_RATIO;
  const canadianDateClearancePt = amountTop - datePatternInkBottom;
  requireCondition(canadianDateClearancePt >= NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount.clearPt, "Canadian date indicators do not have the normal 0.25-inch amount-box clearance");
  return { pageCount: plan.pages.length, exactLetter: true, embeddedFonts: true, printScalingNone: true, fixedPageBoxes: true, micrBandClear: true, productionFurnitureAbsent, canadianDateClearancePt };
}
