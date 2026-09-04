import { useEffect, useMemo, useState } from 'react';
import { FileSearch, Loader2, Upload } from 'lucide-react';
import { mapIncomeFields } from '../incomeFieldMap';
import type { LiveParseSession, ParseResponse } from '../parseTypes';
import { postParsePdf } from '../postParsePdf';
import PdfPagePreview from './PdfPagePreview';

export default function ParserLab() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<LiveParseSession | null>(null);
  const [engine, setEngine] = useState<string>('checking…');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const fields = useMemo(() => (session ? mapIncomeFields(session.result) : []), [session?.result.transaction_id]);

  useEffect(() => {
    void fetch('/health')
      .then((response) => response.json())
      .then((payload) => setEngine(payload.engine || payload.service || 'ready'))
      .catch(() => setEngine('native fallback'));
  }, []);

  useEffect(() => {
    if (!fields.length) {
      setSelectedFieldId(null);
      return;
    }
    const onPage = fields.find((field) => field.pageIndex === pageIndex) ?? fields[0];
    setSelectedFieldId(onPage.id);
    if (onPage.pageIndex !== pageIndex) setPageIndex(onPage.pageIndex);
  }, [session?.result.transaction_id]);

  const parseFile = async (file: File) => {
    setError(null);
    setSession(null);
    setBusy(true);
    try {
      const result = await postParsePdf(file);
      setSession({ file, fileName: file.name, result });
      setPageIndex(result.pages[0]?.index ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  const runSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/fixtures/income-smoke.pdf');
      if (!response.ok) throw new Error('Sample tax return could not be loaded.');
      const blob = await response.blob();
      const file = new File([blob], 'income-smoke.pdf', { type: 'application/pdf' });
      await parseFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sample parse failed');
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 text-emerald-700">
            <FileSearch className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-950">Tax return parser lab</h2>
            <p className="text-xs text-slate-500">
              Classifies 1040 / Schedule C-E / W-2 pages and maps agency income fields — not every OCR token. Engine: {engine}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runSample()}
            disabled={busy}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            Parse sample W-2 + Schedule C
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100">
            {busy ? <Loader2 className="h-4 w-4 animate-spin text-emerald-600" /> : <Upload className="h-4 w-4 text-emerald-600" />}
            <span>{busy ? 'Parsing…' : 'Upload tax PDF'}</span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) void parseFile(next);
              }}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          {error && (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
          )}
          {!session && !error && !busy && (
            <p className="text-sm text-slate-500">
              Upload a 1040 package or run the sample. The lab maps W-2 boxes 1–6 and Schedule C lines 31 / 13 / 44a.
            </p>
          )}
          {session && (
            <PdfPagePreview
              file={session.file}
              pageIndex={pageIndex}
              pageCount={session.result.total_pages_scanned}
              fields={fields}
              selectedFieldId={selectedFieldId}
              onSelectField={setSelectedFieldId}
              onPageChange={setPageIndex}
            />
          )}
        </div>

        <div className="space-y-4">
          {session && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Pages scanned" value={String(session.result.total_pages_scanned)} />
                <Stat label="Core forms" value={String(session.result.pages_extracted_count)} />
                <Stat label="Mapped fields" value={String(fields.length)} />
                <Stat label="Engine" value={session.result.parser_engine === 'python-ocr' ? 'OCR' : 'Native'} />
              </div>
              {session.result.flags?.length > 0 && (
                <p className="text-[11px] text-amber-700">Flags: {session.result.flags.join(', ')}</p>
              )}
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Mapped income fields</p>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Field</th>
                        <th>Form</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {fields.length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-3 py-3 text-slate-500">
                            No W-2 / 1040 income fields matched. Classification still runs on the pages list below.
                          </td>
                        </tr>
                      )}
                      {fields.map((field) => (
                        <tr
                          key={field.id}
                          className={`cursor-pointer ${selectedFieldId === field.id ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                          onClick={() => {
                            setPageIndex(field.pageIndex);
                            setSelectedFieldId(field.id);
                          }}
                        >
                          <td className="px-3 py-2">
                            <p className="font-bold text-slate-900">{field.boxLabel}</p>
                            <p className="text-[10px] text-slate-500">{field.fieldLabel}</p>
                          </td>
                          <td className="text-slate-600">{field.form}</td>
                          <td className="font-mono font-bold text-slate-950">{field.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Page classification</p>
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-2">Page</th>
                      <th>Forms</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {session.result.pages.map((page) => (
                      <tr
                        key={page.index}
                        className={`cursor-pointer ${page.index === pageIndex ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                        onClick={() => setPageIndex(page.index)}
                      >
                        <td className="py-2 font-mono">{page.index + 1}</td>
                        <td>{page.formIds.join(', ') || '—'}</td>
                        <td>{page.isNativeText ? 'Native text' : 'OCR'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}
