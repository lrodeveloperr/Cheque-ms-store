import { CheckPrinterEngine } from "../src/engine.ts";

export function dependencies() {
  let id = 0; let tick = 0;
  return { now: () => new Date(Date.UTC(2026, 8, 18, 12, 0, tick++)).toISOString(), newId: () => `id-${++id}` };
}

export function fixture() {
  const engine = new CheckPrinterEngine(undefined, dependencies());
  const account = engine.createAccount({ name: "Operating", companyName: "Example Co", currency: "USD", nextCheckNumber: 1001 });
  const payee = engine.createPayee({ name: "Northwind Supplies", defaultMemo: "Supplies" });
  const profile = engine.createCalibration({ accountId: account.id, name: "LaserJet voucher", printerKey: "printer-1", layout: "VOUCHER_TOP" });
  return { engine, account, payee, profile };
}
