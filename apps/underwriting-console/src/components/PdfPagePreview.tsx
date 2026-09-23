import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fieldMatchesInspectId, type InspectOverlay } from '../livePacket';
import type { MappedIncomeField } from '../parseTypes';
import { isUsableOverlayBox, padOverlayBox } from '../overlayBox';

GlobalWorkerOptions.workerSrc = pdfWorker;

const RENDER_WIDTH = 720;

/**
 * Payroll and tax forms are dense enough that a whole page scaled to the pane
 * is not readable, and verifying a figure against the document is the entire
 * job here. Zoom goes well past fit-width for that reason.
 */
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3] as const;

export default function PdfPagePreview({
  file,
  pageIndex,
  pageCount,
  fields = [],
  selectedFieldId = null,
  highlight = null,
  onSelectField,
  onPageChange,
}: {
  file: File | null;
  pageIndex: number;
  pageCount: number;
  fields?: MappedIncomeField[];
  selectedFieldId?: string | null;
  /** Live token box from the clicked worksheet field — never a facsimile cell. */
  highlight?: InspectOverlay | null;
  onSelectField?: (id: string) => void;
  onPageChange: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
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
      const baseScale = RENDER_WIDTH / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: baseScale * ZOOM_STEPS[zoomIndex] });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d');
      if (!context) return;
      return page.render({ canvasContext: context, viewport }).promise;
    });

    return () => {
      cancelled = true;
    };
  }, [pageIndex, ready, zoomIndex]);

  // Keep the active highlight on screen. Once zoomed in, the cell being
  // verified is usually outside the viewport, so a highlight the user cannot
  // see is no better than no highlight.
  useEffect(() => {
    const target =
      document.querySelector('[data-inspect-overlay="true"]') ??
      (selectedFieldId ? document.querySelector(`[data-box-id="${selectedFieldId}"]`) : null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [selectedFieldId, highlight, pageIndex, ready, zoomIndex]);

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
            title="Zoom out"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={zoomIndex <= 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-10 text-center tabular-nums text-[11px] text-slate-500">
            {Math.round(ZOOM_STEPS[zoomIndex] * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={zoomIndex >= ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Fit width"
            className="mr-1 rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex(0)}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Previous page"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            disabled={pageIndex <= 0}
            onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-40"
            title="Next page"
            disabled={pageIndex >= last}
            onClick={() => onPageChange(Math.min(last, pageIndex + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-[78vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <div className="relative inline-block">
        <canvas ref={canvasRef} className="block" />
        {pageFields.filter((field) => isUsableOverlayBox(field.box)).flatMap((field) => {
          const selected = fieldMatchesInspectId(field, selectedFieldId);
          const sourceBoxes = selected && field.componentBoxes?.length ? field.componentBoxes : [field.box];
          return sourceBoxes.map((sourceBox, componentIndex) => {
            const box = padOverlayBox(sourceBox);
            return (
            <button
              key={`${field.id}-${componentIndex}`}
              type="button"
              data-box-id={componentIndex === 0 ? field.id : `${field.id}--component-${componentIndex}`}
              data-overlay-visible={selected ? 'true' : 'false'}
              title={`${field.boxLabel} · ${field.fieldLabel} · ${field.value}`}
              className={`absolute box-border rounded-sm ${
                selected
                  ? 'z-10 border-2 border-emerald-600 bg-emerald-400/10'
                  : 'border-0 bg-transparent'
              }`}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${Math.max(box.w * 100, 0.8)}%`,
                height: `${Math.max(box.h * 100, 0.7)}%`,
              }}
              onClick={() => onSelectField?.(field.id)}
            />
            );
          });
        })}
        {highlight && highlight.pageIndex === pageIndex && isUsableOverlayBox(highlight.box) && (() => {
          const box = padOverlayBox(highlight.box);
          return (
          <div
            data-box-id={selectedFieldId ?? 'inspect-overlay'}
            data-overlay-visible="true"
            data-inspect-overlay="true"
            className="pointer-events-none absolute z-20 box-border rounded-sm border-2 border-emerald-600 bg-emerald-400/10"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${Math.max(box.w * 100, 0.8)}%`,
              height: `${Math.max(box.h * 100, 0.7)}%`,
            }}
          />
          );
        })()}
        {ready && pageFields.length === 0 && (
          <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-500">
            No mapped income fields on this page.
          </p>
        )}
        </div>
      </div>
    </div>
  );
}
