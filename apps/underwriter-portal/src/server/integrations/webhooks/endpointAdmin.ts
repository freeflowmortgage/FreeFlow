import { randomUUID } from 'node:crypto';
import type { OutboundWebhookDeliveryStatus, Prisma } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';
import { ApiError } from '../../http/apiError';
import { hashCanonical } from '../../http/canonical';
import { isProtectedRuntime } from '../../runtimeMode';
import { WEBHOOK_AUDIT_RULE_VERSION } from './enqueue';
import type { WebhookSecretStore } from './secretStore';
import {
  hashWebhookUrl,
  parseWebhookUrl,
  WebhookPolicyError,
  webhookUrlHost,
  type WebhookEgressPolicy,
} from './urlPolicy';

export const WEBHOOK_ENDPOINT_OPERATION = 'webhook-endpoint-upsert';
export const WEBHOOK_SECRET_ROTATION_OPERATION = 'webhook-secret-rotation';
export const WEBHOOK_REDELIVERY_OPERATION = 'webhook-redelivery';
export const REAUTHENTICATION_WINDOW_MS = 15 * 60_000;
export const DELIVERY_PAGE_LIMIT = 50;

export type WebhookEndpointView = Readonly<{
  configured: true;
  id: string;
  url: string;
  isEnabled: boolean;
  version: number;
  signingSecretVersion: number;
  signingSecretRotatedAt: string | null;
  updatedAt: string;
}> | Readonly<{ configured: false }>;

export type WebhookDeliveryView = Readonly<{
  id: string;
  loanId: string;
  approvalEventId: string;
  eventType: string;
  status: OutboundWebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastResponseStatus: number | null;
  safeErrorCode: string | null;
  completedAt: string | null;
  createdAt: string;
}>;

const ENDPOINT_SELECT = {
  id: true,
  url: true,
  isEnabled: true,
  version: true,
  signingSecretRef: true,
  signingSecretVersion: true,
  signingSecretRotatedAt: true,
  updatedAt: true,
} as const;

type EndpointRecord = Readonly<{
  id: string;
  url: string;
  isEnabled: boolean;
  version: number;
  signingSecretRef: string;
  signingSecretVersion: number;
  signingSecretRotatedAt: Date | null;
  updatedAt: Date;
}>;

/**
 * Webhook settings change where approved income is sent, so protected
 * runtimes require an identity-provider-asserted sign-in within the window.
 */
export function assertRecentAuthentication(
  context: RequestContext,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): void {
  if (!isProtectedRuntime(env)) return;
  const age = nowMs - context.authTime.getTime();
  if (context.authTimeAsserted !== true || age > REAUTHENTICATION_WINDOW_MS || age < -60_000) {
    throw new ApiError(403, 'REAUTHENTICATION_REQUIRED', 'Sign in again within the last 15 minutes to change webhook settings.');
  }
}

export async function readWebhookEndpoint(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
): Promise<WebhookEndpointView> {
  const endpoint = await transaction.outboundWebhookEndpoint.findFirst({
    where: { tenantId: context.tenantId },
    select: ENDPOINT_SELECT,
  });
  return endpoint ? endpointView(endpoint) : { configured: false };
}

