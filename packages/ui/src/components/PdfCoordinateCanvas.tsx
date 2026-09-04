import React, { useRef, useEffect } from 'react';

export interface SpatialCoordinates {
  pageIndex: number;
  box: [number, number, number, number]; // [x, y, width, height] 0-1 or 0-100
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
}

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

/**
 * Shared PDF coordinate canvas (v2).
 * Overlays bounding boxes on the active page and keeps the highlight in view.
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const category = resolveCategory(documentCategory, documentType);

  useEffect(() => {
    if (activeHighlight && highlightRef.current && containerRef.current) {
      const timer = window.setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }, 100);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [activeHighlight, currentPage]);

  const renderMockDocumentContent = () => {
    if (category === 'PAYSTUB') {
      return (
        <div className="p-8 font-sans text-[11px] text-slate-800 space-y-4">
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
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-2 border border-slate-200 rounded">
            <div>
              <span className="block font-bold text-slate-700">EMPLOYEE NAME:</span>
              <span className="text-slate-900 font-medium">Alex M. Morgan</span>
            </div>
            <div className="text-right">
              <span className="block font-bold text-slate-700">SOCIAL SECURITY NUMBER:</span>
              <span className="font-mono text-slate-900 font-medium">***-**-6789</span>
            </div>
          </div>
        </div>
      );
    }

    if (category === 'APPRAISAL_1004') {
      return (
        <div className="p-8 font-sans text-[10px] text-slate-800 space-y-4">
          <div className="text-center border-b border-slate-400 pb-2">
            <h1 className="text-xs font-black tracking-tight uppercase text-slate-950">
              UNIFORM RESIDENTIAL APPRAISAL REPORT
            </h1>
            <p className="text-[8px] text-slate-500">HUD Form 1004 / Freddie Mac Form 70 — page {currentPage}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 border border-slate-300 p-2 text-[8px] bg-slate-50 rounded">
            <div>
              <span className="block font-bold text-slate-600">Subject Property Address:</span>
              <span className="font-semibold text-slate-900">456 Oak Drive, San Mateo, CA 94402</span>
            </div>
            <div>
              <span className="block font-bold text-slate-600">FHA / VA Case Number:</span>
              <span className="font-semibold text-slate-900 font-mono">CA-1928005-A</span>
            </div>
            <div className="text-right">
              <span className="block font-bold text-slate-600">Appraised Valuation:</span>
              <span className="font-bold text-slate-950 font-mono">$1,150,000</span>
            </div>
          </div>
          {currentPage === 1 && (
            <div className="border border-slate-200 p-2 space-y-1">
              <h3 className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase tracking-wider text-[8px]">
                Neighborhood Trends
              </h3>
              <p className="text-slate-600">Property values stable. Demand/supply in balance. Marketing time under 3 months.</p>
            </div>
          )}
          {currentPage === 2 && (
            <div className="border border-slate-200 p-2 space-y-2">
              <h3 className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase tracking-wider text-[8px]">
                Sales Comparison Analysis
              </h3>
              <p className="font-mono text-[8px] text-slate-700">
                Comp 1 (0.25 mi): $1,120,000 | Net +$30,000 | Gross 2.7%
              </p>
            </div>
          )}
          {currentPage === 3 && (
            <div className="border border-slate-200 p-2 text-[8px] space-y-1">
              <h3 className="font-bold text-slate-900 uppercase text-[8px]">Reconciliation &amp; Physical Condition</h3>
              <p className="text-slate-600 leading-normal">
                Attic and crawlspace inspections completed. Utilities active. No peeling paint detected.
              </p>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="p-16 text-center text-slate-400 font-medium">
        <p>Rendering generic document pages...</p>
      </div>
    );
  };

  const isCurrentPageHighlighted = Boolean(activeHighlight && activeHighlight.pageIndex === currentPage - 1);
  const highlightBox = activeHighlight ? boxToPercent(activeHighlight.box) : null;

  return (
    <div
      data-testid="pdf-coordinate-canvas"
      className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl"
    >
      <div className="flex justify-between items-center px-4 py-2 bg-slate-950 border-b border-slate-800 z-10">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-black tracking-widest rounded uppercase">
            {category}
          </span>
          <span data-testid="pdf-page-label" className="text-[11px] text-slate-400 font-bold">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            data-testid="pdf-zoom-out"
            onClick={onZoomOut}
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-all"
            title="Zoom Out"
          >
            −
          </button>
          <span data-testid="pdf-zoom-label" className="text-[11px] font-mono text-slate-400 px-1 font-bold">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            type="button"
            data-testid="pdf-zoom-in"
            onClick={onZoomIn}
            className="p-1 text-slate-400 hover:text-slate-200 rounded transition-all"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            data-testid="pdf-zoom-reset"
            onClick={onResetZoom}
            className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 rounded transition-all font-bold"
            title="Reset Zoom"
          >
            RESET
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button
            type="button"
            data-testid="pdf-prev-page"
            onClick={onPrevPage}
            disabled={currentPage === 1}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 disabled:text-slate-600 disabled:pointer-events-none rounded border border-slate-800 text-[10px] font-bold transition-all"
          >
            PREV
          </button>
          <button
            type="button"
            data-testid="pdf-next-page"
            onClick={onNextPage}
            disabled={currentPage === totalPages}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 disabled:text-slate-600 disabled:pointer-events-none rounded border border-slate-800 text-[10px] font-bold transition-all"
          >
            NEXT
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-6 bg-slate-950 flex items-start justify-center relative"
      >
        <div
          className="bg-white border border-slate-300 rounded-lg shadow-2xl relative select-text transition-transform origin-top duration-200"
          style={{
            transform: `scale(${zoomScale})`,
            width: '100%',
            maxWidth: '640px',
            minHeight: '820px',
          }}
        >
          {documentUrl ? (
            <object data={documentUrl} type="application/pdf" className="absolute inset-0 h-full w-full opacity-40">
              {renderMockDocumentContent()}
            </object>
          ) : (
            renderMockDocumentContent()
          )}

          {isCurrentPageHighlighted && activeHighlight && highlightBox && (
            <div
              ref={highlightRef}
              data-testid="pdf-highlight"
              data-page-index={activeHighlight.pageIndex}
              data-box={activeHighlight.box.join(',')}
              className="absolute bg-amber-400/25 border-2 border-amber-500 rounded ring-4 ring-amber-500/10 animate-pulse transition-all duration-300 z-10 cursor-pointer flex items-center justify-center group"
              style={{
                left: `${highlightBox[0]}%`,
                top: `${highlightBox[1]}%`,
                width: `${highlightBox[2]}%`,
                height: `${highlightBox[3]}%`,
              }}
              title="Extracted OCR Coordinate Highlight Box"
            >
              <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950 text-amber-400 font-mono text-[8px] font-black tracking-wider px-1 py-0.5 rounded shadow whitespace-nowrap border border-amber-400/30">
                OCR REF: P{activeHighlight.pageIndex} [{activeHighlight.box.join(',')}]
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfCoordinateCanvas;
