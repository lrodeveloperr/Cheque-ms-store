import { createHash } from "node:crypto";
import { hashPrintPlan, NORTH_AMERICAN_TOP_CHEQUE, STOCK_LAYOUTS } from "./calibration.ts";
import { WORKSBIEN_SANS_BOLD, WORKSBIEN_SANS_REGULAR } from "./pdf-font-assets.ts";
import { estimatePdfBoldTextWidthPt, estimatePdfTextWidthPt, PDF_FONT_CAP_HEIGHT_RATIO, pdfBoldWidths, pdfRegularWidths, winAnsiByte } from "./pdf-font.ts";
import type { PrintPage, PrintPlan, TextElement } from "./types.ts";

export type PdfRenderMode = "preview" | "production";
export type PdfLocalizer = (locale: PrintPlan["locale"], key: string) => string;

export interface PdfIntegrityRecord {
  documentId: string;
  documentKind: PrintPlan["documentKind"];
  planHash: string;
  pdfSha256: string;
  checkIds: string[];
  pageCount: number;
  mediaBox: [0, 0, 612, 792];
  renderMode: PdfRenderMode;
  font: "WorksBienSans-Embedded";
  printScaling: "None";
}

export interface RenderedPdfArtifact {
  bytes: Uint8Array;
  integrity: PdfIntegrityRecord;
}

const POINTS_PER_INCH = 72;
const HALF_INCH = POINTS_PER_INCH / 2;
const CONTENT_LEFT = HALF_INCH;
const CONTENT_RIGHT = 8 * POINTS_PER_INCH;
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT;
export const CANADIAN_PREVIEW_DATE_PATTERN = { xPt: 505.3, yPt: 72, fontSizePt: 6 } as const;

function n(value: number): string { return Number(value.toFixed(3)).toString(); }

function pdfString(value: string): string {
  let encoded = "";
  for (const character of value) {
    const byte = winAnsiByte(character);
    if (byte === undefined) throw new Error(`Unsupported PDF character: ${character}`);
    if (byte >= 0x20 && byte <= 0x7e) encoded += /[\\()]/.test(character) ? `\\${character}` : character;
    else encoded += `\\${byte.toString(8).padStart(3, "0")}`;
  }
  return encoded;
}

function textX(element: TextElement): number {
  const width = estimatePdfTextWidthPt(element.text, element.fontSizePt);
  if (element.align === "right") return element.xPt + element.widthPt - width;
  if (element.align === "center") return element.xPt + (element.widthPt - width) / 2;
  return element.xPt;
}

function drawText(page: PrintPage, value: string, x: number, y: number, size: number, font = "F1", gray = 0): string[] {
  return [
    `${n(gray)} g`, "BT", `/${font} ${n(size)} Tf`,
    `1 0 0 1 ${n(x)} ${n(page.heightPt - y - size * PDF_FONT_CAP_HEIGHT_RATIO)} Tm`,
    `(${pdfString(value)}) Tj`, "ET"
  ];
}

function line(page: PrintPage, x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.72): string[] {
  return [`${n(gray)} G`, `${n(width)} w`, `${n(x1)} ${n(page.heightPt - y1)} m`, `${n(x2)} ${n(page.heightPt - y2)} l S`];
}

function rect(page: PrintPage, x: number, y: number, width: number, height: number, strokeGray = 0.72, lineWidth = 0.5): string[] {
  return [`${n(strokeGray)} G`, `${n(lineWidth)} w`, `${n(x)} ${n(page.heightPt - y - height)} ${n(width)} ${n(height)} re S`];
}