export async function upsertWebhookEndpoint(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ url: unknown; isEnabled: unknown; expectedVersion: unknown; idempotencyKey: string }>,
  dependencies: Readonly<{ policy: WebhookEgressPolicy; secretStore: WebhookSecretStore }>,
): Promise<{ endpoint: WebhookEndpointView; signingSecret: string | null; created: boolean; replayed: boolean }> {
  const url = parseUrl(input.url, dependencies.policy);
  if (typeof input.isEnabled !== 'boolean') {
    throw new ApiError(400, 'INVALID_ENABLED_FLAG', 'isEnabled must be a boolean.');
  }
  const expectedVersion = parseExpectedVersion(input.expectedVersion, true);
  const requestHash = hashCanonical({ url: url.href, isEnabled: input.isEnabled, expectedVersion });

  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: WEBHOOK_ENDPOINT_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });
  if (idempotency.kind === 'replay') {
    return { endpoint: await readWebhookEndpoint(transaction, context), signingSecret: null, created: false, replayed: true };
  }

  const existing = await transaction.outboundWebhookEndpoint.findFirst({
    where: { tenantId: context.tenantId },
    select: ENDPOINT_SELECT,
  });

  let endpoint: EndpointRecord;
  let signingSecret: string | null = null;
  if (!existing) {
    if (expectedVersion !== null) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'The webhook endpoint changed since it was loaded. Reload and retry.');
    }
    const endpointId = randomUUID();
    const secret = await dependencies.secretStore.create({ tenantId: context.tenantId, endpointId });
    endpoint = await transaction.outboundWebhookEndpoint.create({
      data: {
        id: endpointId,
        tenantId: context.tenantId,
        url: url.href,
        isEnabled: input.isEnabled,
        signingSecretRef: secret.reference,
        createdByUserId: context.membershipId,
        updatedByUserId: context.membershipId,
      },
      select: ENDPOINT_SELECT,
    });
    signingSecret = secret.secret;
  } else {
    if (expectedVersion !== existing.version) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'The webhook endpoint changed since it was loaded. Reload and retry.');
    }
    endpoint = await updateEndpointAtVersion(transaction, context, existing, {
      url: url.href,
      isEnabled: input.isEnabled,
    });
  }

  await recordEndpointAudit(transaction, context, endpoint, existing ? 'WEBHOOK_ENDPOINT_UPDATED' : 'WEBHOOK_ENDPOINT_CREATED');
  await storeIdempotencyResult(transaction, context, {
    operation: WEBHOOK_ENDPOINT_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: existing ? 200 : 201,
    responseReference: `${endpoint.id}:${endpoint.version}`,
  });
  return { endpoint: endpointView(endpoint), signingSecret, created: !existing, replayed: false };
}

export async function rotateWebhookSigningSecret(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ expectedVersion: unknown; idempotencyKey: string }>,
  dependencies: Readonly<{ secretStore: WebhookSecretStore }>,
): Promise<{ endpoint: WebhookEndpointView; signingSecret: string | null; replayed: boolean }> {
  const expectedVersion = parseExpectedVersion(input.expectedVersion, false)!;
  const requestHash = hashCanonical({ expectedVersion });
  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: WEBHOOK_SECRET_ROTATION_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });
  if (idempotency.kind === 'replay') {
    return { endpoint: await readWebhookEndpoint(transaction, context), signingSecret: null, replayed: true };
  }

  const existing = await transaction.outboundWebhookEndpoint.findFirst({
    where: { tenantId: context.tenantId },
    select: ENDPOINT_SELECT,
  });
  if (!existing) throw new ApiError(404, 'WEBHOOK_ENDPOINT_NOT_FOUND', 'No webhook endpoint is configured.');
  if (existing.version !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'The webhook endpoint changed since it was loaded. Reload and retry.');
  }

  // The conditional update locks the row first, so concurrent rotations
  // serialize and only one of them writes a new secret value.
  const endpoint = await updateEndpointAtVersion(transaction, context, existing, {
    signingSecretVersion: existing.signingSecretVersion + 1,
    signingSecretRotatedAt: new Date(),
  });
  const signingSecret = await dependencies.secretStore.rotate({
    reference: existing.signingSecretRef,
    nextVersion: endpoint.signingSecretVersion,
  });

  await recordEndpointAudit(transaction, context, endpoint, 'WEBHOOK_ENDPOINT_SECRET_ROTATED');
  await storeIdempotencyResult(transaction, context, {
    operation: WEBHOOK_SECRET_ROTATION_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: 200,
    responseReference: `${endpoint.id}:${endpoint.version}`,
  });
  return { endpoint: endpointView(endpoint), signingSecret, replayed: false };
}

