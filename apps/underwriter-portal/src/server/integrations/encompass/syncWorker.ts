import { EncompassConnectorError, type EncompassFieldWrite } from '@mortgage-pos/encompass-connector-contract';
import type { EncompassSyncQueueMessage } from './sync';

export type ClaimedSync = Readonly<{
  jobId: string;
  tenantId: string;
  loanId: string;
  approvalEventId: string;
  mode: 'APPLY' | 'RECONCILE';
  fields: ReadonlyArray<EncompassFieldWrite>;
}>;

export type SyncWorkerDependencies = Readonly<{
  claim(message: EncompassSyncQueueMessage): Promise<ClaimedSync | null>;
  apply(job: ClaimedSync): Promise<Readonly<{ providerRevision?: string }>>;
  readApprovalMarker(job: ClaimedSync): Promise<string | undefined>;
  succeed(job: ClaimedSync, providerRevision?: string): Promise<void>;
  retry(job: ClaimedSync, safeCode: string): Promise<void>;
  reconcile(job: ClaimedSync, safeCode: string): Promise<void>;
  fail(job: ClaimedSync, safeCode: string): Promise<void>;
}>;

export async function runEncompassSyncJob(
  message: EncompassSyncQueueMessage,
  dependencies: SyncWorkerDependencies,
): Promise<'SKIPPED' | 'SUCCEEDED' | 'RETRYABLE_FAILURE' | 'RECONCILING' | 'FAILED'> {
  const job = await dependencies.claim(message);
  if (!job) return 'SKIPPED';

  if (job.mode === 'RECONCILE') {
    try {
      const marker = await dependencies.readApprovalMarker(job);
      if (marker === job.approvalEventId) {
        await dependencies.succeed(job);
        return 'SUCCEEDED';
      }
      await dependencies.fail(job, 'SYNC_OUTCOME_UNKNOWN');
      return 'FAILED';
    } catch (error) {
      if (error instanceof EncompassConnectorError && error.retryable) {
        await dependencies.retry(job, error.safeCode);
        return 'RETRYABLE_FAILURE';
      }
      await dependencies.fail(job, error instanceof EncompassConnectorError ? error.safeCode : 'SYNC_RECONCILIATION_FAILED');
      return 'FAILED';
    }
  }

  try {
    const result = await dependencies.apply(job);
    await dependencies.succeed(job, result.providerRevision);
    return 'SUCCEEDED';
  } catch (error) {
    if (error instanceof EncompassConnectorError && error.safeCode === 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN') {
      await dependencies.reconcile(job, error.safeCode);
      return 'RECONCILING';
    }
    if (error instanceof EncompassConnectorError && error.retryable) {
      await dependencies.retry(job, error.safeCode);
      return 'RETRYABLE_FAILURE';
    }
    await dependencies.fail(job, error instanceof EncompassConnectorError ? error.safeCode : 'SYNC_UNEXPECTED');
    return 'FAILED';
  }
}
