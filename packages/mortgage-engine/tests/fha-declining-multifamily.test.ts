import { calculateUnifiedIncome, UnifiedIncomeCalculationPayload } from '../src/calculateForm1084Income';

describe('FreeFlow Math Engine v7 - FHA Declining Multi-Family Rental Income', () => {

  test('FHA Multi-Family: Stable decline (<= 5.0%) allows standard 24-month historical average', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'FHA',
      scheduleEProperties: [
        {
          year: 2025,
          propertyAddress: '123 Duplex Dr',
          propertyType: 'RENTAL',
          netIncomeLoss: 11400,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        },
        {
          year: 2024,
          propertyAddress: '123 Duplex Dr',
          propertyType: 'RENTAL',
          netIncomeLoss: 11600,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        }
      ]
    };

    // Year 1 Flow = 11,400 + 1,200 = 12,600
    // Year 2 Flow = 11,600 + 1,200 = 12,800
    // Decline = (12,800 - 12,600) / 12,800 = 1.56% (<= 5.0%)
    // Expected Qualifying Monthly = (12,600 + 12,800) / 24 = $1,058.33/mo
    const result = calculateUnifiedIncome(payload);

    expect(result.summary.qualifyingMonthlyIncome).toBe(1058.33);
    const stableWarning = result.warnings.find(w => w.code === 'FHA_MULTIFAMILY_RENTAL_DECLINE_STABLE');
    expect(stableWarning).toBeDefined();
    expect(stableWarning?.severity).toBe('WARNING');
  });

  test('FHA Multi-Family: Significant decline (> 5.0% and <= 20.0%) restricts strictly to lower most recent 12-month period', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'FHA',
      scheduleEProperties: [
        {
          year: 2025,
          propertyAddress: '456 Triplex Way',
          propertyType: 'RENTAL',
          netIncomeLoss: 9000,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        },
        {
          year: 2024,
          propertyAddress: '456 Triplex Way',
          propertyType: 'RENTAL',
          netIncomeLoss: 10800,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        }
      ]
    };

    // Year 1 Flow = 9,000 + 1,200 = 10,200
    // Year 2 Flow = 10,800 + 1,200 = 12,000
    // Decline = (12,000 - 10,200) / 12,000 = 15.0% (> 5.0% and <= 20.0%)
    // Expected Qualifying Monthly = 10,200 / 12 = $850.00/mo
    const result = calculateUnifiedIncome(payload);

    expect(result.summary.qualifyingMonthlyIncome).toBe(850.00);
    const enforcedWarning = result.warnings.find(w => w.code === 'FHA_MULTIFAMILY_RENTAL_DECLINE_ENFORCED');
    expect(enforcedWarning).toBeDefined();
    expect(enforcedWarning?.severity).toBe('WARNING');
  });

  test('FHA Multi-Family: Catastrophic decline (> 20.0%) completely disqualifies property rental income ($0.00/mo)', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'FHA',
      scheduleEProperties: [
        {
          year: 2025,
          propertyAddress: '789 Quadplex Ln',
          propertyType: 'RENTAL',
          netIncomeLoss: 4800,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        },
        {
          year: 2024,
          propertyAddress: '789 Quadplex Ln',
          propertyType: 'RENTAL',
          netIncomeLoss: 10800,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: true
        }
      ]
    };

    // Year 1 Flow = 4,800 + 1,200 = 6,000
    // Year 2 Flow = 10,800 + 1,200 = 12,000
    // Decline = (12,000 - 6,000) / 12,000 = 50.0% (> 20.0%)
    // Expected Qualifying Monthly = $0.00/mo (disqualified)
    const result = calculateUnifiedIncome(payload);

    expect(result.summary.qualifyingMonthlyIncome).toBe(0);
    const criticalWarning = result.warnings.find(w => w.code === 'FHA_MULTIFAMILY_RENTAL_CRITICAL_DECLINE');
    expect(criticalWarning).toBeDefined();
    expect(criticalWarning?.severity).toBe('CRITICAL');

    const condition = result.conditions.find(c => c.title === 'FHA Multi-Family Rental Income Disqualification Review');
    expect(condition).toBeDefined();
    expect(condition?.requiredDocType).toBe('MULTI_FAMILY_RENTAL_LEASE_AND_LEGER_PROOF');
  });

  test('Conventional: Declining rental property restricts to lower most recent 12-month period regardless of multifamily flag', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      scheduleEProperties: [
        {
          year: 2025,
          propertyAddress: '101 SingleFamily Ave',
          propertyType: 'RENTAL',
          netIncomeLoss: 9000,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: false
        },
        {
          year: 2024,
          propertyAddress: '101 SingleFamily Ave',
          propertyType: 'RENTAL',
          netIncomeLoss: 10800,
          depreciation: 1200,
          isMultiFamilySubjectToFhaDecline: false
        }
      ]
    };

    // Decline is 15.0%. Two years in file → 24-month average (warning only).
    // Y1 = 10,200 / 12 = 850; Y2 = 12,000 / 12 = 1,000; avg = 925
    const result = calculateUnifiedIncome(payload);

    expect(result.summary.qualifyingMonthlyIncome).toBe(925.00);
    const restrictedWarning = result.warnings.find(w => w.code === 'RENTAL_INCOME_DECLINE_WARN');
    expect(restrictedWarning).toBeDefined();
  });

});
