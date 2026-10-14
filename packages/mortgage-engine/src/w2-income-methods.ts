import { bonusMonthsCovered, type BonusFrequency } from './bonusTiming';
import type { Form1084BorrowerIncome } from './encompass-urla-map';
import { payPeriodsPerYear, type PayFrequency } from './paystubAnnualization';

/**
 * W-2 base and variable income methods, and each borrower's share of the 1084.
 *
 * This is the math the underwriting console shows on the Wages tab: every
 * employer carries the method the underwriter chose for it, or the guideline
 * recommendation when none was chosen, whether or not that employer is on
 * screen. Callers outside the console (the portal income API, Mortgage-POS)
 * get the same numbers by calling these functions.
 */

export type W2PayFrequency = PayFrequency;
export type W2WageDocSource = 'PAYSTUB' | 'WVOE';
export type W2BaseMethodId = 'hourly' | 'period' | 'ytd' | 'prior' | 'not_used';
export type W2VariableMethodId = 'current' | 'avg24' | 'not_used';

export const W2_INCOME_RULE_VERSION = 'w2-methods-v1';

/** August 15 represents 7.5 elapsed months of the year for the YTD average. */
export const DEFAULT_YTD_MONTHS_ELAPSED = 7.5;

export interface W2EmployerWageInput {
  id: string;
  /** The borrower whose wages these are; unset means the primary borrower. */
  borrowerId?: string;
  payFrequency: W2PayFrequency;
  wageDocSource: W2WageDocSource;
  hourlyRate: number;
  weeklyHours: number;
  currentPeriodBasePay: number;
  baseYtd: number;
  bonusYtd: number;
  overtimeYtd: number;
  tipsYtd: number;
  commissionYtd: number;
  wvoeBonus: number;
  wvoeOvertime: number;
  wvoeMonths: number;
  monthsAtJob: number;
  /** Most recent W-2 Box 5 from this employer, when one was provided. */
  w2Year1Box5: number;
  /**
   * How often this employer pays its bonus. Unset divides the bonus by the
   * same months as overtime; set, the bonus is divided by the months the
   * bonuses paid in that window cover.
   */
  bonusFrequency?: BonusFrequency;
}

/** The previous-employer history on the 1003, which belongs to the primary borrower. */
export interface PriorEmployerWageHistory {
  box5Wages: number;
  box12Bonus: number;
  box14Overtime: number;
}

export interface W2MethodContext {
  /** True when the employer belongs to the primary borrower, so the 1003 previous-employer history applies. */
  ownedByPrimary: boolean;
  priorEmployer?: PriorEmployerWageHistory;
  ytdMonthsElapsed?: number;
}

export interface W2MethodOption<Id extends string> {
  id: Id;
  monthly: number;
}

export interface W2BaseMethods {
  options: W2MethodOption<W2BaseMethodId>[];
  recommendedId: W2BaseMethodId;
  /** Spread between the hourly and YTD methods, as a percent of hourly. */
  maxVariancePct: number;
}

export interface W2VariableMethods {
  options: W2MethodOption<W2VariableMethodId>[];
  recommendedId: W2VariableMethodId;
  /** False for a co-borrower, or when the 1003 has no prior-employer history to add. */
  mergesPriorEmployer: boolean;
  /** Months every current-job variable amount except the bonus is divided by. */
  variableMonths: number;
  /** Months the current-job bonus is divided by; equals `variableMonths` without a bonus frequency. */
  bonusMonths: number;
}

export interface W2MethodChoices {
  base?: string | null;
  variable?: string | null;
}

export interface ChosenW2Income {
  baseMethodId: W2BaseMethodId;
  baseRecommendedId: W2BaseMethodId;
  baseMonthly: number;
  variableMethodId: W2VariableMethodId;
  variableRecommendedId: W2VariableMethodId;
  variableMonthly: number;
}

export function w2BaseMethods(employer: W2EmployerWageInput, context: W2MethodContext): W2BaseMethods {
  const hourly = (employer.hourlyRate * employer.weeklyHours * 52) / 12;
  const period = (employer.currentPeriodBasePay * payPeriodsPerYear(employer.payFrequency)) / 12;
  const ytd = employer.baseYtd / (context.ytdMonthsElapsed ?? DEFAULT_YTD_MONTHS_ELAPSED);
  const priorBox5 = employer.w2Year1Box5 || (context.ownedByPrimary ? context.priorEmployer?.box5Wages ?? 0 : 0);
  const maxVariancePct = Math.abs(((hourly - ytd) / hourly) * 100);
  return {
    options: [
      { id: 'hourly', monthly: hourly },
      { id: 'period', monthly: period },
      { id: 'ytd', monthly: ytd },
      { id: 'prior', monthly: priorBox5 / 12 },
      { id: 'not_used', monthly: 0 },
    ],
    recommendedId: maxVariancePct > 10 ? (hourly <= ytd ? 'hourly' : 'ytd') : 'period',
    maxVariancePct,
  };
}

/** True when the 1003 lists a previous employer with any W-2 wages, bonus or overtime. */
export function hasPriorEmployerHistory(prior: PriorEmployerWageHistory | undefined): boolean {
  return !!prior && (prior.box5Wages > 0 || prior.box12Bonus > 0 || prior.box14Overtime > 0);
}

