import {
  chosenW2Income,
  ownedByPrimaryBorrower,
  splitIncomeByBorrower,
  w2BaseMethods,
  w2VariableMethods,
  type PriorEmployerWageHistory,
  type W2EmployerWageInput,
  type W2PayFrequency,
  type W2WageDocSource,
} from '../src/w2-income-methods';

// The Wages tab demo packet in UnderwriterSplitViewDemo.tsx.
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
const meridian: W2EmployerWageInput = {
  id: 'w2-meridian',
  payFrequency: 'BIWEEKLY',
  wageDocSource: 'WVOE',
  hourlyRate: 22,
  weeklyHours: 12,
  currentPeriodBasePay: 528,
  baseYtd: 7920,
  bonusYtd: 0,
  overtimeYtd: 0,
  tipsYtd: 0,
  commissionYtd: 0,
  wvoeBonus: 0,
  wvoeOvertime: 0,
  wvoeMonths: 24,
  monthsAtJob: 29,
  w2Year1Box5: 11440,
};
const priorEmployer: PriorEmployerWageHistory = { box5Wages: 78500, box12Bonus: 18000, box14Overtime: 6000 };

/**
 * The console's inline W-2 math before it moved into the engine, copied
 * verbatim apart from parameterizing `ownedByPrimary`, the prior-employer
 * history and the underwriter's choices. Parity tests compare against it
 * whenever the 1003 has a previous employer; without one the engine no longer
 * merges, which the identical-stubs test covers.
 */
function consoleReference(
  entry: W2EmployerWageInput,
  ownedByPrimary: boolean,
  prevEmployerW2: PriorEmployerWageHistory,
  baseChoice?: string | null,
  varChoice?: string | null,
) {
  const pickMonthly = (options: Record<string, number>, selected: string | null | undefined, recommendedId: string) =>
    options[selected && selected in options ? selected : recommendedId] ?? 0;
  const periods = entry.payFrequency === 'WEEKLY' ? 52 : entry.payFrequency === 'BIWEEKLY' ? 26 : entry.payFrequency === 'MONTHLY' ? 12 : 24;
  const hourly = (entry.hourlyRate * entry.weeklyHours * 52) / 12;
  const ytd = entry.baseYtd / 7.5;
  const priorBox5 = entry.w2Year1Box5 || (ownedByPrimary ? prevEmployerW2.box5Wages : 0);
  const variancePct = Math.abs(((hourly - ytd) / hourly) * 100);
  const base = pickMonthly(
    { hourly, period: (entry.currentPeriodBasePay * periods) / 12, ytd, prior: priorBox5 / 12, not_used: 0 },
    baseChoice,
    variancePct > 10 ? (hourly <= ytd ? 'hourly' : 'ytd') : 'period',
  );
  const fromWvoe = entry.wageDocSource === 'WVOE';
  const total = fromWvoe
    ? entry.wvoeBonus + entry.wvoeOvertime
    : entry.bonusYtd + entry.overtimeYtd + entry.tipsYtd + entry.commissionYtd;
  const months = Math.max(fromWvoe ? entry.wvoeMonths : entry.monthsAtJob, 1);
  const current = total / months;
  const merged = ownedByPrimary
    ? (entry.bonusYtd + entry.overtimeYtd + prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime) / (entry.monthsAtJob + 12)
    : current;
  const variable = pickMonthly(
    { current, avg24: merged, not_used: 0 },
    varChoice,
    ownedByPrimary && entry.monthsAtJob < 12 ? 'avg24' : 'current',
  );
  return { base, variable };
}

