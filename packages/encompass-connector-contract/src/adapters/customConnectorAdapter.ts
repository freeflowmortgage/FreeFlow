import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { EncompassConnector } from '../connector';
import { EncompassConnectorError } from '../errors';
import { assertNoLosCredentials } from '../secrets';
import {
  CONNECTOR_SERVICE_CONTRACT,
  type ConnectorServiceDownloadRequest,
  type ConnectorServiceListRequest,
} from '../serviceContract';
import type {
  ConnectorDeploymentBinding,
  ConnectorServiceAuth,
  DownloadedEncompassAttachment,
  EncompassAttachmentRef,
  EncompassConnectorContext,
  EncompassApprovedIncomeUpdate,
  EncompassWriteResult,
} from '../types';

export const MAX_CONNECTOR_PDF_BYTES = 40 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

type Fetch = typeof fetch;

/**
 * Orchestrator-side HTTP/S2S client for the separate connector ECS service
 * (`services/encompass-connector`). This adapter does not host LOS I/O.
 * LOS credentials never leave that service; this client sends identity + service auth only.
 */
export class CustomConnectorAdapter implements EncompassConnector {
  readonly kind = 'custom' as const;
  private readonly origin: string;

  constructor(private readonly options: Readonly<{
    binding: ConnectorDeploymentBinding;
    serviceAuth?: ConnectorServiceAuth;
    fetch?: Fetch;
  }>) {
    if (!hasServiceAuth(options.serviceAuth)) {
      throw new EncompassConnectorError(
        'CONNECTOR_SERVICE_AUTH_MISSING',
        'The custom connector service requires service-to-service authentication.',
        false,
      );
    }
    this.origin = normalizeServiceOrigin(options.binding.serviceBaseUrl, 'kind' in options.serviceAuth);
  }

