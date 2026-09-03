import React, { useRef, useEffect } from 'react';

export interface SpatialCoordinates {
  pageIndex: number;
  box: [number, number, number, number]; // [x, y, width, height] as relative ratios (0 to 100)
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
  documentCategory?: string; // "PAYSTUB" | "W2" | "APPRAISAL_1004" etc.
  documentUrl?: string;
}

/**
 * PRODUCTION-GRADE COGNITIVE PDF CANVAS COMPONENT
 * =============================================================================
 * Renders the virtual document page container with dynamic coordinate-based
 * amber overlay markers [cite: 177, 7ee83f58-0785-4f3c-9ff7-34b693f1a12d].
 * Implements smooth autoscroll handshakes to keep highlighted OCR fields focused [cite: 177].
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
  documentCategory = 'PAYSTUB',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic: ensures active highlights scroll smoothly into direct underwriter view [cite: 177]
  useEffect(() => {
    if (activeHighlight && highlightRef.current && containerRef.current) {
      setTimeout(() => {
        highlightRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
      }, 100);
    }
  }, [activeHighlight, currentPage]);

  // High-fidelity background simulation for document classes [cite: 177]
  const renderMockDocumentContent = () => {
    if (documentCategory === 'PAYSTUB') {
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
              <p className="text-[9px] text-slate-500">Payment Date: 08/15/2026</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-2 border border-slate-200 rounded">
            <div>
              <span className="block font-bold text-slate-700">EMPLOYEE NAME:</span>
              <span className="text-slate-900 font-medium">Alex M. Morgan</span>
              <span className="block text-[8px] text-slate-400 mt-1">789 Pine St, San Francisco, CA 94108</span>
            </div>
            <div className="text-right">
              <span className="block font-bold text-slate-700">SOCIAL SECURITY NUMBER:</span>
              <span className="font-mono text-slate-900 font-medium">***-**-6789</span>
            </div>
          </div>

          <table className="w-full text-left text-[9px] mt-4 border-collapse">
            <thead>
              <tr className="border-b border-slate-300 text-slate-600 font-black">
                <th className="pb-1">INCOME CATEGORY</th>
                <th className="pb-1">RATE</th>
                <th className="pb-1">HOURS</th>
                <th className="pb-1">CURRENT GROSS</th>
                <th className="pb-1 text-right">YTD TOTALS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-1 font-semibold text-slate-900">Regular Base Wage</td>
                <td className="py-1 font-mono">$45.00</td>
                <td className="py-1 font-mono">40.00</td>
                <td className="py-1 font-mono font-medium text-slate-900">$3,600.00</td>
                <td className="py-1 font-mono text-right font-medium text-slate-900">$54,000.00</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold text-slate-900">Overtime Earnings</td>
                <td className="py-1 font-mono">$67.50</td>
                <td className="py-1 font-mono">5.50</td>
                <td className="py-1 font-mono">$371.25</td>
                <td className="py-1 font-mono text-right">$4,200.00</td>
              </tr>
              <tr>
                <td className="py-1 font-semibold text-slate-900">Bonus Distribution</td>
                <td className="py-1 font-mono">-</td>
                <td className="py-1 font-mono">-</td>
                <td className="py-1 font-mono">$0.00</td>
                <td className="py-1 font-mono text-right font-medium text-slate-900">$12,500.00</td>
              </tr>
            </tbody>
          </table>

          <div className="border-t border-slate-300 pt-3 flex justify-between font-bold text-slate-950 text-xs">
            <span>TOTAL GROSS PAY</span>
            <span className="font-mono">$3,971.25</span>
          </div>
        </div>
      );
    }

    if (documentCategory === 'APPRAISAL_1004') {
      return (
        <div className="p-8 font-sans text-[10px] text-slate-800 space-y-4">
          <div className="text-center border-b border-slate-400 pb-2">
            <h1 className="text-xs font-black tracking-tight uppercase text-slate-950">UNIFORM RESIDENTIAL APPRAISAL REPORT</h1>
            <p className="text-[8px] text-slate-500">HUD Form 1004 / Freddie Mac Form 70</p>
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

          <div className="border border-slate-200 p-2 space-y-1">
            <h3 className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase tracking-wider text-[8px]">Neighborhood Trends</h3>
            <div className="grid grid-cols-3 gap-1">
              <div>
                <span className="block text-[7px] text-slate-500">Property Values:</span>
                <span className="font-medium text-slate-900">Stable</span>
              </div>
              <div>
                <span className="block text-[7px] text-slate-500">Demand/Supply:</span>
                <span className="font-medium text-slate-900">In Balance</span>
              </div>
              <div>
                <span className="block text-[7px] text-slate-500">Marketing Time:</span>
                <span className="font-medium text-slate-900">Under 3 Mos</span>
              </div>
            </div>
          </div>

          <div className="border border-slate-200 p-2 space-y-2">
            <h3 className="font-bold text-slate-900 border-b border-slate-200 pb-1 uppercase tracking-wider text-[8px]">Sales Comparison Analysis (Comparables Selection)</h3>
            <div className="bg-slate-100 p-1 rounded font-mono text-[8px] leading-tight text-slate-700">
              <p>Comparable Sales Adjustments:</p>
              <p>- Comp 1 (0.25 miles): Sale Price $1,120,000 | Net Adjust: +$30,000 | Gross Adjust: 2.7%</p>
              <p>- Comp 2 (0.45 miles): Sale Price $1,175,000 | Net Adjust: -$25,000 | Gross Adjust: 2.1%</p>
              <p>- Comp 3 (0.95 miles): Sale Price $1,145,000 | Net Adjust: +$5,000  | Gross Adjust: 0.4%</p>
            </div>
          </div>

          <div className="border border-slate-200 p-2 text-[8px] space-y-1">
            <h3 className="font-bold text-slate-900 uppercase text-[8px]">Appraiser Reconciliation & Remarks</h3>
            <p className="text-slate-600 leading-normal">
              "The physical condition of the subject property is assessed as Q3. Attic and crawlspace inspections were completed; utilities are active. Potability test cleared. No peeling paint or active termite damage detected. Leased solar panel installation observed with transfer terms reviewed."
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="p-16 text-center text-slate-400 font-medium">
        <p>Rendering generic document pages...</p>
      </div>
    );
  };

  const isCurrentPageHighlighted = activeHighlight && activeHighlight.pageIndex === (currentPage - 1);

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      {/* Dynamic PDF Canvas Control bar [cite: 177] */}
      <div className="flex justify-between items-center px-4 py-2 bg-slate-950 border-b border-slate-800 z-10">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] font-black tracking-widest rounded uppercase">
            {documentCategory}
          </span>
          <span className="text-[11px] text-slate-400 font-bold">
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={onZoomOut}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-850 rounded transition-all"
            title="Zoom Out"
          >
            ➖
          </button>
          <span className="text-[11px] font-mono text-slate-400 px-1 font-bold">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            onClick={onZoomIn}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-850 rounded transition-all"
            title="Zoom In"
          >
            ➕
          </button>
          <button
            onClick={onResetZoom}
            className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-300 rounded transition-all font-bold"
            title="Reset Zoom"
          >
            RESET
          </button>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={onPrevPage}
            disabled={currentPage === 1}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 disabled:text-slate-600 disabled:pointer-events-none rounded border border-slate-800 text-[10px] font-bold transition-all"
          >
            ◀ PREV
          </button>
          <button
            onClick={onNextPage}
            disabled={currentPage === totalPages}
            className="px-2 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 disabled:text-slate-600 disabled:pointer-events-none rounded border border-slate-800 text-[10px] font-bold transition-all"
          >
            NEXT ▶
          </button>
        </div>
      </div>

      {/* Main coordinate rendering canvas viewport [cite: 177] */}
      <div 
        ref={containerRef}
        className="flex-1 overflow-auto p-6 bg-slate-950 flex items-start justify-center relative scrollbar-thin"
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
          {/* Render the context-aware high-fidelity dynamic mock-content [cite: 177] */}
          {renderMockDocumentContent()}

          {/* Coordinate Overlay Box Layer [cite: 177] */}
          {isCurrentPageHighlighted && activeHighlight && (
            <div
              ref={highlightRef}
              className="absolute bg-amber-400/25 border-2 border-amber-500 rounded ring-4 ring-amber-500/10 animate-pulse transition-all duration-300 z-10 cursor-pointer flex items-center justify-center group"
              style={{
                left: `${activeHighlight.box[0]}%`,
                top: `${activeHighlight.box[1]}%`,
                width: `${activeHighlight.box[2]}%`,
                height: `${activeHighlight.box[3]}%`,
              }}
              title="Extracted OCR Coordinate Highlight Box"
            >
              {/* Tooltip to make coordinate review intuitive for underwriters */}
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
