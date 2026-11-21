import { randomUUID } from 'node:crypto';
import type { OutboundWebhookDeliveryStatus, Prisma, PrismaClient } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { setTenantContext } from '../../database/client';
import { loadApprovedIncomeSnapshot } from '../../exports/approvedIncomeSnapshot';
import { ApiError } from '../../http/apiError';
import { emitOperationalEvent } from '../../observability/operationalEvents';
import {
  MAX_DELIVERY_ATTEMPTS,
  runDeliveryBatch,
  type ClaimedDelivery,
  type ClaimOutcome,
  type DeliveryCompletion,
  type DeliveryWorkerDependencies,
  type DueDelivery,
} from './deliveryWorker';
import { WEBHOOK_AUDIT_RULE_VERSION } from './enqueue';
import { buildIncomeApprovedPayload } from './payload';
import { createWebhookSecretStore, type WebhookSecretStore } from './secretStore';
import { sendWebhookRequest, type WebhookSendResult, type WebhookTransport } from './sender';
import {
  parseWebhookUrl,
  readWebhookEgressPolicy,
  resolveWebhookAddress,
  WebhookPolicyError,
  type HostLookup,
  type WebhookEgressPolicy,
} from './urlPolicy';

export const WEBHOOK_WORKER_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000002';
export const STALE_DELIVERY_CLAIM_MS = 2 * 60_000;
export const PREVIOUS_SECRET_OVERLAP_MS = 24 * 60 * 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const DEFAULT_BATCH_SIZE = 10;

const DUE_STATUSES: OutboundWebhookDeliveryStatus[] = ['PENDING', 'RETRYABLE_FAILURE'];
const SUPERSEDED_SNAPSHOT_CODES = new Set(['STALE_APPROVED_CALCULATION', 'APPROVED_CALCULATION_REQUIRED']);

type RuntimeClaim = ClaimedDelivery & Readonly<{
  loanId: string;
  approvalEventId: string;
  approvedLoanVersion: number;
  requestedByUserId: string;
  correlationId: string;
  eventType: string;
  url: URL;
  signingSecretRef: string;
  signingSecretVersion: number;
  includePreviousSecret: boolean;
  body: string;
  snapshotHash: string;
}>;

type DeliveryRecord = Readonly<{
  id: string;
  tenantId: string;
  loanId: string;
  approvalEventId: string;
  approvedLoanVersion: number;
  requestedByUserId: string;
  correlationId: string;
  status: OutboundWebhookDeliveryStatus;
  claimToken: string | null;
}>;

export type WebhookRuntimeInfrastructure = Readonly<{
  client: Pick<PrismaClient, '$transaction'>;
  secretStore: WebhookSecretStore;
  policy: WebhookEgressPolicy;
  transport: WebhookTransport;
  lookup?: HostLookup;
  now?: () => Date;
  random?: () => number;
}>;

