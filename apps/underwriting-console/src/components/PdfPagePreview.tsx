import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { MappedIncomeField } from '../parseTypes';

GlobalWorkerOptions.workerSrc = pdfWorker;

const RENDER_WIDTH = 720;

export default function PdfPagePreview({
  file,
  pageIndex,
  pageCount,
  fields = [],
  selectedFieldId = null,
  onSelectField,
  onPageChange,
}: {
  file: File | null;
  pageIndex: number;
  pageCount: number;
  fields?: MappedIncomeField[];
  selectedFieldId?: string | null;
  onSelectField?: (id: string) => void;
  onPageChange: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);
  const fileKey = useMemo(() => (file ? `${file.name}-${file.size}-${file.lastModified}` : ''), [file]);
  const pageFields = fields.filter((field) => field.pageIndex === pageIndex);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    pdfRef.current?.destroy().catch(() => undefined);
    pdfRef.current = null;
    if (!file) return undefined;

    const buffer = file.arrayBuffer().then((data) => getDocument({ data }).promise);
    void buffer
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });

    return () => {
      cancelled = true;
      pdfRef.current?.destroy().catch(() => undefined);
      pdfRef.current = null;
    };
  }, [fileKey, file]);

  useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || !ready) return;
    const safeIndex = Math.min(Math.max(pageIndex, 0), pdf.numPages - 1);
    let cancelled = false;

    void pdf.getPage(safeIndex + 1).then((page) => {
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
  }, [pageIndex, ready]);

  const last = Math.max(pageCount - 1, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Page {pageIndex + 1} / {Math.max(pageCount, 1)} · {pageFields.length} mapped field{pageFields.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={pageIndex >= last}
            onClick={() => onPageChange(Math.min(last, pageIndex + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
        <canvas ref={canvasRef} className="block max-w-full" />
        {pageFields.map((field) => {
          const selected = selectedFieldId === field.id;
          return (
            <button
              key={field.id}
              type="button"
              title={`${field.boxLabel} · ${field.fieldLabel} · ${field.value}`}
              className={`absolute box-border rounded-sm ${
                selected
                  ? 'z-10 border-2 border-emerald-600 bg-emerald-400/30 ring-2 ring-emerald-500/40'
                  : 'border border-emerald-500/80 bg-emerald-400/15 hover:bg-emerald-400/25'
              }`}
              style={{
                left: `${field.box.x * 100}%`,
                top: `${field.box.y * 100}%`,
                width: `${Math.max(field.box.w * 100, 1.2)}%`,
                height: `${Math.max(field.box.h * 100, 1.1)}%`,
              }}
              onClick={() => onSelectField?.(field.id)}
            />
          );
        })}
        {ready && pageFields.length === 0 && (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-500">
            No mapped income fields on this page.
          </p>
        )}
      </div>
    </div>
  );
}
