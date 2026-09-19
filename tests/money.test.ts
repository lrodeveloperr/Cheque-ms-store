import assert from "node:assert/strict";
import test from "node:test";
import { amountToWords, parseAmountToCents } from "../src/money.ts";

test("parses exact cents without floating point", () => {
  assert.equal(parseAmountToCents("0.01"), 1);
  assert.equal(parseAmountToCents("1234.5"), 123450);
  assert.equal(parseAmountToCents("999999999.99"), 99999999999);
  for (const bad of ["0", "-1", "1.234", "1e3", "$4.00", "1000000000.00"]) assert.throws(() => parseAmountToCents(bad));
});

test("renders check-safe amount words at boundaries", () => {
  assert.equal(amountToWords(1, "USD"), "Zero and 01/100 Dollars");
  assert.equal(amountToWords(123456, "USD"), "One Thousand Two Hundred Thirty-Four and 56/100 Dollars");
  assert.equal(amountToWords(99999999999, "CAD"), "Nine Hundred Ninety-Nine Million Nine Hundred Ninety-Nine Thousand Nine Hundred Ninety-Nine and 99/100 Canadian Dollars");
});

test("renders Canadian French amount words with cheque-safe grammar", () => {
  assert.equal(amountToWords(1, "CAD", "fr-CA"), "zéro dollars canadiens et 01/100");
  assert.equal(amountToWords(2_101, "CAD", "fr-CA"), "vingt et un dollars canadiens et 01/100");
  assert.equal(amountToWords(7_101, "CAD", "fr-CA"), "soixante et onze dollars canadiens et 01/100");
  assert.equal(amountToWords(8_000, "CAD", "fr-CA"), "quatre-vingts dollars canadiens et 00/100");
  assert.equal(amountToWords(8_100, "CAD", "fr-CA"), "quatre-vingt-un dollars canadiens et 00/100");
  assert.equal(amountToWords(20_000, "CAD", "fr-CA"), "deux cents dollars canadiens et 00/100");
  assert.equal(amountToWords(20_100, "CAD", "fr-CA"), "deux cent un dollars canadiens et 00/100");
  assert.equal(amountToWords(123_456, "CAD", "fr-CA"), "mille deux cent trente-quatre dollars canadiens et 56/100");
  assert.equal(amountToWords(8_000_000, "CAD", "fr-CA"), "quatre-vingt mille dollars canadiens et 00/100");
  assert.equal(amountToWords(20_000_000, "CAD", "fr-CA"), "deux cent mille dollars canadiens et 00/100");
  assert.equal(amountToWords(99_999_999_999, "USD", "fr-CA"), "neuf cent quatre-vingt-dix-neuf millions neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf dollars US et 99/100");
});
