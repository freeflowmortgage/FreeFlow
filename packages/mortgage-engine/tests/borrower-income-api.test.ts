import { ZodError } from 'zod';
import {
  BORROWER_INCOME_SCHEMA_VERSION,
  W2_RECOMMENDED_BASE_ZERO,
  calculateBorrowerIncome,
  parseBorrowerIncomeRequest,
  type BorrowerIncomeRequest,
} from '../src/borrower-income-api';
import { W2_INCOME_RULE_VERSION } from '../src/w2-income-methods';

const stub = {
  payFrequency: 'SEMIMONTHLY' as const,
  hourlyRate: 45,
  weeklyHours: 40,
  currentPeriodBasePay: 3600,
  baseYtd: 54000,
  bonusYtd: 12500,
  overtimeYtd: 4200,
  monthsAtJob: 8,
};
const meridian = {
  id: 'w2-meridian',
  payFrequency: 'BIWEEKLY' as const,
  wageDocSource: 'WVOE' as const,
  hourlyRate: 22,
  weeklyHours: 12,
  currentPeriodBasePay: 528,
  baseYtd: 7920,
  wvoeMonths: 24,
  monthsAtJob: 29,
  w2Year1Box5: 11440,
};
const priorEmployer = { box5Wages: 78500, box12Bonus: 18000, box14Overtime: 6000 };

function issuesOf(request: unknown) {
  try {
    parseBorrowerIncomeRequest(request);
  } catch (error) {
    if (error instanceof ZodError) return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw error;
  }
  return [];
}