export function w2VariableMethods(employer: W2EmployerWageInput, context: W2MethodContext): W2VariableMethods {
  const fromWvoe = employer.wageDocSource === 'WVOE';
  const bonus = fromWvoe ? employer.wvoeBonus : employer.bonusYtd;
  const otherVariable = fromWvoe
    ? employer.wvoeOvertime
    : employer.overtimeYtd + employer.tipsYtd + employer.commissionYtd;
  const variableMonths = Math.max(fromWvoe ? employer.wvoeMonths : employer.monthsAtJob, 1);
  const frequency = employer.bonusFrequency;
  const bonusMonths = frequency ? bonusMonthsCovered(variableMonths, frequency) : variableMonths;
  // Without a bonus frequency this is the console's original single division,
  // kept exact so existing files reproduce to the cent.
  const current = frequency
    ? bonus / bonusMonths + otherVariable / variableMonths
    : (bonus + otherVariable) / variableMonths;
  // Without prior history the merge would divide this job's variable pay by
  // 12 months nobody worked, so a primary borrower would get less than an
  // identical co-borrower.
  const mergesPriorEmployer = context.ownedByPrimary && hasPriorEmployerHistory(context.priorEmployer);
  const prior = context.priorEmployer;
  const mergedMonths = employer.monthsAtJob + 12;
  const merged = !mergesPriorEmployer
    ? current
    : frequency
      ? (employer.bonusYtd + (prior?.box12Bonus ?? 0)) / (bonusMonthsCovered(employer.monthsAtJob, frequency) + 12)
        + (employer.overtimeYtd + (prior?.box14Overtime ?? 0)) / mergedMonths
      : (employer.bonusYtd + employer.overtimeYtd + (prior?.box12Bonus ?? 0) + (prior?.box14Overtime ?? 0)) / mergedMonths;
  return {
    options: [
      { id: 'current', monthly: current },
      { id: 'avg24', monthly: merged },
      { id: 'not_used', monthly: 0 },
    ],
    recommendedId: mergesPriorEmployer && employer.monthsAtJob < 12 ? 'avg24' : 'current',
    mergesPriorEmployer,
    variableMonths,
    bonusMonths,
  };
}

function pick<Id extends string>(options: W2MethodOption<Id>[], selected: string | null | undefined, recommendedId: Id) {
  return options.find((option) => option.id === selected) ?? options.find((option) => option.id === recommendedId)!;
}

/** The base and variable monthly income for one employer, using the chosen method or the recommendation. */
export function chosenW2Income(
  employer: W2EmployerWageInput,
  context: W2MethodContext,
  choices: W2MethodChoices = {},
): ChosenW2Income {
  const base = w2BaseMethods(employer, context);
  const variable = w2VariableMethods(employer, context);
  const chosenBase = pick(base.options, choices.base, base.recommendedId);
  const chosenVariable = pick(variable.options, choices.variable, variable.recommendedId);
  return {
    baseMethodId: chosenBase.id,
    baseRecommendedId: base.recommendedId,
    baseMonthly: chosenBase.monthly,
    variableMethodId: chosenVariable.id,
    variableRecommendedId: variable.recommendedId,
    variableMonthly: chosenVariable.monthly,
  };
}

/** True when the employer or business belongs to the first borrower on the 1003. */
export function ownedByPrimaryBorrower(
  owner: { borrowerId?: string },
  borrowers: ReadonlyArray<{ id: string }>,
): boolean {
  return borrowers.length <= 1 || !owner.borrowerId || owner.borrowerId === borrowers[0]?.id;
}

export interface BorrowerIncomeSplitInput {
  /** Borrowers in 1003 order; the first is the primary borrower. */
  borrowers: ReadonlyArray<{ id: string }>;
  w2: ReadonlyArray<{ borrowerId?: string; baseMonthly: number; variableMonthly: number }>;
  selfEmployed: ReadonlyArray<{ borrowerId?: string; monthly: number }>;
  /** Rental and asset income, held jointly and carried once on the primary borrower. */
  jointMonthly: number;
}

/**
 * Each borrower's share of the 1084, so exports write each person's income to
 * their own fields. Income whose owner is not on the list goes to the primary.
 */
export function splitIncomeByBorrower(input: BorrowerIncomeSplitInput): Form1084BorrowerIncome[] {
  const rows = (input.borrowers.length ? input.borrowers : [{ id: '' }]).map((_, borrowerIndex) => ({
    borrowerIndex,
    w2BaseMonthly: 0,
    w2VariableMonthly: 0,
    selfEmployedMonthly: 0,
    qualifyingMonthlyIncome: 0,
  }));
  const rowFor = (borrowerId?: string) =>
    rows[Math.max(0, input.borrowers.findIndex((borrower) => borrower.id === borrowerId))];
  for (const entry of input.w2) {
    rowFor(entry.borrowerId).w2BaseMonthly += entry.baseMonthly;
    rowFor(entry.borrowerId).w2VariableMonthly += entry.variableMonthly;
  }
  for (const entry of input.selfEmployed) {
    rowFor(entry.borrowerId).selfEmployedMonthly += entry.monthly;
  }
  for (const row of rows) {
    row.qualifyingMonthlyIncome = row.w2BaseMonthly + row.w2VariableMonthly + row.selfEmployedMonthly;
  }
  rows[0].qualifyingMonthlyIncome += input.jointMonthly;
  return rows;
}
