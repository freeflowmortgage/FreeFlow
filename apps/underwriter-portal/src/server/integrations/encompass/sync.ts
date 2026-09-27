import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';
import { ApiError } from '../../http/apiError';
import { hashCanonical } from '../../http/canonical';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';

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
    idempotencyKey: string;
  }>,
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
      select: { id: true, status: true, expectedLoanVersion: true, correlationId: true },
    });
    if (!existing) throw new ApiError(409, 'IDEMPOTENCY_STATE_INVALID', 'The stored sync state is unavailable.');
    return { ...existing, replayed: true };
  }

  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { id: true, version: true, encompassGuid: true },
  });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  if (loan.version !== input.expectedLoanVersion) {
    throw new ApiError(409, 'STALE_APPROVAL', 'The approved loan state is stale.');
  }
  if (!loan.encompassGuid) throw new ApiError(422, 'ENCOMPASS_LOAN_NOT_LINKED', 'The loan is not linked to Encompass.');

  const configuration = await transaction.tenantConfiguration.findFirst({
    where: { tenantId: context.tenantId },
    select: { enableEncompassSync: true },
  });
  const binding = await transaction.encompassConnectorBinding.findFirst({
    where: { tenantId: context.tenantId, isEnabled: true },
    select: { id: true },
  });
  if (!configuration?.enableEncompassSync || !binding) {
    throw new ApiError(422, 'ENCOMPASS_SYNC_DISABLED', 'Encompass synchronization is not enabled for this tenant.');
  }

  const approval = await transaction.auditEvent.findFirst({
    where: {
      id: input.approvalEventId,
      tenantId: context.tenantId,
      loanId: input.loanId,
      entityType: 'FORM_1084_AUDIT',
      action: { in: [AUDIT_ACTIONS.INCOME_APPROVED, AUDIT_ACTIONS.INCOME_OVERRIDE] },
    },
    select: { id: true, entityId: true, expectedLoanVersion: true },
  });
  if (!approval) throw new ApiError(422, 'APPROVAL_REQUIRED', 'An immutable approved calculation is required.');
  if (approval.expectedLoanVersion + 1 !== input.expectedLoanVersion) {
    throw new ApiError(409, 'STALE_APPROVAL', 'The approval does not match the current loan version.');
  }
  const calculation = await transaction.form1084Audit.findFirst({
    where: { id: approval.entityId, tenantId: context.tenantId, loanId: input.loanId, isHumanVerified: true },
    select: {
      id: true,
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
  if (!calculation) throw new ApiError(422, 'APPROVED_CALCULATION_UNAVAILABLE', 'The approved calculation is unavailable.');
  if (!hasCurrentCalculationExtractions(calculation.extractionBindings)) {
    throw new ApiError(409, 'STALE_APPROVAL_EXTRACTION', 'The approved calculation is based on a superseded extraction.');
  }

  const job = await transaction.encompassSyncJob.create({
    data: {
      tenantId: context.tenantId,
      loanId: input.loanId,
      approvalEventId: approval.id,
      requestedByUserId: context.membershipId,
      expectedLoanVersion: input.expectedLoanVersion,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.requestId,
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
    resultHash: hashAuditResult({ jobId: job.id, approvalEventId: approval.id, expectedLoanVersion: input.expectedLoanVersion }),
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
