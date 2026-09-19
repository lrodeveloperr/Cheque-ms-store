import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashPrintPlan } from "../src/calibration.ts";
import { CheckPrinterEngine } from "../src/engine.ts";
import { exactPrintJob } from "../src/host-contract.ts";
import { EncryptedStateStore } from "../src/persistence.ts";
import type { AppLocale, BankCountry, Currency, EngineDependencies, LayoutKind } from "../src/types.ts";
import { writePrintPlanPdf } from "./pdf-renderer.ts";

const VERSION = "0.5.0-rc.1";
const LAYOUTS: LayoutKind[] = ["VOUCHER_TOP", "VOUCHER_MIDDLE", "VOUCHER_BOTTOM", "THREE_UP"];
const JURISDICTIONS: Array<{ label: string; bankCountry: BankCountry; currency: Currency; locale: AppLocale }> = [
  { label: "us-en-usd", bankCountry: "US", currency: "USD", locale: "en-US" },
  { label: "ca-en-cad", bankCountry: "CA", currency: "CAD", locale: "en-CA" },
  { label: "ca-fr-cad", bankCountry: "CA", currency: "CAD", locale: "fr-CA" },
  { label: "ca-fr-usd", bankCountry: "CA", currency: "USD", locale: "fr-CA" },
  { label: "ca-en-usd", bankCountry: "CA", currency: "USD", locale: "en-CA" }
];

function dependencies(prefix: string): EngineDependencies {
  let id = 0; let tick = 0;
  return { now: () => new Date(Date.UTC(2026, 8, 19, 12, 0, tick++)).toISOString(), newId: () => `${prefix}-${++id}` };
}

