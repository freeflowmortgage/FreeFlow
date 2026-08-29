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
}

export interface Form1040BenefitInput {
  year: number;
  // Social Security Benefit (Line 6a & 6b)
  totalSocialSecurity?: number;
  taxableSocialSecurity?: number;
  isSupplementalSecurityIncome?: boolean; // SSI (needs-based, requires continuance)

  // Pension & Annuity Distributions (Line 5a & 5b)
  totalPensionsAndAnnuities?: number;
  taxablePensionsAndAnnuities?: number;
  isNonGovernmentPension?: boolean; // FHA strictly requires continuance on private/non-gov pension

  // VA Disability & Benefits (Tax-Free, Eligible for gross-up)
  vaDisabilityMonthly?: number;
}

export interface ScheduleBAndDInput {
  year: number;
  interestIncome?: number;       // Schedule B, Part I
  dividendIncome?: number;       // Schedule B, Part II
  capitalGainsNetLoss?: number;  // Schedule D, Net Long/Short Term
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
}

export interface MilitaryLESInput {
  militaryBasicPay: number;      // Taxable Basic Pay
  militaryBAH: number;           // Basic Allowance for Housing (Tax-Free)
  militaryBAS: number;           // Basic Allowance for Subsistence (Tax-Free)
  militarySpecialPay?: number;   // Flight, Hazard, Sea, Combat pay
  hasSpecialPayHistory?: boolean; // Minimum 12-24 month history verification
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
}

// ────────────────────────────────────────────────────────────────────────
// 2. UNIFIED CASH FLOW ENGINE & REGULATORY RULE VERIFIER
// ────────────────────────────────────────────────────────────────────────

