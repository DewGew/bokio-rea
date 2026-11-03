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

testCase("2026 active business standard deduction follows the age-based contribution group", () => {
  const born1958 = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1958,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "active",
  });
  const born1937 = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1937,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "active",
  });

  assert.equal(born1958.standardDeduction, 1_600);
  assert.equal(born1958.businessIncomeAfterDeduction, 14_400);
  assert.ok(Math.abs(born1958.socialContributions - 1_468.8) < 0.01);
  assert.equal(born1937.standardDeduction, 0);
  assert.equal(born1937.socialContributions, 0);
});

testCase("2026 enhanced job tax credit applies from birth year 1959", () => {
  const result = estimateAnnualTax({
    taxYear: 2026,
    birthYear: 1959,
    municipalityTaxRate: 34,
    otherEmploymentIncome: 45_000,
    businessProfit: 16_000,
    activityType: "active",
  });

  assert.equal(result.standardDeduction, 4_000);
  assert.ok(result.combinedJobTaxCredit > 0);
});
