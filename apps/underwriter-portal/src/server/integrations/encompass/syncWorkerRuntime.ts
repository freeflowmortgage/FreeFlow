import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Prisma } from '@prisma/client';
import { CustomConnectorAdapter, EncompassConnectorError, type EncompassConnector } from '@mortgage-pos/encompass-connector-contract';
import { buildEncompassFieldUpdatePayload } from '@mortgage-pos/mortgage-engine';
import { prisma, setTenantContext } from '../../database/client';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import type { RequestContext } from '../../auth/requestContext';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';
import type { EncompassSyncQueueMessage } from './sync';
import { runEncompassSyncJob, type ClaimedSync, type SyncWorkerDependencies } from './syncWorker';
import { emitOperationalEvent } from '../../observability/operationalEvents';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000001';
const APPROVAL_FIELD = 'CX.FREEFLOW.APPROVAL.ID';
const MAX_ATTEMPTS = 5;

type RuntimeClaim = ClaimedSync & Readonly<{
  encompassLoanGuid: string;
  requestedByUserId: string;
  correlationId: string;
  expectedLoanVersion: number;
  connector: EncompassConnector;
}>;

export function createSyncRuntimeDependencies(environment: NodeJS.ProcessEnv = process.env): SyncWorkerDependencies {
  const serviceBaseUrl = required(environment.ENCOMPASS_CONNECTOR_SERVICE_URL, 'ENCOMPASS_CONNECTOR_SERVICE_URL');
  const serviceId = required(environment.ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID, 'ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID');
  const signingKey = required(environment.ENCOMPASS_CONNECTOR_SIGNING_KEY, 'ENCOMPASS_CONNECTOR_SIGNING_KEY');
  const appOrigin = required(environment.APP_ORIGIN, 'APP_ORIGIN').replace(/\/$/, '');

  return {
    claim: async (message) => prisma.$transaction(async (transaction) => {
      await setTenantContext(transaction, { tenantId: message.tenantId, principalId: WORKER_PRINCIPAL_ID });
      const record = await transaction.encompassSyncJob.findFirst({
        where: {
          id: message.jobId, tenantId: message.tenantId, loanId: message.loanId,
          approvalEventId: message.approvalEventId, expectedLoanVersion: message.expectedLoanVersion,
          idempotencyKey: message.idempotencyKey, correlationId: message.correlationId,
          status: { in: ['QUEUED', 'RETRYABLE_FAILURE', 'RECONCILING', 'IN_PROGRESS'] },
        },
        select: {
          id: true, tenantId: true, loanId: true, approvalEventId: true, status: true,
          attemptCount: true, startedAt: true, requestedByUserId: true, correlationId: true,
          expectedLoanVersion: true,
          loanApplication: { select: { version: true, encompassGuid: true } },
          approvalEvent: { select: { action: true, entityType: true, entityId: true, expectedLoanVersion: true } },
          tenant: { select: {
            configurations: { select: { enableEncompassSync: true } },
            encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
          } },
        },
      });
      if (!record) return null;
      const staleInProgress = record.status === 'IN_PROGRESS'
        && Boolean(record.startedAt && record.startedAt.getTime() < Date.now() - 15 * 60_000);
      if (record.status === 'IN_PROGRESS' && !staleInProgress) return null;
      if (record.loanApplication.version !== message.expectedLoanVersion
        || record.approvalEvent.expectedLoanVersion + 1 !== message.expectedLoanVersion
        || record.approvalEvent.entityType !== 'FORM_1084_AUDIT'
        || !['INCOME_APPROVED', 'INCOME_OVERRIDE'].includes(record.approvalEvent.action)) {
        await transaction.encompassSyncJob.updateMany({
          where: { id: record.id, tenantId: record.tenantId },
          data: { status: 'FAILED', safeErrorCode: 'STALE_APPROVAL', completedAt: new Date() },
        });
        return null;
      }
      const binding = record.tenant.encompassConnectorBinding;
      if (!record.tenant.configurations?.enableEncompassSync || !binding?.isEnabled || !record.loanApplication.encompassGuid) {
        await transaction.encompassSyncJob.updateMany({
          where: { id: record.id, tenantId: record.tenantId },
          data: { status: 'FAILED', safeErrorCode: 'ENCOMPASS_BINDING_UNAVAILABLE', completedAt: new Date() },
        });
        return null;
      }
      const calculation = await transaction.form1084Audit.findFirst({
        where: {
          id: record.approvalEvent.entityId, tenantId: record.tenantId, loanId: record.loanId,
          isHumanVerified: true, calculatedLoanVersion: record.approvalEvent.expectedLoanVersion,
        },
        select: {
          qualifyingMonthlyIncome: true, trendingResult: true, yearsAnalyzed: true,
          scheduleCMonthlyTotal: true, form1120SMonthlyTotal: true,
          form1065MonthlyTotal: true, form1120MonthlyTotal: true,
          w2BaseMonthly: true, rentalMonthly: true,
          extractionBindings: { select: {
            extractionId: true, extractionHash: true, sourceDocumentId: true,
            sourceDocumentVersion: true, sourceContentHash: true,
            metadataReviewId: true, metadataReviewVersion: true, metadataReviewHash: true,
            extraction: { select: {
              status: true, canonicalHash: true, sourceDocumentVersion: true, sourceContentHash: true,
              sourceDocument: { select: { version: true, sourceContentHash: true } },
              metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, canonicalHash: true } },
            } },
          } },
        },
      });
      if (!calculation || !hasCurrentCalculationExtractions(calculation.extractionBindings)) {
        await transaction.encompassSyncJob.updateMany({
          where: { id: record.id, tenantId: record.tenantId },
          data: {
            status: 'FAILED',
            safeErrorCode: calculation ? 'STALE_APPROVAL_EXTRACTION' : 'APPROVED_CALCULATION_UNAVAILABLE',
            completedAt: new Date(),
          },
        });
        return null;
      }
      const mode = record.status === 'RECONCILING' || staleInProgress ? 'RECONCILE' : 'APPLY';
      if (mode === 'APPLY' && record.attemptCount >= MAX_ATTEMPTS) {
        await transaction.encompassSyncJob.updateMany({
          where: { id: record.id, tenantId: record.tenantId },
          data: { status: 'FAILED', safeErrorCode: 'SYNC_RETRY_LIMIT_REACHED', completedAt: new Date() },
        });
        return null;
      }
      const claimed = await transaction.encompassSyncJob.updateMany({
        where: { id: record.id, tenantId: record.tenantId, status: record.status },
        data: mode === 'APPLY'
          ? { status: 'IN_PROGRESS', attemptCount: { increment: 1 }, startedAt: new Date(), safeErrorCode: null }
          : { status: 'RECONCILING', reconciliationCount: { increment: 1 }, safeErrorCode: null },
      });
      if (claimed.count !== 1) return null;
      const mapped = buildEncompassFieldUpdatePayload(record.loanId, {
        qualifyingMonthlyIncome: calculation.qualifyingMonthlyIncome.toNumber(),
        trendingAnalysis: calculation.trendingResult,
        yearsAnalyzed: calculation.yearsAnalyzed,
        scheduleC_MonthlyTotal: numberOrUndefined(calculation.scheduleCMonthlyTotal),
        form1120S_MonthlyTotal: numberOrUndefined(calculation.form1120SMonthlyTotal),
        form1065_MonthlyTotal: numberOrUndefined(calculation.form1065MonthlyTotal),
        form1120_MonthlyTotal: numberOrUndefined(calculation.form1120MonthlyTotal),
        w2BaseMonthly: numberOrUndefined(calculation.w2BaseMonthly),
        rentalMonthly: numberOrUndefined(calculation.rentalMonthly),
        auditUrl: `${appOrigin}/audit/${record.approvalEventId}`,
      });
      const fields = [...mapped.customFields.filter((field) => field.fieldName !== 'CX.FREEFLOW.SYNCED.AT'),
        { fieldName: APPROVAL_FIELD, value: record.approvalEventId }];
      return {
        jobId: record.id, tenantId: record.tenantId, loanId: record.loanId,
        approvalEventId: record.approvalEventId, mode, fields,
        encompassLoanGuid: record.loanApplication.encompassGuid,
        requestedByUserId: record.requestedByUserId, correlationId: record.correlationId,
        expectedLoanVersion: record.expectedLoanVersion,
        connector: new CustomConnectorAdapter({
          binding: { kind: 'custom', lenderId: binding.lenderId, deploymentId: binding.deploymentId, serviceBaseUrl },
          serviceAuth: { kind: 'signed-hmac', serviceId, signingKey },
        }),
      } satisfies RuntimeClaim;
    }),
    apply: async (job) => {
      const runtime = job as RuntimeClaim;
      return runtime.connector.applyApprovedIncomeUpdate(contextFor(runtime), runtime.encompassLoanGuid, {
        approvalEventId: runtime.approvalEventId,
        fields: runtime.fields,
      });
    },
    readApprovalMarker: async (job) => {
      const runtime = job as RuntimeClaim;
      const fields = await runtime.connector.readFields(contextFor(runtime), runtime.encompassLoanGuid, [APPROVAL_FIELD]);
      return fields[APPROVAL_FIELD];
    },
    succeed: async (job, providerRevision) => finalize(job as RuntimeClaim, 'SUCCEEDED', undefined, providerRevision),
    retry: async (job, safeCode) => updateState(job as RuntimeClaim, 'RETRYABLE_FAILURE', safeCode),
    reconcile: async (job, safeCode) => updateState(job as RuntimeClaim, 'RECONCILING', safeCode),
    fail: async (job, safeCode) => finalize(job as RuntimeClaim, 'FAILED', safeCode),
  };
}