export function calculateUnifiedIncome(payload: UnifiedIncomeCalculationPayload) {
  const program = payload.loanProgram;
  const warnings: WarningMessage[] = [];
  const conditions: GeneratedCondition[] = [];
  
  // HUD 4000.1 FHA Gross-Up Cap: Strictly 1.15 (115%) for non-taxable income
  // Conventional/VA/USDA Gross-Up: Up to 1.25 (125%)
  const grossUpMultiplier = program === 'FHA' ? 1.15 : 1.25;
  const grossUpPercentText = program === 'FHA' ? '15%' : '25%';

  let totalQualifyingMonthlyIncome = new Decimal(0);
  const annualCalculatedTotals: Record<number, Decimal> = {};

  const addFlowToYear = (year: number, val: Decimal) => {
    annualCalculatedTotals[year] = (annualCalculatedTotals[year] || new Decimal(0)).add(val);
  };

  // ──────────────────────────────────────────────────────────────────────
  // A. SCHEDULE C - SOLE PROPRIETOR INCOME
  // ──────────────────────────────────────────────────────────────────────
  const scheduleCBreakdown = (payload.scheduleC || []).map((entry) => {
    const months = entry.monthsInBusiness || 12;
    const net = new Decimal(entry.netProfitLoss);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nonrec = new Decimal(entry.nonrecurringOtherIncomeLoss || 0);
    const amort = new Decimal(entry.amortizationCasualtyLoss || 0);

    // USDA Home Office Restorations
    let home = new Decimal(entry.businessUseOfHome || 0);
    if (program === 'USDA' && home.gt(0)) {
      home = new Decimal(0);
      warnings.push({
        code: 'USDA_HOME_OFFICE_RESTRICTION',
        severity: 'WARNING',
        message: `USDA Program restrictions disallow the automatic add-back of Schedule C Business Use of Home ($${entry.businessUseOfHome}) without explicit underwriter liquidity documentation.`
      });
    }

    const totalScheduleCFlow = net
      .add(depr)
      .add(depl)
      .add(home)
      .add(amort)
      .sub(meals)
      .add(nonrec);

    addFlowToYear(entry.year, totalScheduleCFlow);
    return {
      year: entry.year,
      totalCashFlow: totalScheduleCFlow.toNumber(),
      monthlyAverage: totalScheduleCFlow.div(months).toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // B. FORM 1120S - S-CORPORATION ADJUSTMENTS
  // ──────────────────────────────────────────────────────────────────────
  const form1120SBreakdown = (payload.form1120S || []).map((entry) => {
    const months = entry.monthsInBusiness || 12;
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    const w2 = new Decimal(entry.w2WagesFromBusiness || 0);

    const k1Ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const k1Rental = new Decimal(entry.k1NetRentalRealEstate || 0);
    const k1Other = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const k1Dist = new Decimal(entry.k1Distributions || 0);

    const corporateAdjustments = k1Ordinary
      .add(k1Rental)
      .add(k1Other)
      .add(depr)
      .add(depl)
      .add(amort)
      .sub(meals)
      .mul(ownership);

    let eligibleCorporateIncome = corporateAdjustments;

    if (entry.hasStableDistributions === false) {
      const distributionShare = k1Dist.mul(ownership);
      if (distributionShare.lt(corporateAdjustments)) {
        eligibleCorporateIncome = distributionShare;
        warnings.push({
          code: 'S_CORP_DISTRIBUTION_RESTRICTION',
          severity: 'WARNING',
          message: `K-1 S-Corp cash flow adjustments restricted to actual cash distributions ($${distributionShare.toFixed(2)}) due to missing stable distribution verification.`
        });
      }
    }

    const totalCashFlow = w2.add(eligibleCorporateIncome);
    addFlowToYear(entry.year, totalCashFlow);

    return {
      year: entry.year,
      totalCashFlow: totalCashFlow.toNumber(),
      monthlyAverage: totalCashFlow.div(months).toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // C. FORM 1065 - PARTNERSHIP ADJUSTMENTS
  // ──────────────────────────────────────────────────────────────────────
  const form1065Breakdown = (payload.form1065 || []).map((entry) => {
    const months = entry.monthsInBusiness || 12;
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    
    const k1Ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const k1Rental = new Decimal(entry.k1NetRentalRealEstate || 0);
    const k1Other = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const guaranteed = new Decimal(entry.k1GuaranteedPayments || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const k1Dist = new Decimal(entry.k1Distributions || 0);

    const adjustmentSum = k1Ordinary
      .add(k1Rental)
      .add(k1Other)
      .add(depr)
      .add(depl)
      .add(amort)
      .sub(meals)
      .mul(ownership)
      .add(guaranteed);

    let totalCashFlow = adjustmentSum;

    if (entry.hasStableDistributions === false) {
      const distributionShare = k1Dist.mul(ownership).add(guaranteed);
      if (distributionShare.lt(adjustmentSum)) {
        totalCashFlow = distributionShare;
        warnings.push({
          code: 'PARTNERSHIP_DISTRIBUTION_RESTRICTION',
          severity: 'WARNING',
          message: `Partnership corporate adjustments restricted to actual distributions plus guaranteed payments ($${distributionShare.toFixed(2)}) due to missing stable distribution history.`
        });
      }
    }

    addFlowToYear(entry.year, totalCashFlow);
    return {
      year: entry.year,
      totalCashFlow: totalCashFlow.toNumber(),
      monthlyAverage: totalCashFlow.div(months).toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // D. FORM 1120 - C-CORPORATION ADJUSTMENTS
  // ──────────────────────────────────────────────────────────────────────
  const form1120Breakdown = (payload.form1120 || []).map((entry) => {
    const months = entry.monthsInBusiness || 12;
    const ownership = new Decimal(entry.ownershipPercentage).div(100);
    const w2 = new Decimal(entry.w2WagesFromCorporate || 0);

    if (ownership.lt(0.25)) {
      addFlowToYear(entry.year, w2);
      return {
        year: entry.year,
        totalCashFlow: w2.toNumber(),
        monthlyAverage: w2.div(months).toNumber(),
        quickRatio: null,
        passesLiquidity: null
      };
    }

    const taxable = new Decimal(entry.taxableIncome);
    const tax = new Decimal(entry.totalTaxPaid || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nol = new Decimal(entry.nolAndSpecialDeductions || 0);

    const cash = new Decimal(entry.cash || 0);
    const securities = new Decimal(entry.securities || 0);
    const ar = new Decimal(entry.accountsReceivable || 0);
    const liab = new Decimal(entry.currentLiabilities || 1);

    const quickAssets = cash.add(securities).add(ar);
    const quickRatio = quickAssets.div(liab).toDecimalPlaces(2);
    const passesLiquidity = quickRatio.gte(1.0);

    const corporateAdjustments = taxable
      .sub(tax)
      .add(depr)
      .add(depl)
      .add(amort)
      .add(nol)
      .sub(meals)
      .mul(ownership);

    const eligibleShare = passesLiquidity ? corporateAdjustments : new Decimal(0);
    const totalCashFlow = w2.add(eligibleShare);

    if (!passesLiquidity) {
      warnings.push({
        code: 'CORPORATE_LIQUIDITY_FAILED',
        severity: 'WARNING',
        message: `Schedule L Quick Ratio of ${quickRatio.toNumber()} is under 1.0. C-Corp corporate cash additions ($${corporateAdjustments.toFixed(2)}) are locked out and restricted strictly to W-2 Officer Compensation due to balance sheet liquidity failure.`
      });
    }

    addFlowToYear(entry.year, totalCashFlow);
    return {
      year: entry.year,
      totalCashFlow: totalCashFlow.toNumber(),
      monthlyAverage: totalCashFlow.div(months).toNumber(),
      quickRatio: quickRatio.toNumber(),
      passesLiquidity
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // E. PENSIONS, ANNUITIES, SOCIAL SECURITY & VA BENEFITS (FORM 1040)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.benefits && payload.benefits.length > 0) {
    payload.benefits.forEach((entry) => {
      let benefitFlow = new Decimal(0);

      // 1. Social Security Retirement & Disability OASDI Gross-Up Math
      const ssTotal = new Decimal(entry.totalSocialSecurity || 0);
      const ssTaxable = new Decimal(entry.taxableSocialSecurity || 0);
      const ssExempt = Decimal.max(0, ssTotal.sub(ssTaxable));

      // Calculate grossed-up value for non-taxable Social Security
      const ssQualifying = ssTaxable.add(ssExempt.mul(grossUpMultiplier));
      benefitFlow = benefitFlow.add(ssQualifying);

      if (ssExempt.gt(0)) {
        // Standard Retirement & Disability DO NOT require 3-year continuance under GSE/FHA/VA
        if (entry.isSupplementalSecurityIncome) {
          // SSI is needs-based and does require continuance check
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

      // FHA Private Pension Rule: FHA strictly requires 3-year continuance only on non-government (private) pensions (HUD 4000.1)
      if (entry.isNonGovernmentPension && program === 'FHA') {
        conditions.push({
          title: 'Private Pension Continuance (FHA)',
          category: 'INCOME',
          description: `FHA guidelines (HUD 4000.1) require proof of 3-year continuance for non-government (private) pension distributions.`,
          requiredDocType: 'PENSION_BENEFITS_LETTER_OR_TRUST_STATEMENT'
        });
      }

      // 3. VA Disability & Benefits (100% Tax-Free, eligible for program-specific gross-up)
      const vaDisability = new Decimal(entry.vaDisabilityMonthly || 0);
      if (vaDisability.gt(0)) {
        // Multiply by 12 to convert monthly into annual since annualCalculatedTotals is accumulated annually
        const vaQualifyingAnnual = vaDisability.mul(grossUpMultiplier).mul(12);
        benefitFlow = benefitFlow.add(vaQualifyingAnnual);

        // Standard VA disability benefits do NOT require 3-year continuance proof unless award letter has expiration date
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

      // Mandatory 3-Year Continuance trigger for Asset Income based on asset depletion (All Programs)
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

      // Mandatory 3-Year Continuance and Trust Agreement conditions based on trust holdings
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
  const scheduleEPropertiesBreakdown = (payload.scheduleEProperties || []).map((entry) => {
    const net = new Decimal(entry.netIncomeLoss || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    
    let totalPropertyFlow = new Decimal(0);

    if (entry.propertyType === 'ROYALTY') {
      // ROYALTY CALCULATION: Net income (Line 21) + Depletion (Line 18)
      // Line 21 already incorporates Royalties received (Line 4) minus related expenses (Line 20)
      totalPropertyFlow = net.add(depl);

      // Trigger 3-year continuance for royalty properties to prevent audit issues
      if (totalPropertyFlow.gt(0) && !entry.hasThreeYearRoyaltyContinuance) {
        conditions.push({
          title: 'Royalty Income Continuance Verification',
          category: 'INCOME',
          description: `Royalty income detected from property: ${entry.propertyAddress}. Underwriter must verify 3-year continuance and confirm royalty agreements/contracts remain valid.`,
          requiredDocType: 'ROYALTY_CONTRACT_OR_AGREEMENT_AND_PROOFS'
        });
      }
    } else {
      // RENTAL CALCULATION: Net income (Line 21) + Depreciation (Line 18)
      totalPropertyFlow = net.add(depr);
      
      // Standard rental real estate on Schedule E does NOT require a 3-year continuance verify under Fannie/Freddie rules
    }

    addFlowToYear(entry.year, totalPropertyFlow);

    return {
      year: entry.year,
      propertyAddress: entry.propertyAddress,
      propertyType: entry.propertyType,
      totalCashFlow: totalPropertyFlow.toNumber(),
      netIncomeLoss: net.toNumber(),
      depreciation: depr.toNumber(),
      depletion: depl.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // I. MULTI-YEAR TRENDING ANALYSIS & REGULATORY PROGRAM OVERLAYS
  // ──────────────────────────────────────────────────────────────────────
  const sortedYears = Object.keys(annualCalculatedTotals)
    .map(Number)
    .sort((a, b) => b - a);

  let trendingResult = 'INSUFFICIENT_DATA';

  // VA 2-Year History Rule for self-employed portfolios
  if (program === 'VA' && sortedYears.length < 2 && (payload.scheduleC || payload.form1120S || payload.form1065 || payload.form1120)) {
    warnings.push({
      code: 'VA_MIN_HISTORY_BREACH',
      severity: 'WARNING',
      message: `VA self-employed underwriting requires a minimum of 2 years history. Only ${sortedYears.length} year(s) provided. Loan Officer must verify standard matching industry background for a history exception.`
    });
  }

  if (sortedYears.length >= 2) {
    const year1 = annualCalculatedTotals[sortedYears[0]]; // Most Recent Year
    const year2 = annualCalculatedTotals[sortedYears[1]]; // Prior Year

    if (year1.gte(year2)) {
      // Income is stable or increasing -> Standard 24-month average
      trendingResult = `${program}_STABLE_OR_INCREASING`;
      totalQualifyingMonthlyIncome = year1.add(year2).div(24);
    } else {
      // Income is declining -> Force restriction to lower, most recent 12-month period
      const declineAmount = year2.sub(year1);
      const declinePercent = declineAmount.div(year2).mul(100).toNumber();

      trendingResult = `${program}_DECLINING`;
      totalQualifyingMonthlyIncome = year1.div(12);

      // Add program-specific warnings
      if (program === 'FHA') {
        if (declinePercent <= 5.0) {
          // FHA allows standard average for minor declines (<= 5%)
          trendingResult = 'FHA_DECLINE_STABLE';
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
        } else if (declinePercent > 5.0 && declinePercent <= 20.0) {
          warnings.push({
            code: 'FHA_INCOME_DECLINE_ENFORCED',
            severity: 'WARNING',
            message: `FHA self-employed and variable cash flow declined by ${declinePercent.toFixed(1)}% year-over-year. Under HUD 4000.1, calculations are restricted strictly to the lower most recent 12-month period ($${totalQualifyingMonthlyIncome.toFixed(2)}/mo).`
          });
        } else {
          // Decline exceeds 20%
          trendingResult = 'FHA_CRITICAL_DECLINE';
          warnings.push({
            code: 'FHA_CRITICAL_INCOME_DECLINE',
            severity: 'CRITICAL',
            message: `FHA Alert: Self-employed cash flow declined by ${declinePercent.toFixed(1)}% (exceeds 20% regulatory limit). Business viability is highly suspect; income is subject to complete disqualification by the underwriter unless extreme compensating factors exist.`
          });
        }
      } else {
        warnings.push({
          code: 'INCOME_DECLINE_DETECTED',
          severity: 'WARNING',
          message: `Alert: Qualifying income streams declined by ${declinePercent.toFixed(1)}% year-over-year. Calculations are restricted strictly to the lower most recent 12-month average of $${totalQualifyingMonthlyIncome.toFixed(2)}/mo.`
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

    // Gross up tax-free military allowances (BAH/BAS) dynamically [FHA = 1.15, Conventional/VA/USDA = 1.25]
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

    // Combine military monthly pay to the main qualifying income
    totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(totalQualifyingMilitaryMonthly);
  }

  return {
    summary: {
      qualifyingMonthlyIncome: totalQualifyingMonthlyIncome.toDecimalPlaces(2).toNumber(),
      trendingResult,
      yearsAnalyzed: sortedYears,
      programUsed: program,
      appliedGrossUpMultiplier: grossUpMultiplier,
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
