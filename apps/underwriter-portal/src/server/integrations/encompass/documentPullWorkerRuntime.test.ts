import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPersistableParserExtraction } from './persistedParserExtraction';
import {
  DOCUMENT_PULL_MAX_ATTEMPTS,
  DOCUMENT_PULL_STALE_AFTER_MS,
  DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS,
  documentPullClaimDecision,
  persistParsedExtraction,
} from './documentPullWorkerRuntime';

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

test('document-pull claim recovery waits for active work and reclaims only after visibility expiry', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS + 1), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'ACTIVE');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'CLAIM');
  assert.ok(DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS * 1_000 > DOCUMENT_PULL_STALE_AFTER_MS);
});

test('document-pull retry exhaustion becomes terminal instead of remaining retryable forever', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'RETRYABLE_FAILURE', attemptCount: DOCUMENT_PULL_MAX_ATTEMPTS, startedAt: null, encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'EXHAUSTED');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: DOCUMENT_PULL_MAX_ATTEMPTS,
    startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'EXHAUSTED');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: null, encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'INVALID');
});

test('document-pull claim rejects hosted loans before custom connector work can begin', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'QUEUED', attemptCount: 0, startedAt: null, encompassIntegrationMode: 'ENCOMPASS_HOSTED',
  }, now), 'WRONG_INTEGRATION_MODE');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now), encompassIntegrationMode: 'ENCOMPASS_HOSTED',
  }, now), 'WRONG_INTEGRATION_MODE');
});

test('repeated parser persistence is idempotent for the same document version and canonical hash', async () => {
  let created = false;
  let loanUpdated = false;
  let versionIncremented = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        versionIncremented = Object.hasOwn(data, 'version');
        return { id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId };
      },
      create: async () => assert.fail('must not insert a new document for the same attachment'),
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
  assert.equal(versionIncremented, false);
});

test('a new source hash creates provenance, supersedes the old extraction, and advances the loan version', async () => {
  let supersedeWhere: unknown;
  let createdData: Record<string, unknown> | undefined;
  let loanUpdate: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: 'c'.repeat(64), sourceAttachmentId: result.attachmentId }),
      update: async ({ data }: { data: { version?: unknown } }) => {
        assert.deepEqual(data.version, { increment: 1 });
        return { id: 'document', version: 2, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId };
      },
      create: async () => assert.fail('must update the existing document'),
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
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
      update: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: { findUnique: async () => ({ canonicalHash: 'c'.repeat(64) }) },
  };
  await assert.rejects(
    persistParsedExtraction(transaction as never, job, result as never),
    (error: { safeCode?: string }) => error.safeCode === 'PARSER_RESULT_NONDETERMINISTIC',
  );
});

test('authenticated upload uses only the constrained database writer for authoritative extraction rows', async () => {
  let rawCalls = 0;
  let lockCalls = 0;
  let directMutation = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => { lockCalls += 1; return 1; },
    $queryRaw: async () => { rawCalls += 1; return [{ created: true }]; },
    loanDocument: {
      findFirst: async () => null,
      create: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async () => { directMutation = true; },
      create: async () => { directMutation = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; return { count: 1 }; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never, 'AUTHENTICATED_UPLOAD');
  assert.equal(lockCalls, 1);
  assert.equal(rawCalls, 1);
  assert.equal(directMutation, false);
  assert.equal(loanUpdated, true);
});

test('persists a minimal W-2 extraction and quantizes confidence onto Decimal(5, 2)', async () => {
  const extraction = selectPersistableParserExtraction({
    flags: [],
    w2Extracts: [{
      pageIndex: 0, year: 2025, employerName: 'FreeFlow Synthetic Payroll LLC', ein: '00-0000000',
      box1: 120000, box5: 120000, box6: 1740,
      boxes: { box1: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    }],
  });
  const w2Result = {
    attachmentId: 'synthetic-income-document-1',
    sha256: '50eb5ac04498465000f569680a030df85c44dac939ba117411b43588e3a2ba2b',
    parsed: {
      pageCount: 1, documentCategory: 'W-2', parserVersion: 'income-parser-v5', confidence: 100.004,
      extraction,
    },
  };
  let createdDocument: Record<string, unknown> | undefined;
  let createdExtraction: Record<string, unknown> | undefined;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdDocument = data;
        return { id: 'document', version: 1, sourceContentHash: w2Result.sha256, sourceAttachmentId: w2Result.attachmentId };
      },
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => { createdExtraction = data; return { id: 'extraction' }; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; return { count: 1 }; } },
  };
  await persistParsedExtraction(transaction as never, job, w2Result as never);
  assert.equal(createdDocument?.documentCategory, 'W-2');
  assert.equal(createdDocument?.sourceContentHash, w2Result.sha256);
  assert.equal(createdDocument?.sourceAttachmentId, w2Result.attachmentId);
  assert.equal((createdDocument?.ocrConfidence as { toFixed: (digits: number) => string }).toFixed(2), '100.00');
  const employers = (createdExtraction?.normalizedInput as { w2Records: Array<Record<string, unknown>> }).w2Records;
  assert.equal(employers[0]?.employerName, 'FreeFlow Synthetic Payroll LLC');
  assert.equal(employers[0]?.annualWages, 120000);
  assert.equal(createdExtraction?.schemaVersion, 'income-extraction-v2');
  assert.equal(createdExtraction?.canonicalHash, extraction.canonicalHash);
  assert.equal((createdExtraction?.confidence as { toFixed: (digits: number) => string }).toFixed(2), '100.00');
  assert.equal(loanUpdated, true);
  assert.equal(JSON.stringify(createdExtraction).includes('%PDF'), false);
});

test('a padded CHAR hash is the same document version and does not bump the loan', async () => {
  let versionIncremented = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({
        id: 'document', version: 1, sourceContentHash: `${result.sha256}  `, sourceAttachmentId: result.attachmentId,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        versionIncremented = Object.hasOwn(data, 'version');
        return { id: 'document', version: 1, sourceContentHash: `${result.sha256} `, sourceAttachmentId: result.attachmentId };
      },
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: `${result.parsed.extraction.canonicalHash} ` }),
      updateMany: async () => assert.fail('must not supersede'),
      create: async () => assert.fail('must not insert'),
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never);
  assert.equal(versionIncremented, false);
  assert.equal(loanUpdated, false);
});

test('a unique conflict on insert reloads the document instead of failing the parse', async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => { lines.push(String(line)); };
  let finds = 0;
  let created = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => {
        finds += 1;
        return finds === 1 ? null : {
          id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId,
        };
      },
      create: async () => {
        const error = new Error('Unique constraint failed jane@example.com %PDF-1.4');
        error.name = 'PrismaClientKnownRequestError';
        (error as Error & { code: string }).code = 'P2002';
        throw error;
      },
      update: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: result.parsed.extraction.canonicalHash }),
      create: async () => { created = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  try {
    await persistParsedExtraction(transaction as never, job, result as never);
  } finally {
    console.info = original;
  }
  assert.equal(created, false);
  assert.equal(loanUpdated, false);
  const recovered = lines.map((line) => JSON.parse(line) as { event?: string; prismaCode?: string });
  assert.equal(recovered.some((line) => line.event === 'document_pull_persist_recovered' && line.prismaCode === 'P2002'), true);
  assert.equal(lines.join('\n').includes('jane@example.com'), false);
  assert.equal(lines.join('\n').includes('%PDF'), false);
});
