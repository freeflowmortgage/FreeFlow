import { createHash } from 'node:crypto';
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
    if (!options.serviceAuth?.authorizationHeader.trim()) {
      throw new EncompassConnectorError(
        'CONNECTOR_SERVICE_AUTH_MISSING',
        'The custom connector service requires service-to-service authentication.',
        false,
      );
    }
    this.origin = normalizeServiceOrigin(options.binding.serviceBaseUrl);
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
    const response = await fetchImpl(`${this.origin}${path}`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json, application/pdf',
        'content-type': 'application/json',
        authorization: this.options.serviceAuth!.authorizationHeader,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new EncompassConnectorError(
        `CONNECTOR_SERVICE_FAILED_${response.status}`,
        `Connector service returned HTTP ${response.status}.`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return response;
  }
}

function normalizeServiceOrigin(baseUrl?: string): string {
  if (!baseUrl?.trim()) {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_URL_MISSING', 'The custom connector service origin is not configured.', false);
  }
  let url: URL;
  try {
    url = new URL(baseUrl.replace(/\/$/, ''));
  } catch {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_URL_INVALID', 'The custom connector service origin is invalid.', false);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
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
