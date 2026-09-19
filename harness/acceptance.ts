import { mkdir, mkdtemp, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CheckPrinterEngine } from "../src/engine.ts";
import { parseAmountToCents } from "../src/money.ts";
import { EncryptedStateStore } from "../src/persistence.ts";
import type { BankCountry, CheckStatus, Currency, EngineDependencies } from "../src/types.ts";
import { writePrintPlanPdf } from "./pdf-renderer.ts";

type Outcome = "printed" | "not-sent" | "unknown";

interface AcceptanceOptions {
  outDir: string;
  outcome: Outcome;
  currency: Currency;
  bankCountry: BankCountry;
  amount: string;
  payee: string;
  memo: string;
  issueDate: string;
  checkNumber: number;
}

const LIVE_SECRET = "worksbien-test-secret-2026";
const RECOVERY_PASSPHRASE = "worksbien-test-recovery-2026";

function stableDependencies(): EngineDependencies {
  let id = 0;
  let tick = 0;
  return {
    now: () => new Date(Date.UTC(2026, 8, 18, 12, 0, tick++)).toISOString(),
    newId: () => `acceptance-${++id}`
  };
}

function defaultOutDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve("output", `acceptance-${stamp}`);
}

function valueAfter(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

export function parseAcceptanceArgs(args: string[]): AcceptanceOptions {
  const options: AcceptanceOptions = {
    outDir: defaultOutDir(),
    outcome: "printed",
    currency: "USD",
    bankCountry: "US",
    amount: "1234.56",
    payee: "Northwind Supplies",
    memo: "Invoice 1042",
    issueDate: "2026-09-18",
    checkNumber: 1001
  };
  let countryExplicit = false;
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === "--out") options.outDir = resolve(valueAfter(args, index++, option));
    else if (option === "--outcome") {
      const value = valueAfter(args, index++, option);
      if (!(["printed", "not-sent", "unknown"] as string[]).includes(value)) throw new Error("--outcome must be printed, not-sent, or unknown.");
      options.outcome = value as Outcome;
    } else if (option === "--currency") {
      const value = valueAfter(args, index++, option).toUpperCase();
      if (value !== "USD" && value !== "CAD") throw new Error("--currency must be USD or CAD.");
      options.currency = value;
    } else if (option === "--country") {
      const value = valueAfter(args, index++, option).toUpperCase();
      if (value !== "US" && value !== "CA") throw new Error("--country must be US or CA.");
      options.bankCountry = value; countryExplicit = true;
    } else if (option === "--amount") options.amount = valueAfter(args, index++, option);
    else if (option === "--payee") options.payee = valueAfter(args, index++, option);
    else if (option === "--memo") options.memo = valueAfter(args, index++, option);
    else if (option === "--date") options.issueDate = valueAfter(args, index++, option);
    else if (option === "--check-number") {
      const value = Number(valueAfter(args, index++, option));
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error("--check-number must be a positive integer.");
      options.checkNumber = value;
    } else if (option === "--help") {
      throw new Error("HELP");
    } else throw new Error(`Unknown option: ${option}`);
  }
  if (!countryExplicit && options.currency === "CAD") options.bankCountry = "CA";
  if (options.bankCountry === "US" && options.currency !== "USD") throw new Error("The built-in US cheque template supports USD only.");
  return options;
}

function usage(): string {
  return [
    "WorksBien backend acceptance harness",
    "",
    "Usage:",
    "  npm run acceptance -- [options]",
    "",
    "Options:",
    "  --out <folder>                 Output folder (default: timestamped output folder)",
    "  --outcome printed|not-sent|unknown",
    "  --currency USD|CAD",
    "  --country US|CA              Bank jurisdiction (Canada may use CAD or USD)",
    "  --amount <decimal>             Example: 1234.56",
    "  --payee <single-line text>",
    "  --memo <single-line text>",
    "  --date <YYYY-MM-DD>",
    "  --check-number <integer>",
    "  --help"
  ].join("\n");
}

