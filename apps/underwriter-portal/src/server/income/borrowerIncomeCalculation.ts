import Decimal from 'decimal.js';
import { calculateUnifiedIncome, type LoanProgram, type UnifiedIncomeCalculationPayload } from '@mortgage-pos/mortgage-engine';
import type { BorrowerIncomeLine, PersistedBorrower } from './loanBorrowerRoster';

type Form1084Input = Omit<UnifiedIncomeCalculationPayload, 'loanProgram'>;
type Form1084Result = ReturnType<typeof calculateUnifiedIncome>;

export type BorrowerCalculation = Readonly<{
  qualifyingMonthlyIncome: number;
  trendingResult: string;
  yearsAnalyzed: readonly number[];
  borrowerIncome: readonly BorrowerIncomeLine[];
  slices: readonly Form1084Result[];
}>;

export function calculateProtectedBorrowerIncome(
  loanProgram: Exclude<LoanProgram, 'USDA'>,
  roster: readonly PersistedBorrower[],
  input: Form1084Input,
  borrowerKeyByEntityId: ReadonlyMap<string, string>,
): BorrowerCalculation {
  assertEveryRowAssigned(input, roster, borrowerKeyByEntityId);
  const slices = roster.map((borrower) => {
    const slice = sliceInput(input, borrower.borrowerKey, borrowerKeyByEntityId);
    if (!hasRows(slice)) return null;
    return calculateUnifiedIncome({ ...slice, loanProgram });
  });
  const populated = slices.filter((item): item is Form1084Result => item !== null);
  const qualifying = populated.reduce(
    (total, item) => total.plus(item.summary.qualifyingMonthlyIncome),
    new Decimal(0),
  ).toDecimalPlaces(2);
  const borrowerIncome = roster.map((borrower, index) => ({
    borrowerKey: borrower.borrowerKey,
    ordinal: borrower.ordinal,
    role: borrower.role,
    qualifyingMonthlyIncome: new Decimal(slices[index]?.summary.qualifyingMonthlyIncome ?? 0).toDecimalPlaces(2).toFixed(2),
  }));
  const summed = borrowerIncome.reduce((total, line) => total.plus(line.qualifyingMonthlyIncome), new Decimal(0)).toDecimalPlaces(2);
  if (!summed.equals(qualifying)) {
    throw new Error('BORROWER_INCOME_SUM_MISMATCH');
  }
  const trending = new Set(populated.map((item) => item.summary.trendingResult));
  const years = [...new Set(populated.flatMap((item) => item.summary.yearsAnalyzed))].sort((left, right) => right - left);
  return {
    qualifyingMonthlyIncome: qualifying.toNumber(),
    trendingResult: trending.size === 1 ? [...trending][0] : 'INSUFFICIENT_DATA',
    yearsAnalyzed: years,
    borrowerIncome,
    slices: populated,
  };
}

function assertEveryRowAssigned(
  input: Form1084Input,
  roster: readonly PersistedBorrower[],
  borrowerKeyByEntityId: ReadonlyMap<string, string>,
): void {
  const allowed = new Set(roster.map((borrower) => borrower.borrowerKey));
  for (const value of Object.values(input)) {
    if (!Array.isArray(value)) continue;
    for (const row of value) {
      const entityId = isRecord(row) && typeof row.entityId === 'string' ? row.entityId : null;
      const borrowerKey = entityId ? borrowerKeyByEntityId.get(entityId) : undefined;
      if (!entityId || !borrowerKey || !allowed.has(borrowerKey)) throw new Error('UNASSIGNED_INCOME_ENTITY');
    }
  }
}

function sliceInput(input: Form1084Input, borrowerKey: string, borrowerKeyByEntityId: ReadonlyMap<string, string>): Form1084Input {
  const sliced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Array.isArray(value)) {
      sliced[key] = value;
      continue;
    }
    sliced[key] = value.filter((row) => {
      if (!isRecord(row) || typeof row.entityId !== 'string') return false;
      return borrowerKeyByEntityId.get(row.entityId) === borrowerKey;
    });
  }
  return sliced as Form1084Input;
}

function hasRows(input: Form1084Input): boolean {
  return Object.values(input).some((value) => Array.isArray(value) && value.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
