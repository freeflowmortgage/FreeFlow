import { useEffect, useMemo, useState } from 'react';
import type { LiveParseSession, ParsePage, ParseWord } from '../parseTypes';

type IncomeLine = {
  id: string;
  pageIndex: number;
  wordIndex: number;
  label: string;
  extracted: string;
  numeric: number;
  included: boolean;
  override: string;
};

const MONEY = /\$?\s*[\d,]+\.\d{2}\b|\$\s*[\d,]+/;

function nearbyLabel(words: ParseWord[], index: number): string {
  const before = words
    .slice(Math.max(0, index - 6), index)
    .map((word) => word.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return before.slice(-48) || 'Amount';
}

function buildIncomeLines(session: LiveParseSession): IncomeLine[] {
  const lines: IncomeLine[] = [];
  for (const page of session.result.pages) {
    page.words.forEach((word, wordIndex) => {
      if (!MONEY.test(word.text)) return;
      const numeric = Number(word.text.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(numeric) || numeric < 1) return;
      lines.push({
        id: `${page.index}-${wordIndex}`,
        pageIndex: page.index,
        wordIndex,
        label: nearbyLabel(page.words, wordIndex) || page.formIds[0] || `Page ${page.index + 1}`,
        extracted: word.text,
        numeric,
        included: true,
        override: '',
      });
    });
  }
  return lines;
}

export default function LiveParseWorkbench({
  session,
  page,
  hoveredWord,
  onHoverWord,
  onSelectPage,
}: {
  session: LiveParseSession;
  page: ParsePage | undefined;
  hoveredWord: number | null;
  onHoverWord: (index: number | null) => void;
  onSelectPage: (index: number) => void;
}) {
  const seed = useMemo(() => buildIncomeLines(session), [session.result.transaction_id]);
  const [lines, setLines] = useState<IncomeLine[]>(seed);
  const words = page?.words ?? [];

  useEffect(() => {
    setLines(seed);
  }, [seed]);

  const annual = lines.reduce((sum, line) => {
    if (!line.included) return sum;
    const override = Number(line.override.replace(/[^0-9.]/g, ''));
    return sum + (line.override === '' ? line.numeric : override);
  }, 0);
  const monthly = annual / 12;

  return (
    <div className="space-y-5 text-left">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-white">Live income queue</h3>
        <p className="text-[11px] text-slate-400">
          Every word is boxed on the PDF. Dollar hits are the working ledger — include, override, and total as you
          would on a 1084. Classification still marks core forms; nothing is dropped from the viewer.
        </p>
        <p className="mt-1 font-mono text-[11px] text-slate-500">{session.fileName}</p>
      </div>

      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Working monthly qualifying</p>
        <p className="text-2xl font-black text-emerald-400">
          ${monthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-[11px] text-slate-500">
          Annual included ${annual.toLocaleString('en-US', { minimumFractionDigits: 2 })} / 12
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Scanned" value={String(session.result.total_pages_scanned)} />
        <Stat label="Core forms" value={String(session.result.pages_extracted_count)} />
        <Stat label="Boxes here" value={String(words.length)} />
        <Stat label="Dollar hits" value={String(lines.length)} />
      </div>

      {session.result.flags?.length > 0 && (
        <p className="text-[11px] text-amber-400">Flags: {session.result.flags.join(', ')}</p>
      )}

      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {page?.formIds.join(', ') || 'Unlabeled page'} · {page?.isNativeText ? 'Native boxes' : 'OCR boxes'}
          {page?.inKeepSet ? ' · core form' : ''}
        </p>
        {hoveredWord !== null && words[hoveredWord] && (
          <p className="mb-2 rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 font-mono text-[11px] text-emerald-300">
            {words[hoveredWord].text}
          </p>
        )}
      </div>

      <div className="max-h-[240px] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-2 py-2">In</th>
              <th>Label / extracted</th>
              <th>Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lines.length === 0 && (
              <tr>
                <td colSpan={3} className="px-2 py-3 text-slate-500">
                  No dollar tokens yet. Boxes still overlay the page — click a word on the PDF.
                </td>
              </tr>
            )}
            {lines.map((line, index) => (
              <tr
                key={line.id}
                className={`cursor-pointer ${
                  page?.index === line.pageIndex && hoveredWord === line.wordIndex
                    ? 'bg-emerald-500/10 text-white'
                    : 'text-slate-600 hover:bg-slate-100/60'
                }`}
                onClick={() => {
                  onSelectPage(line.pageIndex);
                  onHoverWord(line.wordIndex);
                }}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={line.included}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setLines((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, included: checked } : item
                        )
                      );
                    }}
                  />
                </td>
                <td className="px-2 py-2">
                  <p className="text-[10px] text-slate-500">
                    p{line.pageIndex + 1} · {line.label}
                  </p>
                  <p className="font-mono">{line.extracted}</p>
                </td>
                <td className="px-2 py-2">
                  <input
                    value={line.override}
                    placeholder={String(line.numeric)}
                    className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-[11px]"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const value = event.target.value;
                      setLines((prev) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, override: value } : item
                        )
                      );
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="max-h-[180px] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-2 py-2">Page</th>
              <th>Forms</th>
              <th>Boxes</th>
              <th>Core</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {session.result.pages.map((row) => (
              <tr
                key={row.index}
                className={`cursor-pointer ${
                  row.index === page?.index ? 'bg-emerald-500/10 text-white' : 'text-slate-600 hover:bg-slate-100/60'
                }`}
                onClick={() => {
                  onSelectPage(row.index);
                  onHoverWord(null);
                }}
              >
                <td className="px-2 py-2 font-mono">{row.index + 1}</td>
                <td>{row.formIds.join(', ') || '—'}</td>
                <td>{row.words.length}</td>
                <td>{row.inKeepSet ? 'yes' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-lg font-black text-white">{value}</p>
    </div>
  );
}
