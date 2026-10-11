import type { DocumentPullQueueMessage } from './documentPull';
import type { EncompassAttachment, ParsedAttachment } from './encompassApi';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { classifyDocumentPullFailure, logDocumentPullFailure } from './documentPullFailure';

export const DOCUMENT_PULL_MAX_AGGREGATE_BYTES = 80 * 1024 * 1024;
export const DOCUMENT_PULL_MAX_AGGREGATE_PAGES = 300;
const MAX_ELAPSED_MS = 10 * 60 * 1000;
const MAX_ATTACHMENTS = 20;

export type ClaimedDocumentPull = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  correlationId: string;
  requestedByUserId: string;
  expectedLoanVersion: number;
  claimToken: string;
  encompassLoanGuid: string;
  lenderId: string;
  deploymentId: string;
  totalAttachmentCount: number;
  processedCount: number;
  processedByteCount: number;
  processedPageCount: number;
  // Only attachments not durably recorded by a preceding attempt are exposed
  // to the processing loop.
  selectedAttachmentIds: ReadonlyArray<string>;
}>;

export type DocumentPullWorkerDependencies = Readonly<{
  claim(message: DocumentPullQueueMessage): Promise<ClaimedDocumentPull | null>;
  listAttachments(job: ClaimedDocumentPull): Promise<ReadonlyArray<EncompassAttachment>>;
  download(job: ClaimedDocumentPull, attachmentId: string): Promise<Readonly<{ bytes: Uint8Array; sha256: string }>>;
  parse(bytes: Uint8Array): Promise<ParsedAttachment>;
  saveResult(job: ClaimedDocumentPull, result: Readonly<{
    attachmentId: string;
    sha256: string;
    byteCount: number;
    parsed: ParsedAttachment;
  }>): Promise<void>;
  succeed(job: ClaimedDocumentPull, attachmentCount: number, processedCount: number): Promise<'SUCCEEDED' | 'FAILED'>;
  fail(job: ClaimedDocumentPull, safeCode: string, retryable: boolean): Promise<void>;
}>;

/**
 * Processes attachments serially so only one document exists in worker memory.
 * The byte array is never returned, logged, queued, or persisted.
 */
export async function runDocumentPullJob(
  message: DocumentPullQueueMessage,
  dependencies: DocumentPullWorkerDependencies,
): Promise<'SKIPPED' | 'SUCCEEDED' | 'RETRYABLE_FAILURE' | 'FAILED'> {
  const job = await dependencies.claim(message);
  if (!job) return 'SKIPPED';

  const attachmentCount = job.totalAttachmentCount;
  let processedCount = job.processedCount;
  let aggregateBytes = job.processedByteCount;
  let aggregatePages = job.processedPageCount;
  const startedAt = Date.now();
  try {
    validateAggregateDocumentLimits({ attachmentCount, bytes: 0, pages: 0, elapsedMs: 0 });
    if (job.selectedAttachmentIds.length > 0) {
      const available = await dependencies.listAttachments(job);
      const availableIds = new Set(available.map((attachment) => attachment.id));
      if (job.selectedAttachmentIds.some((id) => !availableIds.has(id))) {
        throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_NOT_AVAILABLE', 'A selected attachment is not active or does not exist.', false);
      }
    }
    const attachments = job.selectedAttachmentIds.map((id) => ({ id }));
    for (const attachment of attachments) {
      validateAggregateDocumentLimits({ attachmentCount, bytes: aggregateBytes, pages: aggregatePages, elapsedMs: Date.now() - startedAt });
      const downloaded = await dependencies.download(job, attachment.id);
      try {
        aggregateBytes += downloaded.bytes.byteLength;
        validateAggregateDocumentLimits({ attachmentCount, bytes: aggregateBytes, pages: aggregatePages, elapsedMs: Date.now() - startedAt });
        const parsed = await dependencies.parse(downloaded.bytes);
        aggregatePages += parsed.pageCount;
        validateAggregateDocumentLimits({ attachmentCount, bytes: aggregateBytes, pages: aggregatePages, elapsedMs: Date.now() - startedAt });
        if (parsed.documentCategory === 'UNCLASSIFIED') {
          throw new EncompassConnectorError('UNSUPPORTED_DOCUMENT_TYPE', 'The selected attachment is not a supported income document.', false);
        }
        await dependencies.saveResult(job, {
          attachmentId: attachment.id,
          sha256: downloaded.sha256,
          byteCount: downloaded.bytes.byteLength,
          parsed,
        });
        processedCount += 1;
      } finally {
        downloaded.bytes.fill(0);
      }
    }
    return dependencies.succeed(job, attachmentCount, processedCount);
  } catch (error) {
    const classified = classifyDocumentPullFailure(error);
    logDocumentPullFailure(error, classified);
    await dependencies.fail(job, classified.safeCode, classified.retryable);
    return classified.retryable ? 'RETRYABLE_FAILURE' : 'FAILED';
  }
}

export function validateAggregateDocumentLimits(input: Readonly<{
  attachmentCount: number;
  bytes: number;
  pages: number;
  elapsedMs: number;
}>): void {
  if (input.attachmentCount < 1 || input.attachmentCount > MAX_ATTACHMENTS) {
    throw new EncompassConnectorError('DOCUMENT_PULL_ATTACHMENT_LIMIT', 'The attachment selection exceeds the job limit.', false);
  }
  if (input.bytes > DOCUMENT_PULL_MAX_AGGREGATE_BYTES) {
    throw new EncompassConnectorError('DOCUMENT_PULL_BYTE_LIMIT', 'Selected documents exceed the aggregate size limit.', false);
  }
  if (input.pages > DOCUMENT_PULL_MAX_AGGREGATE_PAGES) {
    throw new EncompassConnectorError('DOCUMENT_PULL_PAGE_LIMIT', 'Selected documents exceed the aggregate page limit.', false);
  }
  if (input.elapsedMs > MAX_ELAPSED_MS) {
    throw new EncompassConnectorError('DOCUMENT_PULL_TIME_LIMIT', 'Document pull exceeded its processing time limit.', true);
  }
}
