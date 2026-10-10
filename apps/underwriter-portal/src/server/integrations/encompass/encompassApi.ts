import { selectPersistableParserExtraction, type PersistableIncomeExtraction } from './persistedParserExtraction';

// This versions the bounded persistence projection as well as the private
// parser response. Advance it whenever normalized fields or evidence change so
// an older extraction is superseded instead of failing the determinism guard.
const PERSISTED_PARSER_VERSION = 'income-parser-v6';

export type EncompassAttachment = Readonly<{ id: string }>;
export type ParsedAttachment = Readonly<{
  pageCount: number;
  documentCategory: string;
  parserVersion: string;
  confidence: number | null;
  extraction: PersistableIncomeExtraction;
}>;

export class EncompassApiError extends Error {
  constructor(
    public readonly safeCode: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EncompassApiError';
  }
}

type Fetch = typeof fetch;

/**
 * Sends document bytes to FreeFlow's private income parser and retains only
 * bounded normalized metadata. LOS I/O belongs to the separate custom
 * connector and is deliberately absent from the portal process.
 */
export async function parseWithIncomeService(
  bytes: Uint8Array,
  options: Readonly<{ parserUrl: string; fetch?: Fetch }>,
): Promise<ParsedAttachment> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(options.parserUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(300_000),
      headers: { 'content-type': 'application/pdf', 'x-document-title': 'encompass-document.pdf' },
      body: Buffer.from(bytes),
    });
  } catch {
    throw parserUnavailable();
  }
  if (!response.ok) {
    if (response.status === 408 || response.status === 429 || response.status >= 500) throw parserUnavailable();
    throw httpError('DOCUMENT_PARSER_FAILED', response.status);
  }
  const value = await readJson(response, 'DOCUMENT_PARSER_RESPONSE_INVALID');
  if (!isRecord(value)) throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Unexpected parser response.', false);
  const result = isRecord(value.result) ? value.result : value;
  const pageCount = numberValue(result.total_pages_scanned);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 150) {
    throw new EncompassApiError('DOCUMENT_PAGE_LIMIT_INVALID', 'Parser reported an invalid or excessive page count.', false);
  }
  const classifications = isRecord(result.classifications) ? Object.values(result.classifications) : [];
  const category = classifications.flatMap((item) => Array.isArray(item) ? item : [])
    .find((item): item is string => typeof item === 'string') ?? 'UNCLASSIFIED';
  const pages = Array.isArray(result.pages) ? result.pages : [];
  const scores = pages.map((page) => isRecord(page) ? numberValue(page.meanConfidence) : null)
    .filter((score): score is number => score !== null && score >= 0 && score <= 100);
  let extraction: PersistableIncomeExtraction;
  try {
    extraction = selectPersistableParserExtraction(result);
  } catch {
    throw new EncompassApiError('PARSER_NORMALIZED_RESULT_INVALID', 'Parser result did not contain a supported normalized income extraction.', false);
  }
  return {
    pageCount,
    documentCategory: category.slice(0, 100),
    parserVersion: PERSISTED_PARSER_VERSION,
    confidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    extraction,
  };
}

async function readJson(response: Response, safeCode: string): Promise<unknown> {
  let body: string;
  try { body = await response.text(); }
  catch { throw parserUnavailable(); }
  try { return JSON.parse(body) as unknown; }
  catch { throw new EncompassApiError(safeCode, 'Remote service returned malformed JSON.', false); }
}

function parserUnavailable(): EncompassApiError {
  return new EncompassApiError('DOCUMENT_PARSER_UNAVAILABLE', 'Document processing is temporarily unavailable.', true);
}

function httpError(prefix: string, status: number): EncompassApiError {
  return new EncompassApiError(`${prefix}_${status}`, `Remote service returned HTTP ${status}.`, status === 408 || status === 429 || status >= 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
