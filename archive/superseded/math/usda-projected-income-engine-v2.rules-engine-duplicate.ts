/**
 * FreeFlow Mortgage Solutions - Standalone USDA Projected Income & Eligibility Engine (v2)
 * 
 * This advanced point-solution implements strict compliance calculations under
 * USDA Rural Development Guidelines (HB-1-3555 Chapter 9) and Procedure Notice (PN) 657.
 * 
 * CORE FUNCTIONALITIES:
 * 1. Prospective Projected Income: 12-month forward-looking calculations (not retrospective averages).
 * 2. Multi-Borrower & Household Member Ingestion with Age & Student Gating Rules.
 * 3. Specific Full-Time Student Earned Income Caps (PN 657 limits to $500; older files use $480).
 * 4. Minor Earned Income Exclusions (0% of minor earned income included; 100% of unearned included).
 * 5. Strict USDA Asset Sourcing Audit:
 *    - ALL recurring deposits investigated (Zero Tolerance / $0 minimum per USDA Advanced Matrix).
 *    - Non-recurring deposits > $1,000 investigated (configurable down to $100 for conservative overlays).
 * 6. Dual-Track Self-Employment Splits:
 *    - Repayment DTI: Allows Depreciation & Business Use of Home Add-backs.
 *    - Household Eligibility: Depreciation & Business Use of Home Add-backs are STRICTLY DISALLOWED.
 * 7. Form-1040 SSI Gross-Up Formula:
 *    - Implements the automatic Conventional 15% tax-exempt gross-up step-by-step formula.
 * 
 * Pricing: Premium Complexity-Capped $45.00 Transaction Fee.
 */

export interface SsiProjectedInput {
  grossAwardMonthly: number;
  hasTaxReturns: boolean;
  taxableAmountFrom1040?: number; // From Line 6b of Form 1040 if provided
  programType: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
}

export interface SsiProjectedResult {
  grossAwardMonthly: number;
  original15PercentAmount: number;
  grossedUp15PercentAmount: number;
  taxableBaselineAmount: number;
  finalQualifyingMonthly: number;
  formulaDescription: string;
}

/**
 * Calculates SSI Qualifying Income using the automatic Conventional 15% Rule
 * Formula:
 * 1. Gross SSI Award = G
 * 2. Original 15% Exempt Amount = G * 0.15
 * 3. Grossed-Up Exempt Amount = (G * 0.15) * 1.25
 * 4. Taxable Baseline Amount = G - (G * 0.15)
 * 5. Final Qualifying Monthly = Taxable Baseline + Grossed-Up Exempt
 */
export function calculateProjectedSsi(input: SsiProjectedInput): SsiProjectedResult {
  const G = input.grossAwardMonthly;
  const original15Percent = G * 0.15;
  const grossedUp15 = original15Percent * 1.25;
  const taxableBaseline = G - original15Percent;
  const finalQualifying = taxableBaseline + grossedUp15;

  return {
    grossAwardMonthly: G,
    original15PercentAmount: original15Percent,
    grossedUp15PercentAmount: grossedUp15,
    taxableBaselineAmount: taxableBaseline,
    finalQualifyingMonthly: finalQualifying,
    formulaDescription: `Gross SSI Award ($${G.toFixed(2)}) minus 15% ($${original15Percent.toFixed(2)}) plus grossed-up 15% x 1.25 ($${grossedUp15.toFixed(2)}) = $${finalQualifying.toFixed(2)}`
  };
}

export interface UsdaScheduleCInput {
  netProfitLoss: number;       // Schedule C Line 31 (Net Profit/Loss)
  depreciation: number;        // Schedule C Line 12 (Depreciation)
  businessUseOfHome: number;   // Schedule C Line 30 (Business Use of Home)
  mealsExclusion: number;      // Schedule C Line 24b (Meals Exclusion)
}

export interface UsdaHouseholdMember {
  name: string;
  age: number;
  isBorrower: boolean;
  isSpouse: boolean;
  isFullTimeStudent: boolean;
  earnedIncomeMonthly: number;     // e.g., wages, salary
  unearnedIncomeMonthly: number;   // e.g., SSI, child support, pensions
  selfEmployment?: UsdaScheduleCInput;
}

export interface UsdaAssetTx {
  id: string;
  date: string;
  amount: number;
  description: string;
  isRecurring: boolean;            // Flag indicating if transaction shows recurring pattern
}