describe('W-2 base methods', () => {
  test('Meridian part-time job is $1,144 a month by the period method', () => {
    const methods = w2BaseMethods(meridian, { ownedByPrimary: false });
    const monthly = Object.fromEntries(methods.options.map((option) => [option.id, option.monthly]));
    expect(monthly.hourly).toBeCloseTo(1144, 10);
    expect(monthly.period).toBeCloseTo(1144, 10);
    expect(monthly.ytd).toBeCloseTo(1056, 10);
    expect(monthly.prior).toBeCloseTo(11440 / 12, 10);
    expect(methods.maxVariancePct).toBeCloseTo(7.6923, 3);
    expect(methods.recommendedId).toBe('period');
    expect(chosenW2Income(meridian, { ownedByPrimary: false }).baseMonthly).toBeCloseTo(1144, 10);
  });

  test('a hourly and YTD spread over 10% recommends the lower of the two', () => {
    const raised = { ...apex, hourlyRate: 60 };
    expect(w2BaseMethods(raised, { ownedByPrimary: true }).recommendedId).toBe('ytd');
    const cut = { ...apex, hourlyRate: 30 };
    expect(w2BaseMethods(cut, { ownedByPrimary: true }).recommendedId).toBe('hourly');
  });

  test('the YTD average uses the supplied elapsed months', () => {
    const methods = w2BaseMethods(apex, { ownedByPrimary: true, ytdMonthsElapsed: 9 });
    expect(methods.options.find((option) => option.id === 'ytd')?.monthly).toBeCloseTo(6000, 10);
  });

  test('a December 3 paystub uses its 11.08-month coverage for base and variable YTD', () => {
    const context = { ownedByPrimary: false, ytdMonthsElapsed: 11.08 };
    const employer = { ...apex, baseYtd: 104741.32, bonusYtd: 1108, overtimeYtd: 2216, monthsAtJob: 12 };
    expect(w2BaseMethods(employer, context).options.find((option) => option.id === 'ytd')?.monthly)
      .toBeCloseTo(104741.32 / 11.08, 10);
    const variable = w2VariableMethods(employer, context);
    expect(variable.variableMonths).toBe(11.08);
    expect(variable.options.find((option) => option.id === 'current')?.monthly).toBeCloseTo(300, 10);
  });

  test('prior-year base falls back to the 1003 previous employer only for the primary borrower', () => {
    const noW2 = { ...meridian, w2Year1Box5: 0 };
    const prior = (ownedByPrimary: boolean) =>
      w2BaseMethods(noW2, { ownedByPrimary, priorEmployer }).options.find((option) => option.id === 'prior')?.monthly;
    expect(prior(true)).toBeCloseTo(78500 / 12, 10);
    expect(prior(false)).toBe(0);
  });
});

describe('W-2 variable methods', () => {
  test('the primary borrower under 12 months merges the previous employer into a 24-month average', () => {
    const methods = w2VariableMethods(apex, { ownedByPrimary: true, priorEmployer });
    expect(methods.mergesPriorEmployer).toBe(true);
    expect(methods.recommendedId).toBe('avg24');
    expect(methods.options.find((option) => option.id === 'current')?.monthly).toBeCloseTo(16700 / 8, 10);
    expect(methods.options.find((option) => option.id === 'avg24')?.monthly).toBeCloseTo(40700 / 20, 10);
  });

  test('a co-borrower never merges the primary borrower\'s previous employer', () => {
    const methods = w2VariableMethods(apex, { ownedByPrimary: false, priorEmployer });
    expect(methods.mergesPriorEmployer).toBe(false);
    expect(methods.recommendedId).toBe('current');
    const current = methods.options.find((option) => option.id === 'current')?.monthly;
    expect(methods.options.find((option) => option.id === 'avg24')?.monthly).toBe(current);
  });

  test.each([
    ['missing', undefined],
    ['blank', { box5Wages: 0, box12Bonus: 0, box14Overtime: 0 }],
  ])('a primary borrower under 12 months with a %s previous employer uses this job only', (_label, prior) => {
    const methods = w2VariableMethods(apex, { ownedByPrimary: true, priorEmployer: prior });
    expect(methods.mergesPriorEmployer).toBe(false);
    expect(methods.recommendedId).toBe('current');
    expect(methods.options.find((option) => option.id === 'avg24')?.monthly).toBeCloseTo(16700 / 8, 10);
  });

  test('a previous employer with wages but no bonus or overtime still merges, as zero variable months', () => {
    const methods = w2VariableMethods(apex, { ownedByPrimary: true, priorEmployer: { box5Wages: 60000, box12Bonus: 0, box14Overtime: 0 } });
    expect(methods.recommendedId).toBe('avg24');
    expect(methods.options.find((option) => option.id === 'avg24')?.monthly).toBeCloseTo(16700 / 20, 10);
  });

  test('a WVOE uses the WVOE bonus, overtime and months', () => {
    const wvoe = { ...apex, wageDocSource: 'WVOE' as const, monthsAtJob: 30 };
    const methods = w2VariableMethods(wvoe, { ownedByPrimary: true, priorEmployer });
    expect(methods.options.find((option) => option.id === 'current')?.monthly).toBeCloseTo(24000 / 12, 10);
    expect(methods.recommendedId).toBe('current');
  });

  test('zero months on the job divides by one month', () => {
    const methods = w2VariableMethods({ ...apex, monthsAtJob: 0 }, { ownedByPrimary: false });
    expect(methods.options.find((option) => option.id === 'current')?.monthly).toBe(16700);
  });
});

