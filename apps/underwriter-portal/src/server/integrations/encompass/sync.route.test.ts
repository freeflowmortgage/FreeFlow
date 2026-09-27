import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { ApiError } from '../../http/apiError';
import { createEncompassSyncJob, type EncompassSyncQueueMessage } from './sync';
import { createEncompassSyncHandler } from './syncRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const JOB = '00000000-0000-4000-8000-000000000400';
const calculationExtractionBindings = [{
  extractionId: '00000000-0000-4000-8000-000000000302', extractionHash: 'c'.repeat(64),
  sourceDocumentId: '00000000-0000-4000-8000-000000000303', sourceDocumentVersion: 1,
  sourceContentHash: 'd'.repeat(64),
  extraction: {
    status: 'ACTIVE' as const, canonicalHash: 'c'.repeat(64), sourceDocumentVersion: 1,
    sourceContentHash: 'd'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'd'.repeat(64) },
  },
}];
const context: RequestContext = Object.freeze({
  requestId: 'request-1', subject: 'subject', tenantId: TENANT, membershipId: USER,
  permissions: ['encompass:sync'] as const, authTime: new Date(),
});

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 2, encompassGuid: 'guid' }) },
    tenantConfiguration: { findFirst: async () => ({ enableEncompassSync: true }) },
    encompassConnectorBinding: { findFirst: async () => ({ id: 'binding' }) },
    auditEvent: {
      findFirst: async (input: { where?: { id?: string } }) => input.where?.id
        ? { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 1 }
        : null,
      create: async ({ data }: { data: unknown }) => data,
    },
    form1084Audit: { findFirst: async () => ({ id: CALCULATION, extractionBindings: calculationExtractionBindings }) },
    encompassSyncJob: {
      create: async () => ({ id: JOB, status: 'QUEUED', expectedLoanVersion: 2, correlationId: 'request-1' }),
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    ...overrides,
  };
}

test('authorized enqueue publishes identifiers only', async () => {
  let published: EncompassSyncQueueMessage | undefined;
  const handler = createEncompassSyncHandler({
    withTenantTransaction: (async (_tenant, operation) => operation(transaction() as never)) as never,
    publishJob: async (message) => { published = message; },
  });
  const request = {
    method: 'POST', query: { loanId: LOAN },
    headers: { 'idempotency-key': 'sync-idempotency-key-01' },
    body: { approvalEventId: APPROVAL, expectedLoanVersion: 2 },
  } as unknown as NextApiRequest;
  const { response, state } = responseRecorder();
  await handler(request, response, context);
  assert.equal(state.status, 202);
  assert.deepEqual(Object.keys(published ?? {}).sort(), [
    'approvalEventId', 'correlationId', 'expectedLoanVersion', 'idempotencyKey',
    'jobId', 'loanId', 'tenantId',
  ]);
  assert.equal(JSON.stringify(published).includes('guid'), false);
});

test('cross-tenant or missing loan fails before creating a sync job', async () => {
  let created = false;
  const tx = transaction({
    loanApplication: { findFirst: async () => null },
    encompassSyncJob: { create: async () => { created = true; } },
  });
  await assert.rejects(
    createEncompassSyncJob(tx as never, context, {
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2, idempotencyKey: 'sync-idempotency-key-01',
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'LOAN_NOT_FOUND',
  );
  assert.equal(created, false);
});

test('duplicate API idempotency key returns the same logical sync job', async () => {
  const tx = transaction({
    apiIdempotencyKey: { findFirst: async () => ({ requestHash: 'ignored', responseReference: JOB, responseCode: 202 }) },
  });
  // Match the request hash resolved by the production helper.
  const { hashCanonical } = await import('../../http/canonical');
  const input = { loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2, idempotencyKey: 'sync-idempotency-key-01' };
  (tx.apiIdempotencyKey as { findFirst: () => Promise<unknown> }).findFirst = async () => ({
    requestHash: hashCanonical(input), responseReference: JOB, responseCode: 202,
  });
  (tx.encompassSyncJob as { findFirst: () => Promise<unknown> }).findFirst = async () => ({
    id: JOB, status: 'QUEUED', expectedLoanVersion: 2, correlationId: 'request-1',
  });
  const result = await createEncompassSyncJob(tx as never, context, input);
  assert.equal(result.id, JOB);
  assert.equal(result.replayed, true);
});

test('sync enqueue rejects an approval whose extraction was superseded', async () => {
  const tx = transaction({
    form1084Audit: { findFirst: async () => ({
      id: CALCULATION,
      extractionBindings: [{
        ...calculationExtractionBindings[0],
        extraction: { ...calculationExtractionBindings[0].extraction, status: 'SUPERSEDED' },
      }],
    }) },
  });
  await assert.rejects(
    createEncompassSyncJob(tx as never, context, {
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2, idempotencyKey: 'sync-idempotency-key-01',
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'STALE_APPROVAL_EXTRACTION',
  );
});

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    setHeader() { return response; },
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { response, state };
}
