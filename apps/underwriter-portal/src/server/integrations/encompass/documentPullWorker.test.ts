import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassApiError } from './encompassApi';
import { runDocumentPullJob, type DocumentPullWorkerDependencies } from './documentPullWorker';

const message = { jobId: 'job', tenantId: 'tenant', loanId: 'loan', expectedLoanVersion: 1, correlationId: 'request' };
const job = { jobId: 'job', tenantId: 'tenant', loanId: 'loan', encompassLoanGuid: 'guid', encompassClientId: 'client', encompassInstanceId: 'instance' };

test('processes documents serially, persists metadata only, and erases buffers', async () => {
  const buffers: Uint8Array[] = [];
  const saved: unknown[] = [];
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => job,
    listAttachments: async () => [{ id: 'one' }, { id: 'two' }],
    download: async (_job, attachmentId) => {
      const bytes = new Uint8Array([attachmentId === 'one' ? 1 : 2, 9]);
      buffers.push(bytes);
      return { bytes, sha256: attachmentId.repeat(64).slice(0, 64) };
    },
    parse: async () => ({ pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'v5', confidence: 99 }),
    saveResult: async (_job, result) => { saved.push(result); },
    succeed: async (_job, attachmentCount, processedCount) => { assert.deepEqual([attachmentCount, processedCount], [2, 2]); },
    fail: async () => assert.fail('should not fail'),
  };
  assert.equal(await runDocumentPullJob(message, deps), 'SUCCEEDED');
  assert.equal(saved.length, 2);
  assert.deepEqual(buffers.map((buffer) => [...buffer]), [[0, 0], [0, 0]]);
});

test('classifies throttling as retryable without exposing provider details', async () => {
  let failure: unknown;
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => job,
    listAttachments: async () => { throw new EncompassApiError('ENCOMPASS_API_FAILED_429', 'sensitive provider response', true); },
    download: async () => assert.fail(),
    parse: async () => assert.fail(),
    saveResult: async () => assert.fail(),
    succeed: async () => assert.fail(),
    fail: async (_job, safeCode, retryable) => { failure = { safeCode, retryable }; },
  };
  assert.equal(await runDocumentPullJob(message, deps), 'RETRYABLE_FAILURE');
  assert.deepEqual(failure, { safeCode: 'ENCOMPASS_API_FAILED_429', retryable: true });
});
