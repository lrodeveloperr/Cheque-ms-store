import { CheckPrinterEngine } from "./engine.ts";
import { amountToWords, parseAmountToCents } from "./money.ts";

function stableDependencies() {
  let id = 0;
  return { now: () => "2026-09-18T12:00:00.000Z", newId: () => `demo-${++id}` };
}

function demo(): unknown {
  const engine = new CheckPrinterEngine(undefined, stableDependencies());
  const account = engine.createAccount({ name: "Operating", companyName: "WorksBien Sample Co.", currency: "USD", nextCheckNumber: 1001 });
  const payee = engine.createPayee({ name: "Sample Supplier", defaultMemo: "Office supplies" });
  const calibration = engine.createCalibration({ accountId: account.id, name: "Office printer / voucher", printerKey: "sample-printer", layout: "VOUCHER_TOP" });
  const check = engine.createDraft({ accountId: account.id, payeeId: payee.id, issueDate: "2026-09-18", amountCents: 123456, memo: "Invoice 1042", category: "Supplies" });
  engine.markReady(check.id);
  const queued = engine.queuePrint([check.id], calibration.id, "sample-printer", calibration.stockKey);
  engine.confirmPrint(check.id, queued.attemptIds[0], queued.plan.documentId, queued.planHash);
  return { printPlan: queued.plan, registerCsv: engine.exportRegister(account.id), reconciliation: engine.reconciliation(account.id), state: engine.snapshot() };
}

const [command = "help", ...args] = process.argv.slice(2);
if (command === "demo") console.log(JSON.stringify(demo(), null, 2));
else if (command === "amount") {
  const cents = parseAmountToCents(args[0] ?? "");
  const currency = args[1] === "CAD" ? "CAD" : "USD";
  console.log(JSON.stringify({ cents, currency, words: amountToWords(cents, currency) }, null, 2));
} else {
  console.log("Usage: node src/cli.ts demo | amount <decimal> [USD|CAD]");
  process.exitCode = command === "help" ? 0 : 2;
}
