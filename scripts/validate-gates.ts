import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../gate-manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.candidate, packageJson.version, "manifest candidate must match package.json version");
assert.ok(["ENGINE_READY_FOR_EXTERNAL_VERIFICATION", "BACKEND_ENGINE_LOCKED_FOR_HOST_PDF_INTEGRATION", "LAYOUT_ACCEPTANCE_PENDING"].includes(manifest.status));
assert.ok(Array.isArray(manifest.requirements) && manifest.requirements.length >= 15);
const ids = new Set<string>();
for (const requirement of manifest.requirements) {
  assert.match(requirement.id, /^REQ-[A-Z]+-\d{3}$/);
  assert.ok(!ids.has(requirement.id)); ids.add(requirement.id);
  assert.ok(["LAUNCH", "DEFERRED", "EXCLUDED"].includes(requirement.scope));
  assert.ok(["PASS", "PROVISIONAL", "NOT_RUN", "N_A"].includes(requirement.status));
  if (requirement.scope === "LAUNCH") assert.ok(requirement.tests.length > 0 || requirement.status === "PROVISIONAL");
  if (requirement.scope === "LAUNCH" && manifest.status === "BACKEND_ENGINE_LOCKED_FOR_HOST_PDF_INTEGRATION") assert.equal(requirement.status, "PASS");
  if (requirement.scope === "LAUNCH" && requirement.status === "PROVISIONAL") assert.equal(requirement.id, "REQ-PRN-001");
  await access(new URL(`../${requirement.normative}`, import.meta.url));
  for (const evidence of requirement.tests) if (evidence.startsWith("tests/")) await access(new URL(`../${evidence}`, import.meta.url));
  for (const dependency of requirement.dependencies) assert.ok(manifest.requirements.some((candidate: { id: string }) => candidate.id === dependency), `${requirement.id} has unknown dependency ${dependency}`);
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const script of ["typecheck", "test", "verify:pdf", "test:pdf-visual"]) {
  const result = spawnSync(npm, ["run", script], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) { process.stderr.write(result.stdout); process.stderr.write(result.stderr); throw new Error(`${script} gate failed`); }
}
const packed = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: "pipe" });
if (packed.status !== 0) { process.stderr.write(packed.stdout); process.stderr.write(packed.stderr); throw new Error("package inventory gate failed"); }
const inventory = JSON.parse(packed.stdout) as Array<{ files: Array<{ path: string }> }>;
const forbidden = inventory.flatMap((item) => item.files.map((file) => file.path)).filter((path) => /(^|\/)(node_modules|coverage|tmp|output)\/|\.(wbc|guard|lock|heartbeat|numbers|tmp)$|\.pre-restore-/.test(path));
assert.deepEqual(forbidden, [], `package contains forbidden runtime or secret-bearing artifacts: ${forbidden.join(", ")}`);
console.log(JSON.stringify({ valid: true, runtimeGates: ["typecheck", "test-with-coverage-thresholds", "pdf-integrity-matrix", "300-dpi-visual-regression", "package-inventory"], candidate: manifest.candidate, status: manifest.status, requirements: manifest.requirements.length, launch: manifest.requirements.filter((item: { scope: string }) => item.scope === "LAUNCH").length }, null, 2));
