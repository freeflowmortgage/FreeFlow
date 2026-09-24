import type { InspectOverlay } from './livePacket';
import type { MappedIncomeField } from './parseTypes';
import type { CorpYear, SchCYear, ScheduleL } from './components/selfEmployedIncome';

/** BroadcastChannel name shared by the main workspace and the popped-out document pane */
export const SPLIT_DOC_CHANNEL = 'freeflow-split-doc';

/** Serializable snapshot of everything the document pane needs to render */
export type DocPaneSnapshot = {
  mode: 'demo' | 'live';
  loanId: string;
  borrowerName: string;
  activeTab: string;
  yearIndex: 0 | 1;
  twoYear: boolean;
  selectedId: string | null;
  schC: SchCYear;
  corp: CorpYear;
  scheduleL: ScheduleL;
  showLiquidity: boolean;
  paystub: {
    employer: string;
    borrower: string;
    hourly: number;
    hours: number;
    periodPay: number;
    ytd: number;
  };
  live: {
    /** File transfers via the structured-clone algorithm; null when the transfer failed */
    file: File | null;
    fileName: string;
    pageIndex: number;
    pageCount: number;
    fields: MappedIncomeField[];
    /**
     * The box the main window resolved for the clicked QA row. The selected id
     * is the QA row's, which matches no box on the PDF, so without this the
     * second window neither highlighted nor scrolled to the figure.
     */
    highlight?: InspectOverlay | null;
  } | null;
};

/** Messages exchanged over the channel (doc pane ⇄ main workspace) */
export type SplitDocMessage =
  | { type: 'doc-ready' }
  | { type: 'doc-closed' }
  | { type: 'close-doc' }
  | { type: 'select-field'; id: string }
  | { type: 'year-index'; index: 0 | 1 }
  | { type: 'page-change'; index: number }
  | { type: 'snapshot'; snapshot: DocPaneSnapshot };

// ── Appraisal review dual-monitor sync ────────────────────────────────────────

/** BroadcastChannel name for the appraisal URAR canvas pane */
export const APPRAISAL_DOC_CHANNEL = 'freeflow-appraisal-doc';

/** Serializable snapshot of the appraisal PDF canvas state */
export type AppraisalDocSnapshot = {
  loanId: string;
  borrower: string;
  programLabel: string;
  currentPage: number;
  zoomScale: number;
  totalPages: number;
  activeHighlight: { pageIndex: number; box: [number, number, number, number] } | null;
  documentCategory: string;
  documentType: string;
  /** Static asset URL or blob: URL — blob URLs stay valid across same-origin windows */
  documentUrl: string;
  mappedBoxes: Array<{ pageIndex: number; box: [number, number, number, number] }>;
};

export type AppraisalDocMessage =
  | { type: 'doc-ready' }
  | { type: 'doc-closed' }
  | { type: 'close-doc' }
  | { type: 'nav'; action: 'next' | 'prev' | 'zoom-in' | 'zoom-out' | 'zoom-reset' }
  | { type: 'snapshot'; snapshot: AppraisalDocSnapshot };
