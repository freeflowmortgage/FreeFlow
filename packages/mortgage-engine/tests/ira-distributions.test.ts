import { calculateUnifiedIncome, IraDistributionInput, LoanProgram } from '../src/calculateForm1084Income';

const run = (loanProgram: LoanProgram, iraDistributions: IraDistributionInput[]) =>
  calculateUnifiedIncome({ loanProgram, iraDistributions });

describe('Form 1040 Line 4a/4b IRA distributions', () => {
  const confirmed: IraDistributionInput = {
    year: 2025,
    totalDistributions: 24000,
    taxableDistributions: 18000,
    accountBalance: 400000,
    hasThreeYearContinuance: true,
    grossUpNonTaxable: true,
  };

  test('excludes the distribution and conditions continuance until an underwriter confirms it', () => {
    const result = run('CONVENTIONAL', [{ year: 2025, totalDistributions: 24000, taxableDistributions: 18000 }]);
    expect(result.summary.qualifyingMonthlyIncome).toBe(0);
    expect(result.iraDistributionBreakdown).toMatchObject({ includedInQualifyingIncome: false, qualifyingMonthlyIncome: 0 });
    expect(result.warnings.map((w) => w.code)).toContain('IRA_DISTRIBUTION_EXCLUDED_PENDING_CONTINUANCE');
    expect(result.conditions.map((c) => c.title)).toContain('IRA Distribution 36-Month Continuance');
  });

  test.each([
    ['CONVENTIONAL', 1.25, 2125],
    ['VA', 1.25, 2125],
    ['USDA', 1.25, 2125],
    ['FHA', 1.15, 2075],
  ] as const)('%s grosses the non-taxable portion up by %s', (program, multiplier, monthly) => {
    // 18,000 taxable + 6,000 non-taxable × multiplier, over 12 months.
    const result = run(program, [confirmed]);
    expect(result.iraDistributionBreakdown).toMatchObject({
      appliedGrossUpMultiplier: multiplier,
      nonTaxableDistributions: 6000,
      qualifyingMonthlyIncome: monthly,
      monthsOfContinuance: 200,
    });
    expect(result.summary.qualifyingMonthlyIncome).toBe(monthly);
  });

  test('without the gross-up election the full Line 4a amount qualifies ungrossed', () => {
    const result = run('CONVENTIONAL', [{ ...confirmed, grossUpNonTaxable: false }]);
    expect(result.iraDistributionBreakdown).toMatchObject({ grossUpNonTaxable: false, appliedGrossUpMultiplier: 1, qualifyingMonthlyIncome: 2000 });
  });

  test('uses only the most recent return instead of averaging prior years', () => {
    const result = run('CONVENTIONAL', [
      { ...confirmed, year: 2024, totalDistributions: 12000, taxableDistributions: 12000 },
      { ...confirmed, grossUpNonTaxable: false },
    ]);
    expect(result.iraDistributionBreakdown).toMatchObject({ year: 2025, priorYearsReported: [2024], qualifyingMonthlyIncome: 2000 });
    expect(result.summary.qualifyingMonthlyIncome).toBe(2000);
  });

  test('is added on top of trended income rather than mixed into the yearly average', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      w2Employers: [
        { entityId: 'w2-a', employerName: 'Acme', role: 'CURRENT', year: 2025, annualIncome: 60000 },
        { entityId: 'w2-a', employerName: 'Acme', role: 'CURRENT', year: 2024, annualIncome: 60000 },
      ],
      iraDistributions: [{ ...confirmed, grossUpNonTaxable: false }],
    });
    expect(result.summary.qualifyingMonthlyIncome).toBe(5000 + 2000);
    expect(result.annualCalculatedTotals).toEqual({ 2024: 60000, 2025: 60000 });
  });

  test('a fully taxable distribution reported only on Line 4b is read as the total', () => {
    const result = run('FHA', [{ year: 2025, taxableDistributions: 30000, hasThreeYearContinuance: true, grossUpNonTaxable: true, accountBalance: 200000 }]);
    expect(result.iraDistributionBreakdown).toMatchObject({ totalDistributions: 30000, nonTaxableDistributions: 0, grossUpNonTaxable: false, qualifyingMonthlyIncome: 2500 });
  });

  test('flags a confirmed continuance the recorded balance cannot support', () => {
    const result = run('CONVENTIONAL', [{ ...confirmed, accountBalance: 48000 }]);
    expect(result.iraDistributionBreakdown?.monthsOfContinuance).toBe(24);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'IRA_CONTINUANCE_BALANCE_SHORTFALL', severity: 'CRITICAL' })]));
  });

  test('asks for the statement when continuance is confirmed without a balance', () => {
    const { accountBalance: _omit, ...withoutBalance } = confirmed;
    const result = run('CONVENTIONAL', [withoutBalance]);
    expect(result.iraDistributionBreakdown?.monthsOfContinuance).toBeNull();
    expect(result.conditions.map((c) => c.title)).toContain('IRA Account Balance Documentation');
  });

  test('warns when Line 4b is zero, which usually means a rollover', () => {
    const result = run('CONVENTIONAL', [{ year: 2025, totalDistributions: 80000, taxableDistributions: 0 }]);
    expect(result.warnings.map((w) => w.code)).toContain('IRA_DISTRIBUTION_NOT_TAXABLE');
  });

  test('returns no breakdown when no IRA distributions are reported', () => {
    expect(run('CONVENTIONAL', []).iraDistributionBreakdown).toBeNull();
  });
});
