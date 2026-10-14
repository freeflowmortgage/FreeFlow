import {
  BONUS_FREQUENCIES,
  bonusFrequencyLabel,
  bonusMonthsCovered,
  bonusPayoutsInWindow,
  isBonusFrequency,
  parseBonusFrequency,
} from '../src/bonusTiming';
import { calculateBorrowerIncome, parseBorrowerIncomeRequest } from '../src/borrower-income-api';
import { annualizePaystub } from '../src/paystubAnnualization';
import { w2VariableMethods, type W2EmployerWageInput } from '../src/w2-income-methods';
import { annualizeWvoe } from '../src/wvoeAnnualization';

const apex: W2EmployerWageInput = {
  id: 'w2-apex',
  payFrequency: 'SEMIMONTHLY',
  wageDocSource: 'PAYSTUB',
  hourlyRate: 45,
  weeklyHours: 40,
  currentPeriodBasePay: 3600,
  baseYtd: 54000,
  bonusYtd: 12500,
  overtimeYtd: 4200,
  tipsYtd: 0,
  commissionYtd: 0,
  wvoeBonus: 18000,
  wvoeOvertime: 6000,
  wvoeMonths: 12,
  monthsAtJob: 8,
  w2Year1Box5: 78500,
};
const priorEmployer = { box5Wages: 78500, box12Bonus: 18000, box14Overtime: 6000 };
const monthly = (methods: ReturnType<typeof w2VariableMethods>, id: string) =>
  methods.options.find((option) => option.id === id)?.monthly;

describe('bonus months covered', () => {
  test.each([
    // An August 15 stub spans 7.5 months.
    ['MONTHLY', 7.5, 7, 7],
    ['QUARTERLY', 7.5, 2, 6],
    ['SEMIANNUAL', 7.5, 1, 6],
    ['ANNUAL', 7.5, 1, 12],
    ['QUARTERLY', 12, 4, 12],
    ['SEMIANNUAL', 12, 2, 12],
    ['ANNUAL', 12, 1, 12],
    // A quarterly bonus already in the stub before a full quarter has passed was paid for a quarter.
    ['QUARTERLY', 2, 1, 3],
    ['QUARTERLY', 0, 1, 3],
  ] as const)('%s over %p months is %p payouts covering %p months', (frequency, window, payouts, months) => {
    expect(bonusPayoutsInWindow(window, frequency)).toBe(payouts);
    expect(bonusMonthsCovered(window, frequency)).toBe(months);
  });

  test('a window a hair short of a whole period from date math still counts that period', () => {
    expect(bonusMonthsCovered(5.9999999, 'QUARTERLY')).toBe(6);
    expect(bonusMonthsCovered(5.9, 'QUARTERLY')).toBe(3);
  });

  test('parses the wording employers and verifications use', () => {
    expect(parseBonusFrequency('Quarterly')).toBe('QUARTERLY');
    expect(parseBonusFrequency('Semi-Annually')).toBe('SEMIANNUAL');
    expect(parseBonusFrequency('Bi-annual')).toBe('SEMIANNUAL');
    expect(parseBonusFrequency('Annual')).toBe('ANNUAL');
    expect(parseBonusFrequency('Yearly')).toBe('ANNUAL');
    expect(parseBonusFrequency('Monthly')).toBe('MONTHLY');
    expect(parseBonusFrequency('Semi-Monthly')).toBeUndefined();
    expect(parseBonusFrequency('Biweekly')).toBeUndefined();
    expect(parseBonusFrequency('')).toBeUndefined();
    expect(parseBonusFrequency(undefined)).toBeUndefined();
  });

  test('labels and guards the four frequencies', () => {
    expect(BONUS_FREQUENCIES.map(bonusFrequencyLabel)).toEqual(['Monthly', 'Quarterly', 'Semi-annual', 'Annual']);
    expect(BONUS_FREQUENCIES.every(isBonusFrequency)).toBe(true);
    expect(isBonusFrequency('quarterly')).toBe(false);
    expect(isBonusFrequency(undefined)).toBe(false);
  });
});

