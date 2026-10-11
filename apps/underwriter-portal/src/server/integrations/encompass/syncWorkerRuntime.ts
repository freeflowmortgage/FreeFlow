import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Prisma, type EncompassSyncStatus } from '@prisma/client';
import {
  CustomConnectorAdapter,
  type EncompassConnector,
  type EncompassFieldReadbackReport,
} from '@mortgage-pos/encompass-connector-contract';
import { prisma, setTenantContext } from '../../database/client';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import type { RequestContext } from '../../auth/requestContext';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';
import type { EncompassSyncQueueMessage } from './sync';
import { runEncompassSyncJob, type ClaimedSync, type SyncWorkerDependencies } from './syncWorker';
import { emitOperationalEvent } from '../../observability/operationalEvents';
import { sanitizeFieldReadback } from './fieldReadback';
import { restorePersistedEncompassSyncPreview, type EncompassSyncTarget } from './syncPreview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000001';
const MAX_ATTEMPTS = 5;
const MAX_RECONCILIATIONS = 5;
export const STALE_SYNC_CLAIM_MS = 15 * 60_000;
export const SYNC_MESSAGE_VISIBILITY_SECONDS = 20 * 60;

type RuntimeClaim = ClaimedSync & Readonly<{
  encompassLoanGuid: string;
  requestedByUserId: string;
  correlationId: string;
  expectedLoanVersion: number;
  target: EncompassSyncTarget;
  connector: EncompassConnector;
}>;

type ClaimFailure = Readonly<{ kind: 'FAILED'; safeErrorCode: string }>;

export type SyncRuntimeInfrastructure = Readonly<{
  withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  setTenantContext: typeof setTenantContext;
  createConnector(input: Readonly<{
    serviceBaseUrl: string;
    serviceId: string;
    signingKey: string;
    lenderId: string;
    deploymentId: string;
  }>): EncompassConnector;
}>;

const defaultRuntimeInfrastructure: SyncRuntimeInfrastructure = {
  withTransaction: (operation) => prisma.$transaction(operation),
  setTenantContext,
  createConnector: (input) => new CustomConnectorAdapter({
    binding: {
      kind: 'custom', lenderId: input.lenderId, deploymentId: input.deploymentId,
      serviceBaseUrl: input.serviceBaseUrl,
    },
    serviceAuth: { kind: 'signed-hmac', serviceId: input.serviceId, signingKey: input.signingKey },
  }),
};