describe('chosen W-2 income', () => {
  test('uses the underwriter\'s choice', () => {
    const chosen = chosenW2Income(apex, { ownedByPrimary: true, priorEmployer }, { base: 'hourly', variable: 'current' });
    expect(chosen).toMatchObject({ baseMethodId: 'hourly', baseRecommendedId: 'period', variableMethodId: 'current', variableRecommendedId: 'avg24' });
    expect(chosen.baseMonthly).toBeCloseTo(7800, 10);
    expect(chosen.variableMonthly).toBeCloseTo(2087.5, 10);
  });

  test.each([undefined, null, '', 'bogus', 'HOURLY', 'avg24'])('an invalid base choice %p falls back to the recommendation', (choice) => {
    const chosen = chosenW2Income(apex, { ownedByPrimary: true, priorEmployer }, { base: choice });
    expect(chosen.baseMethodId).toBe('period');
    expect(chosen.baseMonthly).toBeCloseTo(7200, 10);
  });

  test.each([undefined, null, '', 'bogus', 'period'])('an invalid variable choice %p falls back to the recommendation', (choice) => {
    const chosen = chosenW2Income(apex, { ownedByPrimary: true, priorEmployer }, { variable: choice });
    expect(chosen.variableMethodId).toBe('avg24');
    expect(chosen.variableMonthly).toBeCloseTo(2035, 10);
  });

  test('not_used is a real choice worth zero', () => {
    const chosen = chosenW2Income(apex, { ownedByPrimary: true }, { base: 'not_used', variable: 'not_used' });
    expect(chosen).toMatchObject({ baseMethodId: 'not_used', baseMonthly: 0, variableMethodId: 'not_used', variableMonthly: 0 });
  });

  test('matches the console\'s former inline math across frequencies, sources, owners and choices', () => {
    const frequencies: W2PayFrequency[] = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'];
    const sources: W2WageDocSource[] = ['PAYSTUB', 'WVOE'];
    const baseChoices = [undefined, 'hourly', 'period', 'ytd', 'prior', 'not_used', 'bogus'];
    const varChoices = [undefined, 'current', 'avg24', 'not_used', 'bogus'];
    const shapes: W2EmployerWageInput[] = [
      apex,
      meridian,
      { ...apex, hourlyRate: 60, monthsAtJob: 14, tipsYtd: 900, commissionYtd: 2500 },
      { ...meridian, w2Year1Box5: 0, monthsAtJob: 3, bonusYtd: 400 },
      { ...apex, hourlyRate: 0, weeklyHours: 0 },
    ];
    let compared = 0;
    for (const shape of shapes) {
      for (const payFrequency of frequencies) {
        for (const wageDocSource of sources) {
          for (const ownedByPrimary of [true, false]) {
            for (const baseChoice of baseChoices) {
              for (const varChoice of varChoices) {
                const entry = { ...shape, payFrequency, wageDocSource };
                const expected = consoleReference(entry, ownedByPrimary, priorEmployer, baseChoice, varChoice);
                const actual = chosenW2Income(entry, { ownedByPrimary, priorEmployer }, { base: baseChoice, variable: varChoice });
                expect(actual.baseMonthly).toBe(expected.base);
                expect(actual.variableMonthly).toBe(expected.variable);
                compared += 1;
              }
            }
          }
        }
      }
    }
    expect(compared).toBe(5 * 4 * 2 * 2 * 7 * 5);
  });
});