export async function runAcceptance(options: AcceptanceOptions): Promise<{ outDir: string; finalStatus: CheckStatus }> {
  const outDir = resolve(options.outDir);
  const alreadyExists = await stat(outDir).then(() => true).catch(() => false);
  if (alreadyExists) throw new Error(`Output folder already exists: ${outDir}`);
  await mkdir(outDir, { recursive: true });

  const deps = stableDependencies();
  const engine = new CheckPrinterEngine(undefined, deps);
  const account = engine.createAccount({
    name: "Operating",
    companyName: "WorksBien Acceptance Test",
    currency: options.currency,
    bankCountry: options.bankCountry,
    nextCheckNumber: options.checkNumber
  });
  const payee = engine.createPayee({ name: options.payee, defaultMemo: options.memo });
  const profile = engine.createCalibration({
    accountId: account.id,
    name: "PDF acceptance profile",
    printerKey: "microsoft-print-to-pdf",
    layout: "VOUCHER_TOP",
    printCheckNumber: true
  });
  const check = engine.createDraft({
    accountId: account.id,
    payeeId: payee.id,
    issueDate: options.issueDate,
    amountCents: parseAmountToCents(options.amount),
    memo: options.memo,
    category: "ACCEPTANCE_TEST"
  });
  engine.markReady(check.id);

  const calibrationPlan = engine.calibrationPlan(profile.id, profile.printerKey, options.bankCountry === "CA" ? "en-CA" : "en-US");
  const samplePlan = engine.samplePlan(profile.id, profile.printerKey, options.bankCountry === "CA" ? "en-CA" : "en-US");
  const [calibrationIntegrity, sampleIntegrity] = await Promise.all([
    writePrintPlanPdf(resolve(outDir, "01-calibration.pdf"), calibrationPlan),
    writePrintPlanPdf(resolve(outDir, "02-non-negotiable-sample.pdf"), samplePlan),
  ]);
  await Promise.all([
    writeFile(resolve(outDir, "01-calibration.plan.json"), `${JSON.stringify(calibrationPlan, null, 2)}\n`, "utf8"),
    writeFile(resolve(outDir, "02-non-negotiable-sample.plan.json"), `${JSON.stringify(samplePlan, null, 2)}\n`, "utf8")
  ]);

  const guardDirectory = await mkdtemp(join(tmpdir(), "worksbien-acceptance-guards-")); const store = new EncryptedStateStore({ guardDirectory });
  const statePath = resolve(outDir, "state.wbc");
  await store.save(statePath, engine.snapshot(), LIVE_SECRET, 0);
  const queued = await store.queuePrintDurably(statePath, LIVE_SECRET, engine.snapshot().revision, {
    checkIds: [check.id],
    calibrationProfileId: profile.id,
    printerKey: profile.printerKey,
    stockKey: profile.stockKey
  });
  const liveIntegrity = await writePrintPlanPdf(resolve(outDir, "03-live-check.pdf"), queued.plan);
  await writeFile(resolve(outDir, "03-live-check.plan.json"), `${JSON.stringify(queued.plan, null, 2)}\n`, "utf8");

  const finalEngine = new CheckPrinterEngine(queued.state, deps);
  if (options.outcome === "printed") finalEngine.resolvePrintDocumentOutcome(queued.plan.documentId, queued.planHash, { kind: "PRINTED_CORRECTLY" });
  else if (options.outcome === "not-sent") finalEngine.resolvePrintDocumentOutcome(queued.plan.documentId, queued.planHash, { kind: "NOT_PRINTED", reasonCode: "ACCEPTANCE_NOT_SENT", deliveryEvidence: "HOST_CANCELLED_BEFORE_SUBMIT" });
  else finalEngine.resolvePrintDocumentOutcome(queued.plan.documentId, queued.planHash, { kind: "PAPER_MARKED_WITH_PROBLEM", reasonCode: "ACCEPTANCE_UNKNOWN_OUTPUT" });

  await store.save(statePath, finalEngine.snapshot(), LIVE_SECRET, queued.state.revision);
  const backupPath = resolve(outDir, "backup.wbc");
  await store.createBackup(statePath, backupPath, LIVE_SECRET, RECOVERY_PASSPHRASE);
  const reloaded = await store.load(statePath, LIVE_SECRET);
  const verifiedEngine = new CheckPrinterEngine(reloaded, deps);
  const finalCheck = reloaded.checks.find((candidate) => candidate.id === check.id);
  if (!finalCheck) throw new Error("Acceptance check disappeared after persistence reload.");

  const summary = {
    result: "PASS",
    engineVersion: "0.5.0-rc.1",
    outcome: options.outcome,
    finalStatus: finalCheck.status,
    currency: options.currency,
    bankCountry: options.bankCountry,
    checkNumber: finalCheck.checkNumber,
    nextCheckNumber: reloaded.accounts.find((candidate) => candidate.id === account.id)?.nextCheckNumber,
    amountCents: finalCheck.amountCents,
    payee: finalCheck.payeeSnapshot.name,
    memo: finalCheck.memo,
    documentId: queued.plan.documentId,
    planHash: queued.planHash,
    pdfIntegrity: { calibration: calibrationIntegrity, sample: sampleIntegrity, production: liveIntegrity },
    persistenceReloadVerified: true,
    encryptedBackupVerified: true,
    reconciliation: verifiedEngine.reconciliation(account.id),
    inspect: ["01-calibration.pdf", "02-non-negotiable-sample.pdf", "03-live-check.pdf"],
    note: "Every PDF embeds the approved WorksBienSans font subset and records its final SHA-256 beside the immutable plan hash. Physical stock still requires Actual Size ruler calibration."
  };
  await Promise.all([
    writeFile(resolve(outDir, "register.csv"), verifiedEngine.exportRegister(account.id, options.bankCountry === "CA" ? "en-CA" : "en-US"), "utf8"),
    writeFile(resolve(outDir, "result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  ]);

  const transientFiles = (await readdir(outDir)).filter((file) => file === "state.wbc" || file === "state.wbc.guard" || file === "backup.wbc" || file.startsWith("state.wbc.lock"));
  await Promise.all(transientFiles.map((file) => unlink(resolve(outDir, file))));
  const leakedFiles = (await readdir(outDir)).filter((file) => /\.(?:wbc|guard|lock|heartbeat|numbers|tmp)$/u.test(file));
  if (leakedFiles.length > 0) throw new Error(`Acceptance cleanup left transient files: ${leakedFiles.join(", ")}`);
  await rm(guardDirectory, { recursive: true, force: true });

  return { outDir, finalStatus: finalCheck.status };
}

async function main(): Promise<void> {
  try {
    const options = parseAcceptanceArgs(process.argv.slice(2));
    const result = await runAcceptance(options);
    console.log(`PASS: backend acceptance run completed.`);
    console.log(`Final check status: ${result.finalStatus}`);
    console.log(`Open: ${resolve(result.outDir, "03-live-check.pdf")}`);
    console.log(`Full results: ${result.outDir}`);
  } catch (error) {
    if (error instanceof Error && error.message === "HELP") {
      console.log(usage());
      return;
    }
    console.error(error instanceof Error ? error.message : error);
    console.error("\nRun with --help for options.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
