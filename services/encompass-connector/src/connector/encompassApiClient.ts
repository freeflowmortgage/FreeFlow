import { createHash } from 'node:crypto';
import {
  EncompassConnectorError,
  type DownloadedEncompassAttachment,
  type EncompassAttachmentRef,
  type EncompassConnector,
  type EncompassConnectorContext,
} from '@mortgage-pos/encompass-connector-contract';

export const MAX_ENCOMPASS_ATTACHMENT_BYTES = 40 * 1024 * 1024;
const API_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const DEFAULT_ORIGIN = 'https://api.elliemae.com';

export type EncompassRuntimeCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
  instanceId: string;
  apiOrigin?: string;
}>;

/**
 * Connector-only Encompass V3 client. The caller-facing contract intentionally
 * exposes identifiers and bytes only; no provider credential crosses this
 * boundary or is included in thrown messages.
 */
export class EncompassV3Connector implements EncompassConnector {
  readonly kind = 'custom' as const;
  private accessToken?: string;

  constructor(
    private readonly credentials: EncompassRuntimeCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listActiveAttachments(
    _context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    const response = await this.apiFetch(
      `/encompass/v3/loans/${encodeURIComponent(loanGuid)}/attachments?activeOnly=true&view=Summary`,
      { method: 'GET' },
      true,
    );
    const value = await readJson(response, 'ENCOMPASS_ATTACHMENTS_INVALID');
    const attachments = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.attachments)
        ? value.attachments
        : null;
    if (!attachments) {
      throw new EncompassConnectorError('ENCOMPASS_ATTACHMENTS_INVALID', 'Encompass returned an invalid attachment list.', false);
    }
    return attachments.map((attachment) => {
      const id = isRecord(attachment) && typeof attachment.id === 'string' ? attachment.id.trim() : '';
      if (!id) throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_ID_INVALID', 'Encompass omitted an attachment identifier.', false);
      return { id };
    });
  }

  async downloadOriginalAttachment(
    _context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    // V3 replaces the deprecated V1 eFolder attachment download API. Do not
    // use a guessed direct file URL: Encompass returns a short-lived URL here.
    const contractResponse = await this.apiFetch(
      `/encompass/v3/loans/${encodeURIComponent(loanGuid)}/attachmentDownloadUrl`,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ attachments: [attachmentId] }),
      },
      false,
    );
    const contract = parseDownloadContract(
      await readJson(contractResponse, 'ENCOMPASS_DOWNLOAD_CONTRACT_INVALID'),
      attachmentId,
    );
    const url = safeDownloadUrl(contract.url);
    const response = await this.fetchWithRetry(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: contract.authorization ? { authorization: contract.authorization } : undefined,
    });
    if (!response.ok) throw httpError('ENCOMPASS_DOWNLOAD_FAILED', response.status);
    return readPdf(response);
  }

  private async apiFetch(path: string, init: RequestInit, retryable: boolean): Promise<Response> {
    const token = await this.getAccessToken();
    const response = await this.fetchWithRetry(`${apiOrigin(this.credentials.apiOrigin)}${path}`, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { ...init.headers, authorization: `Bearer ${token}` },
    }, retryable);
    if (!response.ok) throw httpError('ENCOMPASS_API_FAILED', response.status);
    return response;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    const basic = Buffer.from(`${this.credentials.clientId}:${this.credentials.clientSecret}`, 'utf8').toString('base64');
    const response = await this.fetchImpl(`${apiOrigin(this.credentials.apiOrigin)}/oauth2/v1/token`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: {
        authorization: `Basic ${basic}`,
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', instance_id: this.credentials.instanceId, scope: 'lp' }),
    });
    if (!response.ok) throw httpError('ENCOMPASS_AUTH_FAILED', response.status);
    const body = await readJson(response, 'ENCOMPASS_AUTH_RESPONSE_INVALID');
    const token = isRecord(body) && typeof body.access_token === 'string' ? body.access_token.trim() : '';
    if (!token) throw new EncompassConnectorError('ENCOMPASS_AUTH_RESPONSE_INVALID', 'Encompass returned an invalid authentication response.', false);
    this.accessToken = token;
    return token;
  }

  private async fetchWithRetry(url: string, init: RequestInit, retryable = true): Promise<Response> {
    try {
      const first = await this.fetchImpl(url, init);
      if (!retryable || first.status < 500) return first;
    } catch (error) {
      if (!retryable || !isNetworkError(error)) throw error;
    }
    // Retry exactly once, only for safe reads. Never retry OAuth or the signed
    // URL creation POST because their provider-side semantics are not assumed.
    return this.fetchImpl(url, init);
  }
}

