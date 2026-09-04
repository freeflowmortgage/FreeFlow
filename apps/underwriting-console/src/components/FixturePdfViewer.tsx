import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorker;

const RENDER_WIDTH = 860;

/**
 * Renders a server-generated demo document (filled IRS form / pay stub) from a
 * fixture URL. The URL carries the live workspace values as query params, so
 * the document re-renders whenever the underwriter edits a figure.
 */
export default function FixturePdfViewer({
  url,
  label,
  boxes = [],
  onSelect,
}: {
  url: string;
  label: string;
  boxes?: Array<{ id: string; x: number; y: number; width: number; height: number; selected: boolean }>;
  onSelect?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setPageIndex(0);
    pdfRef.current?.destroy().catch(() => undefined);
    pdfRef.current = null;

    void fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`fixture ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => getDocument({ data }).promise)
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || status !== 'ready') return;
    let cancelled = false;

    void pdf.getPage(Math.min(pageIndex, pdf.numPages - 1) + 1).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: RENDER_WIDTH / page.getViewport({ scale: 1 }).width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      return page.render({ canvasContext: context, viewport }).promise;
    });

    return () => {
      cancelled = true;
    };
  }, [pageIndex, status]);

  if (status === 'error') {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        Could not load the {label} source document.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {label} · page {pageIndex + 1} / {Math.max(pageCount, 1)}
        </span>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
              disabled={pageIndex >= pageCount - 1}
              onClick={() => setPageIndex((i) => Math.min(pageCount - 1, i + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
        {status === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Rendering document…
          </p>
        )}
        <canvas ref={canvasRef} className="block h-auto w-full" />
        {boxes.map((box) => (
          <button
            key={box.id}
            type="button"
            title={box.id}
            className={`absolute box-border rounded-sm ${
              box.selected
                ? 'z-10 border-2 border-emerald-600 bg-emerald-400/30 ring-2 ring-emerald-500/40'
                : 'border border-emerald-500/80 bg-emerald-400/15 hover:bg-emerald-400/25'
            }`}
            style={{
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${Math.max(box.width, 1.2)}%`,
              height: `${Math.max(box.height, 1.1)}%`,
            }}
            onClick={() => onSelect?.(box.id)}
          />
        ))}
      </div>
    </div>
  );
}
