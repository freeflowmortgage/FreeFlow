import { createHash } from 'node:crypto';
import { selectPersistableParserExtraction, type PersistableIncomeExtraction } from './persistedParserExtraction';

export const MAX_ENCOMPASS_PDF_BYTES = 40 * 1024 * 1024;
const DEFAULT_API_ORIGIN = 'https://api.elliemae.com';
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

export type EncompassAttachment = Readonly<{ id: string }>;
export type ParsedAttachment = Readonly<{
  pageCount: number;
  documentCategory: string;
  parserVersion: string;
  confidence: number | null;
  extraction: PersistableIncomeExtraction;
}>;

export type DownloadedAttachment = Readonly<{
  bytes: Uint8Array;
  sha256: string;
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

export class EncompassApiClient {
  private accessToken?: string;

  constructor(private readonly options: Readonly<{
    clientId: string;
    clientSecret: string;
    instanceId: string;
    baseUrl?: string;
    fetch?: Fetch;
  }>) {}

  async listActiveAttachments(loanGuid: string): Promise<EncompassAttachment[]> {
    const response = await this.apiFetch(
      `/encompass/v3/loans/${encodeURIComponent(loanGuid)}/attachments?activeOnly=true&view=Summary`,
      { method: 'GET' },
    );
    const value = await readJson(response, 'ENCOMPASS_ATTACHMENTS_INVALID');
    const candidates = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.attachments)
        ? value.attachments
        : null;
    if (!candidates) throw new EncompassApiError('ENCOMPASS_ATTACHMENTS_INVALID', 'Unexpected attachment list response.', false);

    return candidates.map((item) => {
      const id = isRecord(item) && typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) throw new EncompassApiError('ENCOMPASS_ATTACHMENT_ID_INVALID', 'Attachment response omitted an identifier.', false);
      return { id };
    });
  }

  async downloadOriginalAttachment(loanGuid: string, attachmentId: string): Promise<DownloadedAttachment> {
    const response = await this.apiFetch(
      `/encompass/v3/loans/${encodeURIComponent(loanGuid)}/attachmentDownloadUrl`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ attachments: [attachmentId] }),
      },
    );
    const contract = parseDownloadContract(await readJson(response, 'ENCOMPASS_DOWNLOAD_CONTRACT_INVALID'), attachmentId);
    const url = new URL(contract.url);
    if (url.protocol !== 'https:') {
      throw new EncompassApiError('ENCOMPASS_DOWNLOAD_URL_REJECTED', 'Attachment download URL must use HTTPS.', false);
    }

    const download = await this.fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: contract.authorization ? { authorization: contract.authorization } : undefined,
    });
    if (!download.ok) throw httpError('ENCOMPASS_DOWNLOAD_FAILED', download.status);

    const declaredLength = Number(download.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ENCOMPASS_PDF_BYTES) {
      throw new EncompassApiError('ENCOMPASS_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the parser size limit.', false);
    }
    const bytes = await readBounded(download, MAX_ENCOMPASS_PDF_BYTES);
    if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new EncompassApiError('ENCOMPASS_ATTACHMENT_NOT_PDF', 'Attachment is not a PDF.', false);
    }
    return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  private get fetchImpl(): Fetch {
    return this.options.fetch ?? fetch;
  }

  private async apiFetch(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    const origin = normalizeApiOrigin(this.options.baseUrl);
    const response = await this.fetchImpl(`${origin}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw httpError('ENCOMPASS_API_FAILED', response.status);
    return response;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const credentials = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`, 'utf8').toString('base64');
    const response = await this.fetchImpl(`${normalizeApiOrigin(this.options.baseUrl)}/oauth2/v1/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        instance_id: this.options.instanceId,
        scope: 'lp',
      }),
    });
    if (!response.ok) throw httpError('ENCOMPASS_AUTH_FAILED', response.status);
    const value = await readJson(response, 'ENCOMPASS_AUTH_RESPONSE_INVALID');
    const token = isRecord(value) && typeof value.access_token === 'string' ? value.access_token.trim() : '';
    if (!token) throw new EncompassApiError('ENCOMPASS_AUTH_RESPONSE_INVALID', 'OAuth response omitted the access token.', false);
    this.accessToken = token;
    return token;
  }
}

export async function parseWithIncomeService(
  bytes: Uint8Array,
  options: Readonly<{ parserUrl: string; fetch?: Fetch }>,
): Promise<ParsedAttachment> {
  const response = await (options.fetch ?? fetch)(options.parserUrl, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(300_000),
    headers: { 'content-type': 'application/pdf', 'x-document-title': 'encompass-document.pdf' },
    body: Buffer.from(bytes),
  });
  if (!response.ok) throw httpError('DOCUMENT_PARSER_FAILED', response.status);
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
    parserVersion: 'income-parser-v5',
    confidence: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    extraction,
  };
}

function normalizeApiOrigin(baseUrl?: string): string {
  const url = new URL((baseUrl || DEFAULT_API_ORIGIN).replace(/\/$/, ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new EncompassApiError('ENCOMPASS_BASE_URL_INVALID', 'Encompass API origin is invalid.', false);
  }
  return url.origin;
}

function parseDownloadContract(value: unknown, attachmentId: string): { url: string; authorization?: string } {
  const roots = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.attachments) ? value.attachments : [value];
  const selected = roots.find((item) => isRecord(item) && (!item.id || item.id === attachmentId));
  if (!isRecord(selected)) throw new EncompassApiError('ENCOMPASS_DOWNLOAD_CONTRACT_INVALID', 'Missing attachment download contract.', false);
  const url = stringValue(selected.url) ?? stringValue(selected.downloadUrl) ?? stringValue(selected.mediaUrl);
  const authorization = stringValue(selected.authorizationHeader) ?? stringValue(selected.authorization) ?? stringValue(selected['elli-signature']);
  if (!url) throw new EncompassApiError('ENCOMPASS_DOWNLOAD_CONTRACT_INVALID', 'Download contract omitted its URL.', false);
  return { url, ...(authorization ? { authorization } : {}) };
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new EncompassApiError('ENCOMPASS_DOWNLOAD_EMPTY', 'Attachment body is empty.', true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) throw new EncompassApiError('ENCOMPASS_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the parser size limit.', false);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function readJson(response: Response, safeCode: string): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new EncompassApiError(safeCode, 'Remote service returned malformed JSON.', false); }
}

function httpError(prefix: string, status: number): EncompassApiError {
  return new EncompassApiError(`${prefix}_${status}`, `Remote service returned HTTP ${status}.`, status === 408 || status === 429 || status >= 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
