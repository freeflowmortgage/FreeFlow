import { Decimal } from 'decimal.js';

// ────────────────────────────────────────────────────────────────────────
// 1. SIMULATED V9 CORE INTERFACES & MATHEMATICAL LOGIC FOR TEST BOUNDING
// ────────────────────────────────────────────────────────────────────────

export type LoanProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';

export interface SubjectPropertyRentalInput {
  grossMarketRent: number;                 // Form 1007 (Single) or Form 1025 (Multi)
  subjectPITIA: number;                    // Full housing payment (P + I + T + I + A)
  isPrimaryMultiFamily2To4Unit?: boolean;  // True if borrower occupies one of the units
}

export interface UnifiedIncomeCalculationPayloadV9 {
  loanProgram: LoanProgram;
  baseW2Wages?: number;                    // Stable base wages for reference
  subjectPropertyRental?: SubjectPropertyRentalInput;
}

export interface WarningMessage {
  code: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
}

export interface UnifiedIncomeCalculationResultV9 {
  summary: {
    qualifyingMonthlyIncome: number;
    proposedRentalLossDebt: number;        // Redirected to 1003 Liabilities (DTI Numerator)
    subjectHousingExpenseAdjustment: number; // Redirected to Housing Expenses (PITIA Offset)
    programUsed: LoanProgram;
  };
  warnings: WarningMessage[];
}

/**
 * Programmatic implementation of Fannie Mae Selling Guide B3-3.1-08 rules
 * for Subject Property Rental Income calculations.
 */
export function calculateUnifiedIncomeV9(payload: UnifiedIncomeCalculationPayloadV9): UnifiedIncomeCalculationResultV9 {
  const program = payload.loanProgram;
  const warnings: WarningMessage[] = [];
  
  let totalQualifyingMonthlyIncome = new Decimal(payload.baseW2Wages || 0);
  let proposedRentalLossDebt = new Decimal(0);
  let subjectHousingExpenseAdjustment = new Decimal(0);

  if (payload.subjectPropertyRental) {
    if (program === 'CONVENTIONAL') {
      const { grossMarketRent, subjectPITIA, isPrimaryMultiFamily2To4Unit } = payload.subjectPropertyRental;
      
      const rawRent = new Decimal(grossMarketRent || 0);
      const pitia = new Decimal(subjectPITIA || 0);
      
      // 1. Apply Fannie Mae standard 75% vacancy factor (25% allowance for vacancy/maintenance)
      const adjustedRent = rawRent.mul(0.75);
      
      // 2. Compute the net cash flow after deducting PITIA
      const netSubjectCashFlow = adjustedRent.sub(pitia);

      if (isPrimaryMultiFamily2To4Unit) {
        // 🟢 Scenario B: 2-4 Unit Primary Residence (Borrower-occupied)
        if (netSubjectCashFlow.gt(0)) {
          // Positive cash flow is added directly to Gross Monthly Income (DTI Denominator)
          totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(netSubjectCashFlow);
          warnings.push({
            code: 'FNMA_SUBJECT_2_4_UNIT_POSITIVE_INCOME',
            severity: 'INFO',
            message: `Subject multi-family primary residence generated net positive cash flow of $${netSubjectCashFlow.toFixed(2)}/mo. Added directly to qualifying income.`
          });
        } else {
          // Negative cash flow offset: added to primary housing expense (PITIA Offset), NOT liabilities
          subjectHousingExpenseAdjustment = netSubjectCashFlow.abs();
          warnings.push({
            code: 'FNMA_SUBJECT_2_4_UNIT_NEGATIVE_EXPENSE',
            severity: 'WARNING',
            message: `Subject multi-family primary residence generated a net cash deficit of ($${subjectHousingExpenseAdjustment.toFixed(2)}/mo). This must be used to increase the primary housing payment on the 1003, NOT listed as a separate liability.`
          });
        }
      } else {
        // 🟢 Scenario A: Standard Subject Investment Property
        if (netSubjectCashFlow.gt(0)) {
          // Positive cash flow is added directly to Gross Monthly Income (DTI Denominator)
          totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(netSubjectCashFlow);
          warnings.push({
            code: 'FNMA_SUBJECT_INVESTMENT_POSITIVE_INCOME',
            severity: 'INFO',
            message: `Subject investment property generated net positive cash flow of $${netSubjectCashFlow.toFixed(2)}/mo. Added directly to qualifying income.`
          });
        } else {
          // Negative cash flow is clamped to $0.00 on income ledger and routed strictly to DTI liabilities
          proposedRentalLossDebt = netSubjectCashFlow.abs();
          warnings.push({
            code: 'FNMA_SUBJECT_INVESTMENT_NEGATIVE_LIABILITY',
            severity: 'WARNING',
            message: `Subject investment property generated a net cash deficit of ($${proposedRentalLossDebt.toFixed(2)}/mo). Qualifying income impact clamped to $0.00; deficit routed as a monthly liability debt.`
          });
        }
      }
    } else {
      warnings.push({
        code: 'PROGRAM_SUBJECT_RENT_SKIPPED',
        severity: 'INFO',
        message: `Subject property rental logic in this module is optimized strictly for Fannie Mae/Conventional files.`
      });
    }
  }

  return {
    summary: {
      qualifyingMonthlyIncome: totalQualifyingMonthlyIncome.toDecimalPlaces(2).toNumber(),
      proposedRentalLossDebt: proposedRentalLossDebt.toDecimalPlaces(2).toNumber(),
      subjectHousingExpenseAdjustment: subjectHousingExpenseAdjustment.toDecimalPlaces(2).toNumber(),
      programUsed: program
    },
    warnings
  };
}

