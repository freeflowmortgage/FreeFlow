import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { LookupFunction } from 'node:net';
import { WEBHOOK_HEADERS, webhookSignatureHeader } from './signing';
import type { ResolvedWebhookAddress } from './urlPolicy';

export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
export const WEBHOOK_USER_AGENT = 'FreeFlow-Webhooks/1.0';

export type WebhookSendResult =
  | Readonly<{ kind: 'delivered'; responseStatus: number }>
  | Readonly<{ kind: 'retryable'; safeErrorCode: string; responseStatus: number | null }>
  | Readonly<{ kind: 'rejected'; safeErrorCode: string; responseStatus: number | null }>;

export type WebhookRequest = Readonly<{
  url: URL;
  address: ResolvedWebhookAddress;
  deliveryId: string;
  eventType: string;
  body: string;
  secrets: readonly string[];
  timestampSeconds: number;
}>;

export type WebhookTransport = (request: WebhookRequest) => Promise<WebhookSendResult>;

export function classifyResponseStatus(status: number): WebhookSendResult {
  if (status >= 200 && status <= 299) return { kind: 'delivered', responseStatus: status };
  if (status >= 300 && status <= 399) {
    return { kind: 'rejected', safeErrorCode: 'RECEIVER_REDIRECT_REFUSED', responseStatus: status };
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: 'retryable', safeErrorCode: 'RECEIVER_RETRYABLE_STATUS', responseStatus: status };
  }
  return { kind: 'rejected', safeErrorCode: 'RECEIVER_REJECTED', responseStatus: status };
}

export function classifyTransportError(error: unknown): string {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError' || name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT'
    || code === 'ABORT_ERR' || code === 'WEBHOOK_TIMEOUT') {
    return 'RECEIVER_TIMEOUT';
  }
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
    || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'HOSTNAME_MISMATCH') {
    return 'RECEIVER_TLS_FAILED';
  }
  return 'RECEIVER_CONNECTION_FAILED';
}

export function buildWebhookHeaders(request: WebhookRequest): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(request.body, 'utf8')),
    'User-Agent': WEBHOOK_USER_AGENT,
    [WEBHOOK_HEADERS.id]: request.deliveryId,
    [WEBHOOK_HEADERS.timestamp]: String(request.timestampSeconds),
    [WEBHOOK_HEADERS.eventType]: request.eventType,
    [WEBHOOK_HEADERS.signature]: webhookSignatureHeader(
      request.secrets,
      request.deliveryId,
      request.timestampSeconds,
      request.body,
    ),
  };
}

/**
 * Sends one signed POST to the pre-validated address. The hostname is kept for
 * SNI and certificate verification; the response body is discarded unread.
 */
export const sendWebhookRequest: WebhookTransport = (request) => new Promise((resolve) => {
  let settled = false;
  const finish = (result: WebhookSendResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    resolve(result);
  };
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (error: null, addresses: { address: string; family: number }[]) => void)(
        null,
        [{ address: request.address.address, family: request.address.family }],
      );
      return;
    }
    callback(null, request.address.address, request.address.family);
  };
  const options: RequestOptions = {
    method: 'POST',
    headers: buildWebhookHeaders(request),
    lookup: pinnedLookup,
    agent: false,
    minVersion: 'TLSv1.2',
    timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
  };

  const outgoing = httpsRequest(request.url, options, (response) => {
    const status = response.statusCode ?? 0;
    response.destroy();
    outgoing.destroy();
    finish(status >= 100 && status <= 599
      ? classifyResponseStatus(status)
      : { kind: 'retryable', safeErrorCode: 'RECEIVER_INVALID_RESPONSE', responseStatus: null });
  });
  const deadline = setTimeout(() => {
    outgoing.destroy(Object.assign(new Error('timeout'), { code: 'WEBHOOK_TIMEOUT' }));
  }, WEBHOOK_REQUEST_TIMEOUT_MS + 2_000);
  outgoing.on('timeout', () => {
    outgoing.destroy(Object.assign(new Error('timeout'), { code: 'WEBHOOK_TIMEOUT' }));
  });
  outgoing.on('error', (error) => {
    finish({ kind: 'retryable', safeErrorCode: classifyTransportError(error), responseStatus: null });
  });
  outgoing.end(request.body);
});
