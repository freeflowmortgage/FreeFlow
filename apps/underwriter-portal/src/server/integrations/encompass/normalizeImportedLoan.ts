import {
  EncompassConnectorError,
  type EncompassLoanSnapshot,
} from '@mortgage-pos/encompass-connector-contract';
import {
  normalizeLoan,
  type FreeFlowNormalizedLoan,
  type NormalizedLoanDraft,
} from '@mortgage-pos/mortgage-engine';

/**
 * Converts the authenticated Encompass boundary projection into the shared,
 * LOS-independent calculation model. Provider identifiers, borrower names,
 * the loan GUID, and connector provenance intentionally remain at the boundary.
 */
export function normalizeEncompassLoanSnapshot(
  snapshot: EncompassLoanSnapshot,
): FreeFlowNormalizedLoan {
  if (
    snapshot.schemaVersion !== 'encompass-loan-snapshot-v1'
    || snapshot.sourceSystem !== 'ENCOMPASS'
    || snapshot.loan.loanProgram === 'OTHER'
  ) {
    throw normalizationError();
  }

  try {
    const borrowers: NormalizedLoanDraft['borrowers'] = snapshot.borrowers.map((borrower, ordinal) => ({
      borrowerKey: `borrower-${ordinal + 1}`,
      role: borrower.role === 'BORROWER' ? 'PRIMARY' : 'CO_BORROWER',
      employment: borrower.employment.map((employment) => {
        const hasIncome = employment.baseMonthlyIncome !== undefined
          || employment.variableMonthlyIncome !== undefined;
        return {
          employerName: employment.employerName,
          employmentStatus: employment.status,
          ...(hasIncome
            ? { monthlyIncome: (employment.baseMonthlyIncome ?? 0) + (employment.variableMonthlyIncome ?? 0) }
            : {}),
        };
      }),
    }));

    return normalizeLoan({
      loanProgram: snapshot.loan.loanProgram,
      borrowers,
    });
  } catch {
    throw normalizationError();
  }
}

function normalizationError(): EncompassConnectorError {
  return new EncompassConnectorError(
    'ENCOMPASS_LOAN_NORMALIZATION_INVALID',
    'The imported loan cannot be normalized for income analysis.',
    false,
  );
}
