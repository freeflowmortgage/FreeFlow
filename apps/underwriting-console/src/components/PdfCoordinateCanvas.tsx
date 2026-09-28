import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import UrarLiveDocument from './UrarLiveDocument';

GlobalWorkerOptions.workerSrc = pdfWorker;

export interface SpatialCoordinates {
  pageIndex: number;
  box: [number, number, number, number];
}

interface PdfCoordinateCanvasProps {
  currentPage: number;
  zoomScale: number;
  activeHighlight: SpatialCoordinates | null;
  totalPages: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  documentCategory?: string;
  documentType?: string;
  documentUrl?: string;
  mappedBoxes?: SpatialCoordinates[];
  allowFallbackMock?: boolean;
  /** Reports the loaded document's real page count (native PDFs only). */
  onPageCount?: (pages: number) => void;
}

const RENDER_WIDTH = 640;

/** Parser boxes are 0-1 relative; demo maps use 0-100. Render as CSS percents. */
export function boxToPercent(box: [number, number, number, number]): [number, number, number, number] {
  const max = Math.max(box[0], box[1], box[2], box[3]);
  if (max <= 1) {
    return [box[0] * 100, box[1] * 100, box[2] * 100, box[3] * 100];
  }
  return box;
}

function resolveCategory(documentCategory?: string, documentType?: string): string {
  const raw = (documentCategory || documentType || 'PAYSTUB').toUpperCase();
  if (raw === 'URAR' || raw === '1004' || raw === 'FORM_1004') return 'APPRAISAL_1004';
  return raw;
}