export function createWebhookWorkerDependencies(infrastructure: WebhookRuntimeInfrastructure): DeliveryWorkerDependencies {
  const now = infrastructure.now ?? (() => new Date());
  const inTenant = <T>(tenantId: string, operation: (transaction: Prisma.TransactionClient) => Promise<T>) => (
    infrastructure.client.$transaction(async (transaction) => {
      await setTenantContext(transaction, { tenantId, principalId: WEBHOOK_WORKER_PRINCIPAL_ID });
      return operation(transaction);
    })
  );

  return {
    now,
    random: infrastructure.random ?? Math.random,

    // Discovery deliberately runs without a tenant context. The database only
    // exposes unfinished delivery rows to the worker role in this mode, and
    // only their identifiers are read here.
    findDue: (limit) => infrastructure.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('app.outbound_webhook_dispatch_scan', 'on', true)`;
      const current = now();
      return transaction.outboundWebhookDelivery.findMany({
        where: {
          OR: [
            { status: { in: DUE_STATUSES }, nextAttemptAt: { lte: current } },
            { status: 'IN_PROGRESS', startedAt: { lt: new Date(current.getTime() - STALE_DELIVERY_CLAIM_MS) } },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, tenantId: true },
      });
    }),

    claim: (due) => inTenant<ClaimOutcome>(due.tenantId, async (transaction) => {
      const current = now();
      const record = await transaction.outboundWebhookDelivery.findFirst({
        where: { id: due.id, tenantId: due.tenantId },
        select: {
          id: true, tenantId: true, loanId: true, approvalEventId: true, approvedLoanVersion: true,
          requestedByUserId: true, correlationId: true, eventType: true, status: true, claimToken: true,
          attemptCount: true, nextAttemptAt: true, startedAt: true, createdAt: true,
          endpoint: { select: {
            url: true, isEnabled: true, signingSecretRef: true, signingSecretVersion: true, signingSecretRotatedAt: true,
          } },
          loanApplication: { select: { encompassIntegrationMode: true } },
        },
      });
      if (!record) return { kind: 'skipped' };
      const staleClaim = record.status === 'IN_PROGRESS'
        && Boolean(record.startedAt && record.startedAt.getTime() < current.getTime() - STALE_DELIVERY_CLAIM_MS);
      const isDue = DUE_STATUSES.includes(record.status) && record.nextAttemptAt.getTime() <= current.getTime();
      if (!isDue && !staleClaim) return { kind: 'skipped' };

      if (staleClaim && record.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        return finishDuringClaim(transaction, record, 'FAILED', 'WEBHOOK_RETRY_LIMIT_REACHED');
      }
      if (!record.endpoint.isEnabled) return finishDuringClaim(transaction, record, 'FAILED', 'WEBHOOK_ENDPOINT_DISABLED');
      if (record.loanApplication.encompassIntegrationMode !== 'NONE') {
        return finishDuringClaim(transaction, record, 'FAILED', 'WEBHOOK_LOAN_NOT_STANDALONE');
      }
      let url: URL;
      try {
        url = parseWebhookUrl(record.endpoint.url, infrastructure.policy);
      } catch (error) {
        const code = error instanceof WebhookPolicyError ? error.code : 'WEBHOOK_URL_INVALID';
        return finishDuringClaim(transaction, record, 'FAILED', code);
      }

      let body: string;
      let snapshotHash: string;
      try {
        const snapshot = await loadApprovedIncomeSnapshot(transaction, workerContext(record), record.loanId);
        if (snapshot.approval.eventId !== record.approvalEventId
          || snapshot.approval.approvedLoanVersion !== record.approvedLoanVersion) {
          return finishDuringClaim(transaction, record, 'SUPERSEDED', 'APPROVAL_SUPERSEDED');
        }
        body = buildIncomeApprovedPayload({ deliveryId: record.id, createdAt: record.createdAt, snapshot });
        snapshotHash = snapshot.snapshotHash;
      } catch (error) {
        if (error instanceof ApiError) {
          return SUPERSEDED_SNAPSHOT_CODES.has(error.code)
            ? finishDuringClaim(transaction, record, 'SUPERSEDED', 'APPROVAL_SUPERSEDED')
            : finishDuringClaim(transaction, record, 'FAILED', error.code);
        }
        throw error;
      }

      const claimToken = randomUUID();
      const claimed = await transaction.outboundWebhookDelivery.updateMany({
        where: { id: record.id, tenantId: record.tenantId, status: record.status, claimToken: record.claimToken },
        data: {
          status: 'IN_PROGRESS',
          claimToken,
          attemptCount: { increment: 1 },
          startedAt: current,
          lastAttemptAt: current,
        },
      });
      if (claimed.count !== 1) return { kind: 'skipped' };

      const rotatedAt = record.endpoint.signingSecretRotatedAt?.getTime();
      const claim: RuntimeClaim = {
        deliveryId: record.id,
        tenantId: record.tenantId,
        claimToken,
        attemptCount: record.attemptCount + 1,
        loanId: record.loanId,
        approvalEventId: record.approvalEventId,
        approvedLoanVersion: record.approvedLoanVersion,
        requestedByUserId: record.requestedByUserId,
        correlationId: record.correlationId,
        eventType: record.eventType,
        url,
        signingSecretRef: record.endpoint.signingSecretRef,
        signingSecretVersion: record.endpoint.signingSecretVersion,
        includePreviousSecret: rotatedAt !== undefined && current.getTime() - rotatedAt < PREVIOUS_SECRET_OVERLAP_MS,
        body,
        snapshotHash,
      };
      return { kind: 'claimed', delivery: claim };
    }),

    send: async (delivery) => {
      const claim = delivery as RuntimeClaim;
      let secrets: string[];
      try {
        const stored = await infrastructure.secretStore.read({
          reference: claim.signingSecretRef,
          version: claim.signingSecretVersion,
          includePrevious: claim.includePreviousSecret,
        });
        secrets = stored.previous ? [stored.current, stored.previous] : [stored.current];
      } catch {
        return { kind: 'retryable', safeErrorCode: 'WEBHOOK_SECRET_UNAVAILABLE', responseStatus: null } satisfies WebhookSendResult;
      }
      let address;
      try {
        address = await resolveWebhookAddress(claim.url, infrastructure.policy, infrastructure.lookup);
      } catch (error) {
        if (error instanceof WebhookPolicyError) {
          return error.retryable
            ? { kind: 'retryable', safeErrorCode: error.code, responseStatus: null }
            : { kind: 'rejected', safeErrorCode: error.code, responseStatus: null };
        }
        throw error;
      }
      return infrastructure.transport({
        url: claim.url,
        address,
        deliveryId: claim.deliveryId,
        eventType: claim.eventType,
        body: claim.body,
        secrets,
        timestampSeconds: Math.floor(now().getTime() / 1000),
      });
    },

    complete: (delivery, completion) => inTenant(delivery.tenantId, async (transaction) => (
      recordCompletion(transaction, delivery as RuntimeClaim, completion, now())
    )),
  };
}

async function recordCompletion(
  transaction: Prisma.TransactionClient,
  claim: RuntimeClaim,
  completion: DeliveryCompletion,
  current: Date,
): Promise<boolean> {
  const data: Prisma.OutboundWebhookDeliveryUpdateManyMutationInput = completion.status === 'SUCCEEDED'
    ? {
      status: 'SUCCEEDED', claimToken: null, safeErrorCode: null, lastResponseStatus: completion.responseStatus,
      deliveredSnapshotHash: claim.snapshotHash, completedAt: current,
    }
    : completion.status === 'FAILED'
      ? {
        status: 'FAILED', claimToken: null, safeErrorCode: completion.safeErrorCode,
        lastResponseStatus: completion.responseStatus, completedAt: current,
      }
      : {
        status: 'RETRYABLE_FAILURE', claimToken: null, safeErrorCode: completion.safeErrorCode,
        lastResponseStatus: completion.responseStatus, nextAttemptAt: completion.nextAttemptAt,
      };
  const updated = await transaction.outboundWebhookDelivery.updateMany({
    where: { id: claim.deliveryId, tenantId: claim.tenantId, status: 'IN_PROGRESS', claimToken: claim.claimToken },
    data,
  });
  if (updated.count !== 1) return false;
  if (completion.status === 'RETRYABLE_FAILURE') return true;

  await appendAuditEvent(transaction, workerContext(claim), {
    loanId: claim.loanId,
    entityType: 'OUTBOUND_WEBHOOK_DELIVERY',
    entityId: claim.deliveryId,
    expectedLoanVersion: claim.approvedLoanVersion + 1,
    action: completion.status === 'SUCCEEDED' ? AUDIT_ACTIONS.OUTBOUND_WEBHOOK_DELIVERED : AUDIT_ACTIONS.OUTBOUND_WEBHOOK_FAILED,
    reasonCode: completion.status === 'SUCCEEDED' ? 'RECEIVER_ACKNOWLEDGED' : completion.safeErrorCode,
    ruleVersion: WEBHOOK_AUDIT_RULE_VERSION,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      deliveryId: claim.deliveryId,
      approvalEventId: claim.approvalEventId,
      status: completion.status,
      attemptCount: claim.attemptCount,
      responseStatus: completion.responseStatus,
      safeErrorCode: completion.status === 'SUCCEEDED' ? null : completion.safeErrorCode,
      deliveredSnapshotHash: completion.status === 'SUCCEEDED' ? claim.snapshotHash : null,
    }),
  });
  return true;
}

async function finishDuringClaim(
  transaction: Prisma.TransactionClient,
  record: DeliveryRecord,
  status: 'FAILED' | 'SUPERSEDED',
  safeErrorCode: string,
): Promise<ClaimOutcome> {
  const updated = await transaction.outboundWebhookDelivery.updateMany({
    where: { id: record.id, tenantId: record.tenantId, status: record.status, claimToken: record.claimToken },
    data: { status, claimToken: null, safeErrorCode, completedAt: new Date() },
  });
  if (updated.count !== 1) return { kind: 'skipped' };
  await appendAuditEvent(transaction, workerContext(record), {
    loanId: record.loanId,
    entityType: 'OUTBOUND_WEBHOOK_DELIVERY',
    entityId: record.id,
    expectedLoanVersion: record.approvedLoanVersion + 1,
    action: status === 'SUPERSEDED' ? AUDIT_ACTIONS.OUTBOUND_WEBHOOK_SUPERSEDED : AUDIT_ACTIONS.OUTBOUND_WEBHOOK_FAILED,
    reasonCode: safeErrorCode,
    ruleVersion: WEBHOOK_AUDIT_RULE_VERSION,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      deliveryId: record.id,
      approvalEventId: record.approvalEventId,
      status,
      safeErrorCode,
    }),
  });
  return { kind: 'finished', status, safeErrorCode };
}

function workerContext(record: Readonly<{
  tenantId: string;
  requestedByUserId: string;
  correlationId: string;
}>): RequestContext {
  return Object.freeze({
    requestId: record.correlationId,
    subject: 'outbound-webhook-worker',
    tenantId: record.tenantId,
    membershipId: record.requestedByUserId,
    permissions: [] as const,
    authTime: new Date(),
  });
}

export async function runOutboundWebhookWorker(
  client: PrismaClient,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const dependencies = createWebhookWorkerDependencies({
    client,
    secretStore: createWebhookSecretStore(environment),
    policy: readWebhookEgressPolicy(environment),
    transport: sendWebhookRequest,
  });
  const pollIntervalMs = boundedInteger(environment.OUTBOUND_WEBHOOK_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, 1_000, 60_000);
  const batchSize = boundedInteger(environment.OUTBOUND_WEBHOOK_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 50);
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  while (!stopping) {
    let summary;
    try {
      summary = await runDeliveryBatch(dependencies, batchSize);
    } catch {
      emitOperationalEvent('webhook_delivery_failure', 'WEBHOOK_WORKER_BATCH_FAILED');
    }
    if (stopping) break;
    if (summary && summary.scanned === batchSize) continue;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollIntervalMs);
      wake = () => { clearTimeout(timer); resolve(); };
    });
  }
  await client.$disconnect();
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid outbound webhook worker setting.');
  return value;
}
