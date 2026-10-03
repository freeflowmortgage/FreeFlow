import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { createIncomeCalculationHandler } from '../../pages/api/income/calculate';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const EXTRACTION = '00000000-0000-4000-8000-000000000300';
const DOCUMENT = '00000000-0000-4000-8000-000000000301';
const CALCULATION = '00000000-0000-4000-8000-000000000400';
const SOURCE_HASH = 'a'.repeat(64);
const EXTRACTION_HASH = 'b'.repeat(64);
const REVIEW = '00000000-0000-4000-8000-000000000302';
const REVIEW_HASH = 'c'.repeat(64);
const context: RequestContext = Object.freeze({
  requestId: 'request-1', subject: 'subject', tenantId: TENANT, membershipId: USER,
  permissions: ['income:calculate'] as const, authTime: new Date(),
});

test('protected calculation route rejects caller-supplied documentData', async () => {
  let queried = false;
  const handler = createIncomeCalculationHandler({
    withTenantTransaction: (async () => { queried = true; }) as never,
  });
  const { response, state } = recorder();
  await handler(request({ loanId: LOAN, extractionIds: [EXTRACTION], documentData: { w2Employers: [] } }), response, context);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error: { code: string } }).error.code, 'CALLER_CALCULATION_INPUT_FORBIDDEN');
  assert.equal(queried, false);
});

test('cross-tenant or wrong-loan extraction ids are not disclosed', async () => {
  const handler = createIncomeCalculationHandler({
    withTenantTransaction: (async (_scope, operation) => operation({
      loanApplication: { findFirst: async () => ({ id: LOAN, version: 1, loanProgram: 'CONVENTIONAL' }) },
      loanBorrower: { findMany: async () => [] },
      incomeExtraction: { findMany: async () => [] },
    } as never)) as never,
  });
  const { response, state } = recorder();
  await handler(request({ loanId: LOAN, extractionIds: [EXTRACTION] }), response, context);
  assert.equal(state.status, 404);
  assert.equal((state.body as { error: { code: string } }).error.code, 'EXTRACTION_NOT_FOUND');
});

test('calculation loads persisted extraction and writes cryptographic provenance', async () => {
  let queryCount = 0;
  let calculationData: Record<string, unknown> | undefined;
  let bindingData: unknown;
  const extraction = currentExtraction();
  const transaction = {
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 1, loanProgram: 'CONVENTIONAL' }) },
    loanBorrower: { findMany: async () => [] },
    incomeExtraction: { findMany: async () => [extraction] },
    $queryRaw: async () => {
      queryCount += 1;
      return queryCount === 1
        ? [{ version: 1 }]
        : [{
          id: EXTRACTION, status: 'ACTIVE', canonicalHash: EXTRACTION_HASH, sourceDocumentId: DOCUMENT,
          sourceDocumentVersion: 1, sourceContentHash: SOURCE_HASH, sourceAttachmentId: 'attachment-1',
          documentVersion: 1, documentHash: SOURCE_HASH, documentAttachmentId: 'attachment-1',
        }];
    },
    form1084Audit: {
      create: async ({ data }: { data: Record<string, unknown> }) => { calculationData = data; return { id: CALCULATION }; },
    },
    incomeCalculationExtraction: {
      createMany: async ({ data }: { data: unknown }) => { bindingData = data; return { count: 1 }; },
    },
    incomeExtractionMetadataReview: { findMany: async () => [{ id: REVIEW, extractionId: EXTRACTION, metadataVersion: 1, canonicalHash: REVIEW_HASH }] },
    $executeRaw: async () => 0,
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => data,
    },
  };
  const handler = createIncomeCalculationHandler({
    withTenantTransaction: (async (_scope, operation) => operation(transaction as never)) as never,
  });
  const { response, state } = recorder();
  await handler(request({ loanId: LOAN, extractionIds: [EXTRACTION] }), response, context);
  assert.equal(state.status, 200);
  assert.equal((state.body as { calculationId: string }).calculationId, CALCULATION);
  assert.equal(calculationData?.calculationSource, 'persisted-parser-extractions');
  assert.equal(calculationData?.mortgageRuleVersion, 'form-1084-v9');
  assert.match(String(calculationData?.canonicalInputHash), /^[0-9a-f]{64}$/);
  assert.deepEqual(calculationData?.sourceDocumentHashes, [SOURCE_HASH]);
  assert.match(JSON.stringify(bindingData), new RegExp(EXTRACTION));
  assert.deepEqual((state.body as { extractionWarnings: string[] }).extractionWarnings, []);
});

test('superseded and source-version-stale extractions fail before calculation', async () => {
  for (const [record, code] of [
    [{ ...currentExtraction(), status: 'SUPERSEDED' }, 'EXTRACTION_SUPERSEDED'],
    [{ ...currentExtraction(), sourceDocument: { version: 2, sourceContentHash: SOURCE_HASH, sourceAttachmentId: 'attachment-1' } }, 'STALE_EXTRACTION_SOURCE'],
  ] as const) {
    const handler = createIncomeCalculationHandler({
      withTenantTransaction: (async (_scope, operation) => operation({
        loanApplication: { findFirst: async () => ({ id: LOAN, version: 1, loanProgram: 'CONVENTIONAL' }) },
        loanBorrower: { findMany: async () => [] },
        incomeExtraction: { findMany: async () => [record] },
      } as never)) as never,
    });
    const { response, state } = recorder();
    await handler(request({ loanId: LOAN, extractionIds: [EXTRACTION] }), response, context);
    assert.equal(state.status, 409);
    assert.equal((state.body as { error: { code: string } }).error.code, code);
  }
});

function currentExtraction() {
  return {
    id: EXTRACTION, status: 'ACTIVE', schemaVersion: 'income-extraction-v2', parserVersion: 'income-parser-v5', warnings: ['W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED'],
    normalizedInput: { w2Records: [
      { entityId: 'w2-2025', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000, box5Wages: 120000 },
      { entityId: 'w2-2024', employerName: 'Synthetic Employer', year: 2024, annualWages: 108000, box5Wages: 108000 },
    ] },
    metadataReviews: [{ id: REVIEW, metadataVersion: 1, canonicalHash: REVIEW_HASH, extractionHash: EXTRACTION_HASH, sourceDocumentVersion: 1, sourceContentHash: SOURCE_HASH, assignments: [
      { entityId: 'w2-2025', employmentRole: 'CURRENT' }, { entityId: 'w2-2024', employmentRole: 'CURRENT' },
    ] }],
    canonicalHash: EXTRACTION_HASH, sourceDocumentId: DOCUMENT, sourceDocumentVersion: 1,
    sourceContentHash: SOURCE_HASH, sourceAttachmentId: 'attachment-1',
    sourceDocument: { version: 1, sourceContentHash: SOURCE_HASH, sourceAttachmentId: 'attachment-1' },
  };
}

function request(body: unknown): NextApiRequest {
  return { method: 'POST', query: {}, headers: {}, body } as NextApiRequest;
}
function recorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    setHeader() { return response; }, status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { response, state };
}