export function readEncompassRuntimeCredentials(env: NodeJS.ProcessEnv): EncompassRuntimeCredentials {
  const clientId = required(env.ENCOMPASS_CLIENT_ID, 'ENCOMPASS_CLIENT_ID');
  const clientSecret = required(env.ENCOMPASS_CLIENT_SECRET, 'ENCOMPASS_CLIENT_SECRET');
  const instanceId = required(env.ENCOMPASS_INSTANCE_ID, 'ENCOMPASS_INSTANCE_ID');
  return { clientId, clientSecret, instanceId, apiOrigin: env.ENCOMPASS_API_ORIGIN?.trim() || undefined };
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', `${name} is required for real Encompass mode.`, false);
  return trimmed;
}

function apiOrigin(value?: string): string {
  let url: URL;
  try { url = new URL((value || DEFAULT_ORIGIN).replace(/\/$/, '')); }
  catch { throw new EncompassConnectorError('ENCOMPASS_API_ORIGIN_INVALID', 'Encompass API origin is invalid.', false); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new EncompassConnectorError('ENCOMPASS_API_ORIGIN_INVALID', 'Encompass API origin is invalid.', false);
  }
  return url.origin;
}

function safeDownloadUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new EncompassConnectorError('ENCOMPASS_DOWNLOAD_URL_REJECTED', 'Encompass returned an invalid download URL.', false); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new EncompassConnectorError('ENCOMPASS_DOWNLOAD_URL_REJECTED', 'Encompass returned an unsafe download URL.', false);
  }
  return url.toString();
}

function parseDownloadContract(value: unknown, attachmentId: string): { url: string; authorization?: string } {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.attachments)
      ? value.attachments
      : [value];
  const selected = candidates.find((item) => isRecord(item) && (!item.id || item.id === attachmentId));
  if (!isRecord(selected)) throw new EncompassConnectorError('ENCOMPASS_DOWNLOAD_CONTRACT_INVALID', 'Encompass did not return a download contract.', false);
  const url = stringValue(selected.url) ?? stringValue(selected.downloadUrl) ?? stringValue(selected.mediaUrl);
  const authorization = stringValue(selected.authorizationHeader) ?? stringValue(selected.authorization) ?? stringValue(selected['elli-signature']);
  if (!url) throw new EncompassConnectorError('ENCOMPASS_DOWNLOAD_CONTRACT_INVALID', 'Encompass download contract omitted a URL.', false);
  return { url, ...(authorization ? { authorization } : {}) };
}

async function readPdf(response: Response): Promise<DownloadedEncompassAttachment> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_ENCOMPASS_ATTACHMENT_BYTES) {
    throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the permitted size.', false);
  }
  if (!response.body) throw new EncompassConnectorError('ENCOMPASS_DOWNLOAD_EMPTY', 'Encompass attachment was empty.', true);
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_ENCOMPASS_ATTACHMENT_BYTES) throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the permitted size.', false);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    bytes.fill(0);
    throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_NOT_PDF', 'Attachment is not a PDF.', false);
  }
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function readJson(response: Response, safeCode: string): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new EncompassConnectorError(safeCode, 'Encompass returned malformed JSON.', false); }
}

function httpError(prefix: string, status: number): EncompassConnectorError {
  return new EncompassConnectorError(`${prefix}_${status}`, `Encompass returned HTTP ${status}.`, status === 408 || status === 429 || status >= 500);
}
function isNetworkError(error: unknown): boolean { return error instanceof TypeError; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
