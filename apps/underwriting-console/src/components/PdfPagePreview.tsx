import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { fieldMatchesInspectId, type InspectOverlay } from '../livePacket';
import type { MappedIncomeField } from '../parseTypes';
import { isUsableOverlayBox, padOverlayBox, selectedOverlayParts } from '../overlayBox';

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
  fillHeight = false,
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
  /**
   * Take the height left in a flex column instead of a fixed 78vh. The split
   * view starts the pane below its toolbars, so 78vh ran past the window and
   * the bottom of every page could not be scrolled into view.
   */
  fillHeight?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileKey = useMemo(() => (file ? `${file.name}-${file.size}-${file.lastModified}` : ''), [file]);
  const pageFields = fields.filter((field) => field.pageIndex === pageIndex);

  // Exactly one field is selected. Every Schedule E property carries the same
  // sourceFieldId, so matching on it marked all three columns as selected and
  // one property's value lit up the whole row. The exact id wins; the looser
  // match is only a fallback for ids that were aliased or entity-suffixed.
  // With a resolved highlight, mark the field under it. The same source id
  // repeats across Schedule E columns, so matching on the id alone outlined
  // column C while the highlight sat on the column actually clicked.
  const highlightHere = highlight && highlight.pageIndex === pageIndex ? highlight.box : null;
  const selectedField = highlightHere
    ? pageFields.find(
        (field) =>
          field.box &&
          Math.abs(field.box.x - highlightHere.x) < 1e-6 &&
          Math.abs(field.box.y - highlightHere.y) < 1e-6 &&
          Math.abs(field.box.w - highlightHere.w) < 1e-6 &&
          Math.abs(field.box.h - highlightHere.h) < 1e-6,
      )
    : pageFields.find((field) => field.id === selectedFieldId) ??
      pageFields.find((field) => fieldMatchesInspectId(field, selectedFieldId));

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

  // Keep the active highlight on screen once zoomed in, without moving
  // anything else.
  //
  // scrollIntoView cannot be used here. It walks every scrollable ancestor,
  // so centring a box inside this pane also repositioned the page and pulled
  // the QA panel out from under the underwriter. Scrolling this container
  // directly leaves the rest of the layout where it was. The query is scoped
  // to the container for the same reason: a document-wide selector can match
  // an overlay belonging to a different pane.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const target =
      container.querySelector('[data-inspect-overlay="true"]') ??
      (selectedFieldId ? container.querySelector(`[data-box-id="${selectedFieldId}"]`) : null);
    if (!(target instanceof HTMLElement)) return;

    // Measure against the part of the pane actually on screen. The pane is
    // capped at 78vh but starts below the toolbar, so its bottom edge can sit
    // past the window; a box there counted as visible and was never scrolled to.
    const rect = container.getBoundingClientRect();
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    const pane = { top, bottom, left: rect.left, right: rect.right, width: rect.width, height: Math.max(bottom - top, 0) };
    const box = target.getBoundingClientRect();
    const alreadyVisible =
      box.top >= pane.top && box.bottom <= pane.bottom && box.left >= pane.left && box.right <= pane.right;
    if (alreadyVisible) return;

    container.scrollTo({
      top: Math.max(0, container.scrollTop + (box.top - pane.top) - (pane.height - box.height) / 2),
      left: Math.max(0, container.scrollLeft + (box.left - pane.left) - (pane.width - box.width) / 2),
      behavior: 'smooth',
    });
  }, [selectedFieldId, highlight, pageIndex, ready, zoomIndex]);

  const last = Math.max(pageCount - 1, 0);

  return (
    <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col gap-2' : 'space-y-2'}>
      <div className="flex shrink-0 items-center justify-between text-xs text-slate-500">
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
      <div
        ref={scrollRef}
        className={`${fillHeight ? 'min-h-0 flex-1' : 'max-h-[78vh]'} overflow-auto rounded-lg border border-slate-200 bg-white`}
      >
        <div className="relative inline-block">
        <canvas ref={canvasRef} className="block" />
        {pageFields.filter((field) => isUsableOverlayBox(field.box)).flatMap((field) => {
          const selected = field === selectedField;
          const parts = selected ? selectedOverlayParts(field) : [{ box: field.box, included: true }];
          return parts.map((part, componentIndex) => {
            const box = padOverlayBox(part.box);
            return (
            <button
              key={`${field.id}-${componentIndex}`}
              type="button"
              data-box-id={componentIndex === 0 ? field.id : `${field.id}--component-${componentIndex}`}
              data-overlay-visible={selected ? 'true' : 'false'}
              data-overlay-counted={selected ? String(part.included) : undefined}
              title={
                selected && !part.included
                  ? `Not counted in ${field.fieldLabel}`
                  : `${field.boxLabel} · ${field.fieldLabel} · ${field.value}`
              }
              className={`absolute box-border rounded-sm ${
                !selected
                  ? 'border-0 bg-transparent'
                  : part.included
                    ? 'z-10 border-2 border-emerald-600 bg-emerald-400/25'
                    : 'z-10 border border-dashed border-slate-400 bg-slate-500/5'
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
            className={`pointer-events-none absolute z-20 box-border rounded-sm border-2 border-emerald-600 ${
              selectedField?.componentCells?.length ? '' : 'bg-emerald-400/10'
            }`}
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