// ────────────────────────────────────────────────────────────────────────
// 2. JEST INTEGRATION TEST SUITE
// ────────────────────────────────────────────────────────────────────────

describe('Fannie Mae Subject Property Rental Income (Selling Guide B3-3.1-08)', () => {
  
  test('Scenario A (Investment - Positive): Should apply 75% factor and add net positive cash flow to income', () => {
    const payload: UnifiedIncomeCalculationPayloadV9 = {
      loanProgram: 'CONVENTIONAL',
      baseW2Wages: 8000, // $8,000/mo stable base wages
      subjectPropertyRental: {
        grossMarketRent: 2000, // Form 1007 Appraisal
        subjectPITIA: 1200,    // Full proposed mortgage payment
        isPrimaryMultiFamily2To4Unit: false // Investment property
      }
    };

    const result = calculateUnifiedIncomeV9(payload);

    // Math: 
    // 1. Adjusted Rent = $2,000 * 0.75 = $1,500
    // 2. Net Cash Flow = $1,500 (adjusted rent) - $1,200 (subject PITIA) = +$300/mo
    // 3. Expected Income = Base W2 ($8,000) + Rental Profit ($300) = $8,300/mo
    // 4. Proposed Rental Loss Debt = $0.00 (Since net cash flow is positive)
    expect(result.summary.qualifyingMonthlyIncome).toBe(8300.00);
    expect(result.summary.proposedRentalLossDebt).toBe(0.00);
    expect(result.summary.subjectHousingExpenseAdjustment).toBe(0.00);
    expect(result.warnings.some(w => w.code === 'FNMA_SUBJECT_INVESTMENT_POSITIVE_INCOME')).toBe(true);
  });

  test('Scenario A (Investment - Negative): Should clamp income impact to $0.00 and redirect net loss to monthly liabilities', () => {
    const payload: UnifiedIncomeCalculationPayloadV9 = {
      loanProgram: 'CONVENTIONAL',
      baseW2Wages: 8000,
      subjectPropertyRental: {
        grossMarketRent: 2000,
        subjectPITIA: 1800,    // High payment exceeds 75% rental yield
        isPrimaryMultiFamily2To4Unit: false
      }
    };

    const result = calculateUnifiedIncomeV9(payload);

    // Math: 
    // 1. Adjusted Rent = $2,000 * 0.75 = $1,500
    // 2. Net Cash Flow = $1,500 - $1,800 = -$300/mo
    // 3. Expected Income = Base W2 ($8,000) remains untouched (clamped at $8,000/mo)
    // 4. Proposed Rental Loss Debt = $300.00 (Routed to 1003 Liabilities numerator)
    expect(result.summary.qualifyingMonthlyIncome).toBe(8000.00);
    expect(result.summary.proposedRentalLossDebt).toBe(300.00);
    expect(result.summary.subjectHousingExpenseAdjustment).toBe(0.00);
    expect(result.warnings.some(w => w.code === 'FNMA_SUBJECT_INVESTMENT_NEGATIVE_LIABILITY')).toBe(true);
  });

  test('Scenario B (Primary 2-4 Unit - Positive): Should add net positive cash flow directly to qualifying income', () => {
    const payload: UnifiedIncomeCalculationPayloadV9 = {
      loanProgram: 'CONVENTIONAL',
      baseW2Wages: 8000,
      subjectPropertyRental: {
        grossMarketRent: 3000, // Rental income from other units
        subjectPITIA: 2000,    // Total payment for entire multi-family property
        isPrimaryMultiFamily2To4Unit: true // Primary Residence 2-4 Unit
      }
    };

    const result = calculateUnifiedIncomeV9(payload);

    // Math:
    // 1. Adjusted Rent = $3,000 * 0.75 = $2,250
    // 2. Net Cash Flow = $2,250 - $2,000 (PITIA) = +$250/mo
    // 3. Expected Income = Base W2 ($8,000) + Positive Multi-Family Cash Flow ($250) = $8,250/mo
    // 4. Expected Proposed Debt = $0.00
    expect(result.summary.qualifyingMonthlyIncome).toBe(8250.00);
    expect(result.summary.proposedRentalLossDebt).toBe(0.00);
    expect(result.summary.subjectHousingExpenseAdjustment).toBe(0.00);
    expect(result.warnings.some(w => w.code === 'FNMA_SUBJECT_2_4_UNIT_POSITIVE_INCOME')).toBe(true);
  });

  test('Scenario B (Primary 2-4 Unit - Negative): Should clamp income impact AND redirect loss to primary housing expenses instead of liabilities', () => {
    const payload: UnifiedIncomeCalculationPayloadV9 = {
      loanProgram: 'CONVENTIONAL',
      baseW2Wages: 8000,
      subjectPropertyRental: {
        grossMarketRent: 2000,
        subjectPITIA: 2000,    // Rent offsets 75% of PITIA, leaving a net housing deficit
        isPrimaryMultiFamily2To4Unit: true
      }
    };

    const result = calculateUnifiedIncomeV9(payload);

    // Math:
    // 1. Adjusted Rent = $2,000 * 0.75 = $1,500
    // 2. Net Cash Flow = $1,500 - $2,000 (PITIA) = -$500/mo
    // 3. Expected Income = Base W2 ($8,000) remains untouched (clamped)
    // 4. Proposed Rental Loss Debt = $0.00 (NOT routed to liabilities)
    // 5. Subject Housing Expense Adjustment = $500.00 (Used to increase the housing expense on the 1003)
    expect(result.summary.qualifyingMonthlyIncome).toBe(8000.00);
    expect(result.summary.proposedRentalLossDebt).toBe(0.00);
    expect(result.summary.subjectHousingExpenseAdjustment).toBe(500.00);
    expect(result.warnings.some(w => w.code === 'FNMA_SUBJECT_2_4_UNIT_NEGATIVE_EXPENSE')).toBe(true);
  });

});