export interface UsdaEngineConfig {
  studentEarnedIncomeCap: number;  // Capped at $500 per PN 657; previously $480
  nonRecurringDepositThreshold: number; // USDA standard is $1,000; can be set to $100 for lender overlays
}

export interface UsdaEngineInput {
  loanId: string;
  countyMedianIncomeLimit: number;
  householdMembers: UsdaHouseholdMember[];
  bankTransactions: UsdaAssetTx[];
  config?: Partial<UsdaEngineConfig>;
}

export interface UsdaEngineResult {
  loanId: string;
  repaymentIncomeMonthly: number;     // Used for DTI (Note-borrowers only, allows Schedule C add-backs)
  annualHouseholdIncome: number;      // Used for eligibility cap (All members, limits student income, NO add-backs)
  adjustedAnnualIncome: number;       // Household income minus USDA standard deductions
  isEligibleByIncome: boolean;
  ssiBreakdowns: SsiProjectedResult[];
  sourcingAlerts: string[];
  complianceLogs: string[];
}

/**
 * Executes full USDA Standalone Prospective 12-Month Income & Eligibility Calculation
 */
export function processUsdaStandaloneCalculationV2(input: UsdaEngineInput): UsdaEngineResult {
  // Resolve configurations (with defaults matching PN 657 and USDA guidelines)
  const studentCap = input.config?.studentEarnedIncomeCap ?? 500;
  const nonRecurringThreshold = input.config?.nonRecurringDepositThreshold ?? 1000;

  let repaymentAnnualTotal = 0;
  let householdAnnualTotal = 0;
  let dependentDeductionsCount = 0;

  const ssiBreakdowns: SsiProjectedResult[] = [];
  const sourcingAlerts: string[] = [];
  const complianceLogs: string[] = [];

  complianceLogs.push(`Initializing USDA Engine v2 under Procedure Notice PN 657 (Student earned income cap: $${studentCap}, Non-recurring deposit threshold: $${nonRecurringThreshold}).`);

  // 1. Process Household Members (Wages & Deductions)
  for (const member of input.householdMembers) {
    let memberAnnualEarned = 0;
    let memberAnnualUnearned = member.unearnedIncomeMonthly * 12;

    // A. Apply Age & Student Gating Rules for Eligibility (Annual Household Income)
    const isMinor = member.age < 18;
    const isFullTimeStudentAdult = member.age >= 18 && member.isFullTimeStudent;

    if (member.isBorrower || member.isSpouse) {
      // Rule: Borrowers, co-borrowers, and spouses NEVER have their income capped or excluded
      memberAnnualEarned = member.earnedIncomeMonthly * 12;
      complianceLogs.push(`Household Member [${member.name}]: Borrower/Spouse role. Including 100% of earned ($${memberAnnualEarned}/yr) and unearned ($${memberAnnualUnearned}/yr) income.`);
    } else if (isMinor) {
      // Rule: Minors' (under 18) EARNED income is 100% excluded. UNEARNED income is included.
      memberAnnualEarned = 0;
      dependentDeductionsCount++;
      complianceLogs.push(`Household Member [${member.name}]: Minor (Age ${member.age}). Earned income strictly excluded ($0). 100% of unearned included ($${memberAnnualUnearned}/yr). Qualifies for dependent deduction.`);
    } else if (isFullTimeStudentAdult) {
      // Rule: Adult full-time student (who is not borrower/spouse) has EARNED income capped at studentCap ($500 per PN 657). UNEARNED is fully included.
      const rawAnnualEarned = member.earnedIncomeMonthly * 12;
      memberAnnualEarned = Math.min(rawAnnualEarned, studentCap);
      dependentDeductionsCount++;
      complianceLogs.push(`Household Member [${member.name}]: Adult FT Student (Age ${member.age}). Earned income of $${rawAnnualEarned}/yr capped at $${studentCap}/yr per USDA rules. Unearned included in full ($${memberAnnualUnearned}/yr). Qualifies for dependent deduction.`);
    } else {
      // Standard non-borrowing adult member: all income counted
      memberAnnualEarned = member.earnedIncomeMonthly * 12;
      if (member.age < 18 || member.isFullTimeStudent) {
        dependentDeductionsCount++;
      }
      complianceLogs.push(`Household Member [${member.name}]: Adult Non-Borrower. Including 100% of earned ($${memberAnnualEarned}/yr) and unearned ($${memberAnnualUnearned}/yr) income.`);
    }

    // Accumulate Eligibility Income
    householdAnnualTotal += (memberAnnualEarned + memberAnnualUnearned);

    // Accumulate Repayment Income (Note-borrowers only)
    if (member.isBorrower) {
      repaymentAnnualTotal += (member.earnedIncomeMonthly * 12 + memberAnnualUnearned);
    }

    // B. Self-Employment Dual-Track Math
    if (member.selfEmployment) {
      const se = member.selfEmployment;

      // Track 1: Repayment (Allows Add-Backs of Depreciation and Business Use of Home)
      const repaymentSE = se.netProfitLoss + se.depreciation + se.businessUseOfHome - se.mealsExclusion;

      // Track 2: Household Eligibility (Strictest Track - Add-backs of Depreciation and Home Use are STRICTLY DISALLOWED)
      const householdSE = se.netProfitLoss;

      if (member.isBorrower) {
        repaymentAnnualTotal += repaymentSE;
      }
      householdAnnualTotal += householdSE;

      complianceLogs.push(
        `Self-Employment Split [${member.name}]: Repayment SE added $${repaymentSE.toFixed(2)} (Depreciation & Home-Use added back). Household Eligibility included $${householdSE.toFixed(2)} raw (Add-backs excluded to protect eligibility thresholds).`
      );
    }
  }

  // 2. Process SSI Awards using automatic step-by-step 15% Gross-Up
  // We assume these are part of unearned income, but run through the gross-up display calculator
  // (Assuming any input SSI awards represent active borrower lines to gross up)
  for (const member of input.householdMembers) {
    if (member.unearnedIncomeMonthly > 0 && member.name.toUpperCase().includes('SSI')) {
      const ssiResult = calculateProjectedSsi({
        grossAwardMonthly: member.unearnedIncomeMonthly,
        hasTaxReturns: false,
        programType: 'USDA'
      });
      ssiBreakdowns.push(ssiResult);
      
      const ssiDTIIncrease = (ssiResult.finalQualifyingMonthly - ssiResult.grossAwardMonthly) * 12;
      
      // Add the gross-up differential to both tracks
      repaymentAnnualTotal += ssiDTIIncrease;
      householdAnnualTotal += ssiDTIIncrease;

      complianceLogs.push(`SSI Auto-Gross Up applied: Raw SSI $${ssiResult.grossAwardMonthly}/mo grossed up to $${ssiResult.finalQualifyingMonthly}/mo (+ $${ssiDTIIncrease}/yr in qualifying power). Formula: ${ssiResult.formulaDescription}`);
    }
  }

  // 3. Strict USDA Asset Sourcing Audit (Detect Undisclosed Household Income)
  for (const tx of input.bankTransactions) {
    const descUpper = tx.description.toUpperCase();
    
    // Ignore typical direct deposit payroll lines
    const isW2Payroll = descUpper.includes('PAYROLL') || descUpper.includes('DIR DEP');

    if (!isW2Payroll) {
      if (tx.isRecurring && tx.amount > 0) {
        // Rule: All recurring deposits, REGARDLESS OF AMOUNT, must be investigated. Zero tolerance.
        sourcingAlerts.push(
          `Undisclosed Income Audit: RECURRING deposit of $${tx.amount.toFixed(2)} detected on ${tx.date} (${tx.description}). Under USDA Chapter 9, there is no tolerance; all recurring deposits must be sourced.`
        );
      } else if (!tx.isRecurring && tx.amount >= nonRecurringThreshold) {
        // Rule: Non-recurring deposits greater than threshold (default $1,000; or $100 overlay)
        sourcingAlerts.push(
          `Large Deposit Audit: Individual non-recurring deposit of $${tx.amount.toFixed(2)} detected on ${tx.date} (${tx.description}). Exceeds the audit limit of $${nonRecurringThreshold}. Underwriter must obtain sourcing documentation.`
        );
      }
    }
  }

  // 4. Calculate Adjusted Annual Income for USDA Limits
  // Dependent Deduction: $500 per dependent (PN 657)
  const dependentDeductionTotal = dependentDeductionsCount * studentCap;
  const adjustedAnnualIncome = Math.max(0, householdAnnualTotal - dependentDeductionTotal);

  const isEligible = adjustedAnnualIncome <= input.countyMedianIncomeLimit;

  return {
    loanId: input.loanId,
    repaymentIncomeMonthly: Math.max(0, repaymentAnnualTotal / 12),
    annualHouseholdIncome: householdAnnualTotal,
    adjustedAnnualIncome: adjustedAnnualIncome,
    isEligibleByIncome: isEligible,
    ssiBreakdowns,
    sourcingAlerts,
    complianceLogs
  };
}
