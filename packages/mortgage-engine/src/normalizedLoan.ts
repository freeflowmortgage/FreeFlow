import Decimal from 'decimal.js';
import { z } from 'zod';

export const FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION = 'freeflow-normalized-loan-v1' as const;

export type FreeFlowLoanProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
export type FreeFlowBorrowerRole = 'PRIMARY' | 'CO_BORROWER';
export type FreeFlowEmploymentStatus = 'CURRENT' | 'PREVIOUS';

export type FreeFlowNormalizedEmployment = Readonly<{
  employerName?: string;
  employmentStatus?: FreeFlowEmploymentStatus;
  monthlyIncome?: string;
}>;

export type FreeFlowNormalizedBorrower = Readonly<{
  borrowerKey: string;
  ordinal: number;
  role: FreeFlowBorrowerRole;
  employment?: readonly FreeFlowNormalizedEmployment[];
}>;

export type FreeFlowNormalizedLoan = Readonly<{
  schemaVersion: typeof FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION;
  loanProgram: FreeFlowLoanProgram;
  borrowers: readonly FreeFlowNormalizedBorrower[];
}>;

export type NormalizedLoanDraft = Readonly<{
  loanProgram: FreeFlowLoanProgram;
  borrowers: readonly Readonly<{
    borrowerKey: string;
    role: FreeFlowBorrowerRole;
    employment?: readonly Readonly<{
      employerName?: string;
      employmentStatus?: FreeFlowEmploymentStatus;
      monthlyIncome?: string | number;
    }>[];
  }>[];
}>;

const moneySchema = z.union([
  z.number().finite().nonnegative().max(999_999_999_999.99),
  z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'Monthly income must be a non-negative decimal with at most two decimal places.'),
]).transform((value) => new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));

const employmentSchema = z.object({
  employerName: z.string().trim().min(1).max(255).optional(),
  employmentStatus: z.enum(['CURRENT', 'PREVIOUS']).optional(),
  monthlyIncome: moneySchema.optional(),
}).strict();

const draftSchema = z.object({
  loanProgram: z.enum(['CONVENTIONAL', 'FHA', 'VA', 'USDA']),
  borrowers: z.array(z.object({
    borrowerKey: z.string().regex(/^borrower-[1-4]$/),
    role: z.enum(['PRIMARY', 'CO_BORROWER']),
    employment: z.array(employmentSchema).max(20).optional(),
  }).strict()).min(1).max(4),
}).strict().superRefine((value, context) => {
  value.borrowers.forEach((borrower, ordinal) => {
    const expectedKey = `borrower-${ordinal + 1}`;
    if (borrower.borrowerKey !== expectedKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['borrowers', ordinal, 'borrowerKey'],
        message: `Borrower keys must be ordered from borrower-1; expected ${expectedKey}.`,
      });
    }
    const expectedRole = ordinal === 0 ? 'PRIMARY' : 'CO_BORROWER';
    if (borrower.role !== expectedRole) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['borrowers', ordinal, 'role'],
        message: ordinal === 0 ? 'The first borrower must be PRIMARY.' : 'Only the first borrower may be PRIMARY.',
      });
    }
  });
});

/**
 * Builds the LOS-independent, versioned loan shape consumed by core workflows.
 * Provider identifiers and provenance deliberately remain outside this model.
 */
export function normalizeLoan(input: NormalizedLoanDraft): FreeFlowNormalizedLoan {
  const parsed = draftSchema.parse(input);
  return {
    schemaVersion: FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
    loanProgram: parsed.loanProgram,
    borrowers: parsed.borrowers.map((borrower, ordinal) => {
      const employment = borrower.employment?.filter((entry) => (
        entry.employerName !== undefined
        || entry.employmentStatus !== undefined
        || entry.monthlyIncome !== undefined
      ));
      return {
        borrowerKey: borrower.borrowerKey,
        ordinal,
        role: borrower.role,
        ...(employment?.length ? { employment } : {}),
      };
    }),
  };
}
