import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';
import { ApiError } from '../../http/apiError';
import { hashCanonical } from '../../http/canonical';
import {
  loadApprovedEncompassSyncPreview,
  type SyncPreviewConfiguration,
} from './syncPreview';

export const ENCOMPASS_SYNC_OPERATION = 'encompass-syncs';

export type EncompassSyncQueueMessage = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  approvalEventId: string;
  expectedLoanVersion: number;
  idempotencyKey: string;
  correlationId: string;
}>;

export async function createEncompassSyncJob(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{
    loanId: string;
    approvalEventId: string;
    expectedLoanVersion: number;
    previewHash: string;
    idempotencyKey: string;
  }>,
  configuration: SyncPreviewConfiguration,
) {
  const requestHash = hashCanonical(input);
  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: ENCOMPASS_SYNC_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });
  if (idempotency.kind === 'replay') {
    const existing = await transaction.encompassSyncJob.findFirst({
      where: { id: idempotency.stored.responseReference, tenantId: context.tenantId, loanId: input.loanId },
      select: {
        id: true, status: true, expectedLoanVersion: true, correlationId: true,
        writePreviewHash: true,
      },
    });
    if (!existing || existing.writePreviewHash !== input.previewHash) {
      throw new ApiError(409, 'IDEMPOTENCY_STATE_INVALID', 'The stored sync state is unavailable.');
    }
    const { writePreviewHash: _writePreviewHash, ...safeExisting } = existing;
    return { ...safeExisting, replayed: true };
  }

  const preview = await loadApprovedEncompassSyncPreview(transaction, context, input, configuration);
  if (preview.previewHash !== input.previewHash) {
    throw new ApiError(409, 'ENCOMPASS_WRITE_APPROVAL_MISMATCH', 'The approved write preview no longer matches the current approved loan state.');
  }

  const job = await transaction.encompassSyncJob.create({
    data: {
      tenantId: context.tenantId,
      loanId: input.loanId,
      approvalEventId: preview.approvalEventId,
      requestedByUserId: context.membershipId,
      expectedLoanVersion: input.expectedLoanVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.requestId,
      writePreviewSchemaVersion: preview.schemaVersion,
      writePreviewHash: preview.previewHash,
      writePreviewFields: preview.fields as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, status: true, expectedLoanVersion: true, correlationId: true },
  });
  await appendAuditEvent(transaction, context, {
    loanId: input.loanId,
    entityType: 'ENCOMPASS_SYNC_JOB',
    entityId: job.id,
    expectedLoanVersion: input.expectedLoanVersion,
    action: AUDIT_ACTIONS.ENCOMPASS_SYNC_QUEUED,
    reasonCode: 'APPROVED_RESULT_QUEUED',
    ruleVersion: 'encompass-sync-v1',
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      jobId: job.id,
      approvalEventId: preview.approvalEventId,
      expectedLoanVersion: input.expectedLoanVersion,
      previewHash: preview.previewHash,
    }),
  });
  await storeIdempotencyResult(transaction, context, {
    operation: ENCOMPASS_SYNC_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: 202,
    responseReference: job.id,
  });
  return { ...job, replayed: false };
}

let sqsClient: SQSClient | undefined;

export async function publishEncompassSyncJob(message: EncompassSyncQueueMessage): Promise<void> {
  const queueUrl = process.env.SYNC_QUEUE_URL?.trim();
  if (!queueUrl) throw new Error('SYNC_QUEUE_URL is not configured.');
  sqsClient ??= new SQSClient({});
  await sqsClient.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
}

export async function markSyncQueueFailure(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  jobId: string,
): Promise<void> {
  await transaction.encompassSyncJob.updateMany({
    where: { id: jobId, tenantId: context.tenantId, status: { in: ['QUEUED', 'RETRYABLE_FAILURE'] } },
    data: { status: 'RETRYABLE_FAILURE', safeErrorCode: 'QUEUE_PUBLISH_FAILED' },
  });
}
