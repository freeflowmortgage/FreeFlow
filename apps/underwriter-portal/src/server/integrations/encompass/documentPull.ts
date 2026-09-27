import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { hashCanonical } from '../../http/canonical';
import { ApiError } from '../../http/apiError';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';

export const DOCUMENT_PULL_OPERATION = 'encompass-document-pulls';

export type DocumentPullQueueMessage = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  expectedLoanVersion: number;
  correlationId: string;
}>;

export type DocumentPullJobResult = Readonly<{
  jobId: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'RETRYABLE_FAILURE' | 'FAILED';
  expectedLoanVersion: number;
  correlationId: string;
  replayed: boolean;
}>;

export async function createDocumentPullJob(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{
    loanId: string;
    expectedLoanVersion: number;
    attachmentIds: ReadonlyArray<string>;
    idempotencyKey: string;
  }>,
): Promise<DocumentPullJobResult> {
  const requestHash = hashCanonical({
    loanId: input.loanId,
    expectedLoanVersion: input.expectedLoanVersion,
    attachmentIds: input.attachmentIds,
  });
  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: DOCUMENT_PULL_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });

  if (idempotency.kind === 'replay') {
    const jobId = idempotency.stored.responseReference;
    const existing = await transaction.encompassDocumentPullJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId, loanId: input.loanId },
      select: {
        id: true,
        status: true,
        expectedLoanVersion: true,
        correlationId: true,
      },
    });
    if (!existing) {
      throw new ApiError(409, 'IDEMPOTENCY_STATE_INVALID', 'The stored request state is unavailable.');
    }
    return {
      jobId: existing.id,
      status: existing.status,
      expectedLoanVersion: existing.expectedLoanVersion,
      correlationId: existing.correlationId,
      replayed: true,
    };
  }

  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { id: true, version: true, encompassGuid: true },
  });
  if (!loan) {
    throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  }
  if (loan.version !== input.expectedLoanVersion) {
    throw new ApiError(409, 'STALE_LOAN_VERSION', 'The loan changed and must be refreshed before documents are pulled.');
  }
  if (!loan.encompassGuid) {
    throw new ApiError(422, 'ENCOMPASS_LOAN_NOT_LINKED', 'The loan is not linked to an Encompass loan.');
  }

  const configuration = await transaction.tenantConfiguration.findFirst({
    where: { tenantId: context.tenantId },
    select: {
      enableEncompassDocumentPull: true,
    },
  });
  if (!configuration?.enableEncompassDocumentPull) {
    throw new ApiError(422, 'ENCOMPASS_DOCUMENT_PULL_DISABLED', 'Encompass document pull is not enabled for this tenant.');
  }
  const binding = await transaction.encompassConnectorBinding.findFirst({
    where: { tenantId: context.tenantId, isEnabled: true },
    select: { id: true },
  });
  if (!binding) {
    throw new ApiError(422, 'ENCOMPASS_CONFIGURATION_INCOMPLETE', 'The tenant Encompass configuration is incomplete.');
  }

  const job = await transaction.encompassDocumentPullJob.create({
    data: {
      tenantId: context.tenantId,
      loanId: input.loanId,
      requestedByUserId: context.membershipId,
      expectedLoanVersion: input.expectedLoanVersion,
      selectedAttachmentIds: [...input.attachmentIds],
      idempotencyKey: input.idempotencyKey,
      correlationId: context.requestId,
    },
    select: {
      id: true,
      status: true,
      expectedLoanVersion: true,
      correlationId: true,
    },
  });

  await appendAuditEvent(transaction, context, {
    loanId: input.loanId,
    entityType: 'ENCOMPASS_DOCUMENT_PULL_JOB',
    entityId: job.id,
    expectedLoanVersion: input.expectedLoanVersion,
    action: AUDIT_ACTIONS.ENCOMPASS_DOCUMENT_PULL_QUEUED,
    reasonCode: 'ENCOMPASS_EFOLDER_REQUESTED',
    ruleVersion: 'encompass-document-pull-v1',
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      jobId: job.id,
      loanId: input.loanId,
      expectedLoanVersion: input.expectedLoanVersion,
      status: job.status,
    }),
  });

  await storeIdempotencyResult(transaction, context, {
    operation: DOCUMENT_PULL_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: 202,
    responseReference: job.id,
  });

  return {
    jobId: job.id,
    status: job.status,
    expectedLoanVersion: job.expectedLoanVersion,
    correlationId: job.correlationId,
    replayed: false,
  };
}

let sqsClient: SQSClient | undefined;

export async function publishDocumentPullJob(message: DocumentPullQueueMessage): Promise<void> {
  const queueUrl = process.env.DOCUMENT_PULL_QUEUE_URL?.trim();
  if (!queueUrl) throw new Error('DOCUMENT_PULL_QUEUE_URL is not configured.');
  sqsClient ??= new SQSClient({});
  await sqsClient.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  }));
}

export async function markDocumentPullQueueFailure(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  jobId: string,
): Promise<void> {
  await transaction.encompassDocumentPullJob.updateMany({
    where: {
      id: jobId,
      tenantId: context.tenantId,
      status: 'QUEUED',
    },
    data: {
      status: 'RETRYABLE_FAILURE',
      safeErrorCode: 'QUEUE_PUBLISH_FAILED',
    },
  });
}