function NativePdfPage({
  url,
  pageNumber,
  zoomScale,
  activeHighlight,
  mappedBoxes = [],
  onPageCount,
  allowFallbackMock = true,
}: {
  url: string;
  pageNumber: number;
  zoomScale: number;
  activeHighlight: SpatialCoordinates | null;
  mappedBoxes?: SpatialCoordinates[];
  onPageCount?: (pages: number) => void;
  allowFallbackMock?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setFailed(false);
    pdfRef.current?.destroy().catch(() => undefined);
    pdfRef.current = null;

    void fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('PDF fetch failed');
        return response.arrayBuffer();
      })
      .then((data) => getDocument({ data }).promise)
      .then((pdf) => {
        if (cancelled) {
          void pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setReady(true);
        onPageCount?.(pdf.numPages);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
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
    if (!pdf || !canvas || !ready) return;
    const safeIndex = Math.min(Math.max(pageNumber, 1), pdf.numPages);
    let cancelled = false;

    void pdf.getPage(safeIndex).then((page) => {
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
  }, [pageNumber, ready]);

  useEffect(() => {
    if (!activeHighlight || !highlightRef.current) return undefined;
    const timer = window.setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeHighlight, pageNumber]);

  if (failed) {
    if (!allowFallbackMock) {
      return <div className="grid min-h-[820px] w-full place-items-center bg-white p-8 text-center text-sm text-red-700">The selected PDF could not be rendered. No fallback document was substituted.</div>;
    }
    const pageIndex = pageNumber - 1;
    const isCurrentPageHighlighted = Boolean(activeHighlight && activeHighlight.pageIndex === pageIndex);
    const highlightBox = activeHighlight ? boxToPercent(activeHighlight.box) : null;
    return (
      <div className="relative origin-top" style={{ transform: `scale(${zoomScale})`, width: RENDER_WIDTH, minHeight: 820 }}>
        <UrarLiveDocument currentPage={pageNumber} />
        {isCurrentPageHighlighted && activeHighlight && highlightBox ? (
          <div
            data-testid="pdf-highlight"
            data-page-index={activeHighlight.pageIndex}
            data-box={activeHighlight.box.join(',')}
            className="absolute z-10 animate-pulse rounded border-2 border-amber-500 bg-amber-400/25 ring-4 ring-amber-500/10"
            style={{
              left: `${highlightBox[0]}%`,
              top: `${highlightBox[1]}%`,
              width: `${highlightBox[2]}%`,
              height: `${highlightBox[3]}%`,
            }}
          />
        ) : null}
      </div>
    );
  }

  const pageIndex = pageNumber - 1;
  const isCurrentPageHighlighted = Boolean(activeHighlight && activeHighlight.pageIndex === pageIndex);
  const highlightBox = activeHighlight ? boxToPercent(activeHighlight.box) : null;
  const pageMaps = mappedBoxes.filter((item) => item.pageIndex === pageIndex);

  return (
    <div
      className="relative origin-top select-text shadow-2xl"
      style={{ transform: `scale(${zoomScale})`, width: RENDER_WIDTH }}
    >
      {!ready ? (
        <div className="grid h-[830px] w-full place-items-center bg-[#f7f4ea] text-xs text-slate-500">
          Loading native URAR PDF…
        </div>
      ) : null}
      <canvas ref={canvasRef} className={`block w-full bg-white ${ready ? '' : 'hidden'}`} />
      {pageMaps.map((item, index) => {
        const pct = boxToPercent(item.box);
        const active =
          activeHighlight?.pageIndex === item.pageIndex && activeHighlight.box.join(',') === item.box.join(',');
        if (active) return null;
        return (
          <div
            key={`${item.pageIndex}-${item.box.join('-')}-${index}`}
            className="pointer-events-none absolute border border-emerald-500/70 bg-emerald-400/10"
            style={{ left: `${pct[0]}%`, top: `${pct[1]}%`, width: `${pct[2]}%`, height: `${pct[3]}%` }}
          />
        );
      })}
      {isCurrentPageHighlighted && activeHighlight && highlightBox ? (
        <div
          ref={highlightRef}
          data-testid="pdf-highlight"
          data-page-index={activeHighlight.pageIndex}
          data-box={activeHighlight.box.join(',')}
          className="absolute z-10 animate-pulse cursor-pointer rounded border-2 border-amber-500 bg-amber-400/25 ring-4 ring-amber-500/10"
          style={{
            left: `${highlightBox[0]}%`,
            top: `${highlightBox[1]}%`,
            width: `${highlightBox[2]}%`,
            height: `${highlightBox[3]}%`,
          }}
          title="Mapped URAR field"
        />
      ) : null}
    </div>
  );
}

/**
 * Shared PDF coordinate canvas.
 * Native PDFs render through pdf.js with percent-mapped overlays.
 */
export const PdfCoordinateCanvas: React.FC<PdfCoordinateCanvasProps> = ({
  currentPage,
  zoomScale,
  activeHighlight,
  totalPages,
  onNextPage,
  onPrevPage,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  documentCategory,
  documentType,
  documentUrl,
  mappedBoxes = [],
  onPageCount,
  allowFallbackMock = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const category = resolveCategory(documentCategory, documentType);
  const native = Boolean(documentUrl);

  useEffect(() => {
    if (native || !activeHighlight || !highlightRef.current) return undefined;
    const timer = window.setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activeHighlight, currentPage, native]);

  const renderMockDocumentContent = () => {
    if (category === 'PAYSTUB') {
      return (
        <div className="space-y-4 p-8 font-sans text-[11px] text-slate-800">
          <div className="flex justify-between border-b-2 border-slate-900 pb-2">
            <div>
              <h2 className="text-sm font-black text-slate-950">APEX TECHNOLOGY PARTNERS LLC</h2>
              <p className="text-[9px] text-slate-500">100 Innovation Way, Suite 400, San Jose, CA 95112</p>
            </div>
            <div className="text-right">
              <h2 className="text-xs font-bold text-slate-900">EARNINGS STATEMENT</h2>
              <p className="text-[9px] text-slate-500">Statement Period: 08/01/2026 to 08/15/2026</p>
            </div>
          </div>
        </div>
      );
    }
    if (category === 'APPRAISAL_1004') {
      return <UrarLiveDocument currentPage={currentPage} />;
    }
    return (
      <div className="p-16 text-center font-medium text-slate-400">
        <p>Rendering generic document pages...</p>
      </div>
    );
  };

  const isCurrentPageHighlighted = Boolean(activeHighlight && activeHighlight.pageIndex === currentPage - 1);
  const highlightBox = activeHighlight ? boxToPercent(activeHighlight.box) : null;

  return (
    <div
      data-testid="pdf-coordinate-canvas"
      className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
    >
      <div className="z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
        <div className="flex items-center space-x-2">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-600">
            {native ? 'NATIVE PDF' : category}
          </span>
          <span data-testid="pdf-page-label" className="text-[11px] font-bold text-slate-400">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button type="button" data-testid="pdf-zoom-out" onClick={onZoomOut} className="rounded p-1 text-slate-400 hover:text-slate-900" title="Zoom Out">
            −
          </button>
          <span data-testid="pdf-zoom-label" className="px-1 font-mono text-[11px] font-bold text-slate-400">
            {Math.round(zoomScale * 100)}%
          </span>
          <button type="button" data-testid="pdf-zoom-in" onClick={onZoomIn} className="rounded p-1 text-slate-400 hover:text-slate-900" title="Zoom In">
            +
          </button>
          <button type="button" data-testid="pdf-zoom-reset" onClick={onResetZoom} className="rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-500 hover:text-slate-600" title="Reset Zoom">
            RESET
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            data-testid="pdf-prev-page"
            onClick={onPrevPage}
            disabled={currentPage === 1}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 disabled:pointer-events-none disabled:text-slate-300"
          >
            PREV
          </button>
          <button
            type="button"
            data-testid="pdf-next-page"
            onClick={onNextPage}
            disabled={currentPage === totalPages}
            className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 disabled:pointer-events-none disabled:text-slate-300"
          >
            NEXT
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative flex flex-1 items-start justify-center overflow-auto bg-slate-100 p-6">
        {native && documentUrl ? (
          <NativePdfPage
            url={documentUrl}
            pageNumber={currentPage}
            zoomScale={zoomScale}
            activeHighlight={activeHighlight}
            mappedBoxes={mappedBoxes}
            onPageCount={onPageCount}
            allowFallbackMock={allowFallbackMock}
          />
        ) : (
          <div
            className="relative origin-top select-text rounded-lg border border-slate-300 bg-white shadow-2xl transition-transform duration-200"
            style={{ transform: `scale(${zoomScale})`, width: '100%', maxWidth: '640px', minHeight: '820px' }}
          >
            {renderMockDocumentContent()}
            {isCurrentPageHighlighted && activeHighlight && highlightBox && (
              <div
                ref={highlightRef}
                data-testid="pdf-highlight"
                data-page-index={activeHighlight.pageIndex}
                data-box={activeHighlight.box.join(',')}
                className="absolute z-10 flex animate-pulse cursor-pointer items-center justify-center rounded border-2 border-amber-500 bg-amber-400/25 ring-4 ring-amber-500/10"
                style={{
                  left: `${highlightBox[0]}%`,
                  top: `${highlightBox[1]}%`,
                  width: `${highlightBox[2]}%`,
                  height: `${highlightBox[3]}%`,
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfCoordinateCanvas;
