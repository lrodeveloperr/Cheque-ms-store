import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DomainError } from "../src/errors.ts";
import { keysForLocale, localize } from "../src/localization.ts";

test("US English, Canadian English, and Canadian French catalogs have identical non-empty keys", async () => {
  const load = async (name: string) => JSON.parse(await readFile(new URL(`../localization/${name}.json`, import.meta.url), "utf8")) as Record<string, string>;
  const us = await load("en-US"); const ca = await load("en-CA"); const fr = await load("fr-CA");
  assert.deepEqual(Object.keys(us).sort(), Object.keys(ca).sort());
  assert.deepEqual(Object.keys(us).sort(), Object.keys(fr).sort());
  for (const [key, value] of Object.entries(us)) { assert.ok(value.trim(), key); assert.ok(ca[key].trim(), key); assert.ok(fr[key].trim(), key); }
  assert.deepEqual(keysForLocale("en-US"), keysForLocale("en-CA"));
  assert.deepEqual(keysForLocale("en-US"), keysForLocale("fr-CA"));
  const error = new DomainError("ENTITLEMENT_REQUIRED", "developer-only detail");
  assert.equal(error.messageKey, "error.ENTITLEMENT_REQUIRED"); assert.equal(error.message, error.messageKey); assert.equal(error.localizedMessage("en-US"), localize("en-US", error.messageKey)); assert.match(error.localizedMessage("en-CA"), /cheques/); assert.equal(error.developerMessage, "developer-only detail");
  assert.match(error.localizedMessage("fr-CA"), /chèques/);
});

test("message keys never depend on English developer wording and parameters localize", () => {
  const error = new DomainError("NOT_FOUND", "Payee not found even though this text mentions calibration and date.", { character: "Δ", codePoint: "U+0394" });
  assert.equal(error.messageKey, "error.NOT_FOUND");
  const font = new DomainError("VALIDATION_ERROR", "developer detail", { character: "Δ", codePoint: "U+0394" }, "validation.fontUnsupported");
  assert.match(font.localizedMessage("en-US"), /Δ \(U\+0394\)/); assert.match(font.localizedMessage("fr-CA"), /Δ \(U\+0394\)/);
});
