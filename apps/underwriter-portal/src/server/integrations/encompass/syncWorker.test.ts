import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { runEncompassSyncJob, type ClaimedSync, type SyncWorkerDependencies } from './syncWorker';
import { retryVisibilitySeconds } from './syncWorkerRuntime';

const message = {
  jobId: 'job', tenantId: 'tenant', loanId: 'loan', approvalEventId: 'approval',
  expectedLoanVersion: 2, idempotencyKey: 'idempotency-key-01', correlationId: 'request',
};
const claimed: ClaimedSync = {
  jobId: 'job', tenantId: 'tenant', loanId: 'loan', approvalEventId: 'approval', mode: 'APPLY',
  fields: [{ fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: 'approval' }],
};

test('retry visibility uses bounded exponential backoff', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 99].map(retryVisibilitySeconds), [30, 60, 120, 240, 480, 480]);
});

function dependencies(overrides: Partial<SyncWorkerDependencies> = {}): SyncWorkerDependencies {
  return {
    claim: async () => claimed,
    apply: async () => ({}),
    readApprovalMarker: async () => undefined,
    succeed: async () => {},
    retry: async () => {},
    reconcile: async () => {},
    fail: async () => {},
    ...overrides,
  };
}

test('duplicate delivery is skipped when the durable job cannot be claimed', async () => {
  let writes = 0;
  const result = await runEncompassSyncJob(message, dependencies({
    claim: async () => null,
    apply: async () => { writes += 1; return {}; },
  }));
  assert.equal(result, 'SKIPPED');
  assert.equal(writes, 0);
});

test('successful apply records one external effect and final success', async () => {
  let writes = 0;
  let succeeded = 0;
  const result = await runEncompassSyncJob(message, dependencies({
    apply: async () => { writes += 1; return { providerRevision: 'revision' }; },
    succeed: async (_job, revision) => { succeeded += 1; assert.equal(revision, 'revision'); },
  }));
  assert.equal(result, 'SUCCEEDED');
  assert.equal(writes, 1);
  assert.equal(succeeded, 1);
});

test('provider 5xx is retryable while validation 4xx is terminal', async () => {
  let retried = '';
  const retryable = await runEncompassSyncJob(message, dependencies({
    apply: async () => { throw new EncompassConnectorError('ENCOMPASS_WRITE_FAILED_503', 'safe', true); },
    retry: async (_job, code) => { retried = code; },
  }));
  assert.equal(retryable, 'RETRYABLE_FAILURE');
  assert.equal(retried, 'ENCOMPASS_WRITE_FAILED_503');

  let failed = '';
  const terminal = await runEncompassSyncJob(message, dependencies({
    apply: async () => { throw new EncompassConnectorError('ENCOMPASS_WRITE_FAILED_422', 'safe', false); },
    fail: async (_job, code) => { failed = code; },
  }));
  assert.equal(terminal, 'FAILED');
  assert.equal(failed, 'ENCOMPASS_WRITE_FAILED_422');
});

test('network timeout enters reconciliation and never blindly repeats the write', async () => {
  let reconciled = '';
  assert.equal(await runEncompassSyncJob(message, dependencies({
    apply: async () => { throw new EncompassConnectorError('ENCOMPASS_WRITE_OUTCOME_UNKNOWN', 'safe', false); },
    reconcile: async (_job, code) => { reconciled = code; },
  })), 'RECONCILING');
  assert.equal(reconciled, 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN');

  let writes = 0;
  const restarted = { ...claimed, mode: 'RECONCILE' as const };
  assert.equal(await runEncompassSyncJob(message, dependencies({
    claim: async () => restarted,
    apply: async () => { writes += 1; return {}; },
    readApprovalMarker: async () => 'approval',
  })), 'SUCCEEDED');
  assert.equal(writes, 0);
});

test('reconciliation without the approval marker fails closed without another mutation', async () => {
  let writes = 0;
  let failure = '';
  assert.equal(await runEncompassSyncJob(message, dependencies({
    claim: async () => ({ ...claimed, mode: 'RECONCILE' }),
    apply: async () => { writes += 1; return {}; },
    readApprovalMarker: async () => undefined,
    fail: async (_job, code) => { failure = code; },
  })), 'FAILED');
  assert.equal(writes, 0);
  assert.equal(failure, 'SYNC_OUTCOME_UNKNOWN');
});
