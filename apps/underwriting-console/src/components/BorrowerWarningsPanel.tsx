import { AlertTriangle, Users } from 'lucide-react';
import type { LoanBorrower } from '../borrowers';
import type { BorrowerWarning } from '../locateIncomeEntities';

/**
 * Who is on the loan, and every document whose person is not one of them.
 * An unidentified document's income stays out of the 1084 and the Encompass
 * export until the underwriter assigns it to a borrower here.
 */
export default function BorrowerWarningsPanel({
  borrowers,
  warnings,
  onAssign,
  assignmentLockedMessage,
  onOpenAuthoritativeReview,
}: {
  borrowers: LoanBorrower[];
  warnings: BorrowerWarning[];
  onAssign: (assignmentKey: string, borrowerId: string, personName?: string) => void;
  assignmentLockedMessage?: string;
  onOpenAuthoritativeReview?: () => void;
}) {
  if (borrowers.length <= 1 && !warnings.length) return null;
  const fromDocuments = borrowers.some((borrower) => borrower.fromDocuments);

  return (
    <section data-testid="borrower-panel" className="shrink-0 space-y-1.5 border-b border-slate-200 bg-white px-4 py-2">
      {borrowers.length ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {fromDocuments ? 'People on the documents' : 'Borrowers on the 1003'}
          </span>
          {borrowers.map((borrower) => (
            <span
              key={borrower.id}
              data-testid="borrower-chip"
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-bold text-indigo-800"
            >
              {borrower.name}
              <span className="ml-1 font-semibold opacity-70">
                {borrower.role === 'Borrower' ? 'Borrower' : 'Co-borrower'}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {warnings.map((warning) => (
        <div
          key={`${warning.code}:${warning.assignmentKey ?? warning.message}`}
          data-testid={warning.code === 'UNIDENTIFIED_BORROWER' ? 'unidentified-borrower-warning' : 'borrower-warning'}
          className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-semibold ${
            warning.code === 'UNIDENTIFIED_BORROWER'
              ? 'border-rose-200 bg-rose-50 text-rose-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{warning.message}</span>
          {warning.code === 'UNIDENTIFIED_BORROWER' && warning.assignmentKey && borrowers.length && assignmentLockedMessage ? (
            <button
              type="button"
              onClick={onOpenAuthoritativeReview}
              className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-900"
            >
              {assignmentLockedMessage}
            </button>
          ) : warning.code === 'UNIDENTIFIED_BORROWER' && warning.assignmentKey && borrowers.length ? (
            <select
              aria-label="Assign document to a borrower"
              data-testid="assign-borrower"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onAssign(warning.assignmentKey!, event.target.value, warning.personName);
              }}
              className="rounded border border-rose-300 bg-white px-2 py-1 text-[11px] font-bold text-rose-900"
            >
              <option value="">Assign to borrower…</option>
              {borrowers.map((borrower) => (
                <option key={borrower.id} value={borrower.id}>
                  {borrower.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ))}
    </section>
  );
}
