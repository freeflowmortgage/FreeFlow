import { Decimal } from 'decimal.js';

/**
 * Annualize a written verification of employment (Fannie Mae Form 1005).
 *
 * The policy is the one `w2VariableMethods` already applies to a WVOE: base
 * pay comes from the figure in item 12A normalized to a month, and variable pay
 * is the verified bonus, overtime, and commission divided by the months those
 * amounts accrued over, optionally averaged with the prior year the form also
 * reports. This module expresses it in the `annualizePaystub` shape so the
 * protected projector can consume a WVOE and a pay stub the same way.
 *
 * Nothing here guesses the divisor. A Form 1005 states the gross earnings
 * columns but not the date its year-to-date column was struck, so the months
 * that column covers stay a reviewed figure. When the form's date of hire shows
 * the borrower was employed for fewer months than the divisor claims, that is a
 * contradiction a person has to settle, not one to average away.
 */

export const WVOE_ANNUALIZATION_RULE_VERSION = 'wvoe-annualization-v1';

export type WvoeBasePayPeriod = 'HOURLY' | 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY' | 'ANNUAL';
export type WvoeBaseMethod = 'current' | 'ytd';
export type WvoeVariableMethod = 'current' | 'avg24';

export type WvoeAnnualizationGap =
  | 'NO_BASE_METHOD'
  | 'BASE_METHOD_UNAVAILABLE'
  | 'BASE_PAY_PERIOD_REQUIRED'
  | 'WEEKLY_HOURS_REQUIRED'
  | 'ELAPSED_MONTHS_REQUIRED'
  | 'ELAPSED_MONTHS_EXCEEDS_EMPLOYMENT'
  | 'PRIOR_YEAR_UNAVAILABLE';

export type WvoeAnnualizationInput = Readonly<{
  /** Item 12A, in the unit named by `basePayPeriod`. */
  currentBasePay?: number;
  basePayPeriod?: WvoeBasePayPeriod;
  /** Required only when `basePayPeriod` is `HOURLY`. */
  weeklyHours?: number;
  /** The year-to-date column of item 12B. */
  baseYtd?: number;
  overtimeYtd?: number;
  bonusYtd?: number;
  commissionYtd?: number;
  /** The prior full year column of item 12B, used by the two-year average. */
  overtimePriorYear?: number;
  bonusPriorYear?: number;
  commissionPriorYear?: number;
  /** Months the year-to-date column covers. Reviewed, never inferred here. */
  elapsedMonths?: number;
  /** Months employed, from the item 13 date of hire when the parser read it. */
  monthsEmployed?: number;
  baseMethod?: WvoeBaseMethod;
  variableMethod?: WvoeVariableMethod;
}>;

export type WvoeComponentMonthly = Readonly<{
  base: number;
  overtime: number;
  bonus: number;
  commission: number;
}>;

export type WvoeAnnualization = Readonly<{
  status: 'READY' | 'GAPS';
  gaps: readonly WvoeAnnualizationGap[];
  selectedBaseMethod: WvoeBaseMethod | null;
  selectedVariableMethod: WvoeVariableMethod | null;
  monthlyBase: number;
  monthlyVariable: number;
  annualBase: number;
  annualVariable: number;
  components: WvoeComponentMonthly;
  annualComponents: WvoeComponentMonthly;
  methods: Readonly<{ current: number | null; ytd: number | null }>;
  /** The divisor the variable components were averaged over. */
  variableMonths: number | null;
}>;

export function wvoeBasePeriodsPerYear(period: Exclude<WvoeBasePayPeriod, 'HOURLY'>): number {
  if (period === 'ANNUAL') return 1;
  if (period === 'MONTHLY') return 12;
  if (period === 'SEMIMONTHLY') return 24;
  if (period === 'BIWEEKLY') return 26;
  return 52;
}

export function parseWvoeBasePayPeriod(value: string | undefined | null): WvoeBasePayPeriod | undefined {
  const text = (value ?? '').toUpperCase();
  if (!text) return undefined;
  if (text.includes('HOUR') || text.includes('HR')) return 'HOURLY';
  if (text.includes('ANNUAL') || text.includes('YEAR') || text.includes('YR')) return 'ANNUAL';
  if (text.includes('SEMI') || text.includes('24')) return 'SEMIMONTHLY';
  if (text.includes('BI') || text.includes('26')) return 'BIWEEKLY';
  if (text.includes('WEEK') || text.includes('WK')) return 'WEEKLY';
  if (text.includes('MONTH') || text.includes('MO')) return 'MONTHLY';
  return undefined;
}

const money = (value: Decimal) => value.toDecimalPlaces(2).toNumber();

