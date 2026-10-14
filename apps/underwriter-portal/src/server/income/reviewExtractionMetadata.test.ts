import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestContext } from '../auth/requestContext';
import { permissionsForRole } from '../auth/permissions';
import { ApiError } from '../http/apiError';
import { parseMetadataReviewBody, reviewExtractionMetadata } from './reviewExtractionMetadata';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const EXTRACTION = '00000000-0000-4000-8000-000000000300';
const DOCUMENT = '00000000-0000-4000-8000-000000000301';
const REVIEW = '00000000-0000-4000-8000-000000000302';
const HASH = 'a'.repeat(64);
const context: RequestContext = { requestId: 'request-1', subject: 'subject', tenantId: TENANT, membershipId: USER, permissions: ['income:metadata:review'], authTime: new Date() };

test('metadata review permission is limited to authoritative reviewer roles', () => {
  assert.ok(permissionsForRole('UNDERWRITER').includes('income:metadata:review'));
  assert.ok(permissionsForRole('BROKER_OWNER').includes('income:metadata:review'));
  assert.equal(permissionsForRole('PROCESSOR').includes('income:metadata:review'), false);
  assert.equal(permissionsForRole('LOAN_OFFICER').includes('income:metadata:review'), false);
});

test('metadata review parser allowlists sources, roles, and fields', () => {
  assert.throws(() => parseMetadataReviewBody({ expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'BROWSER', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', assignments: [{ entityId: 'w2', employmentRole: 'CURRENT' }] }), ApiError);
  assert.throws(() => parseMetadataReviewBody({ expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', assignments: [{ entityId: 'w2', employmentRole: 'INFERRED' }] }), ApiError);
});

test('legitimate reviewer action is source-bound, audited, versioned, and idempotent', async () => {
  let stored: { requestHash: string; responseCode: number; responseReference: string } | null = null;
  let reviewData: Record<string, unknown> | undefined;
  const transaction = {
    $executeRaw: async () => 0,
    apiIdempotencyKey: {
      findFirst: async () => stored,
      create: async ({ data }: { data: typeof stored }) => { stored = data; return data; },
    },
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 1 }), updateMany: async () => ({ count: 1 }) },
    incomeExtraction: { findFirst: async () => ({
      id: EXTRACTION, status: 'ACTIVE', normalizedInput: { w2Records: [{ entityId: 'w2-p0-0' }] }, canonicalHash: HASH,
      sourceDocumentId: DOCUMENT, sourceDocumentVersion: 1, sourceContentHash: HASH,
      sourceDocument: { version: 1, sourceContentHash: HASH }, metadataReviews: [],
    }) },
    incomeExtractionMetadataReview: { create: async ({ data }: { data: Record<string, unknown> }) => { reviewData = data; return { id: REVIEW }; } },
    auditEvent: { findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: data.id }) },
  };
  const input = { loanId: LOAN, extractionId: EXTRACTION, expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW' as const, reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: 'Confirmed against the source document.', assignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' as const }], idempotencyKey: 'review-key-12345678' };
  const created = await reviewExtractionMetadata(transaction as never, context, input);
  assert.equal(created.reviewId, REVIEW); assert.equal(created.metadataVersion, 1); assert.equal(created.loanVersion, 2);
  assert.equal(reviewData?.reviewedByUserId, USER); assert.equal(reviewData?.sourceDocumentId, DOCUMENT);
  const replayed = await reviewExtractionMetadata(transaction as never, context, input);
  assert.equal(replayed.reviewId, REVIEW); assert.equal(replayed.replayed, true);
});

test('wrong-loan or cross-tenant extraction is not disclosed', async () => {
  const transaction = {
    $executeRaw: async () => 0, apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 1 }) }, incomeExtraction: { findFirst: async () => null },
  };
  await assert.rejects(reviewExtractionMetadata(transaction as never, context, {
    loanId: LOAN, extractionId: EXTRACTION, expectedLoanVersion: 1, expectedMetadataVersion: 0,
    source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }], idempotencyKey: 'review-key-87654321',
  }), (error: unknown) => error instanceof ApiError && error.code === 'EXTRACTION_NOT_FOUND');
});

test('IRA continuance metadata is typed and cannot gross up an unconfirmed distribution', () => {
  const body = (assignment: Record<string, unknown>) => ({ expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', assignments: [{ entityId: 'form-1040-p0', ...assignment }] });
  assert.deepEqual(parseMetadataReviewBody(body({ iraAccountBalance: 400000, hasThreeYearIraContinuance: true, grossUpIraNonTaxable: true })).assignments, [
    { entityId: 'form-1040-p0', iraAccountBalance: 400000, hasThreeYearIraContinuance: true, grossUpIraNonTaxable: true },
  ]);
  assert.throws(() => parseMetadataReviewBody(body({ iraAccountBalance: -1 })), ApiError);
  assert.throws(() => parseMetadataReviewBody(body({ hasThreeYearIraContinuance: 'yes' })), ApiError);
  assert.throws(() => parseMetadataReviewBody(body({ hasThreeYearIraContinuance: false, grossUpIraNonTaxable: true })), ApiError);
});

test('IRA continuance metadata is only accepted on a Form 1040 record', async () => {
  const transaction = {
    $executeRaw: async () => 0, apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 1 }) },
    incomeExtraction: { findFirst: async () => ({
      id: EXTRACTION, status: 'ACTIVE', normalizedInput: { formRecords: [{ entityId: 'schedule-c-p0', form: 'Schedule C' }] }, canonicalHash: HASH,
      sourceDocumentId: DOCUMENT, sourceDocumentVersion: 1, sourceContentHash: HASH,
      sourceDocument: { version: 1, sourceContentHash: HASH }, metadataReviews: [],
    }) },
  };
  await assert.rejects(reviewExtractionMetadata(transaction as never, context, {
    loanId: LOAN, extractionId: EXTRACTION, expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW',
    reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null, idempotencyKey: 'review-key-12345678',
    assignments: [{ entityId: 'schedule-c-p0', hasThreeYearIraContinuance: true }],
  }), (error) => error instanceof ApiError && error.code === 'METADATA_FIELD_NOT_ALLOWED');
});
