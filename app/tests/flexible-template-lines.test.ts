import test from "node:test";
import assert from "node:assert/strict";
import { calculateTemplateLines } from "../src/lib/flexible-template-lines";

const template = (lines: unknown[], vatRate = 25) => ({
  lines, costAccount: 6110, vatRate, vatAccount: null, direction: "custom",
});

test("calculates net, input VAT and owner contribution from gross amount", () => {
  const result = calculateTemplateLines(template([
    { account: 6110, side: "debit", rule: "net" },
    { account: 2641, side: "debit", rule: "vat" },
    { account: 2018, side: "credit", rule: "remainder" },
  ]), 125000, { payAccount: 1930 });
  assert.deepEqual(result, [
    { account: 6110, debit: 100000, credit: 0, text: "" },
    { account: 2641, debit: 25000, credit: 0, text: "" },
    { account: 2018, debit: 0, credit: 125000, text: "" },
  ]);
});

test("supports percentage and fixed amount rules", () => {
  const result = calculateTemplateLines(template([
    { account: 6990, side: "debit", rule: "percent_gross", value: 10 },
    { account: 6991, side: "debit", rule: "fixed", value: 5 },
    { account: 1930, side: "credit", rule: "remainder" },
  ], 0), 10000, { payAccount: 1930 });
  assert.equal(result[0].debit, 1000);
  assert.equal(result[1].debit, 500);
  assert.equal(result[2].credit, 1500);
});

test("no VAT makes net equal gross and VAT zero", () => {
  const result = calculateTemplateLines(template([
    { account: 6110, side: "debit", rule: "net" },
    { account: 2641, side: "debit", rule: "vat" },
    { account: 2018, side: "credit", rule: "remainder" },
  ]), 10000, { payAccount: 1930, noVat: true });
  assert.deepEqual(result, [
    { account: 6110, debit: 10000, credit: 0, text: "" },
    { account: 2018, debit: 0, credit: 10000, text: "" },
  ]);
});
