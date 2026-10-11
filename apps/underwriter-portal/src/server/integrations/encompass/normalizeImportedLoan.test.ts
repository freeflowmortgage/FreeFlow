import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EncompassConnectorError,
  type EncompassLoanSnapshot,
} from '@mortgage-pos/encompass-connector-contract';
import { FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION } from '@mortgage-pos/mortgage-engine';
import { normalizeEncompassLoanSnapshot } from './normalizeImportedLoan';

const snapshot: EncompassLoanSnapshot = {
  schemaVersion: 'encompass-loan-snapshot-v1',
  sourceSystem: 'ENCOMPASS',
  simulated: true,
  loanGuid: '00000000-0000-4000-8000-000000000200',
  loan: {
    loanProgram: 'CONVENTIONAL',
    loanPurpose: 'PURCHASE',
    requestedAmount: 320_000,
  },
  borrowers: [
    {
      providerBorrowerId: 'provider-borrower-primary',
      role: 'BORROWER',
      givenName: 'Synthetic Primary',
      familyName: 'Borrower',
      employment: [{
        providerEmploymentId: 'provider-employment-primary',
        employerName: 'Synthetic Payroll LLC',
        status: 'CURRENT',
        baseMonthlyIncome: 4_000,
        variableMonthlyIncome: 1_600,
      }],
    },
    {
      providerBorrowerId: 'provider-borrower-secondary',
      role: 'COBORROWER',
      givenName: 'Synthetic Co',
      familyName: 'Borrower',
      employment: [{
        providerEmploymentId: 'provider-employment-secondary',
        employerName: 'Previous Synthetic Employer',
        status: 'PREVIOUS',
      }],
    },
  ],
};

test('maps the authenticated provider order into the shared versioned loan model', () => {
  const normalized = normalizeEncompassLoanSnapshot(snapshot);

  assert.deepEqual(normalized, {
    schemaVersion: FREEFLOW_NORMALIZED_LOAN_SCHEMA_VERSION,
    loanProgram: 'CONVENTIONAL',
    borrowers: [
      {
        borrowerKey: 'borrower-1',
        ordinal: 0,
        role: 'PRIMARY',
        employment: [{
          employerName: 'Synthetic Payroll LLC',
          employmentStatus: 'CURRENT',
          monthlyIncome: '5600.00',
        }],
      },
      {
        borrowerKey: 'borrower-2',
        ordinal: 1,
        role: 'CO_BORROWER',
        employment: [{
          employerName: 'Previous Synthetic Employer',
          employmentStatus: 'PREVIOUS',
        }],
      },
    ],
  });

  const serialized = JSON.stringify(normalized);
  for (const boundaryOnlyValue of [
    snapshot.loanGuid,
    'provider-borrower-primary',
    'provider-employment-primary',
    'Synthetic Primary',
    'ENCOMPASS',
  ]) {
    assert.equal(serialized.includes(boundaryOnlyValue), false);
  }
});

test('fails closed when the provider program is unsupported by the shared model', () => {
  assertNormalizationFailure({
    ...snapshot,
    loan: { ...snapshot.loan, loanProgram: 'OTHER' },
  });
});

test('fails closed for provider ordering or cardinality that cannot preserve borrower roles', () => {
  assertNormalizationFailure({
    ...snapshot,
    borrowers: [snapshot.borrowers[1], snapshot.borrowers[0]],
  });
  assertNormalizationFailure({
    ...snapshot,
    borrowers: Array.from({ length: 5 }, (_, ordinal) => ({
      ...snapshot.borrowers[ordinal === 0 ? 0 : 1],
      providerBorrowerId: `provider-borrower-${ordinal + 1}`,
    })),
  });
});

function assertNormalizationFailure(candidate: EncompassLoanSnapshot): void {
  assert.throws(
    () => normalizeEncompassLoanSnapshot(candidate),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'ENCOMPASS_LOAN_NORMALIZATION_INVALID'
      && error.retryable === false,
  );
}
