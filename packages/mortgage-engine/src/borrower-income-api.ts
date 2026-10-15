import { z } from 'zod';
import { BONUS_FREQUENCIES } from './bonusTiming';
import type { Form1084BorrowerIncome } from './encompass-urla-map';
import {
  W2_INCOME_RULE_VERSION,
  chosenW2Income,
  ownedByPrimaryBorrower,
  splitIncomeByBorrower,
  w2BaseMethods,
  type ChosenW2Income,
  type PriorEmployerWageHistory,
  type W2BaseMethodId,
  type W2EmployerWageInput,
  type W2VariableMethodId,
} from './w2-income-methods';

/**
 * Request and response contract for the per-borrower income calculation that
 * other systems (the portal income API, Mortgage-POS) call. Amounts are monthly
 * except the YTD, W-2 and WVOE figures, which are as reported on the document.
 */

export const BORROWER_INCOME_SCHEMA_VERSION = 'borrower-income-v1';

const amount = z.number().finite().min(0).max(1_000_000_000);
const months = z.number().finite().min(0).max(600);
const id = z.string().trim().min(1).max(100);

export const W2EmployerRequestSchema = z.object({
  id,
  borrowerId: id.optional(),
  employerName: z.string().trim().max(200).optional(),
  payFrequency: z.enum(['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY']).default('SEMIMONTHLY'),
  wageDocSource: z.enum(['PAYSTUB', 'WVOE']).default('PAYSTUB'),
  hourlyRate: amount.default(0),
  weeklyHours: z.number().finite().min(0).max(168).default(0),
  currentPeriodBasePay: amount.default(0),
  baseYtd: amount.default(0),
  bonusYtd: amount.default(0),
  overtimeYtd: amount.default(0),
  tipsYtd: amount.default(0),
  commissionYtd: amount.default(0),
  wvoeBonus: amount.default(0),
  wvoeOvertime: amount.default(0),
  wvoeMonths: months.default(0),
  monthsAtJob: months.default(12),
  w2Year1Box5: amount.default(0),
  /** How often the employer pays its bonus; omitted divides the bonus like overtime. */
  bonusFrequency: z.enum(BONUS_FREQUENCIES).optional(),
  /** The underwriter's method; omitted means the guideline recommendation. */
  baseMethod: z.enum(['hourly', 'period', 'ytd', 'prior', 'not_used']).optional(),
  variableMethod: z.enum(['current', 'avg24', 'not_used']).optional(),
}).strict();

export const SelfEmployedIncomeRequestSchema = z.object({
  id,
  borrowerId: id.optional(),
  kind: z.enum(['SCHEDULE_C', 'FORM_1120S', 'FORM_1065', 'FORM_1120', 'SCHEDULE_F']),
  businessName: z.string().trim().max(200).optional(),
  /** Qualifying monthly cash flow already calculated for this business. */
  monthly: z.number().finite().min(-1_000_000_000).max(1_000_000_000),
}).strict();

export const BorrowerIncomeRequestSchema = z.object({
  /** Borrowers in 1003 order; the first is the primary borrower. */
  borrowers: z.array(z.object({ id, name: z.string().trim().max(200).optional() }).strict()).min(1).max(10),
  w2Employers: z.array(W2EmployerRequestSchema).max(20).default([]),
  /** The primary borrower's previous employer from the 1003. */
  priorEmployer: z.object({
    box5Wages: amount.default(0),
    box12Bonus: amount.default(0),
    box14Overtime: amount.default(0),
  }).strict().optional(),
  selfEmployed: z.array(SelfEmployedIncomeRequestSchema).max(20).default([]),
  rentalMonthly: z.number().finite().min(-1_000_000_000).max(1_000_000_000).default(0),
  assetIncomeMonthly: amount.default(0),
  ytdMonthsElapsed: z.number().finite().min(0.5).max(12).optional(),
}).strict().superRefine((request, issue) => {
  const borrowerIds = new Set(request.borrowers.map((borrower) => borrower.id));
  if (borrowerIds.size !== request.borrowers.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ['borrowers'], message: 'Borrower ids must be unique.' });
  }
  const ownerPaths: Array<[string | undefined, (string | number)[]]> = [
    ...request.w2Employers.map((entry, index) => [entry.borrowerId, ['w2Employers', index, 'borrowerId']] as [string | undefined, (string | number)[]]),
    ...request.selfEmployed.map((entry, index) => [entry.borrowerId, ['selfEmployed', index, 'borrowerId']] as [string | undefined, (string | number)[]]),
  ];
  for (const [owner, path] of ownerPaths) {
    if (owner !== undefined && !borrowerIds.has(owner)) {
      issue.addIssue({ code: z.ZodIssueCode.custom, path, message: 'borrowerId must name a borrower on the request.' });
    }
  }
  const incomeIds = [...request.w2Employers, ...request.selfEmployed].map((entry) => entry.id);
  if (new Set(incomeIds).size !== incomeIds.length) {
    issue.addIssue({ code: z.ZodIssueCode.custom, path: ['w2Employers'], message: 'Employer and business ids must be unique.' });
  }
});

type W2EmployerRequestDefaults =
  | 'payFrequency' | 'wageDocSource' | 'hourlyRate' | 'weeklyHours' | 'currentPeriodBasePay' | 'baseYtd'
  | 'bonusYtd' | 'overtimeYtd' | 'tipsYtd' | 'commissionYtd' | 'wvoeBonus' | 'wvoeOvertime' | 'wvoeMonths'
  | 'monthsAtJob' | 'w2Year1Box5';

/** One W-2 employer after validation. Written out because the engine compiles without strict null checks. */
export interface ParsedW2EmployerRequest extends W2EmployerWageInput {
  employerName?: string;
  baseMethod?: W2BaseMethodId;
  variableMethod?: W2VariableMethodId;
}

