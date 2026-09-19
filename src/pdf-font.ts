// Liberation Sans widths for WinAnsi bytes 32-255, normalized to 1,000 units.
// The matching subset font is embedded in every PDF, so planning and rendering
// use the same metrics on every machine.
const REGULAR_WIDTHS = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,556,
  556,556,222,556,333,1000,556,556,333,1000,667,333,1000,556,611,
  556,556,222,222,333,333,350,556,1000,333,1000,500,333,944,556,
  500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,
  737,552,400,549,333,333,333,576,537,333,333,333,365,556,834,834,
  834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,
  278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
  667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,
  278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,
  556,500
] as const;

const BOLD_WIDTHS = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,611,
  556,611,278,556,500,1000,556,556,333,1000,667,333,1000,611,611,
  611,611,278,278,500,500,350,556,1000,333,1000,556,333,944,611,
  500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,
  737,552,400,549,333,333,333,576,556,333,333,333,365,556,834,834,
  834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,
  278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,
  667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,
  278,278,611,611,611,611,611,611,611,549,611,611,611,611,611,556,
  611,556
] as const;

const CP1252_EXTRAS = new Map<number, number>([
  [0x20ac,0x80],[0x201a,0x82],[0x0192,0x83],[0x201e,0x84],[0x2026,0x85],[0x2020,0x86],
  [0x2021,0x87],[0x02c6,0x88],[0x2030,0x89],[0x0160,0x8a],[0x2039,0x8b],[0x0152,0x8c],
  [0x017d,0x8e],[0x2018,0x91],[0x2019,0x92],[0x201c,0x93],[0x201d,0x94],[0x2022,0x95],
  [0x2013,0x96],[0x2014,0x97],[0x02dc,0x98],[0x2122,0x99],[0x0161,0x9a],[0x203a,0x9b],
  [0x0153,0x9c],[0x017e,0x9e],[0x0178,0x9f]
]);

export const PDF_FONT_CAP_HEIGHT_RATIO = 0.688;

export function winAnsiByte(character: string): number | undefined {
  const codePoint = character.codePointAt(0)!;
  if (codePoint >= 0x20 && codePoint <= 0x7e) return codePoint;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return codePoint;
  return CP1252_EXTRAS.get(codePoint);
}

export function assertPdfFontPrintable(value: string): void {
  const unsupported = [...value].find((character) => winAnsiByte(character) === undefined);
  if (unsupported) {
    const error = new Error("Text contains a character unavailable in the embedded cheque PDF font.") as Error & { details?: Record<string, string> };
    error.details = { character: unsupported, codePoint: `U+${unsupported.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` };
    throw error;
  }
}

export function estimatePdfTextWidthPt(value: string, fontSizePt: number): number {
  assertPdfFontPrintable(value);
  const units = [...value].reduce((total, character) => total + REGULAR_WIDTHS[winAnsiByte(character)! - 32], 0);
  return units * fontSizePt / 1000;
}

export function estimatePdfBoldTextWidthPt(value: string, fontSizePt: number): number {
  assertPdfFontPrintable(value);
  const units = [...value].reduce((total, character) => total + BOLD_WIDTHS[winAnsiByte(character)! - 32], 0);
  return units * fontSizePt / 1000;
}

export function pdfRegularWidths(): readonly number[] { return REGULAR_WIDTHS; }
export function pdfBoldWidths(): readonly number[] { return BOLD_WIDTHS; }
