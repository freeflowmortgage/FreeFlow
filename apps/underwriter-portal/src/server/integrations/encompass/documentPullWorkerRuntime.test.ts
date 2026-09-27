import assert from 'node:assert/strict';
import test from 'node:test';
import { persistParsedExtraction } from './documentPullWorkerRuntime';

const job = {
  jobId: 'job', tenantId: '00000000-0000-4000-8000-000000000100',
  loanId: '00000000-0000-4000-8000-000000000200', correlationId: 'request',
  encompassLoanGuid: 'guid', lenderId: 'lender', deploymentId: 'deployment', selectedAttachmentIds: ['attachment-1'],
};
const result = {
  attachmentId: 'attachment-1', sha256: 'a'.repeat(64),
  parsed: {
    pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'income-parser-v5', confidence: 98,
    extraction: {
      schemaVersion: 'income-extraction-v1' as const,
      normalizedInput: { w2Employers: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', role: 'CURRENT', year: 2025, annualWages: 120000 }] },
      evidence: { fields: [] }, warnings: ['W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED'], canonicalHash: 'b'.repeat(64),
    },
  },
};

test('repeated parser persistence is idempotent for the same document version and canonical hash', async () => {
  let created = false;
  let loanUpdated = false;
  const transaction = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    loanDocument: {
      findUnique: async () => ({ sourceContentHash: result.sha256 }),
      upsert: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: result.parsed.extraction.canonicalHash }),
      updateMany: async () => assert.fail('must not supersede an idempotent extraction'),
      create: async () => { created = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never);
  assert.equal(created, false);
  assert.equal(loanUpdated, false);
});

test('a new source hash creates provenance, supersedes the old extraction, and advances the loan version', async () => {
  let supersedeWhere: unknown;
  let createdData: Record<string, unknown> | undefined;
  let loanUpdate: unknown;
  const transaction = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    loanDocument: {
      findUnique: async () => ({ sourceContentHash: 'c'.repeat(64) }),
      upsert: async () => ({ id: 'document', version: 2, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async ({ where }: { where: unknown }) => { supersedeWhere = where; return { count: 1 }; },
      create: async ({ data }: { data: Record<string, unknown> }) => { createdData = data; return { id: 'extraction' }; },
    },
    loanApplication: { updateMany: async (args: unknown) => { loanUpdate = args; return { count: 1 }; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never);
  assert.match(JSON.stringify(supersedeWhere), /ACTIVE/);
  assert.equal(createdData?.sourceDocumentVersion, 2);
  assert.equal(createdData?.sourceContentHash, result.sha256);
  assert.equal(createdData?.canonicalHash, result.parsed.extraction.canonicalHash);
  assert.ok(loanUpdate);
});

test('same parser version producing a different canonical result fails closed', async () => {
  const transaction = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    loanDocument: {
      findUnique: async () => ({ sourceContentHash: result.sha256 }),
      upsert: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: { findUnique: async () => ({ canonicalHash: 'c'.repeat(64) }) },
  };
  await assert.rejects(
    persistParsedExtraction(transaction as never, job, result as never),
    (error: { safeCode?: string }) => error.safeCode === 'PARSER_RESULT_NONDETERMINISTIC',
  );
});
