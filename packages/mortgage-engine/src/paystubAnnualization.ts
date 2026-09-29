import { Decimal } from 'decimal.js';

/**
 * Port of the console four-way base reconciliation in
 * `apps/underwriting-console/src/components/UnderwriterSplitViewDemo.tsx`:
 * `payPeriodsPerYear`, `baseWageReconciliation`, and `w2BaseMonthlyOf`
 * (around the "4-Way Base Wage Reconciliation" block).
 *
 * Hourly monthly = (hourlyRate * weeklyHours * 52) / 12
 * Period monthly = (currentPeriodBasePay * periodsPerYear) / 12
 *   WEEKLY 52, BIWEEKLY 26, MONTHLY 12, otherwise 24
 * YTD monthly = amount / elapsedMonths
 *   The demo divides by a hardcoded 7.5 for an August 15 stub. This module
 *   uses the reviewed elapsedMonths argument instead of that constant.
 *   YTD dollars are never used as the annual wage.
 * Prior monthly = priorYearW2Wages / 12
 * When no base method is selected, `w2BaseMonthlyOf` recommends the lower of
 * hourly and YTD when |hourly - ytd| / hourly * 100 is greater than 10,
 * otherwise the period method.
 *
 * Bonus, overtime, tips, and commission follow `w2VariableMonthlyOf` and
 * `variableContinuityCalculations`: each year-to-date amount divided by
 * elapsed months. RSU and other use that same division on parser fields
 * `ps-rsu-ytd` and `ps-other-ytd`. The demo variable total does not include
 * RSU or other, so those two components are not a cited console total.
 *
 * Ben's 10 paystub rules are not in this file. A gap leaves status GAPS, and
 * the protected path keeps `unsupportedCalculation`.
 */

export type PayFrequency = 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
export type PaystubBaseMethod = 'hourly' | 'period' | 'ytd' | 'prior';

export type PaystubAnnualizationInput = Readonly<{
  hourlyRate?: number;
  weeklyHours?: number;
  currentPeriodBasePay?: number;
  payFrequency?: PayFrequency;
  baseYtd?: number;
  overtimeYtd?: number;
  bonusYtd?: number;
  commissionYtd?: number;
  tipsYtd?: number;
  rsuYtd?: number;
  otherYtd?: number;
  elapsedMonths?: number;
  priorYearW2Wages?: number;
  baseMethod?: PaystubBaseMethod;
}>;

export type PaystubComponentMonthly = Readonly<{
  base: number;
  overtime: number;
  bonus: number;
  commission: number;
  tips: number;
  rsu: number;
  other: number;
}>;

export type PaystubAnnualization = Readonly<{
  status: 'READY' | 'GAPS';
  gaps: readonly string[];
  selectedBaseMethod: PaystubBaseMethod | null;
  monthlyBase: number;
  monthlyVariable: number;
  annualBase: number;
  annualVariable: number;
  components: PaystubComponentMonthly;
  methods: Readonly<{ hourly: number | null; period: number | null; ytd: number | null; prior: number | null }>;
}>;

export function payPeriodsPerYear(frequency: PayFrequency): number {
  if (frequency === 'WEEKLY') return 52;
  if (frequency === 'BIWEEKLY') return 26;
  if (frequency === 'MONTHLY') return 12;
  return 24;
}

export function parsePayFrequency(value: string | undefined): PayFrequency | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  if (normalized.includes('BI')) return 'BIWEEKLY';
  if (normalized.includes('SEMI') || normalized.includes('24')) return 'SEMIMONTHLY';
  if (normalized.includes('WEEK')) return 'WEEKLY';
  if (normalized.includes('MONTH')) return 'MONTHLY';
  return undefined;
}

export function annualizePaystub(input: PaystubAnnualizationInput): PaystubAnnualization {
  const gaps: string[] = [];
  const elapsed = input.elapsedMonths;
  const elapsedOk = typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed > 0 && elapsed <= 12;
  const ytdMonthly = (amount: number | undefined): number | null => {
    if (amount == null) return null;
    if (!elapsedOk) return null;
    return new Decimal(amount).div(elapsed as number).toDecimalPlaces(2).toNumber();
  };
  const usesYtd = [input.baseYtd, input.overtimeYtd, input.bonusYtd, input.commissionYtd, input.tipsYtd, input.rsuYtd, input.otherYtd]
    .some((amount) => typeof amount === 'number' && amount !== 0);
  if (usesYtd && !elapsedOk) gaps.push('ELAPSED_MONTHS_REQUIRED');

  const hourly = input.hourlyRate != null && input.weeklyHours != null
    ? new Decimal(input.hourlyRate).mul(input.weeklyHours).mul(52).div(12).toDecimalPlaces(2).toNumber()
    : null;
  const period = input.currentPeriodBasePay != null && input.payFrequency
    ? new Decimal(input.currentPeriodBasePay).mul(payPeriodsPerYear(input.payFrequency)).div(12).toDecimalPlaces(2).toNumber()
    : null;
  const ytd = ytdMonthly(input.baseYtd);
  const prior = input.priorYearW2Wages != null
    ? new Decimal(input.priorYearW2Wages).div(12).toDecimalPlaces(2).toNumber()
    : null;
  const methods = { hourly, period, ytd, prior };
  const available = (Object.entries(methods) as Array<[PaystubBaseMethod, number | null]>).filter(([, value]) => value != null);
  let selected: PaystubBaseMethod | null = null;
  if (input.baseMethod) {
    selected = methods[input.baseMethod] == null ? null : input.baseMethod;
    if (!selected) gaps.push(input.baseMethod === 'prior' ? 'PRIOR_W2_UNAVAILABLE' : 'BASE_METHOD_UNAVAILABLE');
  } else if (available.length) {
    const variance = hourly != null && ytd != null && hourly !== 0
      ? Math.abs(((hourly - ytd) / hourly) * 100)
      : null;
    const recommended: PaystubBaseMethod = variance != null && variance > 10
      ? (hourly! <= ytd! ? 'hourly' : 'ytd')
      : period != null ? 'period' : (hourly != null ? 'hourly' : (ytd != null ? 'ytd' : 'prior'));
    selected = methods[recommended] == null ? available[0][0] : recommended;
  } else {
    gaps.push('NO_BASE_METHOD');
  }

  const components: PaystubComponentMonthly = {
    base: selected ? methods[selected] ?? 0 : 0,
    overtime: ytdMonthly(input.overtimeYtd) ?? 0,
    bonus: ytdMonthly(input.bonusYtd) ?? 0,
    commission: ytdMonthly(input.commissionYtd) ?? 0,
    tips: ytdMonthly(input.tipsYtd) ?? 0,
    rsu: ytdMonthly(input.rsuYtd) ?? 0,
    other: ytdMonthly(input.otherYtd) ?? 0,
  };
  const monthlyVariable = new Decimal(components.overtime).add(components.bonus).add(components.commission)
    .add(components.tips).add(components.rsu).add(components.other).toDecimalPlaces(2).toNumber();
  const ready = gaps.length === 0 && selected != null;
  const monthlyBase = ready ? components.base : 0;
  return {
    status: ready ? 'READY' : 'GAPS',
    gaps,
    selectedBaseMethod: ready ? selected : null,
    monthlyBase,
    monthlyVariable: ready ? monthlyVariable : 0,
    annualBase: new Decimal(monthlyBase).mul(12).toDecimalPlaces(2).toNumber(),
    annualVariable: new Decimal(ready ? monthlyVariable : 0).mul(12).toDecimalPlaces(2).toNumber(),
    components,
    methods,
  };
}