function checkPreviewBackground(plan: PrintPlan, page: PrintPage, localize: PdfLocalizer, addPreviewWatermark: boolean): string[] {
  const commands: string[] = [];
  const amount = NORTH_AMERICAN_TOP_CHEQUE.convenienceAmount;
  const layout = STOCK_LAYOUTS[plan.layout];
  for (const origin of layout.origins) {
    const originY = origin.y;
    commands.push("q", "0.96 g", `10 ${n(page.heightPt - originY - 242)} 592 232 re f`, "Q");
    commands.push(...rect(page, 10, originY + 10, 592, 232, 0.56, 0.75));
    commands.push(...drawText(page, "WORKSBIEN BROWSER TEST", 20, originY + 20, 9, "F2", 0.2));
    commands.push(...drawText(page, localize(plan.locale, "preview.checkPreview"), 20, originY + 35, 7, "F1", 0.48));
    commands.push(...drawText(page, localize(plan.locale, "preview.date"), 450, originY + 36, plan.bankCountry === "CA" ? 8 : 6.5, "F2", 0.42));
    commands.push(...drawText(page, localize(plan.locale, "preview.payToOrder"), 83, originY + 89, 6.5, "F2", 0.42));
    commands.push(...line(page, 83, originY + 124, 422, originY + 124, 0.45, 0.64));
    commands.push(...rect(page, amount.xPt, originY + amount.yPt, amount.widthPt, amount.heightPt, 0.64, 0.45));
    commands.push(...drawText(page, localize(plan.locale, "preview.amountWords"), 30, originY + 133, 6.5, "F2", 0.42));
    commands.push(...drawText(page, localize(plan.locale, "preview.memo"), 72, originY + 170, 6.5, "F2", 0.42));
    commands.push(...line(page, 72, originY + 200, 317, originY + 200, 0.45, 0.64));
    commands.push(...line(page, 365, originY + 200, 560, originY + 200, 0.45, 0.64));
    commands.push(...drawText(page, localize(plan.locale, "preview.authorizedSignature"), 424.7, originY + 190, 6, "F1", 0.5));
    if (plan.bankCountry === "CA") {
      commands.push(...drawText(page, localize(plan.locale, "preview.datePattern"), CANADIAN_PREVIEW_DATE_PATTERN.xPt, originY + CANADIAN_PREVIEW_DATE_PATTERN.yPt, CANADIAN_PREVIEW_DATE_PATTERN.fontSizePt, "F1", 0.48));
      commands.push(...drawText(page, "$", 441, originY + 107, 10, "F1", 0));
    } else {
      commands.push(...line(page, 450, originY + 76, 560, originY + 76, 0.45, 0.64));
      commands.push(...line(page, 30, originY + 166, 560, originY + 166, 0.45, 0.64));
    }
    if (addPreviewWatermark) {
      const watermark = localize(plan.locale, "sample.overlay");
      commands.push(...drawText(page, watermark, (page.widthPt - estimatePdfBoldTextWidthPt(watermark, 10)) / 2, originY + 25, 10, "F2", 0.82));
    }
  }
  for (const stub of layout.voucherStubs) {
    commands.push(...rect(page, 10, stub.topPt + 10, 592, stub.heightPt - 20, 0.68, 0.55));
    commands.push(...drawText(page, localize(plan.locale, "preview.paymentRecord"), 20, stub.topPt + 33, 8, "F2", 0.3));
    commands.push(...drawText(page, localize(plan.locale, "preview.checkDetails"), 20, stub.dataYPt - 24, 7, "F2", 0.48));
    commands.push(...line(page, 20, stub.dataYPt + 18, 592, stub.dataYPt + 18, 0.45, 0.68));
    commands.push(...drawText(page, localize(plan.locale, "preview.retainPaymentRecord"), 20, stub.dataYPt + 42, 7, "F1", 0.48));
    commands.push(...drawText(page, localize(plan.locale, "preview.notes"), 20, stub.dataYPt + 80, 7, "F2", 0.48));
    commands.push(...line(page, 20, stub.dataYPt + 104, 592, stub.dataYPt + 104, 0.4, 0.78));
    commands.push(...line(page, 20, stub.dataYPt + 134, 592, stub.dataYPt + 134, 0.4, 0.78));
  }
  return commands;
}

