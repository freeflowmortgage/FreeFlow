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
  form: 'W-2' | 'Schedule C' | 'Schedule E' | 'Form 1040' | 'Form 1120-S' | 'Form 1065';
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: string;
  value: string;
  numericValue: number;
  pageIndex: number;
  wordIndex: number;
  box: { x: number; y: number; w: number; h: number };
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
};

export type LiveParseSession = {
  file: File;
  fileName: string;
  result: ParseResponse;
};

export function pageLooksLikeW2(page: ParsePage): boolean {
  return page.formIds.some((id) => /w-?2/i.test(id));
}

export function pageLooksSelfEmployed(page: ParsePage): boolean {
  return page.formIds.some((id) =>
    /schedule\s+[cef]|form\s+1120|form\s+1065|k-1|form\s+8825|form\s+4562/i.test(id)
  );
}
