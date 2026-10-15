import {
  annualizeWvoe,
  monthsEmployedBetween,
  monthsFromEmploymentDuration,
  parseWvoeBasePayPeriod,
  parseWvoePayCycle,
  wvoeBasePeriodsPerYear,
} from '../src/wvoeAnnualization';
import { w2VariableMethods } from '../src/w2-income-methods';

const FORM_1005 = {
  currentBasePay: 5200,
  basePayPeriod: 'MONTHLY' as const,
  baseYtd: 62400,
  overtimeYtd: 6000,
  bonusYtd: 18000,
  commissionYtd: 0,
  overtimePriorYear: 5400,
  bonusPriorYear: 16000,
  commissionPriorYear: 0,
  elapsedMonths: 12,
};

describe('annualizeWvoe', () => {
  test('base pay comes from item 12A normalized to a month', () => {
    expect(annualizeWvoe({ ...FORM_1005 }).components.base).toBe(5200);
    expect(annualizeWvoe({ ...FORM_1005, currentBasePay: 62400, basePayPeriod: 'ANNUAL' }).components.base).toBe(5200);
    expect(annualizeWvoe({ ...FORM_1005, currentBasePay: 2400, basePayPeriod: 'BIWEEKLY' }).components.base).toBe(5200);
    expect(annualizeWvoe({ ...FORM_1005, currentBasePay: 2600, basePayPeriod: 'SEMIMONTHLY' }).components.base).toBe(5200);
    expect(annualizeWvoe({ ...FORM_1005, currentBasePay: 1200, basePayPeriod: 'WEEKLY' }).components.base).toBe(5200);
    const hourly = annualizeWvoe({ ...FORM_1005, currentBasePay: 30, basePayPeriod: 'HOURLY', weeklyHours: 40 });
    expect(hourly.components.base).toBe(5200);
    expect(wvoeBasePeriodsPerYear('ANNUAL')).toBe(1);
    expect(wvoeBasePeriodsPerYear('BIWEEKLY')).toBe(26);
  });

  test('never treats a year-to-date column as an annual wage', () => {
    const result = annualizeWvoe({ ...FORM_1005 });
    expect(result.status).toBe('READY');
    expect(result.annualBase).toBe(62400);
    expect(result.annualVariable).toBe(24000);
    expect(result.annualComponents.overtime).toBe(6000);
    expect(result.annualComponents.bonus).toBe(18000);
    expect(result.monthlyVariable).toBe(2000);
    expect(result.variableMonths).toBe(12);
  });

  test('the year-to-date divisor is the reviewed elapsed months', () => {
    const half = annualizeWvoe({ ...FORM_1005, elapsedMonths: 6 });
    expect(half.components.overtime).toBe(1000);
    expect(half.components.bonus).toBe(3000);
    expect(half.annualVariable).toBe(48000);
    expect(annualizeWvoe({ ...FORM_1005, baseMethod: 'ytd', elapsedMonths: 6 }).components.base).toBe(10400);
  });

  test('the two-year average spreads the prior year column over twelve more months', () => {
    const averaged = annualizeWvoe({ ...FORM_1005, variableMethod: 'avg24' });
    expect(averaged.variableMonths).toBe(24);
    expect(averaged.components.overtime).toBe(475);
    expect(averaged.components.bonus).toBe(1416.67);
    expect(averaged.selectedVariableMethod).toBe('avg24');
    const missing = annualizeWvoe({
      currentBasePay: 5200, basePayPeriod: 'MONTHLY', bonusYtd: 18000, elapsedMonths: 12, variableMethod: 'avg24',
    });
    expect(missing.gaps).toContain('PRIOR_YEAR_UNAVAILABLE');
    expect(missing.status).toBe('GAPS');
  });

  test('matches the WVOE variable policy the console already applies', () => {
    const employer = {
      id: 'wvoe-1', payFrequency: 'MONTHLY' as const, wageDocSource: 'WVOE' as const,
      hourlyRate: 0, weeklyHours: 0, currentPeriodBasePay: 5200, baseYtd: 62400,
      bonusYtd: 0, overtimeYtd: 0, tipsYtd: 0, commissionYtd: 0,
      wvoeBonus: 18000, wvoeOvertime: 6000, wvoeMonths: 12, monthsAtJob: 30, w2Year1Box5: 0,
    };
    const console = w2VariableMethods(employer, { ownedByPrimary: false });
    const current = console.options.find((option) => option.id === 'current');
    expect(annualizeWvoe({ ...FORM_1005 }).monthlyVariable).toBe(current?.monthly);
  });

  test('fails closed on every missing input rather than guessing', () => {
    expect(annualizeWvoe({ bonusYtd: 18000 }).gaps).toContain('ELAPSED_MONTHS_REQUIRED');
    expect(annualizeWvoe({ currentBasePay: 5200, elapsedMonths: 12 }).gaps).toContain('BASE_PAY_PERIOD_REQUIRED');
    expect(annualizeWvoe({ currentBasePay: 30, basePayPeriod: 'HOURLY', elapsedMonths: 12 }).gaps).toContain('WEEKLY_HOURS_REQUIRED');
    expect(annualizeWvoe({ elapsedMonths: 12 }).gaps).toContain('NO_BASE_METHOD');
    expect(annualizeWvoe({ baseYtd: 62400, elapsedMonths: 12, baseMethod: 'current' }).gaps).toContain('BASE_METHOD_UNAVAILABLE');
    const blocked = annualizeWvoe({ bonusYtd: 18000 });
    expect(blocked.status).toBe('GAPS');
    expect(blocked.monthlyBase).toBe(0);
    expect(blocked.annualVariable).toBe(0);
  });

  test('a divisor longer than the borrower has worked there is a contradiction to settle', () => {
    const conflict = annualizeWvoe({ ...FORM_1005, monthsEmployed: 7 });
    expect(conflict.gaps).toContain('ELAPSED_MONTHS_EXCEEDS_EMPLOYMENT');
    expect(conflict.status).toBe('GAPS');
    expect(annualizeWvoe({ ...FORM_1005, monthsEmployed: 29 }).status).toBe('READY');
    expect(annualizeWvoe({ ...FORM_1005, elapsedMonths: 7, monthsEmployed: 7 }).status).toBe('READY');
  });

  test('reads the pay period and date of hire the form prints', () => {
    expect(parseWvoeBasePayPeriod('per Month')).toBe('MONTHLY');
    expect(parseWvoeBasePayPeriod('Annual')).toBe('ANNUAL');
    expect(parseWvoeBasePayPeriod('Hourly')).toBe('HOURLY');
    expect(parseWvoeBasePayPeriod('Bi-weekly')).toBe('BIWEEKLY');
    expect(parseWvoeBasePayPeriod('Semi-monthly')).toBe('SEMIMONTHLY');
    expect(parseWvoeBasePayPeriod('per week')).toBe('WEEKLY');
    expect(parseWvoeBasePayPeriod('')).toBeUndefined();
    expect(monthsEmployedBetween('03/14/2021', '12/31/2025')).toBe(57);
    expect(monthsEmployedBetween('06/01/2025', '12/31/2025')).toBe(6);
    expect(monthsEmployedBetween('12/31/2025', '06/01/2025')).toBeNull();
    expect(monthsEmployedBetween(null, '12/31/2025')).toBeNull();
  });

  test('hours stated per pay period are annualized over the pay cycle, not the week', () => {
    // The Work Number: rate of pay $17.42 Hourly, 86 avg hours per pay period,
    // semi-monthly cycle. Reading 86 as weekly hours returns $77,902 a year.
    const workNumber = annualizeWvoe({
      currentBasePay: 17.42, basePayPeriod: 'HOURLY', payPeriodHours: 86, payCycle: 'SEMIMONTHLY',
    });
    expect(workNumber.components.base).toBe(2996.24);
    expect(workNumber.annualBase).toBe(35954.88);
    expect(workNumber.status).toBe('READY');
    const biweekly = annualizeWvoe({
      currentBasePay: 17.42, basePayPeriod: 'HOURLY', payPeriodHours: 80, payCycle: 'BIWEEKLY',
    });
    expect(biweekly.annualBase).toBe(36233.64);
    // Weekly hours stay authoritative when the document states them outright.
    const both = annualizeWvoe({
      currentBasePay: 17.42, basePayPeriod: 'HOURLY', weeklyHours: 40, payPeriodHours: 86, payCycle: 'SEMIMONTHLY',
    });
    expect(both.annualBase).toBe(36233.64);
  });

  test('hours per pay period without a cycle is a gap, never a weekly figure', () => {
    const orphan = annualizeWvoe({ currentBasePay: 17.42, basePayPeriod: 'HOURLY', payPeriodHours: 86 });
    expect(orphan.gaps).toContain('PAY_CYCLE_REQUIRED');
    expect(orphan.gaps).not.toContain('WEEKLY_HOURS_REQUIRED');
    expect(orphan.status).toBe('GAPS');
    expect(orphan.annualBase).toBe(0);
    // Truework reports "Average Hours Worked Per Week: N/A" against an hourly
    // rate, which leaves nothing to annualize.
    const truework = annualizeWvoe({ currentBasePay: 45, basePayPeriod: 'HOURLY' });
    expect(truework.gaps).toContain('WEEKLY_HOURS_REQUIRED');
    expect(truework.status).toBe('GAPS');
  });

  test('a paycheck cycle is never mistaken for the unit the rate is quoted in', () => {
    expect(parseWvoePayCycle('Semi Monthly')).toBe('SEMIMONTHLY');
    expect(parseWvoePayCycle('Bi-Weekly')).toBe('BIWEEKLY');
    expect(parseWvoePayCycle('Monthly')).toBe('MONTHLY');
    expect(parseWvoePayCycle('Hourly')).toBeUndefined();
    expect(parseWvoePayCycle('Annual')).toBeUndefined();
    expect(parseWvoePayCycle('')).toBeUndefined();
  });

  test('months employed can be read from the duration both vendors print', () => {
    expect(monthsFromEmploymentDuration('8 Yrs 7 Months')).toBe(103);
    expect(monthsFromEmploymentDuration('2 Years, 9 Months')).toBe(33);
    expect(monthsFromEmploymentDuration('11 Mos')).toBe(11);
    expect(monthsFromEmploymentDuration('3 Years')).toBe(36);
    expect(monthsFromEmploymentDuration('Data not provided')).toBeNull();
    expect(monthsFromEmploymentDuration(null)).toBeNull();
  });
});
