import type { Prisma } from '@prisma/client';
import { ApiError } from '../http/apiError';

export const BORROWER_KEY = /^borrower-[1-9][0-9]{0,2}$/;
const MAX_BORROWERS = 4;

export type BorrowerRole = 'PRIMARY' | 'CO_BORROWER';
export type BorrowerRosterSlot = Readonly<{ borrowerKey: string; role: BorrowerRole }>;
export type PersistedBorrower = Readonly<{ borrowerKey: string; ordinal: number; role: BorrowerRole }>;
export type BorrowerIncomeLine = Readonly<{
  borrowerKey: string;
  ordinal: number;
  role: BorrowerRole;
  qualifyingMonthlyIncome: string;
}>;

const FORBIDDEN_ROSTER_FIELDS = new Set([
  'name', 'borrowerName', 'firstName', 'lastName', 'email', 'ssn', 'taxId', 'dob', 'address', 'phone',
]);

export function readLaunchBorrowers(body: unknown): readonly BorrowerRosterSlot[] | null {
  if (!isRecord(body) || !('borrowers' in body)) return null;
  const value = body.borrowers;
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_BORROWERS) {
    throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'A hosted multi-borrower loan requires an ordered roster of 2 to 4 borrowers.');
  }
  const roster = value.map((item, index) => {
    if (!isRecord(item)) throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'A borrower roster entry is invalid.');
    if (Object.keys(item).some((key) => FORBIDDEN_ROSTER_FIELDS.has(key) || !['borrowerKey', 'role'].includes(key))) {
      throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'Borrower roster entries accept only a stable key and role.');
    }
    if (typeof item.borrowerKey !== 'string' || !BORROWER_KEY.test(item.borrowerKey)) {
      throw new ApiError(400, 'INVALID_BORROWER_KEY', 'Borrower identity must be a stable borrower key.');
    }
    if (item.role !== 'PRIMARY' && item.role !== 'CO_BORROWER') {
      throw new ApiError(400, 'INVALID_BORROWER_ROLE', 'Borrower role must be PRIMARY or CO_BORROWER.');
    }
    if (index === 0 && item.role !== 'PRIMARY') throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'The first roster entry must be the primary borrower.');
    if (index > 0 && item.role !== 'CO_BORROWER') throw new ApiError(400, 'INVALID_BORROWER_ROSTER', 'Only the first roster entry is the primary borrower.');
    return { borrowerKey: item.borrowerKey, role: item.role as BorrowerRole };
  });
  if (new Set(roster.map((item) => item.borrowerKey)).size !== roster.length) {
    throw new ApiError(400, 'DUPLICATE_BORROWER_KEY', 'Each borrower key may appear once.');
  }
  return roster;
}

export async function persistLoanBorrowerRoster(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  loanId: string,
  roster: readonly BorrowerRosterSlot[],
): Promise<readonly PersistedBorrower[]> {
  const existing = await transaction.loanBorrower.findMany({
    where: { tenantId, loanId },
    orderBy: { ordinal: 'asc' },
    select: { borrowerKey: true, ordinal: true, role: true },
  });
  if (existing.length) {
    const same = existing.length === roster.length && existing.every((row, index) =>
      row.borrowerKey === roster[index]?.borrowerKey && row.ordinal === index && row.role === roster[index]?.role);
    if (!same) throw new ApiError(409, 'BORROWER_ROSTER_CONFLICT', 'The loan borrower roster is already established.');
    return existing;
  }
  await transaction.loanBorrower.createMany({
    data: roster.map((borrower, ordinal) => ({
      tenantId, loanId, borrowerKey: borrower.borrowerKey, ordinal, role: borrower.role,
    })),
  });
  return roster.map((borrower, ordinal) => ({ borrowerKey: borrower.borrowerKey, ordinal, role: borrower.role }));
}

export function readBorrowerIncome(value: unknown): BorrowerIncomeLine[] {
  if (!Array.isArray(value)) return [];
  const lines = value.flatMap((item): BorrowerIncomeLine[] => {
    if (!isRecord(item)) return [];
    if (typeof item.borrowerKey !== 'string' || !BORROWER_KEY.test(item.borrowerKey)) return [];
    if (typeof item.ordinal !== 'number' || !Number.isInteger(item.ordinal) || item.ordinal < 0 || item.ordinal > 3) return [];
    if (item.role !== 'PRIMARY' && item.role !== 'CO_BORROWER') return [];
    if (typeof item.qualifyingMonthlyIncome !== 'string' || !/^\d+\.\d{2}$/.test(item.qualifyingMonthlyIncome)) return [];
    return [{
      borrowerKey: item.borrowerKey,
      ordinal: item.ordinal,
      role: item.role,
      qualifyingMonthlyIncome: item.qualifyingMonthlyIncome,
    }];
  });
  return lines.sort((left, right) => left.ordinal - right.ordinal);
}

export function borrowerIncomeFields(lines: readonly BorrowerIncomeLine[]): Record<string, string> {
  return Object.fromEntries(lines.map((line) => [
    `CX.FREEFLOW.BORROWER.${line.ordinal + 1}.INCOME`,
    line.qualifyingMonthlyIncome,
  ]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