export function createSyncRuntimeDependencies(
  environment: NodeJS.ProcessEnv = process.env,
  infrastructure: SyncRuntimeInfrastructure = defaultRuntimeInfrastructure,
): SyncWorkerDependencies {
  const serviceBaseUrl = required(environment.ENCOMPASS_CONNECTOR_SERVICE_URL, 'ENCOMPASS_CONNECTOR_SERVICE_URL');
  const serviceId = required(environment.ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID, 'ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID');
  const signingKey = required(environment.ENCOMPASS_CONNECTOR_SIGNING_KEY, 'ENCOMPASS_CONNECTOR_SIGNING_KEY');

  return {
    claim: async (message) => {
      const outcome = await infrastructure.withTransaction<RuntimeClaim | ClaimFailure | null>(async (transaction) => {
        await infrastructure.setTenantContext(transaction, { tenantId: message.tenantId, principalId: WORKER_PRINCIPAL_ID });
        const record = await transaction.encompassSyncJob.findFirst({
        where: {
          id: message.jobId, tenantId: message.tenantId, loanId: message.loanId,
          approvalEventId: message.approvalEventId, expectedLoanVersion: message.expectedLoanVersion,
          idempotencyKey: message.idempotencyKey, correlationId: message.correlationId,
          status: { in: ['QUEUED', 'RETRYABLE_FAILURE', 'RECONCILING', 'IN_PROGRESS'] },
        },
        select: {
          id: true, tenantId: true, loanId: true, approvalEventId: true, status: true,
          attemptCount: true, reconciliationCount: true, startedAt: true,
          requestedByUserId: true, correlationId: true,
          expectedLoanVersion: true,
          writePreviewSchemaVersion: true, writePreviewHash: true, writePreviewFields: true,
          writeTargetIntegrationMode: true, writeTargetLenderId: true,
          writeTargetDeploymentId: true, writeTargetEncompassGuid: true,
          loanApplication: { select: { version: true, encompassGuid: true, encompassIntegrationMode: true } },
          approvalEvent: { select: { action: true, entityType: true, entityId: true, expectedLoanVersion: true } },
          tenant: { select: {
            configurations: { select: { enableEncompassSync: true } },
            encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
          } },
        },
      });
      if (!record) return null;
      const staleInProgress = record.status === 'IN_PROGRESS'
        && Boolean(record.startedAt && record.startedAt.getTime() < Date.now() - STALE_SYNC_CLAIM_MS);
      if (record.status === 'IN_PROGRESS' && !staleInProgress) return null;
      if (record.loanApplication.version !== message.expectedLoanVersion
        || record.approvalEvent.expectedLoanVersion + 1 !== message.expectedLoanVersion
        || record.approvalEvent.entityType !== 'FORM_1084_AUDIT'
        || !['INCOME_APPROVED', 'INCOME_OVERRIDE'].includes(record.approvalEvent.action)) {
        return failClaim(transaction, record, 'STALE_APPROVAL');
      }
      if (record.loanApplication.encompassIntegrationMode !== 'CUSTOM_CONNECTOR') {
        return failClaim(transaction, record, 'ENCOMPASS_CUSTOM_CONNECTOR_REQUIRED');
      }
      const binding = record.tenant.encompassConnectorBinding;
      if (!record.tenant.configurations?.enableEncompassSync || !binding?.isEnabled || !record.loanApplication.encompassGuid) {
        return failClaim(transaction, record, 'ENCOMPASS_BINDING_UNAVAILABLE');
      }
      const preview = restorePersistedEncompassSyncPreview({
        schemaVersion: record.writePreviewSchemaVersion,
        previewHash: record.writePreviewHash,
        approvalEventId: record.approvalEventId,
        fields: record.writePreviewFields,
        target: {
          integrationMode: record.writeTargetIntegrationMode,
          lenderId: record.writeTargetLenderId,
          deploymentId: record.writeTargetDeploymentId,
          encompassLoanGuid: record.writeTargetEncompassGuid,
        },
      });
      if (!preview) {
        return failClaim(transaction, record, 'ENCOMPASS_WRITE_PREVIEW_INVALID');
      }
      if (preview.target.lenderId !== binding.lenderId
        || preview.target.deploymentId !== binding.deploymentId
        || preview.target.encompassLoanGuid !== record.loanApplication.encompassGuid) {
        return failClaim(transaction, record, 'ENCOMPASS_WRITE_TARGET_CHANGED');
      }
      const calculation = await transaction.form1084Audit.findFirst({
        where: {
          id: record.approvalEvent.entityId, tenantId: record.tenantId, loanId: record.loanId,
          isHumanVerified: true, calculatedLoanVersion: record.approvalEvent.expectedLoanVersion,
        },
        select: {
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
        return failClaim(
          transaction,
          record,
          calculation ? 'STALE_APPROVAL_EXTRACTION' : 'APPROVED_CALCULATION_UNAVAILABLE',
        );
      }
      const mode = record.status === 'RECONCILING' || staleInProgress ? 'RECONCILE' : 'APPLY';
      if (mode === 'APPLY' && record.attemptCount >= MAX_ATTEMPTS) {
        return failClaim(transaction, record, 'SYNC_RETRY_LIMIT_REACHED');
      }
      if (mode === 'RECONCILE' && record.reconciliationCount >= MAX_RECONCILIATIONS) {
        return failClaim(transaction, record, 'SYNC_RECONCILIATION_LIMIT_REACHED');
      }
      const claimed = await transaction.encompassSyncJob.updateMany({
        where: { id: record.id, tenantId: record.tenantId, status: record.status },
        data: mode === 'APPLY'
          ? { status: 'IN_PROGRESS', attemptCount: { increment: 1 }, startedAt: new Date(), safeErrorCode: null }
          : { status: 'RECONCILING', reconciliationCount: { increment: 1 }, safeErrorCode: null },
      });
      if (claimed.count !== 1) return null;
      return {
        jobId: record.id, tenantId: record.tenantId, loanId: record.loanId,
        approvalEventId: record.approvalEventId, mode, fields: preview.fields,
        encompassLoanGuid: preview.target.encompassLoanGuid,
        requestedByUserId: record.requestedByUserId, correlationId: record.correlationId,
        expectedLoanVersion: record.expectedLoanVersion,
        target: preview.target,
        connector: infrastructure.createConnector({
          lenderId: preview.target.lenderId,
          deploymentId: preview.target.deploymentId,
          serviceBaseUrl,
          serviceId,
          signingKey,
        }),
      } satisfies RuntimeClaim;
      });
      if (!outcome) return null;
      if ('kind' in outcome) {
        emitOperationalEvent('sync_failure', outcome.safeErrorCode);
        return null;
      }
      return outcome;
    },
    apply: async (job) => {
      const runtime = job as RuntimeClaim;
      return runtime.connector.applyApprovedIncomeUpdate(contextFor(runtime), runtime.encompassLoanGuid, {
        approvalEventId: runtime.approvalEventId,
        fields: runtime.fields,
      });
    },
    readFields: async (job) => {
      const runtime = job as RuntimeClaim;
      return runtime.connector.readFields(
        contextFor(runtime),
        runtime.encompassLoanGuid,
        runtime.fields.map((field) => field.fieldName),
      );
    },
    succeed: async (job, providerRevision, readback) => finalize(
      job as RuntimeClaim,
      infrastructure,
      'SUCCEEDED',
      undefined,
      providerRevision,
      readback,
    ),
    retry: async (job, safeCode) => updateState(job as RuntimeClaim, 'RETRYABLE_FAILURE', safeCode, infrastructure),
    reconcile: async (job, safeCode) => updateState(job as RuntimeClaim, 'RECONCILING', safeCode, infrastructure),
    fail: async (job, safeCode, readback) => {
      await finalize(
        job as RuntimeClaim,
        infrastructure,
        'FAILED',
        safeCode,
        undefined,
        readback,
      );
    },
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
      QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 20,
      VisibilityTimeout: SYNC_MESSAGE_VISIBILITY_SECONDS,
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

async function failClaim(
  transaction: Prisma.TransactionClient,
  record: Readonly<{
    id: string;
    tenantId: string;
    loanId: string;
    approvalEventId: string;
    requestedByUserId: string;
    correlationId: string;
    expectedLoanVersion: number;
    status: EncompassSyncStatus;
  }>,
  safeErrorCode: string,
): Promise<ClaimFailure | null> {
  const failed = await transaction.encompassSyncJob.updateMany({
    where: { id: record.id, tenantId: record.tenantId, status: record.status },
    data: { status: 'FAILED', safeErrorCode, completedAt: new Date() },
  });
  if (failed.count !== 1) return null;
  const context = workerContext(record);
  await appendAuditEvent(transaction, context, {
    loanId: record.loanId,
    entityType: 'ENCOMPASS_SYNC_JOB',
    entityId: record.id,
    expectedLoanVersion: record.expectedLoanVersion,
    action: AUDIT_ACTIONS.ENCOMPASS_SYNC_FAILED,
    reasonCode: safeErrorCode,
    ruleVersion: 'encompass-sync-v1',
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      jobId: record.id,
      approvalEventId: record.approvalEventId,
      status: 'FAILED',
      safeErrorCode,
    }),
  });
  return { kind: 'FAILED', safeErrorCode };
}

async function updateState(
  job: RuntimeClaim,
  status: 'RETRYABLE_FAILURE' | 'RECONCILING',
  safeErrorCode: string,
  infrastructure: SyncRuntimeInfrastructure,
) {
  await infrastructure.withTransaction(async (transaction) => {
    await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    await transaction.encompassSyncJob.updateMany({
      where: { id: job.jobId, tenantId: job.tenantId, status: { in: ['IN_PROGRESS', 'RECONCILING'] } },
      data: { status, safeErrorCode },
    });
  });
  emitOperationalEvent(status === 'RETRYABLE_FAILURE' ? 'sync_retry' : 'sync_reconciliation', safeErrorCode);
}

async function finalize(
  job: RuntimeClaim,
  infrastructure: SyncRuntimeInfrastructure,
  status: 'SUCCEEDED' | 'FAILED',
  safeErrorCode?: string,
  providerRevision?: string,
  readback?: EncompassFieldReadbackReport,
): Promise<boolean> {
  const fieldReadback = readback ? sanitizeFieldReadback(readback, {
    allowedFieldNames: new Set(job.fields.map((field) => field.fieldName)),
    expectedOutcome: status,
  }) : undefined;
  const outcome = await infrastructure.withTransaction(async (transaction) => {
    await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    let finalStatus = status;
    let finalSafeErrorCode = safeErrorCode;

    if (status === 'SUCCEEDED') {
      const configuration = await transaction.tenantConfiguration.findFirst({
        where: { tenantId: job.tenantId },
        select: { enableEncompassSync: true },
      });
      const binding = await transaction.encompassConnectorBinding.findFirst({
        where: {
          tenantId: job.tenantId,
          isEnabled: true,
          lenderId: job.target.lenderId,
          deploymentId: job.target.deploymentId,
        },
        select: { id: true },
      });
      if (!configuration?.enableEncompassSync || !binding) {
        finalStatus = 'FAILED';
        finalSafeErrorCode = 'ENCOMPASS_WRITE_TARGET_CHANGED_AFTER_WRITE';
      } else {
        // This conditional UPDATE is the freshness check and row lock. A loan
        // mutation committed before or racing this statement makes count zero.
        const loanUpdated = await transaction.loanApplication.updateMany({
          where: {
            id: job.loanId,
            tenantId: job.tenantId,
            version: job.expectedLoanVersion,
            encompassGuid: job.target.encompassLoanGuid,
            encompassIntegrationMode: job.target.integrationMode,
          },
          data: { status: 'EXPORTED_TO_LOS' },
        });
        if (loanUpdated.count !== 1) {
          finalStatus = 'FAILED';
          finalSafeErrorCode = 'STALE_APPROVAL_AFTER_WRITE';
        }
      }
    }

    const updated = await transaction.encompassSyncJob.updateMany({
      where: { id: job.jobId, tenantId: job.tenantId, status: { in: ['IN_PROGRESS', 'RECONCILING'] } },
      data: {
        status: finalStatus,
        safeErrorCode: finalSafeErrorCode ?? null,
        providerRevision,
        ...(fieldReadback ? { fieldReadback: fieldReadback as Prisma.InputJsonValue } : {}),
        completedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      // Roll back a preceding loan status update instead of committing an
      // unowned terminal transition.
      if (status === 'SUCCEEDED' && finalStatus === 'SUCCEEDED') throw new Error('SYNC_FINAL_STATE_CONFLICT');
      return { transitioned: false, status: finalStatus, safeErrorCode: finalSafeErrorCode };
    }
    const context = workerContext(job);
    await appendAuditEvent(transaction, context, {
      loanId: job.loanId, entityType: 'ENCOMPASS_SYNC_JOB', entityId: job.jobId,
      expectedLoanVersion: job.expectedLoanVersion,
      action: finalStatus === 'SUCCEEDED' ? AUDIT_ACTIONS.ENCOMPASS_SYNC_SUCCEEDED : AUDIT_ACTIONS.ENCOMPASS_SYNC_FAILED,
      reasonCode: finalStatus === 'SUCCEEDED' ? 'PROVIDER_WRITE_CONFIRMED' : (finalSafeErrorCode ?? 'SYNC_FAILED'),
      ruleVersion: 'encompass-sync-v1', schemaVersion: 'audit-event-v1',
      resultHash: hashAuditResult({
        jobId: job.jobId,
        approvalEventId: job.approvalEventId,
        status: finalStatus,
        safeErrorCode: finalSafeErrorCode ?? null,
        fieldReadback: fieldReadback ?? null,
      }),
    });
    return { transitioned: true, status: finalStatus, safeErrorCode: finalSafeErrorCode };
  });
  if (outcome.transitioned && outcome.status === 'FAILED') {
    emitOperationalEvent('sync_failure', outcome.safeErrorCode ?? 'SYNC_FAILED');
  }
  return outcome.transitioned && outcome.status === 'SUCCEEDED';
}

function contextFor(job: RuntimeClaim) {
  return { tenantId: job.tenantId, loanId: job.loanId, correlationId: job.correlationId };
}

function workerContext(job: Readonly<{
  correlationId: string;
  tenantId: string;
  requestedByUserId: string;
}>): RequestContext {
  return Object.freeze({
    requestId: job.correlationId,
    subject: 'encompass-sync-worker',
    tenantId: job.tenantId,
    membershipId: job.requestedByUserId,
    permissions: ['encompass:sync'] as const,
    authTime: new Date(),
  });
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