export async function listWebhookDeliveries(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ cursor: string | null; loanId: string | null; limit: number }>,
): Promise<{ deliveries: WebhookDeliveryView[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(DELIVERY_PAGE_LIMIT, Math.floor(input.limit)));
  if (input.cursor) {
    const anchor = await transaction.outboundWebhookDelivery.findFirst({
      where: { id: input.cursor, tenantId: context.tenantId },
      select: { id: true },
    });
    if (!anchor) throw new ApiError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
  const rows = await transaction.outboundWebhookDelivery.findMany({
    where: { tenantId: context.tenantId, ...(input.loanId ? { loanId: input.loanId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    select: {
      id: true, loanId: true, approvalEventId: true, eventType: true, status: true,
      attemptCount: true, nextAttemptAt: true, lastAttemptAt: true, lastResponseStatus: true,
      safeErrorCode: true, completedAt: true, createdAt: true,
    },
  });
  const page = rows.slice(0, limit);
  return {
    deliveries: page.map((row) => ({
      id: row.id,
      loanId: row.loanId,
      approvalEventId: row.approvalEventId,
      eventType: row.eventType,
      status: row.status,
      attemptCount: row.attemptCount,
      nextAttemptAt: row.status === 'PENDING' || row.status === 'RETRYABLE_FAILURE' ? row.nextAttemptAt.toISOString() : null,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      lastResponseStatus: row.lastResponseStatus,
      safeErrorCode: row.safeErrorCode,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
  };
}

export async function requestWebhookRedelivery(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ deliveryId: string; idempotencyKey: string }>,
): Promise<{ deliveryId: string; status: OutboundWebhookDeliveryStatus; replayed: boolean }> {
  const requestHash = hashCanonical({ deliveryId: input.deliveryId });
  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: WEBHOOK_REDELIVERY_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });
  if (idempotency.kind === 'replay') {
    const current = await transaction.outboundWebhookDelivery.findFirst({
      where: { id: input.deliveryId, tenantId: context.tenantId },
      select: { status: true },
    });
    if (!current) throw new ApiError(404, 'WEBHOOK_DELIVERY_NOT_FOUND', 'The webhook delivery was not found.');
    return { deliveryId: input.deliveryId, status: current.status, replayed: true };
  }

  const delivery = await transaction.outboundWebhookDelivery.findFirst({
    where: { id: input.deliveryId, tenantId: context.tenantId },
    select: {
      id: true, loanId: true, status: true, approvalEventId: true, approvedLoanVersion: true,
      endpoint: { select: { isEnabled: true } },
      loanApplication: { select: { encompassIntegrationMode: true } },
    },
  });
  if (!delivery) throw new ApiError(404, 'WEBHOOK_DELIVERY_NOT_FOUND', 'The webhook delivery was not found.');
  if (delivery.status !== 'SUCCEEDED' && delivery.status !== 'FAILED') {
    throw new ApiError(409, 'WEBHOOK_DELIVERY_NOT_FINISHED', 'Only finished deliveries can be redelivered.');
  }
  if (!delivery.endpoint.isEnabled) {
    throw new ApiError(409, 'WEBHOOK_ENDPOINT_DISABLED', 'Enable the webhook endpoint before redelivering.');
  }
  if (delivery.loanApplication.encompassIntegrationMode !== 'NONE') {
    throw new ApiError(409, 'WEBHOOK_LOAN_NOT_STANDALONE', 'Only standalone loans can be delivered by webhook.');
  }

  const updated = await transaction.outboundWebhookDelivery.updateMany({
    where: { id: delivery.id, tenantId: context.tenantId, status: delivery.status },
    data: {
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      claimToken: null,
      safeErrorCode: null,
      completedAt: null,
    },
  });
  if (updated.count !== 1) {
    throw new ApiError(409, 'WEBHOOK_DELIVERY_CHANGED', 'The delivery changed. Reload and retry.');
  }
  await appendAuditEvent(transaction, context, {
    loanId: delivery.loanId,
    entityType: 'OUTBOUND_WEBHOOK_DELIVERY',
    entityId: delivery.id,
    expectedLoanVersion: delivery.approvedLoanVersion + 1,
    action: AUDIT_ACTIONS.OUTBOUND_WEBHOOK_REDELIVERY_REQUESTED,
    reasonCode: 'ADMIN_REDELIVERY_REQUESTED',
    ruleVersion: WEBHOOK_AUDIT_RULE_VERSION,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      deliveryId: delivery.id,
      approvalEventId: delivery.approvalEventId,
      previousStatus: delivery.status,
    }),
  });
  await storeIdempotencyResult(transaction, context, {
    operation: WEBHOOK_REDELIVERY_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: 202,
    responseReference: delivery.id,
  });
  return { deliveryId: delivery.id, status: 'PENDING', replayed: false };
}

async function updateEndpointAtVersion(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  existing: EndpointRecord,
  data: Prisma.OutboundWebhookEndpointUpdateManyMutationInput,
): Promise<EndpointRecord> {
  const updated = await transaction.outboundWebhookEndpoint.updateMany({
    where: { id: existing.id, tenantId: context.tenantId, version: existing.version },
    data: { ...data, version: existing.version + 1, updatedByUserId: context.membershipId },
  });
  if (updated.count !== 1) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'The webhook endpoint changed since it was loaded. Reload and retry.');
  }
  const endpoint = await transaction.outboundWebhookEndpoint.findFirst({
    where: { id: existing.id, tenantId: context.tenantId },
    select: ENDPOINT_SELECT,
  });
  if (!endpoint) throw new ApiError(409, 'VERSION_CONFLICT', 'The webhook endpoint changed since it was loaded. Reload and retry.');
  return endpoint;
}

