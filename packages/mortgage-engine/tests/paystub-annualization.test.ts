import { annualizePaystub, parsePayFrequency, payPeriodsPerYear } from '../src/paystubAnnualization';

describe('paystub annualization ported from UnderwriterSplitViewDemo', () => {
  test('uses the console pay-period counts', () => {
    expect(payPeriodsPerYear('WEEKLY')).toBe(52);
    expect(payPeriodsPerYear('BIWEEKLY')).toBe(26);
    expect(payPeriodsPerYear('SEMIMONTHLY')).toBe(24);
    expect(payPeriodsPerYear('MONTHLY')).toBe(12);
    expect(parsePayFrequency('Semi-Monthly (24 Pays/Yr)')).toBe('SEMIMONTHLY');
    expect(parsePayFrequency('Biweekly')).toBe('BIWEEKLY');
  });

  test('divides YTD by elapsed months and never treats YTD as the annual wage', () => {
    const result = annualizePaystub({
      baseYtd: 30000, overtimeYtd: 7500, bonusYtd: 1500, commissionYtd: 750, tipsYtd: 300, rsuYtd: 1500, otherYtd: 450,
      elapsedMonths: 7.5, payFrequency: 'SEMIMONTHLY', currentPeriodBasePay: 2000,
    });
    expect(result.status).toBe('READY');
    expect(result.components.base).toBe(4000);
    expect(result.components.overtime).toBe(1000);
    expect(result.components.bonus).toBe(200);
    expect(result.components.commission).toBe(100);
    expect(result.components.tips).toBe(40);
    expect(result.components.rsu).toBe(200);
    expect(result.components.other).toBe(60);
    expect(result.monthlyBase).not.toBeCloseTo(30000 / 12, 2);
    expect(result.annualBase).toBe(48000);
    expect(result.annualBase).not.toBe(30000);
    expect(result.annualComponents.base).toBe(48000);
    expect(result.annualComponents.overtime).toBe(12000);
    expect(result.annualComponents.bonus).toBe(2400);
    expect(result.annualComponents.commission).toBe(1200);
    expect(result.annualComponents.tips).toBe(480);
    expect(result.annualComponents.rsu).toBe(2400);
    expect(result.annualComponents.other).toBe(720);
    expect(result.annualComponents.base).not.toBe(result.annualComponents.overtime);
    expect(result.annualVariable).toBe(19200);
    expect(result.annualVariable).not.toBe(30000);
  });

  test('variable continuity divides each YTD component by elapsed months', () => {
    const result = annualizePaystub({
      currentPeriodBasePay: 1000,
      payFrequency: 'WEEKLY',
      baseMethod: 'period',
      overtimeYtd: 2600,
      bonusYtd: 500,
      elapsedMonths: 2,
    });
    expect(result.status).toBe('READY');
    expect(result.monthlyBase).toBeCloseTo((1000 * 52) / 12, 2);
    expect(result.components.overtime).toBe(1300);
    expect(result.components.bonus).toBe(250);
    expect(result.annualComponents.overtime).toBe(15600);
    expect(result.annualComponents.overtime).not.toBe(2600);
    expect(result.annualComponents.overtime).not.toBe(2600 * 52);
    expect(result.components.overtime).not.toBeCloseTo((2600 * 52) / 12, 2);
  });

  test('keeps hourly, period, and prior-year W-2 methods distinct', () => {
    const hourly = annualizePaystub({ hourlyRate: 50, weeklyHours: 40, baseMethod: 'hourly' });
    expect(hourly.monthlyBase).toBeCloseTo((50 * 40 * 52) / 12, 2);
    const period = annualizePaystub({ currentPeriodBasePay: 2000, payFrequency: 'SEMIMONTHLY', baseMethod: 'period' });
    expect(period.monthlyBase).toBe(4000);
    const prior = annualizePaystub({ priorYearW2Wages: 60000, baseMethod: 'prior' });
    expect(prior.monthlyBase).toBe(5000);
  });

  test('fails closed when YTD is present without elapsed months or no base method exists', () => {
    expect(annualizePaystub({ baseYtd: 54000 }).gaps).toContain('ELAPSED_MONTHS_REQUIRED');
    expect(annualizePaystub({}).gaps).toContain('NO_BASE_METHOD');
    expect(annualizePaystub({ baseMethod: 'prior' }).gaps).toContain('PRIOR_W2_UNAVAILABLE');
    expect(annualizePaystub({ baseYtd: 54000 }).status).toBe('GAPS');
  });
});
