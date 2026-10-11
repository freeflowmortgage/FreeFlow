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
    readFields: async (job) => Object.fromEntries(job.fields.map((field) => [field.fieldName, field.value])),
    succeed: async () => true,
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
    succeed: async (_job, revision, readback) => {
      succeeded += 1;
      assert.equal(revision, 'revision');
      assert.equal(readback.allSucceeded, true);
      return true;
    },
  }));
  assert.equal(result, 'SUCCEEDED');
  assert.equal(writes, 1);
  assert.equal(succeeded, 1);
});

test('a post-effect freshness rejection is reported as failed, never successful', async () => {
  let writes = 0;
  const result = await runEncompassSyncJob(message, dependencies({
    apply: async () => { writes += 1; return {}; },
    succeed: async () => false,
  }));
  assert.equal(writes, 1);
  assert.equal(result, 'FAILED');
});

test('provider 5xx enters reconciliation while validation 4xx is terminal', async () => {
  let reconciled = '';
  const ambiguous = await runEncompassSyncJob(message, dependencies({
    apply: async () => { throw new EncompassConnectorError('ENCOMPASS_WRITE_FAILED_503', 'safe', true); },
    reconcile: async (_job, code) => { reconciled = code; },
  }));
  assert.equal(ambiguous, 'RECONCILING');
  assert.equal(reconciled, 'ENCOMPASS_WRITE_FAILED_503');

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
    readFields: async (job) => Object.fromEntries(job.fields.map((field) => [field.fieldName, field.value])),
  })), 'SUCCEEDED');
  assert.equal(writes, 0);
});

test('reconciliation with any unavailable field fails closed without another mutation', async () => {
  let writes = 0;
  let failure = '';
  assert.equal(await runEncompassSyncJob(message, dependencies({
    claim: async () => ({ ...claimed, mode: 'RECONCILE' }),
    apply: async () => { writes += 1; return {}; },
    readFields: async () => ({}),
    fail: async (_job, code, readback) => {
      failure = code;
      assert.equal(readback?.fields[0]?.status, 'UNAVAILABLE');
    },
  })), 'FAILED');
  assert.equal(writes, 0);
  assert.equal(failure, 'ENCOMPASS_FIELD_UNAVAILABLE');
});

test('repeated retryable reconciliation reads stay read-only and remain reconciling', async () => {
  let writes = 0;
  let retried = 0;
  let reconciled = 0;
  const result = await runEncompassSyncJob(message, dependencies({
    claim: async () => ({ ...claimed, mode: 'RECONCILE' }),
    apply: async () => { writes += 1; return {}; },
    readFields: async () => {
      throw new EncompassConnectorError('CONNECTOR_SERVICE_FAILED_503', 'safe', true);
    },
    retry: async () => { retried += 1; },
    reconcile: async () => { reconciled += 1; },
  }));
  assert.equal(result, 'RECONCILING');
  assert.equal(writes, 0);
  assert.equal(retried, 0);
  assert.equal(reconciled, 1);
});

test('success requires full readback and classifies rejected, unavailable, and conflicting fields', async () => {
  const fields = [
    { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: 'approval' },
    { fieldName: 'CX.FREEFLOW.W2.BASE', value: '4000.00' },
    { fieldName: 'CX.FREEFLOW.W2.VARIABLE', value: '500.00' },
  ];
  let captured: unknown;
  const result = await runEncompassSyncJob(message, dependencies({
    claim: async () => ({ ...claimed, fields }),
    apply: async () => ({ fieldResults: [
      { fieldName: fields[0].fieldName, status: 'APPLIED' },
      { fieldName: fields[1].fieldName, status: 'REJECTED' },
      { fieldName: fields[2].fieldName, status: 'APPLIED' },
    ] }),
    readFields: async () => ({
      [fields[0].fieldName]: fields[0].value,
      [fields[2].fieldName]: '499.99',
    }),
    fail: async (_job, code, readback) => { captured = { code, readback }; },
  }));
  assert.equal(result, 'FAILED');
  assert.deepEqual((captured as any).readback.fields.map((field: any) => field.status), [
    'SUCCESS', 'REJECTED', 'CONFLICT',
  ]);
  assert.equal((captured as any).code, 'ENCOMPASS_FIELD_REJECTED');
  assert.equal(JSON.stringify(captured).includes('4000.00'), false);
});

test('retryable readback failure reconciles without blindly repeating a successful write', async () => {
  let writes = 0;
  let reconciliationCode = '';
  const result = await runEncompassSyncJob(message, dependencies({
    apply: async () => { writes += 1; return {}; },
    readFields: async () => {
      throw new EncompassConnectorError('CONNECTOR_SERVICE_FAILED_503', 'safe', true);
    },
    reconcile: async (_job, code) => { reconciliationCode = code; },
  }));
  assert.equal(result, 'RECONCILING');
  assert.equal(writes, 1);
  assert.equal(reconciliationCode, 'ENCOMPASS_READBACK_UNAVAILABLE');
});