export function annualizeWvoe(input: WvoeAnnualizationInput): WvoeAnnualization {
  const gaps: WvoeAnnualizationGap[] = [];
  const elapsed = input.elapsedMonths;
  const elapsedOk = typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed > 0 && elapsed <= 12;

  const variableYtd = [input.overtimeYtd, input.bonusYtd, input.commissionYtd];
  const usesYtd = [input.baseYtd, ...variableYtd].some((amount) => typeof amount === 'number' && amount !== 0);
  if (usesYtd && !elapsedOk) gaps.push('ELAPSED_MONTHS_REQUIRED');
  if (
    elapsedOk
    && typeof input.monthsEmployed === 'number'
    && Number.isFinite(input.monthsEmployed)
    && input.monthsEmployed > 0
    && (elapsed as number) > input.monthsEmployed
  ) {
    gaps.push('ELAPSED_MONTHS_EXCEEDS_EMPLOYMENT');
  }

  let current: number | null = null;
  if (typeof input.currentBasePay === 'number' && Number.isFinite(input.currentBasePay)) {
    if (!input.basePayPeriod) {
      gaps.push('BASE_PAY_PERIOD_REQUIRED');
    } else if (input.basePayPeriod === 'HOURLY') {
      if (typeof input.weeklyHours === 'number' && Number.isFinite(input.weeklyHours) && input.weeklyHours > 0) {
        current = money(new Decimal(input.currentBasePay).mul(input.weeklyHours).mul(52).div(12));
      } else {
        gaps.push('WEEKLY_HOURS_REQUIRED');
      }
    } else {
      current = money(new Decimal(input.currentBasePay).mul(wvoeBasePeriodsPerYear(input.basePayPeriod)).div(12));
    }
  }
  const ytd = input.baseYtd != null && elapsedOk
    ? money(new Decimal(input.baseYtd).div(elapsed as number))
    : null;
  const methods = { current, ytd };

  let selectedBase: WvoeBaseMethod | null = null;
  if (input.baseMethod) {
    selectedBase = methods[input.baseMethod] == null ? null : input.baseMethod;
    if (!selectedBase) gaps.push('BASE_METHOD_UNAVAILABLE');
  } else if (current != null) {
    selectedBase = 'current';
  } else if (ytd != null) {
    selectedBase = 'ytd';
  } else {
    gaps.push('NO_BASE_METHOD');
  }

  const variableMethod: WvoeVariableMethod = input.variableMethod ?? 'current';
  const priorYear = [input.overtimePriorYear, input.bonusPriorYear, input.commissionPriorYear];
  if (variableMethod === 'avg24' && !priorYear.some((amount) => typeof amount === 'number')) {
    gaps.push('PRIOR_YEAR_UNAVAILABLE');
  }

  const variableMonths = elapsedOk
    ? (variableMethod === 'avg24' ? new Decimal(elapsed as number).add(12) : new Decimal(elapsed as number))
    : null;
  const monthlyVariableComponent = (ytdAmount: number | undefined, priorAmount: number | undefined): number => {
    if (variableMonths === null) return 0;
    const total = new Decimal(ytdAmount ?? 0).add(variableMethod === 'avg24' ? (priorAmount ?? 0) : 0);
    return money(total.div(variableMonths));
  };

  const components: WvoeComponentMonthly = {
    base: selectedBase ? methods[selectedBase] ?? 0 : 0,
    overtime: monthlyVariableComponent(input.overtimeYtd, input.overtimePriorYear),
    bonus: monthlyVariableComponent(input.bonusYtd, input.bonusPriorYear),
    commission: monthlyVariableComponent(input.commissionYtd, input.commissionPriorYear),
  };
  const monthlyVariable = money(
    new Decimal(components.overtime).add(components.bonus).add(components.commission),
  );

  const ready = gaps.length === 0 && selectedBase != null;
  const annualOf = (monthly: number) => money(new Decimal(monthly).mul(12));
  const monthlyBase = ready ? components.base : 0;
  const readyVariable = ready ? monthlyVariable : 0;
  return {
    status: ready ? 'READY' : 'GAPS',
    gaps,
    selectedBaseMethod: ready ? selectedBase : null,
    selectedVariableMethod: ready ? variableMethod : null,
    monthlyBase,
    monthlyVariable: readyVariable,
    annualBase: annualOf(monthlyBase),
    annualVariable: annualOf(readyVariable),
    components,
    annualComponents: {
      base: annualOf(monthlyBase),
      overtime: annualOf(ready ? components.overtime : 0),
      bonus: annualOf(ready ? components.bonus : 0),
      commission: annualOf(ready ? components.commission : 0),
    },
    methods,
    variableMonths: variableMonths === null ? null : variableMonths.toNumber(),
  };
}

/** Whole months between a Form 1005 date of hire and the date the form was struck. */
export function monthsEmployedBetween(hireDate: string | null | undefined, asOf: string | null | undefined): number | null {
  const hire = parseMonthDayYear(hireDate);
  const end = parseMonthDayYear(asOf);
  if (!hire || !end) return null;
  const months = (end.year - hire.year) * 12 + (end.month - hire.month) - (end.day < hire.day ? 1 : 0);
  return months < 0 ? null : months;
}

function parseMonthDayYear(value: string | null | undefined): { year: number; month: number; day: number } | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  if (!us) return null;
  const rawYear = Number(us[3]);
  return {
    year: us[3].length === 4 ? rawYear : rawYear + (rawYear <= 69 ? 2000 : 1900),
    month: Number(us[1]),
    day: Number(us[2]),
  };
}
