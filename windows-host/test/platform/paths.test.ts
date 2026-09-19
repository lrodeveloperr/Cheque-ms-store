import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createAppPaths, requireBackupPath, requirePdfPath } from "../../src/platform/paths.ts";

test("derives deterministic private application paths", () => {
  const guardDirectory = resolve("test-guard");
  const paths = createAppPaths(resolve("C:/user-data"), resolve("C:/temp"), guardDirectory);
  assert.match(paths.stateFile, /worksbien-check-printer\.wbc$/);
  assert.match(paths.secureSecretFile, /storage-key\.dpapi$/);
  assert.equal(paths.guardDirectory, guardDirectory);
  assert.equal(paths.guardDirectory.startsWith(paths.dataDirectory), false);
});

test("requires absolute paths and locked file extensions", () => {
  assert.throws(() => requireBackupPath("backup.wbc"), /absolute/i);
  assert.throws(() => requireBackupPath(resolve("backup.zip")), /\.wbc/i);
  assert.throws(() => requirePdfPath(resolve("checks.txt")), /\.pdf/i);
  assert.equal(requirePdfPath(resolve("checks.PDF")), resolve("checks.PDF"));
  assert.throws(() => createAppPaths(resolve("data"), resolve("temp"), resolve("data/guards")), /outside/i);
});