async function recordEndpointAudit(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  endpoint: EndpointRecord,
  action: 'WEBHOOK_ENDPOINT_CREATED' | 'WEBHOOK_ENDPOINT_UPDATED' | 'WEBHOOK_ENDPOINT_SECRET_ROTATED',
): Promise<void> {
  const url = new URL(endpoint.url);
  await transaction.outboundWebhookEndpointAuditEvent.create({
    data: {
      tenantId: context.tenantId,
      endpointId: endpoint.id,
      actorUserId: context.membershipId,
      action,
      endpointVersion: endpoint.version,
      urlHost: webhookUrlHost(url),
      urlHash: hashWebhookUrl(url),
      isEnabled: endpoint.isEnabled,
      signingSecretVersion: endpoint.signingSecretVersion,
      requestId: context.requestId,
      authTime: context.authTime,
    },
    select: { id: true },
  });
}

function endpointView(endpoint: EndpointRecord): WebhookEndpointView {
  return {
    configured: true,
    id: endpoint.id,
    url: endpoint.url,
    isEnabled: endpoint.isEnabled,
    version: endpoint.version,
    signingSecretVersion: endpoint.signingSecretVersion,
    signingSecretRotatedAt: endpoint.signingSecretRotatedAt?.toISOString() ?? null,
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

function parseUrl(value: unknown, policy: WebhookEgressPolicy): URL {
  try {
    return parseWebhookUrl(value, policy);
  } catch (error) {
    if (error instanceof WebhookPolicyError) {
      throw new ApiError(422, error.code, webhookUrlMessage(error.code));
    }
    throw error;
  }
}

function webhookUrlMessage(code: string): string {
  switch (code) {
    case 'WEBHOOK_URL_HTTPS_REQUIRED': return 'The webhook URL must use HTTPS.';
    case 'WEBHOOK_URL_CREDENTIALS_FORBIDDEN': return 'The webhook URL must not contain a username or password.';
    case 'WEBHOOK_URL_QUERY_FORBIDDEN': return 'The webhook URL must not contain a query string or fragment.';
    case 'WEBHOOK_URL_PORT_FORBIDDEN': return 'The webhook URL must use the default HTTPS port.';
    case 'WEBHOOK_URL_IP_LITERAL_FORBIDDEN': return 'The webhook URL must use a hostname, not an IP address.';
    case 'WEBHOOK_DESTINATION_FORBIDDEN': return 'The webhook URL points to a private or reserved network.';
    case 'WEBHOOK_HOST_NOT_ALLOWED': return 'The webhook host is not on this deployment\'s approved host list.';
    default: return 'The webhook URL is invalid.';
  }
}

function parseExpectedVersion(value: unknown, allowNull: boolean): number | null {
  if (allowNull && (value === null || value === undefined)) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, 'INVALID_ENDPOINT_VERSION', 'expectedVersion must be a positive integer.');
  }
  return value;
}
