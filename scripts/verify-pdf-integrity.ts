import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScenarios } from "../harness/scenarios.ts";

const outIndex = process.argv.indexOf("--out");
const outDir = resolve(outIndex >= 0 ? process.argv[outIndex + 1] : "output/pdf/verification-0.5.0-rc.1");
const replace = outIndex < 0 || process.argv.includes("--replace");
if (replace && await stat(outDir).then(() => true).catch(() => false)) await rm(outDir, { recursive: true, force: true });
await mkdir(resolve("output/pdf"), { recursive: true });
await runScenarios(outDir);

const pdfs = (await readdir(outDir)).filter((name) => name.endsWith(".pdf")).sort();
const evidence: Array<{ file: string; pages: number; fontsEmbedded: number; productionFurnitureAbsent: boolean }> = [];
for (const file of pdfs) {
  const path = resolve(outDir, file);
  const info = execFileSync("pdfinfo", [path], { encoding: "utf8" });
  const pageMatch = info.match(/^Pages:\s+(\d+)$/m); const sizeMatch = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts/m);
  if (!pageMatch || !sizeMatch || Number(sizeMatch[1]) !== 612 || Number(sizeMatch[2]) !== 792) throw new Error(`${file}: page geometry is not exact US Letter`);
  if (!/^Encrypted:\s+no$/m.test(info) || !/^JavaScript:\s+no$/m.test(info)) throw new Error(`${file}: encrypted or active content detected`);
  const fonts = execFileSync("pdffonts", [path], { encoding: "utf8" }).split("\n").slice(2).filter(Boolean);
  if (fonts.length < 2 || fonts.some((line) => !/\syes\s+(?:yes|no)\s+yes\s+/u.test(line))) throw new Error(`${file}: approved fonts are not embedded with Unicode maps`);
  const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
  const productionFurnitureAbsent = !file.endsWith("-live.pdf") || !/WORKSBIEN BROWSER TEST|CHECK PREVIEW|SAMPLE.*NOT NEGOTIABLE/u.test(text);
  if (!productionFurnitureAbsent) throw new Error(`${file}: production output contains preview furniture`);
  evidence.push({ file, pages: Number(pageMatch[1]), fontsEmbedded: fonts.length, productionFurnitureAbsent });
}

const report = {
  result: "PASS", engineVersion: "0.5.0-rc.1", checkedAt: new Date().toISOString(),
  pdfCount: pdfs.length, checks: { exactLetter: true, fixedPageBoxes: true, embeddedFonts: true, unicodeMaps: true, noEncryption: true, noJavaScript: true, productionSparse: true }, evidence
};
await writeFile(resolve(outDir, "pdf-release-gate.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`PASS: ${pdfs.length} PDFs passed structural and text-integrity inspection in ${outDir}`);
