export type TaxActivityType = "active" | "passive";

export type TaxEstimateInput = {
  taxYear: number;
  birthYear: number;
  municipalityTaxRate: number;
  otherEmploymentIncome: number;
  businessProfit: number;
  activityType: TaxActivityType;
};

export type TaxEstimate = {
  supported: boolean;
  businessProfit: number;
  standardDeduction: number;
  businessIncomeAfterDeduction: number;
  basicAllowance: number;
  taxableCombinedIncome: number;
  combinedTaxBeforeCredits: number;
  combinedJobTaxCredit: number;
  incomeTaxOnBusiness: number;
  socialContributions: number;
  totalToReserve: number;
};

const PRICE_BASE_AMOUNT_2026 = 59_200;
const MUNICIPAL_TAX_THRESHOLD_2026 = 643_000;

function basicAllowance2026(earnedAndBusinessIncome: number): number {
  const income = Math.max(0, earnedAndBusinessIncome);
  if (income === 0) return 0;

  const pbb = PRICE_BASE_AMOUNT_2026;
  let amount: number;
  if (income <= 0.99 * pbb) {
    amount = 0.423 * pbb;
  } else if (income <= 2.72 * pbb) {
    amount = 0.423 * pbb + 0.2 * (income - 0.99 * pbb);
  } else if (income <= 3.11 * pbb) {
    amount = 0.77 * pbb;
  } else if (income <= 7.88 * pbb) {
    amount = 0.77 * pbb - 0.1 * (income - 3.11 * pbb);
  } else {
    amount = 0.293 * pbb;
  }

  return Math.min(income, Math.ceil(amount / 100) * 100);
}

function jobTaxCredit2026(
  workIncome: number,
  basicAllowance: number,
  taxRate: number,
  birthYear: number,
): number {
  const income = Math.max(0, workIncome);
  const pbb = PRICE_BASE_AMOUNT_2026;

  // From income year 2026, the enhanced credit applies to people born in 1959 or earlier.
  if (birthYear <= 1959) {
    if (income <= 1.75 * pbb) return income * 0.22;
    if (income <= 5.24 * pbb) return 0.2635 * pbb + income * 0.07;
    return 0.6293 * pbb;
  }

  let creditBase: number;
  if (income <= 0.91 * pbb) {
    creditBase = income - basicAllowance;
  } else if (income <= 3.24 * pbb) {
    creditBase = 0.91 * pbb + 0.3874 * (income - 0.91 * pbb) - basicAllowance;
  } else if (income <= 8.08 * pbb) {
    creditBase = 1.813 * pbb + 0.251 * (income - 3.24 * pbb) - basicAllowance;
  } else {
    creditBase = 3.027 * pbb - basicAllowance;
  }

  return Math.max(0, creditBase * taxRate);
}

function incomeTaxAfterCredits2026(
  totalIncome: number,
  workIncome: number,
  allowanceEligibleIncome: number,
  taxRate: number,
  birthYear: number,
) {
  const allowance = Math.min(basicAllowance2026(totalIncome), Math.max(0, allowanceEligibleIncome));
  const taxableIncome = Math.max(0, Math.floor((totalIncome - allowance) / 100) * 100);
  const municipalTax = taxableIncome * taxRate;
  const stateTax = Math.max(0, taxableIncome - MUNICIPAL_TAX_THRESHOLD_2026) * 0.2;
  const jobCredit = Math.min(municipalTax, jobTaxCredit2026(workIncome, allowance, taxRate, birthYear));

  return {
    allowance,
    taxableIncome,
    taxBeforeCredits: municipalTax + stateTax,
    jobCredit,
    taxAfterCredits: municipalTax - jobCredit + stateTax,
  };
}

/**
 * Approximation for income year 2026. Calculates the additional income tax caused
 * by the business income by comparing the combined tax with the tax on salary alone.
 * It is not a full declaration calculation (e.g. church/burial fees, individual
 * deductions, sickness-benefit exceptions and other tax reductions are excluded).
 */
export function estimateAnnualTax(input: TaxEstimateInput): TaxEstimate {
  const businessProfit = Math.max(0, input.businessProfit);
  const otherEmploymentIncome = Math.max(0, input.otherEmploymentIncome);
  const taxRate = Math.max(0, input.municipalityTaxRate) / 100;
  const active = input.activityType === "active";
  // 2026 standard deduction for active business follows the applicable contribution group.
  const deductionRate = active
    ? input.birthYear <= 1937 ? 0 : input.birthYear <= 1958 ? 0.10 : 0.25
    : 0.20;
  const standardDeduction = businessProfit * deductionRate;
  const businessIncomeAfterDeduction = businessProfit - standardDeduction;

  if (input.taxYear !== 2026) {
    return {
      supported: false,
      businessProfit,
      standardDeduction,
      businessIncomeAfterDeduction,
      basicAllowance: 0,
      taxableCombinedIncome: 0,
      combinedTaxBeforeCredits: 0,
      combinedJobTaxCredit: 0,
      incomeTaxOnBusiness: 0,
      socialContributions: 0,
      totalToReserve: 0,
    };
  }

  const workIncome = otherEmploymentIncome + (active ? businessIncomeAfterDeduction : 0);
  const combinedIncome = otherEmploymentIncome + businessIncomeAfterDeduction;
  const combined = incomeTaxAfterCredits2026(
    combinedIncome,
    workIncome,
    workIncome,
    taxRate,
    input.birthYear,
  );
  const salaryOnly = incomeTaxAfterCredits2026(
    otherEmploymentIncome,
    otherEmploymentIncome,
    otherEmploymentIncome,
    taxRate,
    input.birthYear,
  );
  const incomeTaxOnBusiness = Math.max(0, combined.taxAfterCredits - salaryOnly.taxAfterCredits);

  let socialContributions = 0;
  if (active) {
    const contributionRate = input.birthYear <= 1937 ? 0 : input.birthYear <= 1958 ? 0.1021 : 0.2897;
    socialContributions = businessIncomeAfterDeduction * contributionRate;
    if (businessIncomeAfterDeduction > 40_000 && contributionRate === 0.2897) {
      socialContributions = Math.max(0, socialContributions - Math.min(businessIncomeAfterDeduction * 0.075, 15_000));
    }
  } else {
    socialContributions = businessIncomeAfterDeduction * 0.2426;
  }

  return {
    supported: true,
    businessProfit,
    standardDeduction,
    businessIncomeAfterDeduction,
    basicAllowance: combined.allowance,
    taxableCombinedIncome: combined.taxableIncome,
    combinedTaxBeforeCredits: combined.taxBeforeCredits,
    combinedJobTaxCredit: combined.jobCredit,
    incomeTaxOnBusiness,
    socialContributions,
    totalToReserve: incomeTaxOnBusiness + socialContributions,
  };
}