export async function runSyncQueueWorker(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queueUrl = required(environment.SYNC_QUEUE_URL, 'SYNC_QUEUE_URL');
  const sqs = new SQSClient({});
  const dependencies = createSyncRuntimeDependencies(environment);
  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });
  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 300,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    for (const item of response.Messages ?? []) {
      if (!item.Body || !item.ReceiptHandle) continue;
      let outcome: Awaited<ReturnType<typeof runEncompassSyncJob>>;
      try { outcome = await runEncompassSyncJob(parseMessage(item.Body), dependencies); }
      catch { continue; }
      if (!['RETRYABLE_FAILURE', 'RECONCILING'].includes(outcome)) {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: item.ReceiptHandle }));
      } else {
        const receiveCount = Number(item.Attributes?.ApproximateReceiveCount ?? '1');
        await sqs.send(new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: item.ReceiptHandle,
          VisibilityTimeout: retryVisibilitySeconds(receiveCount),
        }));
      }
    }
  }
  await prisma.$disconnect();
}

export function retryVisibilitySeconds(receiveCount: number): number {
  const boundedCount = Number.isFinite(receiveCount) ? Math.max(1, Math.min(5, Math.floor(receiveCount))) : 1;
  return Math.min(900, 30 * (2 ** (boundedCount - 1)));
}