function calibrationPreviewBackground(page: PrintPage, plan: PrintPlan, localize: PdfLocalizer): string[] {
  const commands: string[] = ["q", "0.985 g", `${CONTENT_LEFT} 36 ${CONTENT_WIDTH} 720 re f`, "Q"];
  for (let x = CONTENT_LEFT; x <= CONTENT_RIGHT; x += HALF_INCH) commands.push(...line(page, x, 36, x, 756, x % POINTS_PER_INCH === HALF_INCH ? 0.35 : 0.25, x % POINTS_PER_INCH === HALF_INCH ? 0.75 : 0.88));
  for (let y = 36; y <= 756; y += HALF_INCH) commands.push(...line(page, CONTENT_LEFT, y, CONTENT_RIGHT, y, y % POINTS_PER_INCH === HALF_INCH ? 0.35 : 0.25, y % POINTS_PER_INCH === HALF_INCH ? 0.75 : 0.88));
  commands.push(...rect(page, CONTENT_LEFT, 36, CONTENT_WIDTH, 720, 0.42, 0.8));
  for (let inch = 1; inch <= 7; inch++) {
    const x = CONTENT_LEFT + inch * POINTS_PER_INCH;
    commands.push(...line(page, x, 29, x, 36, 0.55, 0.35));
    commands.push(...drawText(page, `${inch} in`, x - 7, 19, 5.5, "F1", 0.35));
    commands.push(...drawText(page, `${(inch * 25.4).toFixed(1)} mm`, x - 13, 770, 5.5, "F1", 0.35));
  }
  for (let inch = 1; inch <= 10; inch++) {
    const y = 36 + inch * POINTS_PER_INCH;
    commands.push(...line(page, 29, y, CONTENT_LEFT, y, 0.55, 0.35));
    commands.push(...drawText(page, `${inch} in`, 12, y - 2, 5.5, "F1", 0.35));
    commands.push(...drawText(page, `${(inch * 25.4).toFixed(1)} mm`, 555, y - 2, 5.5, "F1", 0.35));
  }
  commands.push("q", "1 g", `72 ${n(page.heightPt - 130)} 468 70 re f`, "Q");
  commands.push(...drawText(page, localize(plan.locale, "preview.calibrationTitle"), 72, 63, 15, "F2", 0.12));
  commands.push(...drawText(page, localize(plan.locale, "preview.calibrationInstruction"), 72, 88, 8.5, "F1", 0.28));
  commands.push(...drawText(page, localize(plan.locale, "preview.calibrationMeasure"), 72, 104, 8.5, "F1", 0.28));
  commands.push(...line(page, 306, 140, 306, 652, 0.7, 0.5));
  commands.push(...line(page, 108, 396, 504, 396, 0.7, 0.5));
  commands.push("q", "1 g", `108 ${n(page.heightPt - 411)} 396 38 re f`, "Q");
  return commands;
}

function pageContent(page: PrintPage, plan: PrintPlan, mode: PdfRenderMode, localize: PdfLocalizer): string {
  const commands = ["q", "0 0 0 RG", "0 0 0 rg"];
  if (plan.documentKind === "CALIBRATION") commands.push(...calibrationPreviewBackground(page, plan, localize));
  else if (mode === "preview") commands.push(...checkPreviewBackground(plan, page, localize, plan.documentKind === "CHECKS"));
  for (const element of page.elements) {
    if (element.kind === "line") commands.push("0 G", `${n(element.strokeWidthPt)} w`, `${n(element.x1Pt)} ${n(page.heightPt - element.y1Pt)} m`, `${n(element.x2Pt)} ${n(page.heightPt - element.y2Pt)} l S`);
    else commands.push(...drawText(page, element.text, textX(element), element.yPt, element.fontSizePt, "F1", element.role === "overlay" ? 0.82 : 0));
  }
  commands.push("Q");
  return `${commands.join("\n")}\n`;
}

function cp1252Unicode(byte: number): number | undefined {
  if (byte >= 0x20 && byte <= 0x7e || byte >= 0xa0) return byte;
  const extras: Record<number, number> = { 0x80:0x20ac,0x82:0x201a,0x83:0x0192,0x84:0x201e,0x85:0x2026,0x86:0x2020,0x87:0x2021,0x88:0x02c6,0x89:0x2030,0x8a:0x0160,0x8b:0x2039,0x8c:0x0152,0x8e:0x017d,0x91:0x2018,0x92:0x2019,0x93:0x201c,0x94:0x201d,0x95:0x2022,0x96:0x2013,0x97:0x2014,0x98:0x02dc,0x99:0x2122,0x9a:0x0161,0x9b:0x203a,0x9c:0x0153,0x9e:0x017e,0x9f:0x0178 };
  return extras[byte];
}

