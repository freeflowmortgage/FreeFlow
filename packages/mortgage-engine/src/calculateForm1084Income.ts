import { Decimal } from 'decimal.js'; // Standard financial rounding precision

export type LoanProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';

export interface WarningMessage {
  code: string;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
}

export interface GeneratedCondition {
  title: string;
  category: 'INCOME' | 'ASSETS' | 'CREDIT' | 'GENERAL';
  description: string;
  requiredDocType?: string;
}

// ────────────────────────────────────────────────────────────────────────
// 1. COMPLEX VARIABLE, MILITARY, AND TAX-EXEMPT INCOME INPUT INTERFACES
// ────────────────────────────────────────────────────────────────────────

export interface ScheduleCEntry {
  year: number;
  monthsInBusiness?: number;
  netProfitLoss: number;
  depreciation?: number;
  depletion?: number;
  businessUseOfHome?: number;
  mealsExclusion?: number;
  nonrecurringOtherIncomeLoss?: number;
  amortizationCasualtyLoss?: number;
}

export interface Form1120SEntry {
  year: number;
  monthsInBusiness?: number;
  /** END-of-year stock ownership percentage from the K-1 (never the beginning figure) */
  ownershipPercentage: number;
  w2WagesFromBusiness?: number;
  k1OrdinaryIncome?: number;
  k1NetRentalRealEstate?: number;
  k1OtherNetRentalIncome?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  k1Distributions?: number;
  hasStableDistributions?: boolean;
}

export interface Form1065Entry {
  year: number;
  monthsInBusiness?: number;
  /**
   * END-of-year percentage from K-1 Item J (never the beginning figure).
   * Freddie Mac qualifies on the ending PROFIT %; FNMA on the ending CAPITAL %.
   */
  ownershipPercentage: number;
  k1OrdinaryIncome?: number;
  k1NetRentalRealEstate?: number;
  k1OtherNetRentalIncome?: number;
  k1GuaranteedPayments?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  k1Distributions?: number;
  hasStableDistributions?: boolean;
}

export interface Form1120Entry {
  year: number;
  monthsInBusiness?: number;
  ownershipPercentage: number;
  w2WagesFromCorporate?: number;
  taxableIncome: number;
  totalTaxPaid?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  nolAndSpecialDeductions?: number;
  cash?: number;
  securities?: number;
  accountsReceivable?: number;
  currentLiabilities?: number;
  borrowerDividendsReceived?: number; // C-Corp dividends distributed directly to the borrower (from Form 1099-DIV / Schedule B)
}

export interface Form1040BenefitInput {
  year: number;
  totalSocialSecurity?: number;
  taxableSocialSecurity?: number;
  isSupplementalSecurityIncome?: boolean; // SSI
  totalPensionsAndAnnuities?: number;
  taxablePensionsAndAnnuities?: number;
  isNonGovernmentPension?: boolean; // FHA strictly requires continuance on private
  vaDisabilityMonthly?: number;
}

export interface ScheduleBAndDInput {
  year: number;
  interestIncome?: number;       // Schedule B, Part I
  dividendIncome?: number;       // Schedule B, Part II
  capitalGainsNetLoss?: number;  // Schedule D
  hasThreeYearAssetSupport?: boolean; // Underwriter verified continuance based on asset balance
}

export interface ScheduleEPartIIIInput {
  year: number;
  trustIncome?: number;          // Schedule E, Part III
  hasThreeYearTrustContinuance?: boolean;
}

// Schedule E Page 1 - Rental vs Royalty Properties
export interface ScheduleEPage1PropertyInput {
  year: number;
  propertyAddress: string;
  propertyType: 'RENTAL' | 'ROYALTY'; // Distinguish between rental real estate and royalties
  rentsReceived?: number;             // Line 3 (Rents Received)
  royaltiesReceived?: number;         // Line 4 (Royalties Received)
  depreciation?: number;              // Line 18 (Depreciation Expense - Rental)
  depletion?: number;                 // Line 18 (Depletion Expense - Royalty)
  totalExpenses?: number;             // Line 20 (Total Expenses)
  netIncomeLoss?: number;             // Line 21 (Net Income/Loss)
  hasThreeYearRoyaltyContinuance?: boolean; // Underwriter verified continuance of royalties
  isMultiFamilySubjectToFhaDecline?: boolean; // Trigger FHA declining multi-family property checks
  fairRentalDays?: number;            // Line 2 (Fair Rental Days)
  fairRentalDaysOverride?: number;    // Underwriter Days Rented Override
}

export interface MilitaryLESInput {
  militaryBasicPay: number;      // Taxable Basic Pay
  militaryBAH: number;           // Basic Allowance for Housing (Tax-Free)
  militaryBAS: number;           // Basic Allowance for Subsistence (Tax-Free)
  militarySpecialPay?: number;   // Flight, Hazard, Sea, Combat pay
  hasSpecialPayHistory?: boolean; // Minimum 12-24 month history verification
}