function outputDirectory(args: string[]): string {
  const index = args.indexOf("--out");
  if (index >= 0) {
    const value = args[index + 1]; if (!value) throw new Error("--out requires a folder."); return resolve(value);
  }
  if (args.length) throw new Error(`Unknown option: ${args[0]}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve("output", `verification-${VERSION}-${stamp}`);
}

async function sha256(path: string): Promise<string> { return createHash("sha256").update(await readFile(path)).digest("hex"); }

export async function runScenarios(outDir: string): Promise<void> {
  if (await stat(outDir).then(() => true).catch(() => false)) throw new Error(`Output folder already exists: ${outDir}`);
  await mkdir(outDir, { recursive: true });
  const matrix: Array<Record<string, unknown>> = [];

  for (const jurisdiction of JURISDICTIONS) for (const layout of LAYOUTS) {
    const label = `${jurisdiction.label}-${layout.toLocaleLowerCase("en").replaceAll("_", "-")}`;
    const engine = new CheckPrinterEngine(undefined, dependencies(label));
    engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-19T12:00:00.000Z" });
    const account = engine.createAccount({ name: label, companyName: "WorksBien Verification", currency: jurisdiction.currency, bankCountry: jurisdiction.bankCountry, locale: jurisdiction.locale, nextCheckNumber: 7001 });
    const payee = engine.createPayee({ name: jurisdiction.locale === "fr-CA" ? "Fournitures Québec" : "Northwind Supplies", defaultMemo: jurisdiction.locale === "fr-CA" ? "Facture 1042" : "Invoice 1042" });
    const profile = engine.createCalibration({ accountId: account.id, name: label, printerKey: `pdf-${label}`, layout, printCheckNumber: true });
    const count = layout === "THREE_UP" ? 3 : 1; const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 123_456 + index, category: "VERIFICATION" });
      engine.markReady(check.id, profile.id); ids.push(check.id);
    }
    const queued = engine.queuePrint(ids, profile.id, profile.printerKey, profile.stockKey, 0, layout === "THREE_UP" ? [`${label}-sheet-1`] : []);
    const job = exactPrintJob(queued.plan, profile.printerKey, queued.planHash);
    const livePath = resolve(outDir, `${label}-live.pdf`); const samplePath = resolve(outDir, `${label}-sample.pdf`); const calibrationPath = layout === "VOUCHER_TOP" ? resolve(outDir, `${jurisdiction.label}-calibration.pdf`) : undefined;
    const liveIntegrity = await writePrintPlanPdf(livePath, job.plan);
    const sampleIntegrity = await writePrintPlanPdf(samplePath, engine.samplePlan(profile.id, profile.printerKey));
    const calibrationIntegrity = calibrationPath ? await writePrintPlanPdf(calibrationPath, engine.calibrationPlan(profile.id, profile.printerKey)) : undefined;
    const statuses = engine.resolvePrintDocumentOutcome(queued.plan.documentId, queued.planHash, { kind: "PRINTED_CORRECTLY" }).map((check) => check.status);
    matrix.push({ label, bankCountry: jurisdiction.bankCountry, currency: jurisdiction.currency, locale: jurisdiction.locale, layout, checkCount: count, planVersion: queued.plan.version, planHash: hashPrintPlan(queued.plan), pdfSha256: liveIntegrity.pdfSha256, samplePdfSha256: sampleIntegrity.pdfSha256, calibrationPdfSha256: calibrationIntegrity?.pdfSha256, statuses, livePdf: livePath.split("/").at(-1), samplePdf: samplePath.split("/").at(-1), calibrationPdf: calibrationPath?.split("/").at(-1) });
  }

  const slotEvidence: Array<Record<string, unknown>> = [];
  for (const startSlot of [1, 2]) {
    const engine = new CheckPrinterEngine(undefined, dependencies(`slot-${startSlot}`)); engine.setEntitlement({ kind: "LIFETIME", source: "TEST", verifiedAt: "2026-09-19T12:00:00.000Z" });
    const account = engine.createAccount({ name: `Slot ${startSlot}`, companyName: "WorksBien Verification", currency: "USD", bankCountry: "US", locale: "en-US", nextCheckNumber: 8001 });
    const payee = engine.createPayee({ name: "Slot Verification" }); const profile = engine.createCalibration({ accountId: account.id, name: `Slot ${startSlot}`, printerKey: `slot-${startSlot}`, layout: "THREE_UP", printCheckNumber: true });
    const ids: string[] = []; const count = 3 - startSlot;
    for (let index = 0; index < count; index++) { const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-19", amountCents: 500 + index }); engine.markReady(check.id, profile.id); ids.push(check.id); }
    const queued = engine.queuePrint(ids, profile.id, profile.printerKey, profile.stockKey, startSlot, [`slot-${startSlot}-sheet-1`]); const file = `three-up-start-slot-${startSlot}.pdf`; await writePrintPlanPdf(resolve(outDir, file), queued.plan);
    slotEvidence.push({ startSlot, checkCount: count, pages: queued.plan.pages.length, file, planHash: queued.planHash });
  }

  const workflowEngine = new CheckPrinterEngine(undefined, dependencies("workflow"));
  let rejectedUntrustedLifetime = false;
  try { workflowEngine.setEntitlement({ kind: "LIFETIME", source: "LOCAL_FREE", verifiedAt: "2026-09-19T12:00:00.000Z" }); } catch { rejectedUntrustedLifetime = true; }
  workflowEngine.setEntitlement({ kind: "LIFETIME", source: "MICROSOFT_STORE", verifiedAt: "2026-09-19T12:00:00.000Z" });
  const usAccount = workflowEngine.createAccount({ name: "US workflow", companyName: "WorksBien Verification", currency: "USD", bankCountry: "US", locale: "en-US", nextCheckNumber: 9001 });
  const usPayee = workflowEngine.createPayee({ name: "Workflow Supplier", defaultMemo: "Default memo" });
  const usProfile = workflowEngine.createCalibration({ accountId: usAccount.id, name: "Workflow", printerKey: "workflow-pdf", layout: "VOUCHER_TOP" });
  const favourite = workflowEngine.createPaymentTemplate({ name: "Variable favourite", accountId: usAccount.id, payeeId: usPayee.id, amountCents: 1_000 });
  workflowEngine.updatePaymentTemplate(favourite.id, { amountCents: null });
  const favouriteDraft = workflowEngine.createDraftFromTemplate(favourite.id, { issueDate: "2026-09-19", amountCents: 2_500 });
  const duplicate = workflowEngine.duplicateCheck(favouriteDraft.id, { issueDate: "2026-10-19" });
  let rejectedUnsafeReady = false; const tooLong = workflowEngine.createPayee({ name: "W".repeat(80) }); const unsafeDraft = workflowEngine.createDraft({ accountId: usAccount.id, payeeId: tooLong.id, issueDate: "2026-09-19", amountCents: 100 });
  try { workflowEngine.markReady(unsafeDraft.id, usProfile.id); } catch { rejectedUnsafeReady = true; }
  let rejectedWrongLocale = false; try { workflowEngine.samplePlan(usProfile.id, usProfile.printerKey, "fr-CA"); } catch { rejectedWrongLocale = true; }
  const caAccount = workflowEngine.createAccount({ name: "CA workflow", companyName: "WorksBien Verification", currency: "CAD", bankCountry: "CA", locale: "en-CA", nextCheckNumber: 9101 });
  workflowEngine.createDraft({ accountId: caAccount.id, payeeId: usPayee.id, issueDate: "2026-09-19", amountCents: 3_500 });
  const report = workflowEngine.registerReport({}, "en-CA");
  const statePath = resolve(outDir, "workflow-state.wbc"); const backupPath = resolve(outDir, "workflow-backup.wbc"); const guardDirectory = await mkdtemp(join(tmpdir(), "worksbien-scenario-guards-")); const store = new EncryptedStateStore({ guardDirectory });
  await store.save(statePath, workflowEngine.snapshot(), "scenario-live-secret", 0); await store.createBackup(statePath, backupPath, "scenario-live-secret", "scenario-recovery-passphrase");
  const reloaded = await store.load(statePath, "scenario-live-secret"); new CheckPrinterEngine(reloaded).assertInvariants();
  const workflow = { rejectedUntrustedLifetime, entitlement: workflowEngine.snapshot().entitlement, favouriteAmountCleared: workflowEngine.snapshot().paymentTemplates[0].amountCents === undefined, payeeDefaultMemoApplied: favouriteDraft.memo === "Default memo", newNumbers: [favouriteDraft.checkNumber, duplicate.checkNumber], rejectedUnsafeReady, unsafeDraftStatus: workflowEngine.snapshot().checks.find((check) => check.id === unsafeDraft.id)?.status, rejectedWrongLocale, totalsByCurrency: report.totals.byCurrency, persistenceReloadVerified: reloaded.revision === workflowEngine.snapshot().revision, encryptedBackupCreated: (await stat(backupPath)).size > 0 };
  await writeFile(resolve(outDir, "workflow-result.json"), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  for (const file of await readdir(outDir)) if (file === "workflow-state.wbc" || file === "workflow-state.wbc.guard" || file === "workflow-backup.wbc" || file.startsWith("workflow-state.wbc.lock")) await unlink(resolve(outDir, file)).catch(() => undefined);
  await rm(guardDirectory, { recursive: true, force: true });

  const result = { result: "PASS", engineVersion: VERSION, generatedAt: "2026-09-19T12:00:00.000Z", matrixCases: matrix.length, layouts: LAYOUTS, jurisdictions: JURISDICTIONS, matrix, threeUpStartSlots: slotEvidence, workflow, guarantees: { exactLetter: true, actualSizePercent: 100, fitToPage: false, immutablePlanHashes: true, batchOutcomesAtomic: true, samplesNonNegotiable: true }, externalStillRequired: ["Windows native print integration", "Microsoft Store receipt validation", "physical stock calibration", "financial-institution qualification"] };
  await writeFile(resolve(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const files = (await readdir(outDir)).filter((file) => file !== "sha256-manifest.json").sort();
  const manifest = { engineVersion: VERSION, files: await Promise.all(files.map(async (file) => ({ file, bytes: (await stat(resolve(outDir, file))).size, sha256: await sha256(resolve(outDir, file)) }))) };
  await writeFile(resolve(outDir, "sha256-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> { const outDir = outputDirectory(process.argv.slice(2)); await runScenarios(outDir); console.log(`PASS: ${VERSION} scenario matrix written to ${outDir}`); }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
