import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { ApiError, sendApiError } from '../../http/apiError';
import { EncompassApiError } from './encompassApi';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const MAX_PARSER_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_PAGES = 150;
const MAX_WORDS_PER_PAGE = 50_000;

type JsonObject = Record<string, unknown>;

function parserUrl(): string {
  const value = process.env.DOC_PARSER_SERVICE_URL?.trim();
  if (!value) throw new EncompassApiError('DOCUMENT_PARSER_UNAVAILABLE', 'Document processing is unavailable.', true);
  return value;
}

async function readPdf(req: NextApiRequest): Promise<Buffer> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
  if (type !== 'application/pdf') throw new ApiError(422, 'UNSUPPORTED_DOCUMENT_MEDIA', 'Only PDF documents are supported.');
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_DOCUMENT_BYTES) throw new ApiError(422, 'DOCUMENT_TOO_LARGE', 'The document exceeds the allowed size.');
      chunks.push(bytes);
    }
  } catch (error) {
    chunks.forEach((chunk) => chunk.fill(0));
    throw error;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ApiError(422, 'INVALID_PDF', 'The uploaded document is not a valid PDF.');
  }
  return bytes;
}

/**
 * Returns the private parser's full page-and-box result for the authenticated
 * browser session. This path deliberately performs no database or queue I/O.
 */
export async function parseIncomeDocumentPreview(
  bytes: Uint8Array,
  options: Readonly<{ parserUrl: string; fetch?: typeof fetch }>,
): Promise<JsonObject> {
  const response = await (options.fetch ?? fetch)(options.parserUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(300_000),
    headers: { 'content-type': 'application/pdf', 'x-document-title': 'income-preview.pdf' },
    // Next's DOM typings omit Node's Buffer body even though undici accepts it.
    // Keep the same mutable buffer so the handler can erase it in finally.
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new EncompassApiError('DOCUMENT_PARSER_FAILED', 'Document processing failed.', response.status === 408 || response.status === 429 || response.status >= 500);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_PARSER_RESPONSE_BYTES) {
    throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_TOO_LARGE', 'Document processor response exceeded the allowed size.', false);
  }
  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (responseBytes.byteLength > MAX_PARSER_RESPONSE_BYTES) {
    throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_TOO_LARGE', 'Document processor response exceeded the allowed size.', false);
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(responseBytes)); }
  catch { throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Document processor returned malformed data.', false); }
  finally { responseBytes.fill(0); }
  const envelope = record(value);
  const result = record(envelope?.result) ?? envelope;
  if (!result) throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Document processor returned malformed data.', false);
  validatePreviewResult(result);
  return result;
}

function validatePreviewResult(result: JsonObject): void {
  const totalPages = result.total_pages_scanned;
  const pages = result.pages;
  if (!Number.isInteger(totalPages) || Number(totalPages) < 1 || Number(totalPages) > MAX_PAGES || !Array.isArray(pages) || pages.length > MAX_PAGES) {
    throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Document processor returned invalid page data.', false);
  }
  for (const page of pages) {
    const item = record(page);
    if (!item || !Array.isArray(item.words) || item.words.length > MAX_WORDS_PER_PAGE) {
      throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Document processor returned invalid page data.', false);
    }
  }
  for (const key of ['incomeFields', 'scheduleEProperties', 'formExtracts', 'w2Extracts', 'unresolved_statements']) {
    if (result[key] !== undefined && (!Array.isArray(result[key]) || (result[key] as unknown[]).length > 100_000)) {
      throw new EncompassApiError('DOCUMENT_PARSER_RESPONSE_INVALID', 'Document processor returned invalid extraction data.', false);
    }
  }
}

function record(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

export function createIncomeDocumentPreviewHandler(dependencies = { parse: parseIncomeDocumentPreview }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId } });
    }
    let bytes: Buffer | undefined;
    try {
      bytes = await readPdf(req);
      const result = await dependencies.parse(bytes, { parserUrl: parserUrl() });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      if (error instanceof EncompassApiError) {
        return res.status(error.retryable ? 503 : 422).json({
          error: {
            code: error.retryable ? 'DOCUMENT_PROCESSOR_UNAVAILABLE' : 'DOCUMENT_PROCESSOR_REJECTED',
            message: 'The uploaded document could not be processed.',
            requestId: context.requestId,
          },
        });
      }
      throw error;
    } finally {
      bytes?.fill(0);
    }
  };
}
