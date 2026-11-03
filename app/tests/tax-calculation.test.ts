import assert from "node:assert/strict";
import testCase from "node:test";
import { estimateAnnualTax } from "../src/lib/tax-calculation";

testCase("2026 tax estimate includes salary, basic allowance and job tax credit", () => {
  const result = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1974,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "active",
  });

  assert.equal(result.supported, true);
  assert.equal(result.standardDeduction, 4_000);
  assert.equal(result.businessIncomeAfterDeduction, 12_000);
  assert.equal(result.basicAllowance, 25_100);
  assert.equal(result.taxableCombinedIncome, 31_900);
  assert.ok(Math.abs(result.incomeTaxOnBusiness - 651.5) < 1);
  assert.ok(Math.abs(result.socialContributions - 3_476.4) < 0.01);
  assert.ok(Math.abs(result.totalToReserve - 4_127.9) < 1);
});

testCase("2026 estimate marks other tax years unsupported", () => {
  const result = estimateAnnualTax({
    taxYear: 2025,
    birthYear: 1974,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "active",
  });

  assert.equal(result.supported, false);
  assert.equal(result.totalToReserve, 0);
});

testCase("passive business does not generate job tax credit", () => {
  const result = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1974,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "passive",
  });

  assert.equal(result.standardDeduction, 3_200);
  assert.ok(Math.abs(result.socialContributions - 3_105.28) < 0.01);
});

testCase("2026 basic allowance has the correct minimum at high income", () => {
  const result = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1974,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 540_000,
    businessProfit: 16_000,
    activityType: "active",
  });

  assert.equal(result.basicAllowance, 17_400);
  assert.ok(Math.abs(result.incomeTaxOnBusiness - 4_080) < 1);
  assert.ok(Math.abs(result.totalToReserve - 7_556.4) < 1);
});
