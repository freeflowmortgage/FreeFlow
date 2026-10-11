import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { ApiError } from '../../http/apiError';
import { approvedHostFields } from './hostWrite';
import { createEncompassSyncJob, type EncompassSyncQueueMessage } from './sync';
import { buildTargetBoundEncompassSyncPreview } from './syncPreview';
import { createEncompassSyncHandler } from './syncRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const JOB = '00000000-0000-4000-8000-000000000400';
const decimal = (value: number) => ({ toNumber: () => value });
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
const previewConfiguration = Object.freeze({ appOrigin: 'https://freeflow.example' });
const calculation = {
  id: CALCULATION,
  qualifyingMonthlyIncome: decimal(8125.5),
  trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING',
  yearsAnalyzed: [2025, 2024],
  scheduleCMonthlyTotal: null,
  form1120SMonthlyTotal: null,
  form1065MonthlyTotal: null,
  form1120MonthlyTotal: null,
  w2BaseMonthly: decimal(7600),
  w2VariableMonthly: decimal(400),
  assetIncomeMonthly: decimal(125.5),
  rentalMonthly: null,
  borrowerIncome: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '8125.50' }],
  extractionBindings: calculationExtractionBindings,
};
const expectedPreview = buildTargetBoundEncompassSyncPreview({
  approvalEventId: APPROVAL,
  fields: Object.entries(approvedHostFields({
    loanId: LOAN,
    approvalId: APPROVAL,
    qualifyingMonthlyIncome: 8125.5,
    trendingAnalysis: calculation.trendingResult,
    yearsAnalyzed: calculation.yearsAnalyzed,
    w2BaseMonthly: 7600,
    w2VariableMonthly: 400,
    assetIncomeMonthly: 125.5,
    borrowerIncome: calculation.borrowerIncome,
    auditUrl: `${previewConfiguration.appOrigin}/audit/${APPROVAL}`,
  })).map(([fieldName, value]) => ({ fieldName, value })),
  target: {
    integrationMode: 'CUSTOM_CONNECTOR',
    lenderId: 'lender-1',
    deploymentId: 'deployment-1',
    encompassLoanGuid: 'guid',
  },
});

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: { findFirst: async () => ({
      id: LOAN, version: 2, encompassGuid: 'guid', encompassIntegrationMode: 'CUSTOM_CONNECTOR',
    }) },
    tenantConfiguration: { findFirst: async () => ({ enableEncompassSync: true }) },
    encompassConnectorBinding: { findFirst: async () => ({ lenderId: 'lender-1', deploymentId: 'deployment-1' }) },
    auditEvent: {
      findFirst: async (input: { where?: { id?: string } }) => input.where?.id
        ? { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 1 }
        : null,
      create: async ({ data }: { data: unknown }) => data,
    },
    form1084Audit: { findFirst: async () => calculation },
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
    previewConfiguration: () => previewConfiguration,
  });
  const request = {
    method: 'POST', query: { loanId: LOAN },
    headers: { 'idempotency-key': 'sync-idempotency-key-01' },
    body: { approvalEventId: APPROVAL, expectedLoanVersion: 2, previewHash: expectedPreview.previewHash },
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

test('enqueue atomically persists the exact approved preview including borrower income', async () => {
  let persisted: any;
  const tx = transaction({
    encompassSyncJob: {
      create: async ({ data }: any) => {
        persisted = data;
        return { id: JOB, status: 'QUEUED', expectedLoanVersion: 2, correlationId: 'request-1' };
      },
    },
  });
  await createEncompassSyncJob(tx as never, context, {
    loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
    previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
  }, previewConfiguration);
  assert.equal(persisted.writePreviewSchemaVersion, expectedPreview.schemaVersion);
  assert.equal(persisted.writePreviewHash, expectedPreview.previewHash);
  assert.deepEqual(persisted.writePreviewFields, expectedPreview.fields);
  assert.equal(persisted.writeTargetIntegrationMode, 'CUSTOM_CONNECTOR');
  assert.equal(persisted.writeTargetLenderId, 'lender-1');
  assert.equal(persisted.writeTargetDeploymentId, 'deployment-1');
  assert.equal(persisted.writeTargetEncompassGuid, 'guid');
  assert.equal(
    persisted.writePreviewFields.some((field: any) => field.fieldName === 'CX.FREEFLOW.BORROWER.1.INCOME'),
    true,
  );
});

test('enqueue rejects a hash that does not match the server-authoritative preview', async () => {
  let created = false;
  const tx = transaction({
    encompassSyncJob: { create: async () => { created = true; } },
  });
  await assert.rejects(
    createEncompassSyncJob(tx as never, context, {
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
      previewHash: '0'.repeat(64), idempotencyKey: 'sync-idempotency-key-01',
    }, previewConfiguration),
    (error: unknown) => error instanceof ApiError && error.code === 'ENCOMPASS_WRITE_APPROVAL_MISMATCH',
  );
  assert.equal(created, false);
});

test('enqueue rejects a preview after the authoritative target binding changes', async () => {
  let created = false;
  const tx = transaction({
    encompassConnectorBinding: { findFirst: async () => ({ lenderId: 'lender-2', deploymentId: 'deployment-2' }) },
    encompassSyncJob: { create: async () => { created = true; } },
  });
  await assert.rejects(
    createEncompassSyncJob(tx as never, context, {
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
      previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
    }, previewConfiguration),
    (error: unknown) => error instanceof ApiError && error.code === 'ENCOMPASS_WRITE_APPROVAL_MISMATCH',
  );
  assert.equal(created, false);
});

test('cross-tenant or missing loan fails before creating a sync job', async () => {
  let created = false;
  const tx = transaction({
    loanApplication: { findFirst: async () => null },
    encompassSyncJob: { create: async () => { created = true; } },
  });
  await assert.rejects(
    createEncompassSyncJob(tx as never, context, {
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
      previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
    }, previewConfiguration),
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
  const input = {
    loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
    previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
  };
  (tx.apiIdempotencyKey as { findFirst: () => Promise<unknown> }).findFirst = async () => ({
    requestHash: hashCanonical(input), responseReference: JOB, responseCode: 202,
  });
  (tx.encompassSyncJob as { findFirst: () => Promise<unknown> }).findFirst = async () => ({
    id: JOB, status: 'QUEUED', expectedLoanVersion: 2, correlationId: 'request-1',
    writePreviewSchemaVersion: expectedPreview.schemaVersion,
    writePreviewHash: expectedPreview.previewHash,
    writeTargetIntegrationMode: expectedPreview.target.integrationMode,
    writeTargetLenderId: expectedPreview.target.lenderId,
    writeTargetDeploymentId: expectedPreview.target.deploymentId,
    writeTargetEncompassGuid: expectedPreview.target.encompassLoanGuid,
  });
  const result = await createEncompassSyncJob(tx as never, context, input, previewConfiguration);
  assert.equal(result.id, JOB);
  assert.equal(result.replayed, true);
});

test('idempotent replay rejects a legacy job that has no approved target identity', async () => {
  const { hashCanonical } = await import('../../http/canonical');
  const input = {
    loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
    previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
  };
  const tx = transaction({
    apiIdempotencyKey: { findFirst: async () => ({
      requestHash: hashCanonical(input), responseReference: JOB, responseCode: 202,
    }) },
    encompassSyncJob: { findFirst: async () => ({
      id: JOB, status: 'QUEUED', expectedLoanVersion: 2, correlationId: 'request-1',
      writePreviewSchemaVersion: 'encompass-write-preview-v1',
      writePreviewHash: expectedPreview.previewHash,
      writeTargetIntegrationMode: null,
      writeTargetLenderId: null,
      writeTargetDeploymentId: null,
      writeTargetEncompassGuid: null,
    }) },
  });

  await assert.rejects(
    createEncompassSyncJob(tx as never, context, input, previewConfiguration),
    (error: unknown) => error instanceof ApiError && error.code === 'IDEMPOTENCY_STATE_INVALID',
  );
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
      loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2,
      previewHash: expectedPreview.previewHash, idempotencyKey: 'sync-idempotency-key-01',
    }, previewConfiguration),
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
