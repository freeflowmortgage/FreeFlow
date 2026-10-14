/**
 * When a bonus is paid, and so how many months a year-to-date bonus figure
 * actually pays for.
 *
 * Bonus pay does not accrue each paycheck. A quarterly bonus struck through
 * August 15 holds two quarterly payouts, which pay for six months of work, not
 * the 7.5 months the year-to-date window spans. Dividing by the window
 * understates the borrower's bonus; dividing by the months the paid bonuses
 * cover does not.
 *
 * A bonus is paid once its period closes, so a window holds one payout per
 * full period. A window that holds a bonus but no full period, such as an
 * annual bonus paid in March, still holds that one payout, and it pays for one
 * whole period.
 */

export const BONUS_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export type BonusFrequency = (typeof BONUS_FREQUENCIES)[number];

const PERIOD_MONTHS: Record<BonusFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 };

/** Elapsed months come from dates, so 5.9999 months is six. */
const WHOLE_PERIOD_TOLERANCE = 1e-6;

export function bonusPeriodMonths(frequency: BonusFrequency): number {
  return PERIOD_MONTHS[frequency];
}

/** The number of bonus payouts a window of `windowMonths` holds. */
export function bonusPayoutsInWindow(windowMonths: number, frequency: BonusFrequency): number {
  const window = Number.isFinite(windowMonths) && windowMonths > 0 ? windowMonths : 0;
  return Math.max(1, Math.floor(window / PERIOD_MONTHS[frequency] + WHOLE_PERIOD_TOLERANCE));
}

/** The months of work the bonuses paid within a year-to-date window pay for. */
export function bonusMonthsCovered(windowMonths: number, frequency: BonusFrequency): number {
  return bonusPayoutsInWindow(windowMonths, frequency) * PERIOD_MONTHS[frequency];
}

export function isBonusFrequency(value: unknown): value is BonusFrequency {
  return typeof value === 'string' && (BONUS_FREQUENCIES as readonly string[]).includes(value);
}

export function parseBonusFrequency(value: string | null | undefined): BonusFrequency | undefined {
  const text = (value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!text || text.includes('SEMIMONTH') || text.includes('WEEK')) return undefined;
  if (text.includes('SEMIANNUAL') || text.includes('BIANNUAL') || text.includes('HALFYEAR')) return 'SEMIANNUAL';
  if (text.includes('QUARTER')) return 'QUARTERLY';
  if (text.includes('MONTH')) return 'MONTHLY';
  if (text.includes('ANNUAL') || text.includes('YEAR')) return 'ANNUAL';
  return undefined;
}

export function bonusFrequencyLabel(frequency: BonusFrequency): string {
  if (frequency === 'SEMIANNUAL') return 'Semi-annual';
  return frequency.charAt(0) + frequency.slice(1).toLowerCase();
}