describe('borrower ownership and split', () => {
  const borrowers = [{ id: 'b1' }, { id: 'b2' }];

  test('the first borrower, an unset owner and a single-borrower file are all primary', () => {
    expect(ownedByPrimaryBorrower({ borrowerId: 'b1' }, borrowers)).toBe(true);
    expect(ownedByPrimaryBorrower({}, borrowers)).toBe(true);
    expect(ownedByPrimaryBorrower({ borrowerId: 'b2' }, borrowers)).toBe(false);
    expect(ownedByPrimaryBorrower({ borrowerId: 'b2' }, [{ id: 'b1' }])).toBe(true);
  });

  test('two spouses with identical stubs and no previous employer get identical income', () => {
    const context = (borrowerId: string) => ({ ownedByPrimary: ownedByPrimaryBorrower({ borrowerId }, borrowers) });
    const first = chosenW2Income({ ...apex, id: 'a', borrowerId: 'b1' }, context('b1'));
    const second = chosenW2Income({ ...apex, id: 'b', borrowerId: 'b2' }, context('b2'));
    expect(second.baseMonthly).toBe(first.baseMonthly);
    expect(second.variableMonthly).toBe(first.variableMonthly);
    const rows = splitIncomeByBorrower({
      borrowers,
      w2: [
        { borrowerId: 'b1', baseMonthly: first.baseMonthly, variableMonthly: first.variableMonthly },
        { borrowerId: 'b2', baseMonthly: second.baseMonthly, variableMonthly: second.variableMonthly },
      ],
      selfEmployed: [],
      jointMonthly: 0,
    });
    expect(rows[0].qualifyingMonthlyIncome).toBe(rows[1].qualifyingMonthlyIncome);
  });

  test('joint rental and asset income is credited once, to the primary borrower', () => {
    const rows = splitIncomeByBorrower({
      borrowers,
      w2: [{ borrowerId: 'b2', baseMonthly: 1000, variableMonthly: 100 }],
      selfEmployed: [{ borrowerId: 'b2', monthly: 500 }, { monthly: 250 }],
      jointMonthly: 1200,
    });
    expect(rows).toEqual([
      { borrowerIndex: 0, w2BaseMonthly: 0, w2VariableMonthly: 0, selfEmployedMonthly: 250, qualifyingMonthlyIncome: 1450 },
      { borrowerIndex: 1, w2BaseMonthly: 1000, w2VariableMonthly: 100, selfEmployedMonthly: 500, qualifyingMonthlyIncome: 1600 },
    ]);
  });

  test('income for an owner not on the list goes to the primary borrower', () => {
    const rows = splitIncomeByBorrower({
      borrowers,
      w2: [{ borrowerId: 'gone', baseMonthly: 1000, variableMonthly: 0 }],
      selfEmployed: [],
      jointMonthly: 0,
    });
    expect(rows[0].w2BaseMonthly).toBe(1000);
    expect(rows[1].w2BaseMonthly).toBe(0);
  });

  test('a file with no borrowers yet still returns one primary row', () => {
    const rows = splitIncomeByBorrower({ borrowers: [], w2: [{ baseMonthly: 10, variableMonthly: 5 }], selfEmployed: [], jointMonthly: 1 });
    expect(rows).toEqual([{ borrowerIndex: 0, w2BaseMonthly: 10, w2VariableMonthly: 5, selfEmployedMonthly: 0, qualifyingMonthlyIncome: 16 }]);
  });
});
