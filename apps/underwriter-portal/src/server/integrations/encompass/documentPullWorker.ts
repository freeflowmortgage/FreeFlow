import type { DocumentPullQueueMessage } from './documentPull';
import { EncompassApiError, type EncompassAttachment, type ParsedAttachment } from './encompassApi';

export type ClaimedDocumentPull = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  encompassLoanGuid: string;
  encompassClientId: string;
  encompassInstanceId: string;
}>;

export type DocumentPullWorkerDependencies = Readonly<{
  claim(message: DocumentPullQueueMessage): Promise<ClaimedDocumentPull | null>;
  listAttachments(job: ClaimedDocumentPull): Promise<EncompassAttachment[]>;
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
  try {
    const attachments = await dependencies.listAttachments(job);
    attachmentCount = attachments.length;
    for (const attachment of attachments) {
      const downloaded = await dependencies.download(job, attachment.id);
      try {
        const parsed = await dependencies.parse(downloaded.bytes);
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
    const known = error instanceof EncompassApiError;
    const retryable = known ? error.retryable : true;
    await dependencies.fail(job, known ? error.safeCode : 'DOCUMENT_PULL_UNEXPECTED', retryable);
    return retryable ? 'RETRYABLE_FAILURE' : 'FAILED';
  }
}
