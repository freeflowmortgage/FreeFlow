import { useState } from 'react';
import { AlertTriangle, FileSearch, Info } from 'lucide-react';
import type { ReviewNote } from '../parseTypes';

/**
 * Shared controls for the wage panel.
 *
 * Two problems these exist to solve. A figure the parser never located used to
 * render as `0`, indistinguishable from a verified zero, which is the kind of
 * thing that reaches a decision unnoticed. And the parser's warnings were
 * computed and discarded, so an excluded earning code was invisible.
 */

export function formatMoney(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type MoneyFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Source id used for the document highlight, e.g. `ps-base-ytd`. */
  fieldId?: string;
  onInspect?: (fieldId: string) => void;
  highlighted?: boolean;
  /** False when a document is loaded but this figure was not found on it. */
  extracted?: boolean;
  /** Rate fields carry four decimals; money carries two. */
  decimals?: number;
  hint?: string;
};

export function MoneyField({
  label,
  value,
  onChange,
  fieldId,
  onInspect,
  highlighted = false,
  extracted,
  decimals = 2,
  hint,
}: MoneyFieldProps) {
  const clickable = Boolean(fieldId && onInspect);
  const missing = extracted === false;

  // While the field has focus the raw keystrokes are shown, and the formatted
  // value returns on blur. Reformatting on every keystroke fights the typist:
  // the controlled value is rewritten mid-entry and the caret jumps to the
  // end, so typing "250" over an existing figure lands as "2.00".
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (missing ? '' : formatMoney(value, decimals));

  return (
    <div
      data-qa-field={fieldId}
      className={`rounded-md p-1 ${clickable ? 'cursor-pointer' : ''} ${
        highlighted ? 'ring-2 ring-emerald-500' : ''
      }`}
      onClick={clickable ? () => onInspect!(fieldId!) : undefined}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-[11px] font-semibold text-slate-600">{label}</label>
        {clickable && (
          <span
            className="flex items-center gap-1 text-[10px] font-medium text-slate-400"
            title="Show where this came from on the document"
          >
            <FileSearch className="h-3 w-3" />
            Source
          </span>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={missing ? 'Not found on document' : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
          onChange(Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : 0);
        }}
        onBlur={() => setDraft(null)}
        // The input covers most of the row, so it must not swallow the click:
        // showing where a figure came from is the point of the panel, and it
        // costs nothing to do that while the field also takes focus for edits.
        onFocus={clickable ? () => onInspect!(fieldId!) : undefined}
        className={`w-full rounded border p-2 font-semibold tabular-nums focus:border-indigo-500 focus:outline-none ${
          missing
            ? 'border-dashed border-amber-300 bg-amber-50 text-slate-900 placeholder:font-normal placeholder:text-amber-700'
            : 'border-slate-300'
        }`}
      />
      {missing && (
        <p className="mt-1 text-[10px] text-amber-700">
          Not on the document. Enter it manually or supply another stub.
        </p>
      )}
      {!missing && hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * Everything the parser flagged about the documents behind this panel.
 *
 * Warnings mean a value was excluded or could not be trusted; info notes are
 * disclosures the underwriter has to confirm, such as shift differential being
 * reported inside overtime.
 */
export function ReviewNotesPanel({ notes }: { notes: ReviewNote[] }) {
  if (notes.length === 0) return null;

  const warnings = notes.filter((note) => note.severity === 'warning').length;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
      <header className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <h4 className="text-xs font-bold tracking-wide text-amber-900">
          Needs review
        </h4>
        <span className="text-[10px] font-semibold text-amber-700">
          {warnings > 0
            ? `${warnings} of ${notes.length} affect the totals above`
            : `${notes.length} to confirm`}
        </span>
      </header>
      <ul className="space-y-2">
        {notes.map((note) => (
          <li key={note.message} className="flex gap-2 text-[11px] leading-relaxed">
            {note.severity === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
            ) : (
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-600" />
            )}
            <span className={note.severity === 'warning' ? 'text-amber-900' : 'text-slate-700'}>
              {note.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
