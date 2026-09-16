/** Vendor-agnostic paystub row-kind and frequency rules for any payroll processor.

  The JSON catalog is not a Banner Health template. Banner is only a test fixture.
 */
import rules from './paystubRowRules.json';

export type PaystubRowKind = 'regular' | 'bonus' | 'ot' | 'tips' | 'commission' | 'rsu';
export type PaystubFrequency = 'Weekly' | 'Biweekly' | 'SemiMonthly' | 'Monthly';

export const PAYSTUB_EXCLUDE_ROW = new RegExp(rules.excludeRow, 'i');
export const PAYSTUB_BASE_ROW = new RegExp(rules.baseRow, 'i');
export const PAYSTUB_PRIMARY_RATE_ROW = new RegExp(rules.primaryRateRow, 'i');
export const PAYSTUB_BONUS_ROW = new RegExp(rules.bonusRow, 'i');
export const PAYSTUB_OT_ROW = new RegExp(rules.otRow, 'i');
export const PAYSTUB_TIPS_ROW = new RegExp(rules.tipsRow, 'i');
export const PAYSTUB_COMMISSION_ROW = new RegExp(rules.commissionRow, 'i');
export const PAYSTUB_RSU_ROW = new RegExp(rules.rsuRow, 'i');
const NON_WORKED = new RegExp(rules.nonWorked, 'i');
const HOURS_BEFORE_RATE = new RegExp(rules.hoursBeforeRate, 'i');
const FREQ_SEMI_MONTHLY = new RegExp(rules.frequency.semiMonthly, 'i');
const FREQ_BIWEEKLY = new RegExp(rules.frequency.biweekly, 'i');
const FREQ_WEEKLY = new RegExp(rules.frequency.weekly, 'i');
const FREQ_MONTHLY = new RegExp(rules.frequency.monthly, 'i');

export const PAYSTUB_YTD_FIELD_BY_KIND: Record<string, string> = rules.ytdFieldByKind;

export function paystubHoursBeforeRate(text: string): boolean {
  return HOURS_BEFORE_RATE.test(text);
}

export function paystubFrequencyFromDates(text: string): PaystubFrequency | undefined {
  const parsed: Array<{ t: number; raw: string }> = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g)) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const stamp = Date.UTC(year, Number(match[1]) - 1, Number(match[2]));
    if (!Number.isFinite(stamp) || seen.has(match[0])) continue;
    seen.add(match[0]);
    parsed.push({ t: stamp, raw: match[0] });
  }
  if (parsed.length < 2) return undefined;
  parsed.sort((a, b) => a.t - b.t);
  const spanDays = Math.round((parsed[1].t - parsed[0].t) / 86_400_000);
  const [w0, w1] = rules.frequency.weeklySpan;
  const [b0, b1] = rules.frequency.biweeklySpan;
  const [m0, m1] = rules.frequency.monthlySpan;
  if (spanDays >= w0 && spanDays <= w1) return 'Weekly';
  if (spanDays >= b0 && spanDays <= b1) return 'Biweekly';
  if (spanDays >= m0 && spanDays <= m1) return 'Monthly';
  return undefined;
}

export function paystubFrequencyType(text: string): PaystubFrequency | undefined {
  if (FREQ_SEMI_MONTHLY.test(text)) return 'SemiMonthly';
  if (FREQ_BIWEEKLY.test(text)) return 'Biweekly';
  if (FREQ_WEEKLY.test(text)) return 'Weekly';
  if (FREQ_MONTHLY.test(text)) return 'Monthly';
  return paystubFrequencyFromDates(text);
}

export function paystubPaysPerYear(text: string): number | undefined {
  const frequency = paystubFrequencyType(text);
  if (frequency === 'Weekly') return 52;
  if (frequency === 'Biweekly') return 26;
  if (frequency === 'SemiMonthly') return 24;
  if (frequency === 'Monthly') return 12;
  return undefined;
}

export function weeklyHoursFromPeriod(periodHours: number, paysPerYear?: number): number | undefined {
  if (periodHours >= 20 && periodHours <= 50) return periodHours;
  if (paysPerYear) return Math.round((periodHours * paysPerYear) / 52 * 100) / 100;
  return undefined;
}

export function paystubRowKind(label: string): PaystubRowKind | null {
  const stripped = label.replace(/[$,0-9.\-—/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped || PAYSTUB_EXCLUDE_ROW.test(stripped)) return null;
  if (PAYSTUB_OT_ROW.test(label) || PAYSTUB_OT_ROW.test(stripped)) return 'ot';
  if (PAYSTUB_RSU_ROW.test(stripped)) return 'rsu';
  if (PAYSTUB_TIPS_ROW.test(stripped)) return 'tips';
  if (PAYSTUB_COMMISSION_ROW.test(stripped)) return 'commission';
  if (PAYSTUB_BONUS_ROW.test(stripped)) return 'bonus';
  if (PAYSTUB_BASE_ROW.test(stripped)) return 'regular';
  return null;
}

export function isPrimaryRateRow(label: string): boolean {
  return PAYSTUB_PRIMARY_RATE_ROW.test(label) && !NON_WORKED.test(label);
}