  async listActiveAttachments(
    context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    const body: ConnectorServiceListRequest = this.requestBody(context, loanGuid);
    const response = await this.serviceFetch(CONNECTOR_SERVICE_CONTRACT.listPath, body, REQUEST_TIMEOUT_MS);
    const value = await readJson(response, 'CONNECTOR_LIST_INVALID');
    const candidates = Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.attachments)
        ? value.attachments
        : null;
    if (!candidates) {
      throw new EncompassConnectorError('CONNECTOR_LIST_INVALID', 'Unexpected attachment list response.', false);
    }
    return candidates.map((item) => {
      const id = isRecord(item) && typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) {
        throw new EncompassConnectorError('CONNECTOR_ATTACHMENT_ID_INVALID', 'Attachment response omitted an identifier.', false);
      }
      return { id };
    });
  }

  async downloadOriginalAttachment(
    context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    const body: ConnectorServiceDownloadRequest = { ...this.requestBody(context, loanGuid), attachmentId };
    const response = await this.serviceFetch(CONNECTOR_SERVICE_CONTRACT.downloadPath, body, DOWNLOAD_TIMEOUT_MS);
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CONNECTOR_PDF_BYTES) {
      throw new EncompassConnectorError('CONNECTOR_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the parser size limit.', false);
    }
    const bytes = await readBounded(response, MAX_CONNECTOR_PDF_BYTES);
    if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
      throw new EncompassConnectorError('CONNECTOR_ATTACHMENT_NOT_PDF', 'Attachment is not a PDF.', false);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const declaredHash = response.headers.get('x-content-sha256')?.trim().toLowerCase();
    if (declaredHash && declaredHash !== sha256) {
      throw new EncompassConnectorError('CONNECTOR_ATTACHMENT_HASH_MISMATCH', 'Attachment digest did not match the service contract.', false);
    }
    return { bytes, sha256 };
  }

  async applyApprovedIncomeUpdate(
    context: EncompassConnectorContext,
    loanGuid: string,
    update: EncompassApprovedIncomeUpdate,
  ): Promise<EncompassWriteResult> {
    validateUpdate(update);
    const body = { ...this.requestBody(context, loanGuid), ...update };
    const response = await this.serviceFetch(CONNECTOR_SERVICE_CONTRACT.applyUpdatePath, body, REQUEST_TIMEOUT_MS);
    const value = await readJson(response, 'CONNECTOR_WRITE_INVALID');
    if (!isRecord(value) || value.applied !== true) {
      throw new EncompassConnectorError('CONNECTOR_WRITE_INVALID', 'Unexpected connector write response.', false);
    }
    return typeof value.providerRevision === 'string'
      ? { providerRevision: value.providerRevision.slice(0, 100) }
      : {};
  }

  async readFields(
    context: EncompassConnectorContext,
    loanGuid: string,
    fieldNames: ReadonlyArray<string>,
  ): Promise<Readonly<Record<string, string>>> {
    validateFieldNames(fieldNames);
    const body = { ...this.requestBody(context, loanGuid), fieldNames };
    const response = await this.serviceFetch(CONNECTOR_SERVICE_CONTRACT.readFieldsPath, body, REQUEST_TIMEOUT_MS);
    const value = await readJson(response, 'CONNECTOR_FIELDS_INVALID');
    if (!isRecord(value) || !isRecord(value.fields)) {
      throw new EncompassConnectorError('CONNECTOR_FIELDS_INVALID', 'Unexpected connector field response.', false);
    }
    const allowed = new Set(fieldNames);
    return Object.fromEntries(Object.entries(value.fields)
      .filter(([name, fieldValue]) => allowed.has(name) && typeof fieldValue === 'string')
      .map(([name, fieldValue]) => [name, String(fieldValue).slice(0, 500)]));
  }

  private requestBody(context: EncompassConnectorContext, loanGuid: string): ConnectorServiceListRequest {
    const payload: ConnectorServiceListRequest = {
      contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
      deploymentId: this.options.binding.deploymentId,
      lenderId: this.options.binding.lenderId,
      tenantId: context.tenantId,
      loanId: context.loanId,
      loanGuid,
      correlationId: context.correlationId,
    };
    assertNoLosCredentials(payload);
    return payload;
  }

  private async serviceFetch(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    assertNoLosCredentials(body);
    const fetchImpl = this.options.fetch ?? fetch;
    const bodyText = JSON.stringify(body);
    const response = await fetchImpl(`${this.origin}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json, application/pdf',
        'content-type': 'application/json',
        ...serviceAuthHeaders(this.options.serviceAuth!, 'POST', path, bodyText),
      },
      body: bodyText,
    });
    if (!response.ok) {
      let safeCode = `CONNECTOR_SERVICE_FAILED_${response.status}`;
      try {
        const errorBody = await response.clone().json() as unknown;
        if (isRecord(errorBody) && errorBody.safeCode === 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN') {
          safeCode = errorBody.safeCode;
        }
      } catch {
        // The status-derived code remains safe and provider-neutral.
      }
      throw new EncompassConnectorError(
        safeCode,
        `Connector service returned HTTP ${response.status}.`,
        safeCode !== 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN'
          && (response.status === 408 || response.status === 429 || response.status >= 500),
      );
    }
    return response;
  }
}

const FIELD_NAME = /^(?:CX\.FREEFLOW\.[A-Z0-9.]+|10[1-7])$/;

function validateFieldNames(fieldNames: ReadonlyArray<string>): void {
  if (fieldNames.length < 1 || fieldNames.length > 32 || fieldNames.some((name) => !FIELD_NAME.test(name))) {
    throw new EncompassConnectorError('CONNECTOR_FIELDS_INVALID', 'The requested field set is invalid.', false);
  }
}

function validateUpdate(update: EncompassApprovedIncomeUpdate): void {
  if (!/^[0-9a-f-]{36}$/i.test(update.approvalEventId)) {
    throw new EncompassConnectorError('CONNECTOR_WRITE_INVALID', 'The approval reference is invalid.', false);
  }
  validateFieldNames(update.fields.map((field) => field.fieldName));
  if (new Set(update.fields.map((field) => field.fieldName)).size !== update.fields.length
    || update.fields.some((field) => typeof field.value !== 'string' || field.value.length > 500)) {
    throw new EncompassConnectorError('CONNECTOR_WRITE_INVALID', 'The field update is invalid.', false);
  }
}

function hasServiceAuth(auth: ConnectorServiceAuth | undefined): auth is ConnectorServiceAuth {
  if (!auth) return false;
  return 'authorizationHeader' in auth
    ? Boolean(auth.authorizationHeader.trim())
    : Boolean(auth.serviceId.trim() && auth.signingKey.trim());
}

function serviceAuthHeaders(auth: ConnectorServiceAuth, method: string, path: string, body: string): Record<string, string> {
  if ('authorizationHeader' in auth) return { authorization: auth.authorizationHeader };
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString('base64url');
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`;
  return {
    'x-freeflow-service-id': auth.serviceId,
    'x-freeflow-timestamp': timestamp,
    'x-freeflow-nonce': nonce,
    'x-freeflow-signature': createHmac('sha256', auth.signingKey).update(canonical, 'utf8').digest('hex'),
  };
}

function normalizeServiceOrigin(baseUrl: string | undefined, allowPrivateHttp: boolean): string {
  if (!baseUrl?.trim()) {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_URL_MISSING', 'The custom connector service origin is not configured.', false);
  }
  let url: URL;
  try {
    url = new URL(baseUrl.replace(/\/$/, ''));
  } catch {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_URL_INVALID', 'The custom connector service origin is invalid.', false);
  }
  const privateCloudMapHttp = allowPrivateHttp
    && url.protocol === 'http:'
    && url.hostname.endsWith('.freeflow.local');
  if ((!privateCloudMapHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_URL_INVALID', 'The custom connector service origin is invalid.', false);
  }
  return url.origin;
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.body) throw new EncompassConnectorError('CONNECTOR_DOWNLOAD_EMPTY', 'Attachment body is empty.', true);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) {
        throw new EncompassConnectorError('CONNECTOR_ATTACHMENT_TOO_LARGE', 'Attachment exceeds the parser size limit.', false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function readJson(response: Response, safeCode: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new EncompassConnectorError(safeCode, 'Remote service returned malformed JSON.', false);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
