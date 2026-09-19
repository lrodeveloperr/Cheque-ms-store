import assert from "node:assert/strict";
import test from "node:test";
import { hashPrintPlan } from "../src/calibration.ts";
import { exactPrintJob } from "../src/host-contract.ts";
import { fixture } from "./test-helpers.ts";

test("host print jobs are exact Letter, 100 percent, no-fit, and printer bound", () => {
  const { engine, profile } = fixture();
  const plan = engine.samplePlan(profile.id, profile.printerKey);
  const expected = hashPrintPlan(plan); const job = exactPrintJob(plan, profile.printerKey, expected);
  assert.equal(plan.version, 4);
  assert.equal(job.paper, "LETTER"); assert.equal(job.scalePercent, 100); assert.equal(job.fitToPage, false);
  assert.equal(job.planHash, expected); assert.notEqual(job.plan, plan); assert.deepEqual(job.plan, plan);
  assert.throws(() => exactPrintJob(plan, "another-printer", expected));
  const changed = structuredClone(plan); const payee = changed.pages[0].elements.find((item) => item.kind === "text" && item.role === "payee"); if (payee?.kind === "text") payee.text = "Changed after queue";
  assert.throws(() => exactPrintJob(changed, profile.printerKey, expected));
});
