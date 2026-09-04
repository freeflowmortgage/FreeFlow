import {
  calculateUnifiedIncome,
  UnifiedIncomeCalculationPayload
} from '../src/calculateForm1084Income';

describe('Form 1084 entity-scoped income', () => {
  test('sums current and concurrent W-2 employers while retaining prior history', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      w2Employers: [
        {
          entityId: 'w2-primary-2025',
          employerName: 'Primary Systems',
          ein: '11-1111111',
          role: 'CURRENT',
          year: 2025,
          annualBaseIncome: 60000
        },
        {
          entityId: 'w2-concurrent-2025',
          employerName: 'Weekend Health',
          ein: '22-2222222',
          role: 'CONCURRENT',
          year: 2025,
          annualBaseIncome: 18000,
          annualVariableIncome: 6000,
          monthsWorked: 12
        },
        {
          entityId: 'w2-prior-2024',
          employerName: 'Prior Systems',
          role: 'PRIOR',
          year: 2024,
          annualWages: 72000
        }
      ]
    });

    expect(result.annualCalculatedTotals).toEqual({ 2024: 72000, 2025: 84000 });
    expect(result.summary.qualifyingMonthlyIncome).toBe(6500);
    expect(result.w2EmployerBreakdown.filter((entry) => entry.isActiveEmployment)).toHaveLength(2);
    expect(result.w2EmployerBreakdown[1]).toMatchObject({
      entityId: 'w2-concurrent-2025',
      role: 'CONCURRENT',
      annualQualifyingIncome: 24000
    });
  });

  test('preserves and sums multiple Schedule C business identities', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      scheduleC: [
        { entityId: 'biz-a', businessName: 'Alpha Design', ein: '11-1111111', year: 2025, netProfitLoss: 50000 },
        { entityId: 'biz-b', businessName: 'Beta Books', ein: '22-2222222', year: 2025, netProfitLoss: 30000 },
        { entityId: 'biz-a', businessName: 'Alpha Design', ein: '11-1111111', year: 2024, netProfitLoss: 40000 },
        { entityId: 'biz-b', businessName: 'Beta Books', ein: '22-2222222', year: 2024, netProfitLoss: 20000 }
      ]
    };

    const result = calculateUnifiedIncome(payload);

    expect(result.annualCalculatedTotals).toEqual({ 2024: 60000, 2025: 80000 });
    expect(result.summary.qualifyingMonthlyIncome).toBe(5833.33);
    expect(result.scheduleCBreakdown.map((entry) => entry.entityId)).toEqual([
      'biz-a',
      'biz-b',
      'biz-a',
      'biz-b'
    ]);
  });

  test('calculates Schedule F Form 1084 adjustments and preserves farm identity', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      scheduleF: [
        {
          entityId: 'farm-1',
          businessName: 'Green Acres Farm',
          ein: '33-3333333',
          year: 2025,
          netFarmProfitLoss: 40000,
          nonTaxPortionOngoingCoopAndCccPayments: 5000,
          nonrecurringOtherIncomeLoss: -2000,
          depreciation: 10000,
          amortizationCasualtyLossDepletion: 3000,
          businessUseOfHome: 2000
        }
      ]
    });

    expect(result.annualCalculatedTotals).toEqual({ 2025: 58000 });
    expect(result.summary.qualifyingMonthlyIncome).toBe(4833.33);
    expect(result.scheduleFBreakdown[0]).toMatchObject({
      entityId: 'farm-1',
      businessName: 'Green Acres Farm',
      ein: '33-3333333',
      totalAdjustedIncome: 58000
    });
  });

  test('excludes asset income and capital losses by default with review guidance', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      assets: [
        {
          year: 2025,
          interestIncome: 12000,
          dividendIncome: 6000,
          capitalGainsNetLoss: -3000
        }
      ]
    });

    expect(result.summary.qualifyingMonthlyIncome).toBe(0);
    expect(result.assetIncomeBreakdown[0]).toMatchObject({
      capitalGainsNetLoss: -3000,
      detectedAssetIncome: 15000,
      includeInQualifyingIncome: false,
      qualifyingAssetIncome: 0
    });
    expect(result.warnings.some((warning) => warning.code === 'ASSET_INCOME_EXCLUDED_BY_DEFAULT')).toBe(true);
    expect(result.conditions.some((condition) => condition.title === 'Asset Income Underwriter Election')).toBe(true);
  });

  test('includes supported asset income only after explicit underwriter election', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      assets: [
        {
          year: 2025,
          interestIncome: 12000,
          dividendIncome: 6000,
          capitalGainsNetLoss: -3000,
          includeInQualifyingIncome: true,
          hasThreeYearAssetSupport: true
        }
      ]
    });

    expect(result.summary.qualifyingMonthlyIncome).toBe(1250);
    expect(result.assetIncomeBreakdown[0].qualifyingAssetIncome).toBe(15000);
    expect(result.warnings).toHaveLength(0);
    expect(result.conditions).toHaveLength(0);
  });
});
