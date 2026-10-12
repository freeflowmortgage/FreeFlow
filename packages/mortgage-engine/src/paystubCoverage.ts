import { Decimal } from 'decimal.js';
import { payPeriodsPerYear, type PayFrequency } from './paystubAnnualization';

/**
 * How much of a tax year a pay stub's year-to-date column actually covers.
 *
 * `annualizePaystub` divides every YTD figure by `elapsedMonths`, so that one
 * number decides the answer: a December stub divided by the mid-year default of
 * 7.5 overstates income by 60%. Nothing on the stub was previously read to
 * check it, which left the figure resting entirely on reviewer recall.
 *
 * A year-end stub is not identified by a 12/31 period end. Payroll calendars
 * rarely land on the last day of the year: a biweekly year can close on 12/18,
 * a weekly one on 12/28, and a semimonthly December still has a 12/31 period to
 * come. What makes a stub the last one of its year is that no further pay
 * period of that year ends after it, so this module asks that question instead:
 * when fewer days remain in the tax year than one pay period spans, the YTD
 * column already holds every period the year will have and covers 12 months.
 *
 * Every other stub is measured by the share of the year its period end sits at,
 * which is leap-year aware and works the same in January as in October.
 */

export const PAYSTUB_COVERAGE_RULE_VERSION = 'paystub-coverage-v1';

export type PaystubCoverageGap =
  | 'PERIOD_END_REQUIRED'
  | 'PERIOD_END_UNREADABLE'
  | 'PERIOD_END_OUTSIDE_TAX_YEAR'
  | 'PAY_FREQUENCY_REQUIRED_FOR_YEAR_END';

export type PaystubCoverageInput = Readonly<{
  /** The year the YTD column accumulates over. */
  taxYear: number;
  /** Pay period end as printed on the stub. `payDate` is used when it is absent. */
  periodEnd?: string | null;
  payDate?: string | null;
  payFrequency?: PayFrequency | null;
}>;

export type PaystubCoverage = Readonly<{
  status: 'READY' | 'GAPS';
  gaps: readonly PaystubCoverageGap[];
  /** The date the coverage was measured from, normalized to `YYYY-MM-DD`. */
  periodEndIso: string | null;
  elapsedMonths: number | null;
  /** True when no further pay period of the tax year ends after this stub. */
  coversFullYear: boolean;
  daysRemainingInTaxYear: number | null;
}>;

/**
 * How far a reviewed `elapsedMonths` may sit from the stub's own period end
 * before the two are treated as disagreeing. Half a month absorbs a payroll
 * calendar that does not align to month ends; it still separates a December
 * stub from the 7.5 of an August one.
 */
export const ELAPSED_MONTHS_TOLERANCE = 0.5;

/**
 * How close to the year end the full-year question changes the divisor. Inside
 * this window the pay frequency decides whether the stub is the year's last, so
 * a missing frequency is a gap rather than a silent fall back to the day share.
 */
const YEAR_END_WINDOW_DAYS = 31;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
}

type CalendarDate = { year: number; month: number; day: number };

/**
 * Read a date printed on a stub without trusting the host locale. Payroll
 * vendors emit `MM/DD/YYYY`, `M/D/YY`, and ISO; `Date.parse` disagrees with
 * itself across those, and a two-digit year it reads as 1925 would place a
 * stub outside its own tax year.
 */
export function parseStubDate(value: string | null | undefined): CalendarDate | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (us) {
    [month, day] = [Number(us[1]), Number(us[2])];
    const rawYear = Number(us[3]);
    year = us[3].length === 4 ? rawYear : rawYear + (rawYear <= 69 ? 2000 : 1900);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || year < 1990 || year > 2100) return null;
  if (day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function dayOfYear(date: CalendarDate): number {
  let total = date.day;
  for (let month = 1; month < date.month; month += 1) total += daysInMonth(date.year, month);
  return total;
}

function toIso(date: CalendarDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function blocked(gaps: PaystubCoverageGap[]): PaystubCoverage {
  return { status: 'GAPS', gaps, periodEndIso: null, elapsedMonths: null, coversFullYear: false, daysRemainingInTaxYear: null };
}

/** The months of `taxYear` a stub's YTD column covers, read from the stub itself. */
export function paystubCoverage(input: PaystubCoverageInput): PaystubCoverage {
  const printed = input.periodEnd ?? input.payDate ?? null;
  if (!(printed ?? '').trim()) return blocked(['PERIOD_END_REQUIRED']);
  const date = parseStubDate(printed);
  if (!date) return blocked(['PERIOD_END_UNREADABLE']);
  if (!Number.isInteger(input.taxYear) || date.year !== input.taxYear) {
    return blocked(['PERIOD_END_OUTSIDE_TAX_YEAR']);
  }

  const total = daysInYear(date.year);
  const elapsedDays = dayOfYear(date);
  const daysRemaining = total - elapsedDays;

  if (!input.payFrequency) {
    if (daysRemaining <= YEAR_END_WINDOW_DAYS) {
      return {
        status: 'GAPS',
        gaps: ['PAY_FREQUENCY_REQUIRED_FOR_YEAR_END'],
        periodEndIso: toIso(date),
        elapsedMonths: null,
        coversFullYear: false,
        daysRemainingInTaxYear: daysRemaining,
      };
    }
    return ready(date, daysRemaining, false, elapsedDays, total);
  }

  const periodDays = new Decimal(total).div(payPeriodsPerYear(input.payFrequency));
  const coversFullYear = periodDays.greaterThan(daysRemaining);
  return ready(date, daysRemaining, coversFullYear, elapsedDays, total);
}

function ready(
  date: CalendarDate,
  daysRemaining: number,
  coversFullYear: boolean,
  elapsedDays: number,
  total: number,
): PaystubCoverage {
  const share = new Decimal(elapsedDays).div(total).mul(12).toDecimalPlaces(2).toNumber();
  return {
    status: 'READY',
    gaps: [],
    periodEndIso: toIso(date),
    elapsedMonths: coversFullYear ? 12 : Math.min(12, share),
    coversFullYear,
    daysRemainingInTaxYear: daysRemaining,
  };
}

/** True when a reviewed elapsed-months figure matches what the stub's own date implies. */
export function elapsedMonthsAgree(reviewed: number, derived: number): boolean {
  return Math.abs(reviewed - derived) <= ELAPSED_MONTHS_TOLERANCE;
}