describe('W-2 variable methods with a bonus frequency', () => {
  test('without a frequency the bonus divides by months at the job like overtime', () => {
    const methods = w2VariableMethods(apex, { ownedByPrimary: false });
    expect(methods.bonusMonths).toBe(8);
    expect(methods.variableMonths).toBe(8);
    expect(monthly(methods, 'current')).toBe(16700 / 8);
  });

  test('a quarterly bonus eight months in divides by the two quarters paid', () => {
    const methods = w2VariableMethods({ ...apex, bonusFrequency: 'QUARTERLY' }, { ownedByPrimary: false });
    expect(methods.bonusMonths).toBe(6);
    expect(methods.variableMonths).toBe(8);
    expect(monthly(methods, 'current')).toBeCloseTo(12500 / 6 + 4200 / 8, 10);
  });

  test('an annual bonus covers a full year', () => {
    const methods = w2VariableMethods({ ...apex, bonusFrequency: 'ANNUAL' }, { ownedByPrimary: false });
    expect(methods.bonusMonths).toBe(12);
    expect(monthly(methods, 'current')).toBeCloseTo(12500 / 12 + 4200 / 8, 10);
  });

  test('a monthly bonus over whole months matches having no frequency', () => {
    const methods = w2VariableMethods({ ...apex, bonusFrequency: 'MONTHLY' }, { ownedByPrimary: false });
    expect(methods.bonusMonths).toBe(8);
    expect(monthly(methods, 'current')).toBeCloseTo(16700 / 8, 10);
  });

  test('tips and commission stay on the months at the job', () => {
    const methods = w2VariableMethods(
      { ...apex, tipsYtd: 800, commissionYtd: 1600, bonusFrequency: 'SEMIANNUAL' },
      { ownedByPrimary: false },
    );
    expect(monthly(methods, 'current')).toBeCloseTo(12500 / 6 + (4200 + 800 + 1600) / 8, 10);
  });

  test('the 24-month merge adds twelve prior months to the bonus months covered', () => {
    const methods = w2VariableMethods({ ...apex, bonusFrequency: 'QUARTERLY' }, { ownedByPrimary: true, priorEmployer });
    expect(methods.recommendedId).toBe('avg24');
    expect(monthly(methods, 'avg24')).toBeCloseTo((12500 + 18000) / 18 + (4200 + 6000) / 20, 10);
  });

  test('a WVOE divides its bonus by the months the paid bonuses cover within the WVOE months', () => {
    const wvoe = { ...apex, wageDocSource: 'WVOE' as const, wvoeMonths: 7.5, bonusFrequency: 'QUARTERLY' as const };
    const methods = w2VariableMethods(wvoe, { ownedByPrimary: false });
    expect(methods.bonusMonths).toBe(6);
    expect(monthly(methods, 'current')).toBeCloseTo(18000 / 6 + 6000 / 7.5, 10);
  });
});

describe('paystub annualization with a bonus frequency', () => {
  const stub = {
    baseYtd: 30000, overtimeYtd: 7500, bonusYtd: 1500, elapsedMonths: 7.5,
    payFrequency: 'SEMIMONTHLY' as const, currentPeriodBasePay: 2000,
  };

  test.each([
    [undefined, 7.5, 200],
    ['MONTHLY', 7, 214.29],
    ['QUARTERLY', 6, 250],
    ['SEMIANNUAL', 6, 250],
    ['ANNUAL', 12, 125],
  ] as const)('%p divides the year-to-date bonus by %p months', (bonusFrequency, months, bonus) => {
    const result = annualizePaystub({ ...stub, bonusFrequency });
    expect(result.status).toBe('READY');
    expect(result.bonusMonths).toBe(months);
    expect(result.components.bonus).toBe(bonus);
    expect(result.components.overtime).toBe(1000);
    expect(result.annualComponents.bonus).toBe(Math.round(bonus * 12 * 100) / 100);
  });

  test('without elapsed months there is no bonus divisor', () => {
    const result = annualizePaystub({ ...stub, elapsedMonths: undefined, bonusFrequency: 'QUARTERLY' });
    expect(result.status).toBe('GAPS');
    expect(result.bonusMonths).toBeNull();
  });
});

describe('WVOE annualization with a bonus frequency', () => {
  const form = {
    currentBasePay: 5200, basePayPeriod: 'MONTHLY' as const, baseYtd: 39000,
    overtimeYtd: 6000, bonusYtd: 18000, overtimePriorYear: 5400, bonusPriorYear: 16000, elapsedMonths: 7.5,
  };

  test('year to date only divides the bonus by the quarters paid', () => {
    const result = annualizeWvoe({ ...form, bonusFrequency: 'QUARTERLY' });
    expect(result.variableMonths).toBe(7.5);
    expect(result.bonusMonths).toBe(6);
    expect(result.components.bonus).toBe(3000);
    expect(result.components.overtime).toBe(800);
  });

  test('the 24-month average adds the prior year to the bonus months covered', () => {
    const result = annualizeWvoe({ ...form, variableMethod: 'avg24', bonusFrequency: 'QUARTERLY' });
    expect(result.variableMonths).toBe(19.5);
    expect(result.bonusMonths).toBe(18);
    expect(result.components.bonus).toBe(1888.89);
    expect(result.components.overtime).toBe(584.62);
  });

  test('without a frequency the bonus keeps the variable divisor', () => {
    const result = annualizeWvoe({ ...form });
    expect(result.bonusMonths).toBe(7.5);
    expect(result.components.bonus).toBe(2400);
  });
});

describe('borrower income API with a bonus frequency', () => {
  const request = (bonusFrequency?: string) => ({
    borrowers: [{ id: 'b1' }],
    w2Employers: [{ id: 'apex', ...apex, bonusFrequency, variableMethod: 'current' }],
  });

  test('applies the bonus frequency to the variable income', () => {
    const result = calculateBorrowerIncome(request('QUARTERLY') as Parameters<typeof calculateBorrowerIncome>[0]);
    expect(result.employers[0].variableMonthly).toBeCloseTo(12500 / 6 + 4200 / 8, 10);
    expect(result.borrowers[0].w2VariableMonthly).toBeCloseTo(12500 / 6 + 4200 / 8, 10);
  });

  test('rejects an unknown bonus frequency', () => {
    expect(() => parseBorrowerIncomeRequest(request('WEEKLY'))).toThrow();
    expect(() => parseBorrowerIncomeRequest(request('quarterly'))).toThrow();
  });
});