export interface SelfEmployedIncomeRequest {
  id: string;
  borrowerId?: string;
  kind: 'SCHEDULE_C' | 'FORM_1120S' | 'FORM_1065' | 'FORM_1120' | 'SCHEDULE_F';
  businessName?: string;
  monthly: number;
}

export interface ParsedBorrowerIncomeRequest {
  borrowers: Array<{ id: string; name?: string }>;
  w2Employers: ParsedW2EmployerRequest[];
  priorEmployer?: PriorEmployerWageHistory;
  selfEmployed: SelfEmployedIncomeRequest[];
  rentalMonthly: number;
  assetIncomeMonthly: number;
  ytdMonthsElapsed?: number;
}

/** The request as callers send it; fields with defaults may be omitted. */
export interface BorrowerIncomeRequest {
  borrowers: ParsedBorrowerIncomeRequest['borrowers'];
  w2Employers?: Array<Omit<ParsedW2EmployerRequest, W2EmployerRequestDefaults> & Partial<Pick<ParsedW2EmployerRequest, W2EmployerRequestDefaults>>>;
  priorEmployer?: Partial<PriorEmployerWageHistory>;
  selfEmployed?: SelfEmployedIncomeRequest[];
  rentalMonthly?: number;
  assetIncomeMonthly?: number;
  ytdMonthsElapsed?: number;
}

export function parseBorrowerIncomeRequest(request: unknown): ParsedBorrowerIncomeRequest {
  return BorrowerIncomeRequestSchema.parse(request) as ParsedBorrowerIncomeRequest;
}

/**
 * The recommended base method came out to zero while another method did not,
 * usually because a salaried stub has no hourly rate or hours. The console
 * recommends the same zero, so callers must review rather than rely on it.
 */
export const W2_RECOMMENDED_BASE_ZERO = 'W2_RECOMMENDED_BASE_ZERO';

export type BorrowerIncomeEmployerWarning = typeof W2_RECOMMENDED_BASE_ZERO;

export interface BorrowerIncomeEmployerResult extends ChosenW2Income {
  id: string;
  borrowerId: string;
  employerName?: string;
  warnings: BorrowerIncomeEmployerWarning[];
}

export interface BorrowerIncomeRow extends Form1084BorrowerIncome {
  borrowerId: string;
  name?: string;
}

export interface BorrowerIncomeResult {
  schemaVersion: typeof BORROWER_INCOME_SCHEMA_VERSION;
  ruleVersion: typeof W2_INCOME_RULE_VERSION;
  borrowers: BorrowerIncomeRow[];
  employers: BorrowerIncomeEmployerResult[];
  totals: {
    w2BaseMonthly: number;
    w2VariableMonthly: number;
    selfEmployedMonthly: number;
    rentalMonthly: number;
    assetIncomeMonthly: number;
    qualifyingMonthlyIncome: number;
  };
}

/** Validate the request and return each borrower's qualifying monthly income. Throws `ZodError` on bad input. */
export function calculateBorrowerIncome(request: BorrowerIncomeRequest): BorrowerIncomeResult {
  const parsed = parseBorrowerIncomeRequest(request);
  const primaryId = parsed.borrowers[0].id;
  const employers: BorrowerIncomeEmployerResult[] = parsed.w2Employers.map((employer) => {
    const context = {
      ownedByPrimary: ownedByPrimaryBorrower(employer, parsed.borrowers),
      priorEmployer: parsed.priorEmployer,
      ytdMonthsElapsed: parsed.ytdMonthsElapsed,
    };
    const chosen = chosenW2Income(employer, context, { base: employer.baseMethod, variable: employer.variableMethod });
    const warnings: BorrowerIncomeEmployerWarning[] = [];
    if (
      !employer.baseMethod
      && chosen.baseMonthly === 0
      && w2BaseMethods(employer, context).options.some((option) => option.monthly > 0)
    ) {
      warnings.push(W2_RECOMMENDED_BASE_ZERO);
    }
    return {
      id: employer.id,
      borrowerId: employer.borrowerId ?? primaryId,
      ...(employer.employerName ? { employerName: employer.employerName } : {}),
      ...chosen,
      warnings,
    };
  });
  const rows = splitIncomeByBorrower({
    borrowers: parsed.borrowers,
    w2: employers.map((employer) => ({
      borrowerId: employer.borrowerId,
      baseMonthly: employer.baseMonthly,
      variableMonthly: employer.variableMonthly,
    })),
    selfEmployed: parsed.selfEmployed,
    jointMonthly: parsed.rentalMonthly + parsed.assetIncomeMonthly,
  });
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    schemaVersion: BORROWER_INCOME_SCHEMA_VERSION,
    ruleVersion: W2_INCOME_RULE_VERSION,
    borrowers: rows.map((row) => ({
      ...row,
      borrowerId: parsed.borrowers[row.borrowerIndex].id,
      ...(parsed.borrowers[row.borrowerIndex].name ? { name: parsed.borrowers[row.borrowerIndex].name } : {}),
    })),
    employers,
    totals: {
      w2BaseMonthly: sum(employers.map((employer) => employer.baseMonthly)),
      w2VariableMonthly: sum(employers.map((employer) => employer.variableMonthly)),
      selfEmployedMonthly: sum(parsed.selfEmployed.map((entry) => entry.monthly)),
      rentalMonthly: parsed.rentalMonthly,
      assetIncomeMonthly: parsed.assetIncomeMonthly,
      qualifyingMonthlyIncome: sum(rows.map((row) => row.qualifyingMonthlyIncome)),
    },
  };
}
