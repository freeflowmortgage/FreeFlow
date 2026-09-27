import type { DocumentPullQueueMessage } from './documentPull';
import { EncompassApiError, type EncompassAttachment, type ParsedAttachment } from './encompassApi';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';

const MAX_AGGREGATE_BYTES = 80 * 1024 * 1024;
const MAX_AGGREGATE_PAGES = 300;
const MAX_ELAPSED_MS = 10 * 60 * 1000;
const MAX_ATTACHMENTS = 20;

export type ClaimedDocumentPull = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  correlationId: string;
  encompassLoanGuid: string;
  lenderId: string;
  deploymentId: string;
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
    parsed: ParsedAttachment;
  }>): Promise<void>;
  succeed(job: ClaimedDocumentPull, attachmentCount: number, processedCount: number): Promise<void>;
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

  let attachmentCount = 0;
  let processedCount = 0;
  let aggregateBytes = 0;
  let aggregatePages = 0;
  const startedAt = Date.now();
  try {
    const available = await dependencies.listAttachments(job);
    const availableIds = new Set(available.map((attachment) => attachment.id));
    if (job.selectedAttachmentIds.some((id) => !availableIds.has(id))) {
      throw new EncompassConnectorError('ENCOMPASS_ATTACHMENT_NOT_AVAILABLE', 'A selected attachment is not active or does not exist.', false);
    }
    const attachments = job.selectedAttachmentIds.map((id) => ({ id }));
    attachmentCount = attachments.length;
    validateAggregateDocumentLimits({ attachmentCount, bytes: 0, pages: 0, elapsedMs: 0 });
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
          parsed,
        });
        processedCount += 1;
      } finally {
        downloaded.bytes.fill(0);
      }
    }
    await dependencies.succeed(job, attachmentCount, processedCount);
    return 'SUCCEEDED';
  } catch (error) {
    const known = error instanceof EncompassApiError || error instanceof EncompassConnectorError;
    const retryable = known ? error.retryable : true;
    await dependencies.fail(job, known ? error.safeCode : 'DOCUMENT_PULL_UNEXPECTED', retryable);
    return retryable ? 'RETRYABLE_FAILURE' : 'FAILED';
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
  if (input.bytes > MAX_AGGREGATE_BYTES) {
    throw new EncompassConnectorError('DOCUMENT_PULL_BYTE_LIMIT', 'Selected documents exceed the aggregate size limit.', false);
  }
  if (input.pages > MAX_AGGREGATE_PAGES) {
    throw new EncompassConnectorError('DOCUMENT_PULL_PAGE_LIMIT', 'Selected documents exceed the aggregate page limit.', false);
  }
  if (input.elapsedMs > MAX_ELAPSED_MS) {
    throw new EncompassConnectorError('DOCUMENT_PULL_TIME_LIMIT', 'Document pull exceeded its processing time limit.', true);
  }
}
