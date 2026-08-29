import { useState } from 'react';
import { FileSearch, Loader2, Upload } from 'lucide-react';

const PARSER_URL = '/parse';

type Word = { text: string; x: number; y: number; w: number; h: number; confidence: number };
type PageHit = {
  index: number;
  formIds: string[];
  isNativeText: boolean;
  meanConfidence: number;
  skewDegrees: number;
  words: Word[];
  flags: string[];
};

type ParseResponse = {
  transaction_id: string;
  total_pages_scanned: number;
  pages_extracted_count: number;
  extracted_page_indices: number[];
  ocr_page_count: number;
  has_business_returns: boolean;
  flags: string[];
  classifications: Record<string, string[]>;
  unresolved_statements: { page_index: number; token: string | null; snippet: string }[];
  pages: PageHit[];
};

export default function ParserLab() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResponse | null>(null);
  const [fileName, setFileName] = useState<string>('');

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(PARSER_URL, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) {
        const detail = payload.detail;
        const message = typeof detail === 'string' ? detail : JSON.stringify(detail || payload);
        throw new Error(message || `Parser returned ${response.status}`);
      }
      setResult(payload as ParseResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 text-slate-100 shadow-2xl">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-6 py-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2 text-emerald-400">
            <FileSearch className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Local parser lab</h2>
            <p className="text-xs text-slate-400">
              POST the PDF to the in-memory tool. Boxes are relative 0–1; no sandwich file is returned.
            </p>
          </div>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold hover:bg-slate-700">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-emerald-400" />}
          <span>{busy ? 'Parsing…' : 'Upload PDF'}</span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>
      </div>

      <div className="space-y-4 px-6 pb-6">
        {fileName && <p className="font-mono text-[11px] text-slate-500">{fileName}</p>}
        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        {!result && !error && !busy && (
          <p className="text-xs text-slate-500">Parser must be running on :8080 (proxied through this app).</p>
        )}
        {result && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Pages scanned" value={String(result.total_pages_scanned)} />
              <Stat label="Kept" value={String(result.pages_extracted_count)} />
              <Stat label="OCR pages" value={String(result.ocr_page_count)} />
              <Stat label="Business?" value={result.has_business_returns ? 'Yes' : 'No'} />
            </div>
            {result.flags?.length > 0 && (
              <p className="text-[11px] text-amber-400">Flags: {result.flags.join(', ')}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2">Page</th>
                    <th>Forms</th>
                    <th>Conf</th>
                    <th>Words</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.pages.map((page) => (
                    <tr key={page.index}>
                      <td className="py-2 font-mono">{page.index + 1}</td>
                      <td>{page.formIds.join(', ') || '—'}</td>
                      <td>{page.meanConfidence.toFixed(1)}</td>
                      <td>{page.words.length}</td>
                      <td>{page.isNativeText ? 'Native text' : 'OCR'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.unresolved_statements?.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs">
                <p className="mb-1 font-bold text-amber-400">Unresolved See Statement</p>
                {result.unresolved_statements.map((item, idx) => (
                  <p key={idx} className="text-slate-400">
                    Page {item.page_index + 1}: {item.snippet}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-lg font-black text-white">{value}</p>
    </div>
  );
}