export interface SubjectPropertyRentalInput {
  grossMarketRent: number;                 // Form 1007 / Form 1025 / Lease
  subjectPITIA: number;                    // Full PITIA of the subject property
  isPrimaryMultiFamily2To4Unit?: boolean;  // Flags if borrower occupies one unit
}

export interface UnifiedIncomeCalculationPayload {
  loanProgram: LoanProgram;
  scheduleC?: ScheduleCEntry[];
  form1120S?: Form1120SEntry[];
  form1065?: Form1065Entry[];
  form1120?: Form1120Entry[];
  benefits?: Form1040BenefitInput[];
  assets?: ScheduleBAndDInput[];
  trusts?: ScheduleEPartIIIInput[];
  scheduleEProperties?: ScheduleEPage1PropertyInput[]; // Added Schedule E Page 1
  militaryLES?: MilitaryLESInput;
  subjectPropertyRental?: SubjectPropertyRentalInput; // Added Subject Property Rent in v9
}

// ────────────────────────────────────────────────────────────────────────
// 2. HELPER FUNCTIONS: RECURRING MATH AND DAYS RENTED CONVERSIONS
// ────────────────────────────────────────────────────────────────────────

function getMonthsInService(entry: ScheduleEPage1PropertyInput): number {
  if (entry.fairRentalDaysOverride !== undefined && entry.fairRentalDaysOverride !== null) {
    return Math.max(1, Math.min(12, Math.ceil(entry.fairRentalDaysOverride / 30)));
  }
  if (entry.fairRentalDays !== undefined && entry.fairRentalDays !== null && entry.fairRentalDays > 0) {
    return Math.max(1, Math.min(12, Math.ceil(entry.fairRentalDays / 30)));
  }
  return 12; // Default to standard 12 months if no days rented is specified
}

interface ComputedPropertyCashFlow {
  totalAnnualCashFlow: Decimal;
  monthsInService: number;
  monthlyAverage: Decimal;
}

function getMonthlyPropertyCashFlow(entry: ScheduleEPage1PropertyInput): ComputedPropertyCashFlow {
  const depr = new Decimal(entry.depreciation || 0);
  let totalAnnual: Decimal;
  if (entry.netIncomeLoss !== undefined && entry.netIncomeLoss !== null) {
    totalAnnual = new Decimal(entry.netIncomeLoss).add(depr);
  } else {
    const rents = new Decimal(entry.rentsReceived || 0);
    const expenses = new Decimal(entry.totalExpenses || 0);
    totalAnnual = rents.sub(expenses).add(depr);
  }
  const months = getMonthsInService(entry);
  const average = totalAnnual.div(months);
  
  return {
    totalAnnualCashFlow: totalAnnual,
    monthsInService: months,
    monthlyAverage: average
  };
}

// ────────────────────────────────────────────────────────────────────────
// 3. MAIN UNIFIED INCOME CALCULATION ENGINE (v9 Production Core)
// ────────────────────────────────────────────────────────────────────────

