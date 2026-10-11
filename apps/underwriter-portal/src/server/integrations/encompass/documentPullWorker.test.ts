import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassApiError } from './encompassApi';
import { runDocumentPullJob, validateAggregateDocumentLimits, type DocumentPullWorkerDependencies } from './documentPullWorker';
import { classifyDocumentPullFailure } from './documentPullFailure';

const message = { jobId: 'job', tenantId: 'tenant', loanId: 'loan', expectedLoanVersion: 1, correlationId: 'request' };
const job = {
  jobId: 'job', tenantId: 'tenant', loanId: 'loan', correlationId: 'request', encompassLoanGuid: 'guid',
  requestedByUserId: 'user', expectedLoanVersion: 1, claimToken: 'claim',
  lenderId: 'lender', deploymentId: 'deployment', totalAttachmentCount: 2, processedCount: 0,
  processedByteCount: 0, processedPageCount: 0,
  selectedAttachmentIds: ['one', 'two'],
};

const extraction = {
  schemaVersion: 'income-extraction-v2' as const,
  normalizedInput: { w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000 }] },
  evidence: { fields: [] }, warnings: [], canonicalHash: 'a'.repeat(64),
};

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
    parse: async () => ({
      pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'v5', confidence: 99, extraction,
    }),
    saveResult: async (_job, result) => { saved.push(result); },
    succeed: async (_job, attachmentCount, processedCount) => { assert.deepEqual([attachmentCount, processedCount], [2, 2]); return 'SUCCEEDED'; },
    fail: async () => assert.fail('should not fail'),
  };
  assert.equal(await runDocumentPullJob(message, deps), 'SUCCEEDED');
  assert.equal(saved.length, 2);
  assert.deepEqual(buffers.map((buffer) => [...buffer]), [[0, 0], [0, 0]]);
});

test('classifies throttling and logs only allowlisted diagnostics', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => { lines.push(String(line)); };
  let failure: unknown;
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => job,
    listAttachments: async () => {
      throw new EncompassApiError(
        'ENCOMPASS_API_FAILED_429',
        'SYNTHETIC_PROVIDER_BODY borrower=Example Authorization: Bearer SYNTHETIC_TOKEN SSN=000-00-0000',
        true,
      );
    },
    download: async () => assert.fail(),
    parse: async () => assert.fail(),
    saveResult: async () => assert.fail(),
    succeed: async () => assert.fail(),
    fail: async (_job, safeCode, retryable) => { failure = { safeCode, retryable }; },
  };
  try {
    assert.equal(await runDocumentPullJob(message, deps), 'RETRYABLE_FAILURE');
  } finally {
    console.error = original;
  }
  assert.deepEqual(failure, { safeCode: 'ENCOMPASS_API_FAILED_429', retryable: true });
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(logged, {
    source: 'freeflow',
    event: 'document_pull_error',
    category: 'UPSTREAM_DEPENDENCY',
    diagnosticId: 'UPSTREAM_API_ERROR',
    safeCode: 'ENCOMPASS_API_FAILED_429',
    retryable: true,
  });
  assertNoSensitiveLogText(lines[0]!);
});

test('processes only the explicitly selected active attachments', async () => {
  const downloaded: string[] = [];
  const selectedJob = { ...job, totalAttachmentCount: 1, selectedAttachmentIds: ['two'] };
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => selectedJob,
    listAttachments: async () => [{ id: 'one' }, { id: 'two' }, { id: 'three' }],
    download: async (_job, attachmentId) => {
      downloaded.push(attachmentId);
      return { bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) };
    },
    parse: async () => ({
      pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'v5', confidence: 99, extraction,
    }),
    saveResult: async () => undefined,
    succeed: async (_job, attachmentCount, processedCount) => { assert.deepEqual([attachmentCount, processedCount], [1, 1]); return 'SUCCEEDED'; },
    fail: async () => assert.fail('should not fail'),
  };
  assert.equal(await runDocumentPullJob(message, deps), 'SUCCEEDED');
  assert.deepEqual(downloaded, ['two']);
});