describe('calculateBorrowerIncome', () => {
  test('returns the contract and rule versions', () => {
    const result = calculateBorrowerIncome({ borrowers: [{ id: 'b1' }] });
    expect(result.schemaVersion).toBe(BORROWER_INCOME_SCHEMA_VERSION);
    expect(result.ruleVersion).toBe(W2_INCOME_RULE_VERSION);
    expect(result.borrowers).toEqual([
      { borrowerIndex: 0, borrowerId: 'b1', w2BaseMonthly: 0, w2VariableMonthly: 0, selfEmployedMonthly: 0, qualifyingMonthlyIncome: 0 },
    ]);
  });

  test('two spouses with identical stubs get identical income', () => {
    const result = calculateBorrowerIncome({
      borrowers: [{ id: 'b1', name: 'Alex' }, { id: 'b2', name: 'Sam' }],
      w2Employers: [
        { ...stub, id: 'e1', borrowerId: 'b1' },
        { ...stub, id: 'e2', borrowerId: 'b2' },
      ],
    });
    const [first, second] = result.borrowers;
    expect(first).toMatchObject({ borrowerId: 'b1', name: 'Alex' });
    expect(second).toMatchObject({ borrowerId: 'b2', name: 'Sam' });
    expect(second.w2BaseMonthly).toBe(first.w2BaseMonthly);
    expect(second.w2VariableMonthly).toBe(first.w2VariableMonthly);
    expect(first.w2BaseMonthly).toBeCloseTo(7200, 10);
    expect(first.w2VariableMonthly).toBeCloseTo(16700 / 8, 10);
  });

  test('the previous employer on the 1003 merges only into the primary borrower', () => {
    const result = calculateBorrowerIncome({
      borrowers: [{ id: 'b1' }, { id: 'b2' }],
      priorEmployer,
      w2Employers: [
        { ...stub, id: 'e1', borrowerId: 'b1' },
        { ...stub, id: 'e2', borrowerId: 'b2' },
      ],
    });
    const [primary, coBorrower] = result.employers;
    expect(primary).toMatchObject({ variableMethodId: 'avg24', variableRecommendedId: 'avg24' });
    expect(primary.variableMonthly).toBeCloseTo(40700 / 20, 10);
    expect(coBorrower).toMatchObject({ variableMethodId: 'current', variableRecommendedId: 'current' });
    expect(coBorrower.variableMonthly).toBeCloseTo(16700 / 8, 10);
  });

  test('Meridian as a co-borrower\'s second job adds $1,144 to that borrower only', () => {
    const result = calculateBorrowerIncome({
      borrowers: [{ id: 'b1' }, { id: 'b2' }],
      priorEmployer,
      w2Employers: [
        { ...stub, id: 'w2-apex', borrowerId: 'b1', employerName: 'Apex Technology Partners LLC' },
        { ...meridian, borrowerId: 'b2', employerName: 'Meridian Health Systems' },
      ],
    });
    const meridianResult = result.employers.find((employer) => employer.id === 'w2-meridian');
    expect(meridianResult).toMatchObject({ borrowerId: 'b2', employerName: 'Meridian Health Systems', baseMethodId: 'period', variableMonthly: 0 });
    expect(meridianResult?.baseMonthly).toBeCloseTo(1144, 10);
    expect(result.borrowers[1].qualifyingMonthlyIncome).toBeCloseTo(1144, 10);
    expect(result.borrowers[0].qualifyingMonthlyIncome).toBeCloseTo(7200 + 2035, 10);
  });

  test('an employer without a borrowerId belongs to the primary borrower', () => {
    const result = calculateBorrowerIncome({ borrowers: [{ id: 'b1' }, { id: 'b2' }], w2Employers: [{ ...stub, id: 'e1' }] });
    expect(result.employers[0].borrowerId).toBe('b1');
    expect(result.borrowers[0].w2BaseMonthly).toBeCloseTo(7200, 10);
    expect(result.borrowers[1].w2BaseMonthly).toBe(0);
  });

  test('the underwriter\'s chosen methods are applied', () => {
    const result = calculateBorrowerIncome({
      borrowers: [{ id: 'b1' }],
      priorEmployer,
      w2Employers: [{ ...stub, id: 'e1', baseMethod: 'hourly', variableMethod: 'not_used' }],
    });
    expect(result.employers[0]).toMatchObject({ baseMethodId: 'hourly', baseRecommendedId: 'period', variableMethodId: 'not_used', variableMonthly: 0 });
    expect(result.employers[0].baseMonthly).toBeCloseTo(7800, 10);
  });

  test('joint rental and asset income is credited to the primary borrower and the totals add up', () => {
    const result = calculateBorrowerIncome({
      borrowers: [{ id: 'b1' }, { id: 'b2' }],
      w2Employers: [{ ...stub, id: 'e1', borrowerId: 'b2' }],
      selfEmployed: [
        { id: 's1', borrowerId: 'b2', kind: 'SCHEDULE_C', monthly: 1500 },
        { id: 's2', kind: 'FORM_1120S', monthly: -200 },
      ],
      rentalMonthly: 900,
      assetIncomeMonthly: 100,
    });
    expect(result.borrowers[0]).toMatchObject({ w2BaseMonthly: 0, selfEmployedMonthly: -200, qualifyingMonthlyIncome: 800 });
    expect(result.borrowers[1].selfEmployedMonthly).toBe(1500);
    expect(result.borrowers[1].qualifyingMonthlyIncome).toBeCloseTo(7200 + 16700 / 8 + 1500, 10);
    expect(result.totals).toMatchObject({ selfEmployedMonthly: 1300, rentalMonthly: 900, assetIncomeMonthly: 100 });
    expect(result.totals.qualifyingMonthlyIncome).toBeCloseTo(
      result.borrowers[0].qualifyingMonthlyIncome + result.borrowers[1].qualifyingMonthlyIncome,
      10,
    );
  });

  test('a recommended base of zero beside a positive method is flagged for review', () => {
    const salaried = { id: 'e1', currentPeriodBasePay: 3600, baseYtd: 54000 };
    const flagged = calculateBorrowerIncome({ borrowers: [{ id: 'b1' }], w2Employers: [salaried] }).employers[0];
    expect(flagged).toMatchObject({ baseMethodId: 'hourly', baseMonthly: 0, warnings: [W2_RECOMMENDED_BASE_ZERO] });
    const chosen = calculateBorrowerIncome({ borrowers: [{ id: 'b1' }], w2Employers: [{ ...salaried, baseMethod: 'period' }] }).employers[0];
    expect(chosen.warnings).toEqual([]);
    expect(chosen.baseMonthly).toBeCloseTo(7200, 10);
    const empty = calculateBorrowerIncome({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1' }] }).employers[0];
    expect(empty.warnings).toEqual([]);
  });

  test('throws ZodError on invalid input', () => {
    expect(() => calculateBorrowerIncome({ borrowers: [] } as BorrowerIncomeRequest)).toThrow(ZodError);
  });
});

describe('borrower income request validation', () => {
  test('requires one to ten borrowers', () => {
    expect(issuesOf({ borrowers: [] })).toEqual([expect.stringMatching(/^borrowers: /)]);
    expect(issuesOf({})).toEqual([expect.stringMatching(/^borrowers: /)]);
    expect(issuesOf({ borrowers: Array.from({ length: 11 }, (_, index) => ({ id: `b${index}` })) })).toHaveLength(1);
  });

  test('rejects duplicate borrower ids', () => {
    expect(issuesOf({ borrowers: [{ id: 'b1' }, { id: 'b1' }] })).toEqual(['borrowers: Borrower ids must be unique.']);
  });

  test('rejects income owned by a borrower not on the request', () => {
    expect(issuesOf({
      borrowers: [{ id: 'b1' }],
      w2Employers: [{ id: 'e1', borrowerId: 'b9' }],
      selfEmployed: [{ id: 's1', borrowerId: 'b8', kind: 'SCHEDULE_C', monthly: 1 }],
    })).toEqual([
      'w2Employers.0.borrowerId: borrowerId must name a borrower on the request.',
      'selfEmployed.0.borrowerId: borrowerId must name a borrower on the request.',
    ]);
  });

  test('rejects duplicate employer and business ids', () => {
    expect(issuesOf({
      borrowers: [{ id: 'b1' }],
      w2Employers: [{ id: 'x' }],
      selfEmployed: [{ id: 'x', kind: 'SCHEDULE_C', monthly: 1 }],
    })).toEqual(['w2Employers: Employer and business ids must be unique.']);
  });

  test('rejects unknown fields, unknown methods, negative wages and non-finite numbers', () => {
    expect(issuesOf({ borrowers: [{ id: 'b1' }], ssn: '000-00-0000' })[0]).toMatch(/Unrecognized key/);
    expect(issuesOf({ borrowers: [{ id: 'b1', ssn: '1' }] })[0]).toMatch(/^borrowers.0: Unrecognized key/);
    expect(issuesOf({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', baseMethod: 'bogus' }] })[0]).toMatch(/^w2Employers.0.baseMethod: /);
    expect(issuesOf({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', baseYtd: -1 }] })[0]).toMatch(/^w2Employers.0.baseYtd: /);
    expect(issuesOf({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1', weeklyHours: 169 }] })[0]).toMatch(/^w2Employers.0.weeklyHours: /);
    expect(issuesOf({ borrowers: [{ id: 'b1' }], rentalMonthly: Infinity })[0]).toMatch(/^rentalMonthly: /);
    expect(issuesOf({ borrowers: [{ id: 'b1' }], ytdMonthsElapsed: 0 })[0]).toMatch(/^ytdMonthsElapsed: /);
    expect(issuesOf({ borrowers: [{ id: '  ' }] })[0]).toMatch(/^borrowers.0.id: /);
  });

  test('fills defaults for omitted wage fields', () => {
    const parsed = parseBorrowerIncomeRequest({ borrowers: [{ id: 'b1' }], w2Employers: [{ id: 'e1' }] });
    expect(parsed.w2Employers[0]).toMatchObject({ payFrequency: 'SEMIMONTHLY', wageDocSource: 'PAYSTUB', hourlyRate: 0, monthsAtJob: 12 });
    expect(parsed).toMatchObject({ selfEmployed: [], rentalMonthly: 0, assetIncomeMonthly: 0 });
  });
});