function toUnicodeCMap(): string {
  const entries: string[] = [];
  for (let byte = 0x20; byte <= 0xff; byte++) {
    const unicode = cp1252Unicode(byte);
    if (unicode !== undefined) entries.push(`<${byte.toString(16).padStart(2, "0")}> <${unicode.toString(16).padStart(4, "0")}>`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /WorksBienWinAnsi def\n/CMapType 2 def\n1 begincodespacerange\n<20> <FF>\nendcodespacerange\n${entries.length} beginbfchar\n${entries.join("\n")}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

function ascii(value: string): Uint8Array { return new TextEncoder().encode(value); }

function concat(chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function stream(bytes: Uint8Array, extras = ""): Uint8Array {
  return concat([ascii(`<< /Length ${bytes.length}${extras} >>\nstream\n`), bytes, ascii("\nendstream")]);
}

function fontDictionary(baseName: string, widths: readonly number[], descriptorId: number, toUnicodeId: number): string {
  return `<< /Type /Font /Subtype /TrueType /BaseFont /${baseName} /FirstChar 32 /LastChar 255 /Widths [${widths.join(" ")}] /FontDescriptor ${descriptorId} 0 R /Encoding /WinAnsiEncoding /ToUnicode ${toUnicodeId} 0 R >>`;
}

function buildPdf(plan: PrintPlan, mode: PdfRenderMode, localize: PdfLocalizer): Uint8Array {
  if (plan.pages.length === 0) throw new Error("A print plan must contain at least one page.");
  if (plan.pages.some((page) => page.widthPt !== 612 || page.heightPt !== 792)) throw new Error("Only exact US Letter pages are supported.");
  const objects = new Map<number, Uint8Array>();
  const pageIds: number[] = [];
  let next = 11;
  for (const page of plan.pages) {
    const pageId = next++; const contentId = next++; const content = ascii(pageContent(page, plan, mode, localize)); pageIds.push(pageId);
    objects.set(pageId, ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [0 0 612 792] /TrimBox [0 0 612 792] /Rotate 0 /Resources << /ProcSet [/PDF /Text] /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.set(contentId, stream(content));
  }
  const cmap = ascii(toUnicodeCMap());
  objects.set(1, ascii("<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None /PickTrayByPDFSize true >> /PageLayout /SinglePage >>"));
  objects.set(2, ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`));
  objects.set(3, ascii(fontDictionary("WorksBienSans-Regular", pdfRegularWidths(), 5, 9)));
  objects.set(4, ascii(fontDictionary("WorksBienSans-Bold", pdfBoldWidths(), 6, 10)));
  objects.set(5, ascii("<< /Type /FontDescriptor /FontName /WorksBienSans-Regular /Flags 32 /FontBBox [-544 -303 1302 980] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 80 /FontFile2 7 0 R >>"));
  objects.set(6, ascii("<< /Type /FontDescriptor /FontName /WorksBienSans-Bold /Flags 32 /FontBBox [-482 -376 1304 1033] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 120 /FontFile2 8 0 R >>"));
  objects.set(7, stream(WORKSBIEN_SANS_REGULAR, ` /Length1 ${WORKSBIEN_SANS_REGULAR.length}`));
  objects.set(8, stream(WORKSBIEN_SANS_BOLD, ` /Length1 ${WORKSBIEN_SANS_BOLD.length}`));
  objects.set(9, stream(cmap)); objects.set(10, stream(cmap));

  const header = concat([ascii("%PDF-1.7\n%"), new Uint8Array([0xe2,0xe3,0xcf,0xd3]), ascii("\n")]);
  const chunks: Uint8Array[] = [header]; const offsets: number[] = [0]; let length = header.length;
  for (let id = 1; id < next; id++) {
    const object = objects.get(id); if (!object) throw new Error(`PDF object ${id} is missing.`);
    const prefix = ascii(`${id} 0 obj\n`); const suffix = ascii("\nendobj\n"); offsets[id] = length;
    chunks.push(prefix, object, suffix); length += prefix.length + object.length + suffix.length;
  }
  const xrefOffset = length; let xref = `xref\n0 ${next}\n0000000000 65535 f\r\n`;
  for (let id = 1; id < next; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n\r\n`;
  xref += `trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(ascii(xref)); return concat(chunks);
}

export function defaultPdfRenderMode(plan: PrintPlan): PdfRenderMode {
  return plan.documentKind === "CHECKS" ? "production" : "preview";
}

export function renderPdfArtifact(plan: PrintPlan, localize: PdfLocalizer, mode: PdfRenderMode = defaultPdfRenderMode(plan)): RenderedPdfArtifact {
  const bytes = buildPdf(plan, mode, localize);
  return {
    bytes,
    integrity: {
      documentId: plan.documentId, documentKind: plan.documentKind, planHash: hashPrintPlan(plan),
      pdfSha256: createHash("sha256").update(bytes).digest("hex"), checkIds: [...plan.checkIds],
      pageCount: plan.pages.length, mediaBox: [0,0,612,792], renderMode: mode,
      font: "WorksBienSans-Embedded", printScaling: "None"
    }
  };
}