export function calculateUnifiedIncome(payload: UnifiedIncomeCalculationPayload) {
  const program = payload.loanProgram;
  const warnings: WarningMessage[] = [];
  const conditions: GeneratedCondition[] = [];
  
  // Determine Program-Specific Gross-Up Multiplier [FHA = 1.15, Conventional/VA/USDA = 1.25]
  const grossUpMultiplier = program === 'FHA' ? new Decimal(1.15) : new Decimal(1.25);
  const grossUpPercentText = program === 'FHA' ? '15%' : '25%';

  let totalQualifyingMonthlyIncome = new Decimal(0);
  const annualCalculatedTotals: Record<number, Decimal> = {};

  // Helper to add calculated cash flow directly to annual totals
  const addFlowToYear = (year: number, amount: Decimal) => {
    if (!annualCalculatedTotals[year]) {
      annualCalculatedTotals[year] = new Decimal(0);
    }
    annualCalculatedTotals[year] = annualCalculatedTotals[year].add(amount);
  };

  // ──────────────────────────────────────────────────────────────────────
  // A. SCHEDULE C - INDIVIDUAL PROFIT OR LOSS SOLE PROPRIETOR
  // ──────────────────────────────────────────────────────────────────────
  const scheduleCBreakdown = (payload.scheduleC || []).map((entry) => {
    const netProfit = new Decimal(entry.netProfitLoss);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const homeUse = new Decimal(entry.businessUseOfHome || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nonrecurring = new Decimal(entry.nonrecurringOtherIncomeLoss || 0);
    const amortCasualty = new Decimal(entry.amortizationCasualtyLoss || 0);

    // Form 1084 Adjustments: Net Profit + Depreciation + Depletion + Home Use - Meals + Nonrecurring + Amortization
    const totalAdjusted = netProfit
      .add(depr)
      .add(depl)
      .add(homeUse)
      .sub(meals)
      .add(nonrecurring)
      .add(amortCasualty);

    addFlowToYear(entry.year, totalAdjusted);

    return {
      year: entry.year,
      netProfitLoss: netProfit.toNumber(),
      depreciation: depr.toNumber(),
      businessUseOfHome: homeUse.toNumber(),
      mealsExclusion: meals.toNumber(),
      totalAdjustedIncome: totalAdjusted.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // B. FORM 1120S - SHAREHOLDER SHARE OF INCOME FROM S-CORPORATION
  // ──────────────────────────────────────────────────────────────────────
  const form1120SBreakdown = (payload.form1120S || []).map((entry) => {
    const w2 = new Decimal(entry.w2WagesFromBusiness || 0);
    const ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const rentalRealEstate = new Decimal(entry.k1NetRentalRealEstate || 0);
    const otherRental = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const distributions = new Decimal(entry.k1Distributions || 0);

    let k1EligibleIncome = new Decimal(0);

    // FNMA S-Corp Liquidity Exception & Stable Distribution Triggers
    if (entry.ownershipPercentage >= 25) {
      const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
      const totalCorpAdjustments = ordinary
        .add(rentalRealEstate)
        .add(otherRental)
        .add(depr)
        .add(depl)
        .add(amort)
        .sub(meals);

      const borrowerShareOfAdjustments = totalCorpAdjustments.mul(shareFactor);

      if (entry.hasStableDistributions) {
        k1EligibleIncome = borrowerShareOfAdjustments;
      } else {
        k1EligibleIncome = Decimal.min(borrowerShareOfAdjustments, distributions);
        warnings.push({
          code: 'SCORP_DISTRIBUTION_LIMITATION_ACTIVE',
          severity: 'WARNING',
          message: `S-Corporation Year ${entry.year}: Borrower has ownership of ${entry.ownershipPercentage}%, but hasStableDistributions is false. K-1 ordinary income has been capped at the lesser of corporate share ($${borrowerShareOfAdjustments.toFixed(2)}) or actual distributions received ($${distributions.toFixed(2)}).`
        });
      }
    } else if (entry.ownershipPercentage > 0) {
      // Under 25%: borrower is NOT self-employed. K-1 boxes 1/2/3 remain usable as
      // ordinary income — no business-level non-cash add-backs, no liquidity test —
      // capped at actual distributions received unless a stable history is documented.
      const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
      const minorityK1Income = ordinary.add(rentalRealEstate).add(otherRental).mul(shareFactor);
      k1EligibleIncome = entry.hasStableDistributions
        ? minorityK1Income
        : Decimal.min(minorityK1Income, distributions);
      warnings.push({
        code: 'SCORP_MINORITY_K1_INCOME',
        severity: 'WARNING',
        message: `S-Corporation Year ${entry.year}: Ownership ${entry.ownershipPercentage}% is under 25% — borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 ($${minorityK1Income.toFixed(2)}) with no business add-backs${entry.hasStableDistributions ? '' : `, capped at distributions received ($${distributions.toFixed(2)})`}. Document a 2-year receipt history.`
      });
    }

    const totalCombined = w2.add(k1EligibleIncome);
    addFlowToYear(entry.year, totalCombined);

    return {
      year: entry.year,
      w2WagesFromBusiness: w2.toNumber(),
      k1EligibleIncome: k1EligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // C. FORM 1065 - PARTNERSHIP INCOME
  // ──────────────────────────────────────────────────────────────────────
  const form1065Breakdown = (payload.form1065 || []).map((entry) => {
    const ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const rentalRealEstate = new Decimal(entry.k1NetRentalRealEstate || 0);
    const otherRental = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const guaranteed = new Decimal(entry.k1GuaranteedPayments || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const distributions = new Decimal(entry.k1Distributions || 0);

    let k1EligibleIncome = new Decimal(0);

    if (entry.ownershipPercentage >= 25) {
      const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
      const totalPartnershipAdjustments = ordinary
        .add(rentalRealEstate)
        .add(otherRental)
        .add(depr)
        .add(depl)
        .add(amort)
        .sub(meals);

      const borrowerShareOfAdjustments = totalPartnershipAdjustments.mul(shareFactor);

      if (entry.hasStableDistributions) {
        k1EligibleIncome = borrowerShareOfAdjustments;
      } else {
        k1EligibleIncome = Decimal.min(borrowerShareOfAdjustments, distributions);
        warnings.push({
          code: 'PARTNERSHIP_DISTRIBUTION_LIMITATION_ACTIVE',
          severity: 'WARNING',
          message: `Partnership Year ${entry.year}: Borrower has ownership of ${entry.ownershipPercentage}%, but hasStableDistributions is false. K-1 ordinary income has been capped at the lesser of corporate share ($${borrowerShareOfAdjustments.toFixed(2)}) or actual distributions received ($${distributions.toFixed(2)}).`
        });
      }
    } else if (entry.ownershipPercentage > 0) {
      // Under 25%: borrower is NOT self-employed. K-1 boxes 1/2/3 remain usable as
      // ordinary income (guaranteed payments are added separately below) — no
      // business add-backs, no liquidity test — capped at distributions received
      // unless a stable history is documented.
      const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
      const minorityK1Income = ordinary.add(rentalRealEstate).add(otherRental).mul(shareFactor);
      k1EligibleIncome = entry.hasStableDistributions
        ? minorityK1Income
        : Decimal.min(minorityK1Income, distributions);
      warnings.push({
        code: 'PARTNERSHIP_MINORITY_K1_INCOME',
        severity: 'WARNING',
        message: `Partnership Year ${entry.year}: Ownership ${entry.ownershipPercentage}% is under 25% — borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 ($${minorityK1Income.toFixed(2)}) plus guaranteed payments, with no business add-backs${entry.hasStableDistributions ? '' : ` and capped at distributions received ($${distributions.toFixed(2)})`}. Document a 2-year receipt history. Note: qualify on the END-of-year percentage — Freddie Mac uses the Item J profit %, FNMA uses the capital %.`
      });
    }

    const totalCombined = k1EligibleIncome.add(guaranteed);
    addFlowToYear(entry.year, totalCombined);

    return {
      year: entry.year,
      guaranteedPayments: guaranteed.toNumber(),
      k1EligibleIncome: k1EligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // D. FORM 1120 - U.S. CORPORATION INCOME TAX RETURN
  // ──────────────────────────────────────────────────────────────────────
  const form1120Breakdown = (payload.form1120 || []).map((entry) => {
    const w2 = new Decimal(entry.w2WagesFromCorporate || 0);
    const taxable = new Decimal(entry.taxableIncome || 0);
    const taxPaid = new Decimal(entry.totalTaxPaid || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nol = new Decimal(entry.nolAndSpecialDeductions || 0);
    const dividends = new Decimal(entry.borrowerDividendsReceived || 0);

    const cash = new Decimal(entry.cash || 0);
    const securities = new Decimal(entry.securities || 0);
    const ar = new Decimal(entry.accountsReceivable || 0);
    const currentLiabilities = new Decimal(entry.currentLiabilities || 1); // Avoid division by zero

    // Quick Ratio Test: (Cash + Securities + Accounts Receivable) / Current Liabilities
    const quickRatio = cash.add(securities).add(ar).div(currentLiabilities);
    const passesLiquidity = quickRatio.gte(1.0);

    let corporateEligibleIncome = new Decimal(0);

    if (entry.ownershipPercentage >= 25) {
      if (passesLiquidity) {
        // Form 1084 Corp Calculation: (Taxable Income - Tax Paid + Depreciation + Depletion + Amortization - Meals + NOL) * Share%
        const totalCorpAdjustments = taxable
          .sub(taxPaid)
          .add(depr)
          .add(depl)
          .add(amort)
          .sub(meals)
          .add(nol);

        const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
        corporateEligibleIncome = totalCorpAdjustments.mul(shareFactor);
      } else {
        corporateEligibleIncome = new Decimal(0);
        warnings.push({
          code: 'CORPORATE_LIQUIDITY_FAILED',
          severity: 'WARNING',
          message: `C-Corporation Year ${entry.year}: Quick Ratio is ${quickRatio.toFixed(2)} (< 1.0). Balance sheet liquidity failed Fannie Mae requirements. Corporate adjustments have been locked out ($0.00). Only borrower W-2 wages and direct dividends can qualify.`
        });
      }
    }

    // Dividends are always eligible for minority shareholders (<25%) and stack with corporate income for SE owners
    const totalCombined = w2.add(corporateEligibleIncome).add(dividends);
    addFlowToYear(entry.year, totalCombined);

    return {
      year: entry.year,
      w2WagesFromCorporate: w2.toNumber(),
      borrowerDividendsReceived: dividends.toNumber(),
      corporateEligibleIncome: corporateEligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber(),
      quickRatio: entry.ownershipPercentage >= 25 ? quickRatio.toDecimalPlaces(2).toNumber() : null,
      passesLiquidity: entry.ownershipPercentage >= 25 ? passesLiquidity : null
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // E. FORM 1040 BENEFIT INPUTS (SOCIAL SECURITY, DISABILITY, AND PENSIONS)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.benefits && payload.benefits.length > 0) {
    payload.benefits.forEach((entry) => {
      let benefitFlow = new Decimal(0);

      // 1. Social Security Retirement & Disability OASDI Gross-Up Math
      const ssTotal = new Decimal(entry.totalSocialSecurity || 0);
      const ssTaxable = new Decimal(entry.taxableSocialSecurity || 0);
      const ssExempt = Decimal.max(0, ssTotal.sub(ssTaxable));

      const ssQualifying = ssTaxable.add(ssExempt.mul(grossUpMultiplier));
      benefitFlow = benefitFlow.add(ssQualifying);

      if (ssExempt.gt(0)) {
        if (entry.isSupplementalSecurityIncome) {
          conditions.push({
            title: 'Supplemental Security Income (SSI) Continuance',
            category: 'INCOME',
            description: `SSI benefits detected. Verify 3-year continuance and confirm borrower meets active asset and income qualification limits.`,
            requiredDocType: 'SSI_AWARD_LETTER'
          });
        }
      }

      // 2. Pension & Annuity Distributions
      const totalPension = new Decimal(entry.totalPensionsAndAnnuities || 0);
      const taxablePension = new Decimal(entry.taxablePensionsAndAnnuities || 0);
      const exemptPension = Decimal.max(0, totalPension.sub(taxablePension));
      
      const pensionQualifying = taxablePension.add(exemptPension.mul(grossUpMultiplier));
      benefitFlow = benefitFlow.add(pensionQualifying);

      if (entry.isNonGovernmentPension && program === 'FHA') {
        conditions.push({
          title: 'Private Pension Continuance (FHA)',
          category: 'INCOME',
          description: `FHA guidelines (HUD 4000.1) require proof of 3-year continuance for non-government (private) pension distributions.`,
          requiredDocType: 'PENSION_BENEFITS_LETTER_OR_TRUST_STATEMENT'
        });
      }

      // 3. VA Disability & Benefits (100% Tax-Free, grossed up)
      const vaDisability = new Decimal(entry.vaDisabilityMonthly || 0);
      if (vaDisability.gt(0)) {
        const vaQualifyingAnnual = vaDisability.mul(grossUpMultiplier).mul(12);
        benefitFlow = benefitFlow.add(vaQualifyingAnnual);
      }

      addFlowToYear(entry.year, benefitFlow);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // F. ASSET-DERIVED INCOME (SCHEDULE B INTEREST/DIVIDENDS & SCHEDULE D GAINS)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.assets && payload.assets.length > 0) {
    payload.assets.forEach((entry) => {
      const interest = new Decimal(entry.interestIncome || 0);
      const dividends = new Decimal(entry.dividendIncome || 0);
      const capitalGains = new Decimal(entry.capitalGainsNetLoss || 0);

      const totalAssetFlow = interest.add(dividends).add(capitalGains);
      addFlowToYear(entry.year, totalAssetFlow);

      if (totalAssetFlow.gt(0) && !entry.hasThreeYearAssetSupport) {
        conditions.push({
          title: 'Asset Income Continuance & Asset Balance Audit',
          category: 'INCOME',
          description: `Borrower is qualifying using asset-derived income (Interest/Dividends/Capital Gains). Underwriter must verify that the underlying brokerage or deposit asset balance is sufficient to support the distribution rate for at least 36 months.`,
          requiredDocType: 'BROKERAGE_ACCOUNT_STATEMENTS_3_YEARS'
        });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // G. TRUST INCOME (SCHEDULE E, PART III & K-1 1041)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.trusts && payload.trusts.length > 0) {
    payload.trusts.forEach((entry) => {
      const trust = new Decimal(entry.trustIncome || 0);
      addFlowToYear(entry.year, trust);

      if (trust.gt(0) && !entry.hasThreeYearTrustContinuance) {
        conditions.push({
          title: 'Trust Agreement and Continuance Verification',
          category: 'INCOME',
          description: `Trust income detected on Schedule E Part III. Underwriter must verify the Trust Agreement or Trustee's Letter confirming stable distribution and 3-year continuance.`,
          requiredDocType: 'TRUST_AGREEMENT_AND_CERTIFICATE'
        });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // H. SCHEDULE E PAGE 1 - RENTAL PROPERTY VS. ROYALTY INCOME
  // ──────────────────────────────────────────────────────────────────────
  let totalQualifyingRentalMonthly = new Decimal(0);
  const rentalPropertiesMap: Record<string, ScheduleEPage1PropertyInput[]> = {};

  (payload.scheduleEProperties || []).forEach((prop) => {
    if (prop.propertyType === 'RENTAL') {
      if (!rentalPropertiesMap[prop.propertyAddress]) {
        rentalPropertiesMap[prop.propertyAddress] = [];
      }
      rentalPropertiesMap[prop.propertyAddress].push(prop);
    }
  });

  Object.entries(rentalPropertiesMap).forEach(([address, entries]) => {
    const sortedProps = [...entries].sort((a, b) => b.year - a.year);
    const hasMultipleYears = sortedProps.length >= 2;
    const isMultiFamily = sortedProps[0].isMultiFamilySubjectToFhaDecline === true;

    if (hasMultipleYears) {
      const propYear1 = sortedProps[0];
      const propYear2 = sortedProps[1];

      const p1 = getMonthlyPropertyCashFlow(propYear1);
      const p2 = getMonthlyPropertyCashFlow(propYear2);

      const monthly1 = p1.monthlyAverage;
      const monthly2 = p2.monthlyAverage;

      let finalPropertyMonthly = new Decimal(0);

      if (monthly1.lt(monthly2)) {
        const declineAmount = monthly2.sub(monthly1);
        const declinePercent = declineAmount.div(monthly2).mul(100).toNumber();

        if (program === 'FHA' && isMultiFamily) {
          if (declinePercent <= 5.0) {
            finalPropertyMonthly = monthly1.add(monthly2).div(2);
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_DECLINE_STABLE',
              severity: 'WARNING',
              message: `FHA Multi-Family rental cash flow for ${address} declined slightly by ${declinePercent.toFixed(1)}% (within 5% HUD stable decline threshold). Standard 24-month average ($${finalPropertyMonthly.toFixed(2)}/mo) utilized.`
            });
          } else if (declinePercent > 5.0 && declinePercent <= 20.0) {
            finalPropertyMonthly = monthly1;
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_DECLINE_ENFORCED',
              severity: 'WARNING',
              message: `FHA Multi-Family rental cash flow for ${address} declined by ${declinePercent.toFixed(1)}% (exceeds 5% HUD stable limit). Qualifying rental income restricted strictly to the lower most recent period of $${finalPropertyMonthly.toFixed(2)}/mo.`
            });
          } else {
            finalPropertyMonthly = new Decimal(0);
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_CRITICAL_DECLINE',
              severity: 'CRITICAL',
              message: `FHA Multi-Family rental cash flow for ${address} declined catastrophically by ${declinePercent.toFixed(1)}% (exceeds 20% limit). Income from this property has been completely disqualified ($0.00/mo) and locked out to prevent severe audit risk.`
            });
            conditions.push({
              title: 'FHA Multi-Family Rental Income Disqualification Review',
              category: 'INCOME',
              description: `Multi-family property ${address} rental income declined by ${declinePercent.toFixed(1)}% (exceeds 20% FHA boundary). Complete viability review required to satisfy HUD 4000.1 checklist.`,
              requiredDocType: 'MULTI_FAMILY_RENTAL_LEASE_AND_LEGER_PROOF'
            });
          }
        } else {
          finalPropertyMonthly = monthly1;
          warnings.push({
            code: 'RENTAL_INCOME_DECLINE_RESTRICTED',
            severity: 'WARNING',
            message: `Rental income for property ${address} declined by ${declinePercent.toFixed(1)}% year-over-year. Qualifying cash flow restricted to lower most recent period ($${finalPropertyMonthly.toFixed(2)}/mo).`
          });
        }
      } else {
        finalPropertyMonthly = monthly1.add(monthly2).div(2);
      }

      totalQualifyingRentalMonthly = totalQualifyingRentalMonthly.add(finalPropertyMonthly);

    } else {
      const propYear1 = sortedProps[0];
      const p1 = getMonthlyPropertyCashFlow(propYear1);
      const finalPropertyMonthly = p1.monthlyAverage;
      totalQualifyingRentalMonthly = totalQualifyingRentalMonthly.add(finalPropertyMonthly);
    }
  });

  const scheduleEPropertiesBreakdown = (payload.scheduleEProperties || []).map((entry) => {
    const net = new Decimal(entry.netIncomeLoss || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);

    let totalPropertyFlow = new Decimal(0);
    let calculatedMonths = 12;

    if (entry.propertyType === 'ROYALTY') {
      totalPropertyFlow = net.add(depl);

      if (totalPropertyFlow.gt(0) && !entry.hasThreeYearRoyaltyContinuance) {
        conditions.push({
          title: 'Royalty Income Continuance Verification',
          category: 'INCOME',
          description: `Royalty income detected from property: ${entry.propertyAddress}. Underwriter must verify 3-year continuance and confirm royalty agreements/contracts remain valid.`,
          requiredDocType: 'ROYALTY_CONTRACT_OR_AGREEMENT_AND_PROOFS'
        });
      }
      addFlowToYear(entry.year, totalPropertyFlow);
    } else {
      totalPropertyFlow = net.add(depr);
      calculatedMonths = getMonthsInService(entry);
    }

    return {
      year: entry.year,
      propertyAddress: entry.propertyAddress,
      propertyType: entry.propertyType,
      totalCashFlow: totalPropertyFlow.toNumber(),
      netIncomeLoss: net.toNumber(),
      depreciation: depr.toNumber(),
      depletion: depl.toNumber(),
      fairRentalDays: entry.fairRentalDays !== undefined ? entry.fairRentalDays : null,
      fairRentalDaysOverride: entry.fairRentalDaysOverride !== undefined ? entry.fairRentalDaysOverride : null,
      monthsInService: calculatedMonths
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // I. MULTI-YEAR TRENDING ANALYSIS & REGULATORY PROGRAM OVERLAYS
  // ──────────────────────────────────────────────────────────────────────
  const sortedYears = Object.keys(annualCalculatedTotals)
    .map(Number)
    .sort((a, b) => b - a);

  let trendingResult = 'INSUFFICIENT_DATA';

  if (program === 'VA' && sortedYears.length < 2 && (payload.scheduleC || payload.form1120S || payload.form1065 || payload.form1120)) {
    warnings.push({
      code: 'VA_MIN_HISTORY_BREACH',
      severity: 'WARNING',
      message: `VA self-employed underwriting requires a minimum of 2 years history. Only ${sortedYears.length} year(s) provided. Loan Officer must verify standard matching industry background for a history exception.`
    });
  }

  if (sortedYears.length >= 2) {
    const year1 = annualCalculatedTotals[sortedYears[0]];
    const year2 = annualCalculatedTotals[sortedYears[1]];

    if (year1.gte(year2)) {
      trendingResult = `${program}_STABLE_OR_INCREASING`;
      totalQualifyingMonthlyIncome = year1.add(year2).div(24);

      const increaseAmount = year1.sub(year2);
      const increasePercent = increaseAmount.div(year2).mul(100).toNumber();
      if (increasePercent > 10.0 && program === 'CONVENTIONAL') {
        warnings.push({
          code: 'FHLMC_SIGNIFICANT_INCREASE_AUDIT',
          severity: 'WARNING',
          message: `Freddie Mac Alert: Variable cash flow increased by ${increasePercent.toFixed(1)}% year-over-year. Fluctuation requires underwriter analysis.`
        });
      }
    } else {
      const declineAmount = year2.sub(year1);
      const declinePercent = declineAmount.div(year2).mul(100).toNumber();

      trendingResult = `${program}_DECLINING`;

      if (program === 'FHA') {
        totalQualifyingMonthlyIncome = year1.div(12);
        if (declinePercent <= 5.0) {
          trendingResult = 'FHA_DECLINE_STABLE';
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
        } else if (declinePercent > 5.0 && declinePercent <= 20.0) {
          warnings.push({
            code: 'FHA_INCOME_DECLINE_ENFORCED',
            severity: 'WARNING',
            message: `FHA self-employed and variable cash flow declined by ${declinePercent.toFixed(1)}% year-over-year. Under HUD 4000.1, calculations are restricted strictly to the lower most recent 12-month period ($${totalQualifyingMonthlyIncome.toFixed(2)}/mo).`
          });
        } else {
          trendingResult = 'FHA_CRITICAL_DECLINE';
          warnings.push({
            code: 'FHA_CRITICAL_INCOME_DECLINE',
            severity: 'CRITICAL',
            message: `FHA Alert: Self-employed cash flow declined by ${declinePercent.toFixed(1)}% (exceeds 20% limit). Business viability is highly suspect.`
          });
        }
      } else if (program === 'CONVENTIONAL') {
        if (declinePercent <= 10.0) {
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
          warnings.push({
            code: 'CONVENTIONAL_MILD_DECLINE_STABLE',
            severity: 'WARNING',
            message: `Conventional Warning: Cash flow declined by ${declinePercent.toFixed(1)}% (within 10% FHLMC limit). Standard 24-month average ($${totalQualifyingMonthlyIncome.toFixed(2)}/mo) is utilized.`
          });
        } else {
          totalQualifyingMonthlyIncome = year1.div(12);
          warnings.push({
            code: 'FHLMC_SIGNIFICANT_DECLINE_ENFORCED',
            severity: 'WARNING',
            message: `Freddie Mac Alert: Cash flow declined by ${declinePercent.toFixed(1)}% (exceeds 10% limit). Qualifying restricted to lower most recent 12-month average of $${totalQualifyingMonthlyIncome.toFixed(2)}/mo.`
          });
        }
      } else {
        totalQualifyingMonthlyIncome = year1.div(12);
        warnings.push({
          code: 'INCOME_DECLINE_DETECTED',
          severity: 'WARNING',
          message: `Alert: Income declined by ${declinePercent.toFixed(1)}%. Restricted strictly to lower most recent 12-month average of $${totalQualifyingMonthlyIncome.toFixed(2)}/mo.`
        });
      }
    }
  } else if (sortedYears.length === 1) {
    trendingResult = 'SINGLE_YEAR';
    totalQualifyingMonthlyIncome = annualCalculatedTotals[sortedYears[0]].div(12);
  }

  // ──────────────────────────────────────────────────────────────────────
  // J. MILITARY LES PARSING & BASE PAY / TAX-FREE HOUSING GROSS-UP
  // ──────────────────────────────────────────────────────────────────────
  let totalQualifyingMilitaryMonthly = new Decimal(0);
  let militaryBreakdown = null;

  if (payload.militaryLES) {
    const les = payload.militaryLES;
    const basicPay = new Decimal(les.militaryBasicPay);
    const bah = new Decimal(les.militaryBAH);
    const bas = new Decimal(les.militaryBAS);
    const taxFreeAllowances = bah.add(bas);

    const qualifyingAllowances = taxFreeAllowances.mul(grossUpMultiplier);
    const militaryGrossUpBenefit = qualifyingAllowances.sub(taxFreeAllowances);

    let eligibleSpecialPay = new Decimal(0);
    if (les.militarySpecialPay && les.militarySpecialPay > 0) {
      if (les.hasSpecialPayHistory) {
        eligibleSpecialPay = new Decimal(les.militarySpecialPay);
      } else {
        conditions.push({
          title: 'Military Special Pay History Audit',
          category: 'INCOME',
          description: `Military special pay (flight/hazard/combat) of $${les.militarySpecialPay}/mo detected on LES, but lacks verified 12-month receipt history. Excluded from qualifying baseline.`,
          requiredDocType: 'MILITARY_ORDERS_OR_YTD_HISTORY_PROOF'
        });
      }
    }

    totalQualifyingMilitaryMonthly = basicPay.add(eligibleSpecialPay).add(qualifyingAllowances);

    militaryBreakdown = {
      basicPay: basicPay.toNumber(),
      eligibleSpecialPay: eligibleSpecialPay.toNumber(),
      taxFreeAllowances: taxFreeAllowances.toNumber(),
      qualifyingAllowances: qualifyingAllowances.toNumber(),
      monthlyGrossUpBenefit: militaryGrossUpBenefit.toNumber(),
      totalQualifyingMilitaryMonthly: totalQualifyingMilitaryMonthly.toNumber()
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // K. FINAL CASH FLOW ASSEMBLY: VA INCOME REDUCTION VS. CONVENTIONAL DEBT OFFSET (v9 Core)
  // ──────────────────────────────────────────────────────────────────────
  let finalRentalIncomeImpact = new Decimal(0);
  let proposedRentalLossDebt = new Decimal(0);
  let subjectHousingExpenseAdjustment = new Decimal(0);

  if (totalQualifyingRentalMonthly.lt(0)) {
    if (program === 'VA') {
      // VA Rule: Direct reduction of gross qualifying income [cite: 122]
      finalRentalIncomeImpact = totalQualifyingRentalMonthly;
      warnings.push({
        code: 'VA_RENTAL_LOSS_INCOME_REDUCTION',
        severity: 'WARNING',
        message: `VA Guidelines require net aggregated rental loss of ($${Math.abs(totalQualifyingRentalMonthly.toNumber()).toFixed(2)}/mo) to be deducted directly from gross qualifying income.`
      });
    } else {
      // FNMA/Conventional & FHA Rule: Clamp income impact to $0.00 and redirect loss as debt [cite: 107]
      finalRentalIncomeImpact = new Decimal(0);
      proposedRentalLossDebt = totalQualifyingRentalMonthly.abs();
      warnings.push({
        code: 'CONVENTIONAL_RENTAL_LOSS_LIABILITY',
        severity: 'WARNING',
        message: `Conventional/FHA net aggregated rental loss of ($${proposedRentalLossDebt.toFixed(2)}/mo) has been clamped to $0.00 for qualifying income and redirected as a proposed monthly liability on the 1003.`
      });
    }
  } else {
    // Net positive rental income is added directly to gross income for all programs [cite: 122]
    finalRentalIncomeImpact = totalQualifyingRentalMonthly;
  }

  // Handle optional Subject Property Rental inputs [cite: 35]
  if (payload.subjectPropertyRental) {
    const { grossMarketRent, subjectPITIA, isPrimaryMultiFamily2To4Unit } = payload.subjectPropertyRental;
    const rawRent = new Decimal(grossMarketRent || 0);
    const pitia = new Decimal(subjectPITIA || 0);
    const adjustedRent = rawRent.mul(0.75); // Fannie Mae 75% vacancy factor [cite: 35]
    const netSubjectCashFlow = adjustedRent.sub(pitia);

    if (isPrimaryMultiFamily2To4Unit) {
      // Duplex/triplex/fourplex primary residence offset check [cite: 35]
      if (netSubjectCashFlow.gt(0)) {
        finalRentalIncomeImpact = finalRentalIncomeImpact.add(netSubjectCashFlow);
      } else {
        subjectHousingExpenseAdjustment = netSubjectCashFlow.abs();
        warnings.push({
          code: 'PRIMARY_2_4_UNIT_RENTAL_DEFICIT',
          severity: 'WARNING',
          message: `Subject multi-family primary residence tenant unit rental deficit of ($${subjectHousingExpenseAdjustment.toFixed(2)}/mo) has been applied as an adjustment to the primary housing expense, bypassing consumer liability categorization.`
        });
      }
    } else {
      // Investment Property Subject Rent [cite: 35]
      if (netSubjectCashFlow.gt(0)) {
        finalRentalIncomeImpact = finalRentalIncomeImpact.add(netSubjectCashFlow);
      } else {
        proposedRentalLossDebt = proposedRentalLossDebt.add(netSubjectCashFlow.abs());
        warnings.push({
          code: 'INVESTMENT_SUBJECT_RENTAL_DEFICIT',
          severity: 'WARNING',
          message: `Subject investment property net rental loss of ($${netSubjectCashFlow.abs().toFixed(2)}/mo) has been mapped as a proposed monthly liability debt.`
        });
      }
    }
  }

  // Combine military and rental impact
  totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(totalQualifyingMilitaryMonthly);
  totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(finalRentalIncomeImpact);

  return {
    summary: {
      qualifyingMonthlyIncome: totalQualifyingMonthlyIncome.toDecimalPlaces(2).toNumber(),
      proposedRentalLossDebt: proposedRentalLossDebt.toDecimalPlaces(2).toNumber(),
      subjectHousingExpenseAdjustment: subjectHousingExpenseAdjustment.toDecimalPlaces(2).toNumber(),
      trendingResult,
      yearsAnalyzed: sortedYears,
      programUsed: program,
      appliedGrossUpMultiplier: grossUpMultiplier.toNumber(),
      appliedGrossUpPercentText: grossUpPercentText
    },
    warnings,
    conditions,
    scheduleCBreakdown,
    form1120SBreakdown,
    form1065Breakdown,
    form1120Breakdown,
    scheduleEPropertiesBreakdown,
    militaryBreakdown
  };
}
