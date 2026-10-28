import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_SIGNATURE_VERSION = 'v1';
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
export const WEBHOOK_HEADERS = {
  id: 'FreeFlow-Webhook-Id',
  timestamp: 'FreeFlow-Webhook-Timestamp',
  signature: 'FreeFlow-Webhook-Signature',
  eventType: 'FreeFlow-Event-Type',
} as const;

const SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;

export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function isSigningSecret(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/**
 * HMAC-SHA256 over `${id}.${timestamp}.${body}`, keyed with the UTF-8 bytes of
 * the complete secret string. Receivers reproduce this exactly.
 */
export function computeWebhookSignature(secret: string, id: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`, 'utf8').digest('hex');
}

export function webhookSignatureHeader(
  secrets: readonly string[],
  id: string,
  timestamp: number,
  body: string,
): string {
  if (secrets.length === 0) throw new Error('At least one signing secret is required.');
  return secrets
    .map((secret) => `${WEBHOOK_SIGNATURE_VERSION}=${computeWebhookSignature(secret, id, timestamp, body)}`)
    .join(' ');
}

export type WebhookVerificationInput = Readonly<{
  secret: string;
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}>;

/** Reference receiver check used by tests and documented for customers. */
export function verifyWebhookSignature(input: WebhookVerificationInput): boolean {
  if (!input.id || !input.timestamp || !input.signature) return false;
  if (!/^\d{1,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > (input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS)) return false;
  const expected = Buffer.from(computeWebhookSignature(input.secret, input.id, timestamp, input.body), 'hex');
  return input.signature.split(' ').some((entry) => {
    const [version, value] = entry.split('=', 2);
    if (version !== WEBHOOK_SIGNATURE_VERSION || !value || !/^[0-9a-f]{64}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
}
