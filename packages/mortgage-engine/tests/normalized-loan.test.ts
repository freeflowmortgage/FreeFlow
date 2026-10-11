import { ZodError } from 'zod';
import {
  FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
  normalizeLoan,
} from '../src/normalizedLoan';

describe('normalizeLoan', () => {
  test('produces one versioned model for ordered borrowers and actual employment', () => {
    expect(normalizeLoan({
      loanProgram: 'CONVENTIONAL',
      borrowers: [
        {
          borrowerKey: 'borrower-1',
          role: 'PRIMARY',
          employment: [
            { employerName: ' Synthetic Employer ', employmentStatus: 'CURRENT', monthlyIncome: '6500' },
            {},
          ],
        },
        { borrowerKey: 'borrower-2', role: 'CO_BORROWER' },
      ],
    })).toEqual({
      schemaVersion: FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
      loanProgram: 'CONVENTIONAL',
      borrowers: [
        {
          borrowerKey: 'borrower-1',
          ordinal: 0,
          role: 'PRIMARY',
          employment: [{ employerName: 'Synthetic Employer', employmentStatus: 'CURRENT', monthlyIncome: '6500.00' }],
        },
        { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' },
      ],
    });
  });

  test('omits empty employment rather than fabricating records', () => {
    expect(normalizeLoan({
      loanProgram: 'FHA',
      borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', employment: [] }],
    }).borrowers[0]).toEqual({ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' });
  });

  test.each([
    { loanProgram: 'CONVENTIONAL', borrowers: [] },
    { loanProgram: 'CONVENTIONAL', borrowers: [{ borrowerKey: 'borrower-2', role: 'PRIMARY' }] },
    { loanProgram: 'CONVENTIONAL', borrowers: [{ borrowerKey: 'borrower-1', role: 'CO_BORROWER' }] },
    { loanProgram: 'CONVENTIONAL', borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', name: 'Not in the core model' }] },
    { loanProgram: 'CONVENTIONAL', borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', employment: [{ monthlyIncome: '-1' }] }] },
  ])('fails closed for a malformed or expanded draft %#', (draft) => {
    expect(() => normalizeLoan(draft as never)).toThrow(ZodError);
  });
});
