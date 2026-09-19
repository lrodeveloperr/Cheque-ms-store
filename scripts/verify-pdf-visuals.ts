import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceDir = resolve("output/pdf/verification-0.5.0-rc.1");
const goldenDir = resolve("tests/golden/pdf");
const cases = [
  "us-en-usd-voucher-top-live.pdf",
  "us-en-usd-voucher-top-sample.pdf",
  "ca-en-cad-voucher-top-sample.pdf",
  "ca-fr-cad-voucher-top-sample.pdf",
  "ca-en-cad-calibration.pdf"
];
const update = process.argv.includes("--update");
if (!await stat(sourceDir).then(() => true).catch(() => false)) throw new Error("Run npm run verify:pdf -- --replace first.");
await mkdir(goldenDir, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), "worksbien-pdf-visual-"));
const results: Array<{ case: string; absoluteErrorPixels: number }> = [];
try {
  for (const file of cases) {
    const stem = file.slice(0, -4); const rendered = resolve(temp, `${stem}.png`); const golden = resolve(goldenDir, `${stem}.png`);
    execFileSync("pdftoppm", ["-gray", "-png", "-r", "300", "-singlefile", resolve(sourceDir, file), resolve(temp, stem)], { stdio: "pipe" });
    if (update) await copyFile(rendered, golden);
    if (!await stat(golden).then(() => true).catch(() => false)) throw new Error(`Missing golden image: ${golden}`);
    let absoluteErrorPixels = 0;
    try { execFileSync("compare", ["-metric", "AE", golden, rendered, "null:"], { stdio: "pipe" }); }
    catch (error) {
      const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: Buffer }).stderr ?? "") : "";
      absoluteErrorPixels = Number(stderr.trim());
      if (!Number.isFinite(absoluteErrorPixels) || absoluteErrorPixels !== 0) throw new Error(`${file}: visual regression changed ${stderr.trim() || "an unknown number of"} pixels`);
    }
    results.push({ case: file, absoluteErrorPixels });
  }
  await writeFile(resolve(sourceDir, "visual-regression-report.json"), `${JSON.stringify({ result: "PASS", dpi: 300, cases: results }, null, 2)}\n`, "utf8");
  console.log(`PASS: ${results.length} golden PDFs match at 300 DPI.`);
} finally { await rm(temp, { recursive: true, force: true }); }
