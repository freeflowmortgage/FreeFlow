import {
  EncompassConnectorError,
  compareEncompassFieldReadback,
  type EncompassFieldReadbackReport,
  type EncompassFieldWrite,
  type EncompassWriteResult,
} from '@mortgage-pos/encompass-connector-contract';
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
  apply(job: ClaimedSync): Promise<EncompassWriteResult>;
  readFields(job: ClaimedSync): Promise<Readonly<Record<string, string>>>;
  succeed(job: ClaimedSync, providerRevision: string | undefined, readback: EncompassFieldReadbackReport): Promise<void>;
  retry(job: ClaimedSync, safeCode: string): Promise<void>;
  reconcile(job: ClaimedSync, safeCode: string): Promise<void>;
  fail(job: ClaimedSync, safeCode: string, readback?: EncompassFieldReadbackReport): Promise<void>;
}>;

export async function runEncompassSyncJob(
  message: EncompassSyncQueueMessage,
  dependencies: SyncWorkerDependencies,
): Promise<'SKIPPED' | 'SUCCEEDED' | 'RETRYABLE_FAILURE' | 'RECONCILING' | 'FAILED'> {
  const job = await dependencies.claim(message);
  if (!job) return 'SKIPPED';

  if (job.mode === 'RECONCILE') {
    try {
      const actualFields = await dependencies.readFields(job);
      const readback = compareEncompassFieldReadback(job.fields, actualFields);
      if (readback.allSucceeded) {
        await dependencies.succeed(job, undefined, readback);
        return 'SUCCEEDED';
      }
      await dependencies.fail(job, readbackSafeCode(readback), readback);
      return 'FAILED';
    } catch (error) {
      if (error instanceof EncompassConnectorError && error.retryable) {
        await dependencies.reconcile(job, error.safeCode);
        return 'RECONCILING';
      }
      await dependencies.fail(job, error instanceof EncompassConnectorError ? error.safeCode : 'SYNC_RECONCILIATION_FAILED');
      return 'FAILED';
    }
  }

  try {
    const result = await dependencies.apply(job);
    let actualFields: Readonly<Record<string, string>>;
    try {
      actualFields = await dependencies.readFields(job);
    } catch (error) {
      if (error instanceof EncompassConnectorError && error.retryable) {
        await dependencies.reconcile(job, 'ENCOMPASS_READBACK_UNAVAILABLE');
        return 'RECONCILING';
      }
      await dependencies.fail(job, error instanceof EncompassConnectorError ? error.safeCode : 'SYNC_READBACK_FAILED');
      return 'FAILED';
    }
    const readback = compareEncompassFieldReadback(job.fields, actualFields, result.fieldResults);
    if (!readback.allSucceeded) {
      await dependencies.fail(job, readbackSafeCode(readback), readback);
      return 'FAILED';
    }
    await dependencies.succeed(job, result.providerRevision, readback);
    return 'SUCCEEDED';
  } catch (error) {
    if (error instanceof EncompassConnectorError
      && (error.safeCode === 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN' || error.retryable)) {
      await dependencies.reconcile(job, error.safeCode);
      return 'RECONCILING';
    }
    await dependencies.fail(job, error instanceof EncompassConnectorError ? error.safeCode : 'SYNC_UNEXPECTED');
    return 'FAILED';
  }
}

function readbackSafeCode(readback: EncompassFieldReadbackReport): string {
  if (readback.fields.some((field) => field.status === 'REJECTED')) return 'ENCOMPASS_FIELD_REJECTED';
  if (readback.fields.some((field) => field.status === 'CONFLICT')) return 'ENCOMPASS_FIELD_CONFLICT';
  return 'ENCOMPASS_FIELD_UNAVAILABLE';
}