test('resumes after attachment one is saved and a retryable attachment two failure without duplicate extraction', async () => {
  let attempt = 0;
  let attachmentTwoFailed = false;
  const persisted: string[] = [];
  const downloaded: string[] = [];
  const terminalStates: string[] = [];
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => {
      attempt += 1;
      return attempt === 1
        ? { ...job, claimToken: 'claim-1' }
        : {
          ...job,
          claimToken: 'claim-2',
          processedCount: 1,
          processedByteCount: 1,
          processedPageCount: 1,
          selectedAttachmentIds: ['two'],
        };
    },
    listAttachments: async () => [{ id: 'one' }, { id: 'two' }],
    download: async (_job, attachmentId) => {
      downloaded.push(attachmentId);
      if (attachmentId === 'two' && !attachmentTwoFailed) {
        attachmentTwoFailed = true;
        throw new EncompassApiError('ENCOMPASS_API_FAILED_503', 'Synthetic connector outage.', true);
      }
      return { bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) };
    },
    parse: async () => ({
      pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'v5', confidence: 99, extraction,
    }),
    saveResult: async (_job, result) => {
      assert.equal(persisted.includes(result.attachmentId), false, 'an attachment was extracted twice');
      persisted.push(result.attachmentId);
    },
    succeed: async (_job, attachmentCount, processedCount) => {
      terminalStates.push('SUCCEEDED');
      assert.deepEqual([attachmentCount, processedCount], [2, 2]);
      return 'SUCCEEDED';
    },
    fail: async (_job, safeCode, retryable) => {
      terminalStates.push(retryable ? 'RETRYABLE_FAILURE' : 'FAILED');
      assert.equal(safeCode, 'ENCOMPASS_API_FAILED_503');
      assert.equal(retryable, true);
    },
  };

  assert.equal(await runDocumentPullJob(message, deps), 'RETRYABLE_FAILURE');
  assert.deepEqual(persisted, ['one']);
  assert.equal(await runDocumentPullJob(message, deps), 'SUCCEEDED');
  assert.deepEqual(persisted, ['one', 'two']);
  assert.deepEqual(downloaded, ['one', 'two', 'two']);
  assert.deepEqual(terminalStates, ['RETRYABLE_FAILURE', 'SUCCEEDED']);
});

test('fails closed when a selected attachment is not active', async () => {
  let failure: unknown;
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => ({ ...job, totalAttachmentCount: 1, selectedAttachmentIds: ['missing'] }),
    listAttachments: async () => [{ id: 'one' }],
    download: async () => assert.fail(), parse: async () => assert.fail(), saveResult: async () => assert.fail(),
    succeed: async () => assert.fail(),
    fail: async (_job, safeCode, retryable) => { failure = { safeCode, retryable }; },
  };
  assert.equal(await runDocumentPullJob(message, deps), 'FAILED');
  assert.deepEqual(failure, { safeCode: 'ENCOMPASS_ATTACHMENT_NOT_AVAILABLE', retryable: false });
});

test('catch logs allowlisted database diagnostics and maps Prisma conflicts off the catch-all', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => { lines.push(String(line)); };
  let failure: unknown;
  const error = new Error([
    'Invalid `prisma.loanDocument.upsert()` invocation:',
    '{ "employerName": "Jane Doe", "note": "%PDF-1.4 borrower", "authorization": "Bearer secret-token" }',
    'Unique constraint failed on the fields: (`tenantId`,`loanId`,`sourceAttachmentId`)',
  ].join('\n'));
  error.name = 'PrismaClientKnownRequestError';
  error.stack = 'Error: boom\n    at persist (/home/ubuntu/app/documentPullWorkerRuntime.ts:1:1)\n    DATABASE_URL=postgres://user:secret@db/app';
  (error as Error & { code: string }).code = 'P2002';
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => job,
    listAttachments: async () => { throw error; },
    download: async () => assert.fail(),
    parse: async () => assert.fail(),
    saveResult: async () => assert.fail(),
    succeed: async () => assert.fail(),
    fail: async (_job, safeCode, retryable) => { failure = { safeCode, retryable }; },
  };
  try {
    assert.equal(await runDocumentPullJob(message, deps), 'RETRYABLE_FAILURE');
  } finally {
    console.error = original;
  }
  assert.deepEqual(failure, { safeCode: 'DOCUMENT_PULL_DB_CONFLICT', retryable: true });
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(logged, {
    source: 'freeflow',
    event: 'document_pull_error',
    category: 'DATABASE',
    diagnosticId: 'PRISMA_ERROR',
    prismaCode: 'P2002',
    safeCode: 'DOCUMENT_PULL_DB_CONFLICT',
    retryable: true,
  });
  assertNoSensitiveLogText(lines[0]!);
});

