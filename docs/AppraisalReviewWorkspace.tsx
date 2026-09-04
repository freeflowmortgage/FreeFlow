import { Eye, MapPin } from 'lucide-react';
import { PdfCoordinateCanvas } from './PdfCoordinateCanvas';
import { usePdfViewer, type SpatialCoordinates } from '../hooks/usePdfViewer';

const APPRAISAL_COORDINATE_MAP: Record<string, { label: string; pageIndex: number; box: SpatialCoordinates['box'] }> = {
  URAR_SUBJECT_CONTRACT: { label: 'Subject / contract', pageIndex: 0, box: [12, 18, 76, 5] },
  URAR_NEIGHBORHOOD_TRENDS: { label: 'Neighborhood trends', pageIndex: 0, box: [12, 35, 76, 8] },
  URAR_PHYSICAL_REPAIRS: { label: 'Physical repairs', pageIndex: 1, box: [12, 55, 76, 6] },
  URAR_COMP_1_ADJUSTMENT: { label: 'Comp 1 adjustment', pageIndex: 1, box: [35, 22, 15, 4] },
  URAR_CRAWLSPACE_ACC_VIOLATION: { label: 'Crawlspace access', pageIndex: 2, box: [15, 60, 70, 5] },
};

export default function AppraisalReviewWorkspace() {
  const {
    currentPage,
    zoomScale,
    activeHighlight,
    totalPages,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    resetZoom,
    triggerHighlight,
    clearHighlight,
  } = usePdfViewer(3);

  return (
    <div
      data-testid="appraisal-workspace"
      className="flex h-[calc(100vh-8.5rem)] min-h-[780px] w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100"
    >
      <div className="flex h-full w-1/2 min-w-0 flex-col border-r border-slate-800 bg-slate-900">
        <PdfCoordinateCanvas
          currentPage={currentPage}
          zoomScale={zoomScale}
          activeHighlight={activeHighlight}
          totalPages={totalPages}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          documentCategory="APPRAISAL_1004"
          documentType="URAR"
        />
      </div>

      <div className="flex h-full w-1/2 min-w-0 flex-col overflow-y-auto bg-slate-950 p-6">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-400">Collateral</p>
        <h2 className="mt-1 text-lg font-bold text-white">Appraisal review</h2>
        <p className="mt-1 text-xs text-slate-400">
          Inspect URAR fields to map bounding boxes and jump the viewport to the source page.
        </p>

        <ul className="mt-6 space-y-2">
          {Object.entries(APPRAISAL_COORDINATE_MAP).map(([code, marker]) => {
            const active =
              activeHighlight?.pageIndex === marker.pageIndex &&
              activeHighlight.box.join(',') === marker.box.join(',');
            return (
              <li key={code}>
                <button
                  type="button"
                  data-testid={`inspect-${code}`}
                  onClick={() => triggerHighlight({ pageIndex: marker.pageIndex, box: marker.box })}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-slate-800 bg-slate-900/60 text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span>
                    <span className="flex items-center gap-2 text-xs font-bold">
                      <MapPin className="h-3.5 w-3.5" />
                      {marker.label}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                      page {marker.pageIndex + 1} · [{marker.box.join(', ')}]
                    </span>
                  </span>
                  <Eye className="h-4 w-4 text-slate-500" />
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          data-testid="clear-highlight"
          onClick={clearHighlight}
          className="mt-4 self-start rounded border border-slate-800 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 hover:text-white"
        >
          Clear highlight
        </button>
      </div>
    </div>
  );
}
