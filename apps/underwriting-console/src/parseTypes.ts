export type ParseWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

export type MappedIncomeField = {
  id: string;
  /** Owning live-upload document when several PDFs are on the file. */
  documentId?: string;
  /** Stable page-scoped document entity. Present on fields mapped by current parsers. */
  entityId?: string;
  /** Legacy field definition ID before entity scoping. */
  sourceFieldId?: string;
  form: 'W-2' | 'Paystub' | 'WVOE' | 'Schedule B' | 'Schedule C' | 'Schedule D' | 'Schedule E' | 'Schedule F' | 'Form 1040' | 'Form 1120-S' | 'Form 1065' | 'Form 1120' | 'Form 8825';
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: string;
  value: string;
  numericValue: number;
  pageIndex: number;
  wordIndex: number;
  box: { x: number; y: number; w: number; h: number };
  /** Numeric source cells contributing to a computed aggregate. */
  componentBoxes?: OverlayBox[];
  /** Anything the parser flagged about the page this value came from. */
  reviewNotes?: ReviewNote[];
};

export type ParsePage = {
  index: number;
  formIds: string[];
  isNativeText: boolean;
  inKeepSet?: boolean;
  meanConfidence: number;
  skewDegrees: number;
  words: ParseWord[];
  flags: string[];
};

export type ParseResponse = {
  transaction_id: string;
  /**
   * Deterministic digest of the uploaded bytes, stable across resubmissions of
   * the same file. Use this to recognize a duplicate submission;
   * `transaction_id` is random per request and cannot.
   */
  document_id?: string;
  total_pages_scanned: number;
  pages_extracted_count: number;
  extracted_page_indices: number[];
  ocr_page_count: number;
  has_business_returns: boolean;
  flags: string[];
  classifications: Record<string, string[]>;
  unresolved_statements: { page_index: number; token: string | null; snippet: string }[];
  pages: ParsePage[];
  incomeFields?: MappedIncomeField[];
  parser_engine?: 'python-ocr' | 'native-pdf';
  original_filename?: string;
  /** Every Schedule E Page 1 property column (A/B/C) across all years in the package. */
  scheduleEProperties?: ScheduleEPropertyExtract[];
  /** Label-anchored IRS fields with overlay boxes (W-2, C, F, K-1, 1120, 1040, …). */
  formExtracts?: FormFieldExtract[];
  /** IRS Copy B boxes clipped from the fw2.pdf wage-column matrix. */
  w2Extracts?: W2BoxExtract[];
};

export type ScheduleEExpenseDetermination = {
  status: 'confirmed' | 'reconstructed' | 'mismatch' | 'incomplete';
  itemizedExpenses: number;
  reportedLine20: number;
  line20Source: 'visual' | 'itemized-sum';
  expensesBalanced: boolean;
  calculatedNet: number;
  netBalanced: boolean;
  fairRentalDays?: number;
  personalUseDays?: number;
  rentalMonths?: number;
  daysStatus?: 'accepted' | 'full-year' | 'missing';
  daysBalanced?: boolean;
  recheckedLine?: string;
  recheckedFrom?: number;
  recheckedTo?: number;
  recheckValidated?: boolean;
  recheckSource?: 'form-bound';
};

export type OverlayBox = { x: number; y: number; w: number; h: number };

export type W2BoxExtract = {
  pageIndex: number;
  year: number | null;
  employerName: string;
  ein: string;
  box1: number;
  box2: number;
  box3: number;
  box4: number;
  box5: number;
  box6: number;
  boxes?: Partial<Record<'employer_ein' | 'employer_name' | 'box1' | 'box2' | 'box3' | 'box4' | 'box5' | 'box6', OverlayBox>>;
};

/**
 * Something the parser could not resolve, or a note the underwriter must act
 * on. `warning` means a value was excluded or could not be trusted; `info` is
 * a disclosure such as shift differential being reported inside overtime.
 */
export type ReviewNote = {
  severity: 'warning' | 'info';
  message: string;
};

export type FormFieldExtract = {
  pageIndex: number;
  form: MappedIncomeField['form'];
  sourceFieldId: string;
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: string;
  value: string;
  numericValue: number;
  box: OverlayBox;
  componentBoxes?: OverlayBox[];
  entityId?: string;
  /** Page-level review notes, repeated on each field extracted from that page. */
  reviewNotes?: ReviewNote[];
};

export type ScheduleEPropertyBoxes = {
  address?: OverlayBox;
  type?: OverlayBox;
  days?: OverlayBox;
  financials?: Record<string, OverlayBox>;
};

export type ScheduleEPropertyExtract = {
  pageIndex: number;
  column: 'A' | 'B' | 'C';
  year: number | null;
  address: string;
  propertyType: string;
  fairRentalDays: number;
  financials: Record<string, number>;
  determination?: ScheduleEExpenseDetermination;
  /** Official f1040se clip boxes, 0–1 relative to the parsed page. */
  boxes?: ScheduleEPropertyBoxes;
};

export type LiveParseSession = {
  file: File;
  fileName: string;
  result: ParseResponse;
};

/** One PDF in the live income packet. Load live PDF appends; it does not replace. */
export type LiveDocument = LiveParseSession & {
  id: string;
  sha256: string;
};

export function pageLooksLikeW2(page: ParsePage): boolean {
  return page.formIds.some((id) => /w-?2/i.test(id));
}

export function pageLooksSelfEmployed(page: ParsePage): boolean {
  return page.formIds.some((id) =>
    /schedule\s+[cef]|form\s+1120|form\s+1065|k-1|form\s+8825|form\s+4562/i.test(id)
  );
}

/**
 * Schedule E Page 1 only. Page 2 carries K-1 and trust income, which belongs on
 * a different tab, so a bare "Schedule E" match is not enough to route a page.
 */
export function pageLooksLikeScheduleERentals(page: Pick<ParsePage, 'formIds'>): boolean {
  return page.formIds.some(
    (id) => /schedule\s+e/i.test(id) && !/page\s*2|k-1|trust/i.test(id)
  );
}
