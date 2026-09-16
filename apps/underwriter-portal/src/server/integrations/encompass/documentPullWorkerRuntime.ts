import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Prisma } from '@prisma/client';
import { prisma, setTenantContext } from '../../database/client';
import type { DocumentPullQueueMessage } from './documentPull';
import { EncompassApiClient, parseWithIncomeService } from './encompassApi';
import { runDocumentPullJob, type ClaimedDocumentPull, type DocumentPullWorkerDependencies } from './documentPullWorker';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000001';

export function createRuntimeDependencies(environment: NodeJS.ProcessEnv = process.env): DocumentPullWorkerDependencies {
  const clientSecret = required(environment.ENCOMPASS_CLIENT_SECRET, 'ENCOMPASS_CLIENT_SECRET');
  const parserUrl = required(environment.DOC_PARSER_SERVICE_URL, 'DOC_PARSER_SERVICE_URL');
  const clients = new Map<string, EncompassApiClient>();

  const clientFor = (job: ClaimedDocumentPull) => {
    let client = clients.get(job.jobId);
    if (!client) {
      client = new EncompassApiClient({
        clientId: job.encompassClientId,
        clientSecret,
        instanceId: job.encompassInstanceId,
        baseUrl: environment.ENCOMPASS_BASE_URL,
      });
      clients.set(job.jobId, client);
    }
    return client;
  };

  return {
    claim: async (message) => prisma.$transaction(async (transaction) => {
      await setTenantContext(transaction, { tenantId: message.tenantId, principalId: WORKER_PRINCIPAL_ID });
      const claimWhere: Prisma.EncompassDocumentPullJobWhereInput = {
        id: message.jobId,
        tenantId: message.tenantId,
        loanId: message.loanId,
        expectedLoanVersion: message.expectedLoanVersion,
        correlationId: message.correlationId,
        status: { in: ['QUEUED', 'RETRYABLE_FAILURE'] },
        attemptCount: { lt: 5 },
      };
      const record = await transaction.encompassDocumentPullJob.findFirst({
        where: claimWhere,
        select: {
          id: true,
          tenantId: true,
          loanId: true,
          loanApplication: { select: { version: true, encompassGuid: true } },
          tenant: { select: { configurations: { select: {
            enableEncompassDocumentPull: true,
            encompassClientId: true,
            encompassInstanceId: true,
          } } } },
        },
      });
      if (!record) return null;
      const configuration = record.tenant.configurations;
      if (record.loanApplication.version !== message.expectedLoanVersion) {
        await transaction.encompassDocumentPullJob.updateMany({
          where: claimWhere,
          data: { status: 'FAILED', safeErrorCode: 'STALE_LOAN_VERSION', completedAt: new Date() },
        });
        return null;
      }
      if (!configuration?.enableEncompassDocumentPull || !configuration.encompassClientId || !configuration.encompassInstanceId || !record.loanApplication.encompassGuid) {
        await transaction.encompassDocumentPullJob.updateMany({
          where: claimWhere,
          data: { status: 'FAILED', safeErrorCode: 'ENCOMPASS_CONFIGURATION_INCOMPLETE', completedAt: new Date() },
        });
        return null;
      }
      const claimed = await transaction.encompassDocumentPullJob.updateMany({
        where: claimWhere,
        data: {
          status: 'IN_PROGRESS',
          attemptCount: { increment: 1 },
          safeErrorCode: null,
          startedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return null;
      return {
        jobId: record.id,
        tenantId: record.tenantId,
        loanId: record.loanId,
        encompassLoanGuid: record.loanApplication.encompassGuid,
        encompassClientId: configuration.encompassClientId,
        encompassInstanceId: configuration.encompassInstanceId,
      };
    }),
    listAttachments: async (job) => clientFor(job).listActiveAttachments(job.encompassLoanGuid),
    download: async (job, attachmentId) => clientFor(job).downloadOriginalAttachment(job.encompassLoanGuid, attachmentId),
    parse: async (bytes) => parseWithIncomeService(bytes, { parserUrl }),
    saveResult: async (job, result) => prisma.$transaction(async (transaction) => {
      await setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
      await transaction.loanDocument.upsert({
        where: { tenantId_loanId_sourceAttachmentId: {
          tenantId: job.tenantId,
          loanId: job.loanId,
          sourceAttachmentId: result.attachmentId,
        } },
        create: {
          tenantId: job.tenantId,
          loanId: job.loanId,
          fileType: 'application/pdf',
          documentCategory: result.parsed.documentCategory,
          sourceAttachmentId: result.attachmentId,
          sourceContentHash: result.sha256,
          sourcePageCount: result.parsed.pageCount,
          parserVersion: result.parsed.parserVersion,
          ocrConfidence: result.parsed.confidence === null ? null : new Prisma.Decimal(result.parsed.confidence),
        },
        update: {
          documentCategory: result.parsed.documentCategory,
          sourceContentHash: result.sha256,
          sourcePageCount: result.parsed.pageCount,
          parserVersion: result.parsed.parserVersion,
          ocrConfidence: result.parsed.confidence === null ? null : new Prisma.Decimal(result.parsed.confidence),
        },
      });
    }),
    succeed: async (job, attachmentCount, processedCount) => updateJob(job, {
      status: 'SUCCEEDED', attachmentCount, processedCount, completedAt: new Date(), safeErrorCode: null,
    }),
    fail: async (job, safeErrorCode, retryable) => {
      clients.delete(job.jobId);
      await updateJob(job, {
        status: retryable ? 'RETRYABLE_FAILURE' : 'FAILED', safeErrorCode, completedAt: retryable ? null : new Date(),
      });
    },
  };
}

export async function runQueueWorker(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queueUrl = required(environment.DOCUMENT_PULL_QUEUE_URL, 'DOCUMENT_PULL_QUEUE_URL');
  const sqs = new SQSClient({});
  const dependencies = createRuntimeDependencies(environment);
  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });

  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 900,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    for (const item of response.Messages ?? []) {
      if (!item.Body || !item.ReceiptHandle) continue;
      let outcome: Awaited<ReturnType<typeof runDocumentPullJob>> = 'FAILED';
      try {
        outcome = await runDocumentPullJob(parseMessage(item.Body), dependencies);
      } catch {
        // The message remains hidden until the visibility timeout and is retried.
        continue;
      }
      if (outcome !== 'RETRYABLE_FAILURE') {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: item.ReceiptHandle }));
      }
    }
  }
  await prisma.$disconnect();
}

function parseMessage(body: string): DocumentPullQueueMessage {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error('Invalid queue message.'); }
  if (!isRecord(value)) throw new Error('Invalid queue message.');
  for (const field of ['jobId', 'tenantId', 'loanId'] as const) {
    if (typeof value[field] !== 'string' || !UUID.test(value[field])) throw new Error('Invalid queue message.');
  }
  if (!Number.isInteger(value.expectedLoanVersion) || Number(value.expectedLoanVersion) < 1) throw new Error('Invalid queue message.');
  if (typeof value.correlationId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.correlationId)) throw new Error('Invalid queue message.');
  return value as DocumentPullQueueMessage;
}

async function updateJob(job: ClaimedDocumentPull, data: Prisma.EncompassDocumentPullJobUpdateManyMutationInput): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    await transaction.encompassDocumentPullJob.updateMany({
      where: { id: job.jobId, tenantId: job.tenantId, status: 'IN_PROGRESS' },
      data,
    });
  });
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
