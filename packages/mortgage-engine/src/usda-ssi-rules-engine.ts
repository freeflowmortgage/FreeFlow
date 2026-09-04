/**
 * FreeFlow Mortgage Solutions - Advanced SSI & USDA Income Rules Engine
 * 
 * This module implements precision calculations for:
 * 1. Conventional SSI Automatic Gross-up (FNMA/FHLMC 15% rule without tax returns)
 * 2. FHA SSI Verification Rules (requires tax returns to verify taxable portion)
 * 3. USDA Dual-Track Math (Repayment Income with add-backs vs. Annual Household Eligibility)
 * 4. Transactional Asset Sourcing for Undisclosed Household Income Detection
 */
import {
  processUsdaStandaloneCalculationV2,
  UsdaEngineInput
} from './usda-projected-income-engine-v2';

export interface SsiInput {
  grossAward: number;
  hasTaxReturns: boolean;
  taxableAmountFrom1040?: number; // From Line 6b of Form 1040
  programType: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
}

export interface SsiCalculationResult {
  grossAward: number;
  taxExemptPortion: number;
  taxablePortion: number;
  grossedUpExemptPortion: number;
  finalQualifyingIncome: number;
  requiresTaxReturns: boolean;
  complianceWarning?: string;
}

/**
 * Calculates the qualifying SSI income based on agency rules.
 * 
 * UNDER FNMA/FHLMC (Conventional): 
 * If no tax returns are provided, we can assume a flat 15% is tax-exempt and gross it up 1.25.
 * Formula:
 * 1. Gross Award = G
 * 2. Auto-exempt portion (15% of Gross) = G * 0.15
 * 3. Grossed-up exempt portion = G * 0.15 * 1.25
 * 4. Taxable portion = G - (G * 0.15)
 * 5. Final qualifying = Taxable portion + Grossed-up exempt portion
 * 
 * UNDER FHA:
 * Requires tax returns to gross up any portion of SSI.
 */
export function calculateSsiQualifyingIncome(input: SsiInput): SsiCalculationResult {
  const G = input.grossAward;

  if (input.programType === 'FHA') {
    if (!input.hasTaxReturns) {
      return {
        grossAward: G,
        taxExemptPortion: 0,
        taxablePortion: G,
        grossedUpExemptPortion: 0,
        finalQualifyingIncome: G,
        requiresTaxReturns: true,
        complianceWarning: 'FHA requires federal tax returns (Form 1040) to verify tax-exempt SSI status before applying any gross-up.'
      };
    }

    // FHA with returns
    const taxable = input.taxableAmountFrom1040 ?? G;
    const exempt = Math.max(0, G - taxable);
    const grossedUpExempt = exempt * 1.25;

    return {
      grossAward: G,
      taxExemptPortion: exempt,
      taxablePortion: taxable,
      grossedUpExemptPortion: grossedUpExempt,
      finalQualifyingIncome: taxable + grossedUpExempt,
      requiresTaxReturns: false
    };
  }

  // Conventional (FNMA/FHLMC) - Automatic 15% Rule
  if (!input.hasTaxReturns) {
    const original15Percent = G * 0.15;
    const grossedUp15Percent = original15Percent * 1.25;
    const taxablePortion = G - original15Percent;
    const finalQualifying = taxablePortion + grossedUp15Percent;

    return {
      grossAward: G,
      taxExemptPortion: original15Percent,
      taxablePortion: taxablePortion,
      grossedUpExemptPortion: grossedUp15Percent,
      finalQualifyingIncome: finalQualifying,
      requiresTaxReturns: false,
      complianceWarning: 'Conventional automatic 15% tax-exempt assumption applied. No tax returns required.'
    };
  }

  // Conventional with returns (allows higher gross-up if 1040 proves taxable amount is lower than 85%)
  const taxable = input.taxableAmountFrom1040 ?? (G * 0.85);
  const exempt = Math.max(0, G - taxable);
  const grossedUpExempt = exempt * 1.25;

  return {
    grossAward: G,
    taxExemptPortion: exempt,
    taxablePortion: taxable,
    grossedUpExemptPortion: grossedUpExempt,
    finalQualifyingIncome: taxable + grossedUpExempt,
    requiresTaxReturns: false
  };
}

export interface ScheduleCBusinessIncome {
  netProfitLoss: number;
  depreciation: number;
  businessUseOfHome: number;
  mealsExclusion: number;
}

export interface HouseholdMember {
  name: string;
  isBorrower: boolean;
  age: number;
  w2IncomeMonthly: number;
  selfEmployment?: ScheduleCBusinessIncome;
}

export interface BankTransaction {
  id: string;
  date: string;
  amount: number; // Positive is deposit, negative is withdrawal
  description: string;
}

export interface UsdaCalculationInput {
  householdMembers: HouseholdMember[];
  bankTransactions: BankTransaction[];
  countyMedianIncomeLimit: number;
}

export interface SsiDualTrackResult {
  repaymentIncomeMonthly: number;    // Used for Qualifying DTI (Borrowers only, with add-backs)
  annualHouseholdIncome: number;     // Used for eligibility cap (All members, no self-employment add-backs)
  isEligibleByIncome: boolean;
  unverifiedAssetDeposits: BankTransaction[];
  complianceAlerts: string[];
}

/**
 * Executes the dual-track USDA calculation logic.
 * 
 * USDA rules require calculating:
 * 1. Repayment Income (DTI): Borrowers on the note only. Supports self-employed add-backs (depreciation, business use of home).
 * 2. Annual Household Income (Eligibility): Combined income of all household members.
 *    - CRITICAL RULE: Under USDA Chapter 9, self-employed depreciation and business use of home CANNOT be added back
 *      to artificially lower the eligibility income; net profit/loss is counted raw to avoid inflating eligibility thresholds.
 */
export function calculateUsdaEligibility(input: UsdaCalculationInput): SsiDualTrackResult {
  const canonicalInput: UsdaEngineInput = {
    loanId: 'legacy-usda-calculation',
    countyMedianIncomeLimit: input.countyMedianIncomeLimit,
    householdMembers: input.householdMembers.map((member) => ({
      name: member.name,
      age: member.age,
      isBorrower: member.isBorrower,
      isSpouse: false,
      isFullTimeStudent: false,
      earnedIncomeMonthly: member.w2IncomeMonthly,
      unearnedIncomeMonthly: 0,
      selfEmployment: member.selfEmployment
        ? {
            type: 'SCHEDULE_C',
            ...member.selfEmployment
          }
        : undefined
    })),
    bankTransactions: input.bankTransactions.map((tx) => ({
      ...tx,
      isRecurring: /\b(?:ZELLE|VENMO|CASH APP)\b/i.test(tx.description)
    }))
  };
  const canonical = processUsdaStandaloneCalculationV2(canonicalInput);
  const sourcedIds = new Set(canonical.sourcedTransactionIds);

  return {
    repaymentIncomeMonthly: canonical.repaymentIncomeMonthly,
    annualHouseholdIncome: canonical.annualHouseholdIncome,
    isEligibleByIncome: canonical.isEligibleByIncome,
    unverifiedAssetDeposits: input.bankTransactions.filter((tx) => sourcedIds.has(tx.id)),
    complianceAlerts: [...canonical.complianceLogs, ...canonical.sourcingAlerts]
  };
}