test('untyped throws stay DOCUMENT_PULL_UNEXPECTED and log only a safe diagnostic id', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line?: unknown) => { lines.push(String(line)); };
  let failure: unknown;
  const deps: DocumentPullWorkerDependencies = {
    claim: async () => job,
    listAttachments: async () => [{ id: 'one' }, { id: 'two' }],
    download: async () => ({ bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) }),
    parse: async () => {
      throw new TypeError('SYNTHETIC_PROVIDER_BODY box1 borrower@example.invalid token=SYNTHETIC_TOKEN SSN=000-00-0000');
    },
    saveResult: async () => assert.fail(),
    succeed: async () => assert.fail(),
    fail: async (_job, safeCode, retryable) => { failure = { safeCode, retryable }; },
  };
  try {
    assert.equal(await runDocumentPullJob(message, deps), 'RETRYABLE_FAILURE');
  } finally {
    console.error = original;
  }
  assert.deepEqual(failure, { safeCode: 'DOCUMENT_PULL_UNEXPECTED', retryable: true });
  const logged = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(logged, {
    source: 'freeflow',
    event: 'document_pull_error',
    category: 'APPLICATION',
    diagnosticId: 'TYPE_ERROR',
    safeCode: 'DOCUMENT_PULL_UNEXPECTED',
    retryable: true,
  });
  assertNoSensitiveLogText(lines[0]!);
});

test('postgres conflict-target and check failures are not retryable catch-alls', () => {
  const conflict = new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification');
  (conflict as Error & { meta: { code: string } }).meta = { code: '42P10' };
  assert.deepEqual(classifyDocumentPullFailure(conflict), { safeCode: 'DOCUMENT_PULL_DB_CONFLICT_TARGET', retryable: false });
  const check = new Error('new row for relation "income_extractions" violates check constraint "income_extractions_confidence_range"');
  (check as Error & { meta: { code: string } }).meta = { code: '23514' };
  assert.deepEqual(classifyDocumentPullFailure(check), { safeCode: 'DOCUMENT_PULL_DB_CHECK', retryable: false });
});

test('aggregate document limits are bounded and typed', () => {
  assert.throws(
    () => validateAggregateDocumentLimits({ attachmentCount: 21, bytes: 0, pages: 0, elapsedMs: 0 }),
    (error: unknown) => error instanceof Error && 'safeCode' in error && error.safeCode === 'DOCUMENT_PULL_ATTACHMENT_LIMIT',
  );
  assert.throws(
    () => validateAggregateDocumentLimits({ attachmentCount: 1, bytes: 80 * 1024 * 1024 + 1, pages: 0, elapsedMs: 0 }),
    (error: unknown) => error instanceof Error && 'safeCode' in error && error.safeCode === 'DOCUMENT_PULL_BYTE_LIMIT',
  );
  assert.throws(
    () => validateAggregateDocumentLimits({ attachmentCount: 1, bytes: 0, pages: 301, elapsedMs: 0 }),
    (error: unknown) => error instanceof Error && 'safeCode' in error && error.safeCode === 'DOCUMENT_PULL_PAGE_LIMIT',
  );
  assert.throws(
    () => validateAggregateDocumentLimits({ attachmentCount: 1, bytes: 0, pages: 0, elapsedMs: 600_001 }),
    (error: unknown) => error instanceof Error && 'safeCode' in error && error.safeCode === 'DOCUMENT_PULL_TIME_LIMIT',
  );
});

function assertNoSensitiveLogText(serialized: string): void {
  for (const forbidden of [
    'SYNTHETIC_PROVIDER_BODY',
    'SYNTHETIC_TOKEN',
    '000-00-0000',
    'Jane Doe',
    '%PDF',
    'Bearer',
    'secret',
    'borrower@example.invalid',
    'documentPullWorkerRuntime.ts',
    'DATABASE_URL',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `log contained forbidden text: ${forbidden}`);
  }
  assert.equal(Object.hasOwn(JSON.parse(serialized) as object, 'message'), false);
}
