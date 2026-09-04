/**
 * FreeFlow Mortgage Solutions - Advanced SSI & USDA Income Rules Engine
 * 
 * This module implements precision calculations for:
 * 1. Conventional SSI Automatic Gross-up (FNMA/FHLMC 15% rule without tax returns)
 * 2. FHA SSI Verification Rules (requires tax returns to verify taxable portion)
 * 3. USDA Dual-Track Math (Repayment Income with add-backs vs. Annual Household Eligibility)
 * 4. Transactional Asset Sourcing for Undisclosed Household Income Detection
 */

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
  let totalRepaymentMonthly = 0;
  let totalHouseholdAnnual = 0;
  const complianceAlerts: string[] = [];

  // Track primary repayment calculation baseline for transaction sourcing threshold
  let borrowerW2Total = 0;

  for (const member of input.householdMembers) {
    let memberRepaymentAnnual = 0;
    let memberHouseholdAnnual = 0;

    // 1. Calculate W2 base
    const w2Annual = member.w2IncomeMonthly * 12;
    if (member.isBorrower) {
      memberRepaymentAnnual += w2Annual;
      borrowerW2Total += member.w2IncomeMonthly;
    }
    memberHouseholdAnnual += w2Annual;

    // 2. Calculate Self-Employment if present
    if (member.selfEmployment) {
      const se = member.selfEmployment;
      
      // Repayment track (Conventional Form 1084 rules: add back depreciation & use of home, subtract meals)
      const repaymentSE = se.netProfitLoss + se.depreciation + se.businessUseOfHome - se.mealsExclusion;
      
      // Household Eligibility track (USDA rules: depreciation & business use of home are NOT allowed as add-backs)
      // Note: We take the net business profit/loss directly.
      const householdSE = se.netProfitLoss;

      if (member.isBorrower) {
        memberRepaymentAnnual += repaymentSE;
      }
      memberHouseholdAnnual += householdSE;

      complianceAlerts.push(
        `USDA Accounting Split applied for ${member.name}: Repayment SE added back $${se.depreciation} depreciation, Household SE excluded it.`
      );
    }

    // Accumulate
    totalRepaymentMonthly += (memberRepaymentAnnual / 12);
    totalHouseholdAnnual += memberHouseholdAnnual;
  }

  // Clamp monthly repayment to zero if net self-employment loss dragged it negative
  totalRepaymentMonthly = Math.max(0, totalRepaymentMonthly);

  // Determine eligibility against county limits
  const isEligible = totalHouseholdAnnual <= input.countyMedianIncomeLimit;

  // 3. Scan assets for potential undisclosed income sources (USDA Sourcing Audit)
  // Threshold: Look for unverified deposits exceeding 50% of borrowing payroll income, or recurring deposits
  const monthlyPayrollBase = borrowerW2Total || 2000; // default baseline if self-employed only
  const sourcingThreshold = monthlyPayrollBase * 0.5;
  const unverifiedAssetDeposits: BankTransaction[] = [];

  for (const tx of input.bankTransactions) {
    if (tx.amount > 0) {
      const descUpper = tx.description.toUpperCase();
      
      // Exclude typical payroll or transfer descriptors
      const isExpected = descUpper.includes('PAYROLL') || 
                         descUpper.includes('DIR DEP') || 
                         descUpper.includes('IRS TREAS') ||
                         descUpper.includes('TAX REF') ||
                         descUpper.includes('TRANSFER');

      if (!isExpected) {
        if (tx.amount >= sourcingThreshold) {
          unverifiedAssetDeposits.push(tx);
          complianceAlerts.push(
            `Undisclosed Income Audit: Large asset deposit of $${tx.amount} detected on ${tx.date} (${tx.description}). Underwriter must source to satisfy USDA regulations.`
          );
        } else if (descUpper.includes('ZELLE') || descUpper.includes('VENMO') || descUpper.includes('CASH APP')) {
          // Flag P2P apps as potential unrecorded cash income
          unverifiedAssetDeposits.push(tx);
          complianceAlerts.push(
            `Potential Cash Flow Leak: Peer-to-Peer transfer of $${tx.amount} detected (${tx.description}). Underwriter must verify if this is undisclosed household income.`
          );
        }
      }
    }
  }

  return {
    repaymentIncomeMonthly: totalRepaymentMonthly,
    annualHouseholdIncome: totalHouseholdAnnual,
    isEligibleByIncome: isEligible,
    unverifiedAssetDeposits,
    complianceAlerts
  };
}