function parseMessage(body: string): EncompassSyncQueueMessage {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error('Invalid sync message.'); }
  if (!isRecord(value)) throw new Error('Invalid sync message.');
  for (const field of ['jobId', 'tenantId', 'loanId', 'approvalEventId'] as const) {
    if (typeof value[field] !== 'string' || !UUID.test(value[field])) throw new Error('Invalid sync message.');
  }
  if (!Number.isSafeInteger(value.expectedLoanVersion) || Number(value.expectedLoanVersion) < 1) throw new Error('Invalid sync message.');
  if (typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9._~-]{16,128}$/.test(value.idempotencyKey)) throw new Error('Invalid sync message.');
  if (typeof value.correlationId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.correlationId)) throw new Error('Invalid sync message.');
  return value as EncompassSyncQueueMessage;
}

async function updateState(job: RuntimeClaim, status: 'RETRYABLE_FAILURE' | 'RECONCILING', safeErrorCode: string) {
  await prisma.$transaction(async (transaction) => {
    await setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    await transaction.encompassSyncJob.updateMany({
      where: { id: job.jobId, tenantId: job.tenantId, status: { in: ['IN_PROGRESS', 'RECONCILING'] } },
      data: { status, safeErrorCode },
    });
  });
  emitOperationalEvent(status === 'RETRYABLE_FAILURE' ? 'sync_retry' : 'sync_reconciliation', safeErrorCode);
}

async function finalize(job: RuntimeClaim, status: 'SUCCEEDED' | 'FAILED', safeErrorCode?: string, providerRevision?: string) {
  await prisma.$transaction(async (transaction) => {
    await setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    const updated = await transaction.encompassSyncJob.updateMany({
      where: { id: job.jobId, tenantId: job.tenantId, status: { in: ['IN_PROGRESS', 'RECONCILING'] } },
      data: { status, safeErrorCode: safeErrorCode ?? null, providerRevision, completedAt: new Date() },
    });
    if (updated.count !== 1) return;
    const context: RequestContext = Object.freeze({
      requestId: job.correlationId, subject: 'encompass-sync-worker', tenantId: job.tenantId,
      membershipId: job.requestedByUserId, permissions: ['encompass:sync'] as const, authTime: new Date(),
    });
    await appendAuditEvent(transaction, context, {
      loanId: job.loanId, entityType: 'ENCOMPASS_SYNC_JOB', entityId: job.jobId,
      expectedLoanVersion: job.expectedLoanVersion,
      action: status === 'SUCCEEDED' ? AUDIT_ACTIONS.ENCOMPASS_SYNC_SUCCEEDED : AUDIT_ACTIONS.ENCOMPASS_SYNC_FAILED,
      reasonCode: status === 'SUCCEEDED' ? 'PROVIDER_WRITE_CONFIRMED' : (safeErrorCode ?? 'SYNC_FAILED'),
      ruleVersion: 'encompass-sync-v1', schemaVersion: 'audit-event-v1',
      resultHash: hashAuditResult({ jobId: job.jobId, approvalEventId: job.approvalEventId, status, safeErrorCode: safeErrorCode ?? null }),
    });
    if (status === 'SUCCEEDED') {
      await transaction.loanApplication.updateMany({
        where: { id: job.loanId, tenantId: job.tenantId, version: job.expectedLoanVersion },
        data: { status: 'EXPORTED_TO_LOS' },
      });
    }
  });
  if (status === 'FAILED') emitOperationalEvent('sync_failure', safeErrorCode ?? 'SYNC_FAILED');
}

function contextFor(job: RuntimeClaim) {
  return { tenantId: job.tenantId, loanId: job.loanId, correlationId: job.correlationId };
}
function numberOrUndefined(value: Prisma.Decimal | null): number | undefined { return value?.toNumber(); }
function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
