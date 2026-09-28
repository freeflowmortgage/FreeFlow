import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestContext } from '../../auth/requestContext';
import { ApiError } from '../../http/apiError';
import { authorizeHostWrite, completeHostWrite } from './hostWrite';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const WRITE = '00000000-0000-4000-8000-000000000400';
const context = { requestId: 'request-1', tenantId: TENANT, membershipId: USER } as RequestContext;
const input = { loanId: LOAN, approvalEventId: APPROVAL, expectedLoanVersion: 2, idempotencyKey: 'host-write-key-0001', appOrigin: 'https://freeflow.example' };
const decimal = (value: number) => ({ toNumber: () => value });

function transaction(overrides: Record<string, unknown> = {}) {
  let storedWrite: Record<string, unknown> | null = null;
  const storedKeys: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async () => 0,
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 2, encompassGuid: 'encompass-guid', encompassIntegrationMode: 'ENCOMPASS_HOSTED' }), updateMany: async () => ({ count: 1 }) },
    tenantConfiguration: { findFirst: async () => ({ encompassIntegrationMode: 'ENCOMPASS_HOSTED' }) },
    auditEvent: {
      findFirst: async ({ where }: any) => where?.id ? { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 1 } : null,
      create: async ({ data }: any) => ({ ...data }),
    },
    form1084Audit: { findFirst: async () => ({
      qualifyingMonthlyIncome: decimal(8125.5), trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING', yearsAnalyzed: [2025, 2024],
      scheduleCMonthlyTotal: null, form1120SMonthlyTotal: null, form1065MonthlyTotal: null, form1120MonthlyTotal: null,
      w2BaseMonthly: decimal(8000), w2VariableMonthly: null, scheduleFMonthlyTotal: null, assetIncomeMonthly: null,
      rentalMonthly: null, rentalLiabilityMonthly: null, housingExpenseAdjustment: null,
      extractionBindings: [{ extractionId: 'e', extractionHash: 'a'.repeat(64), sourceDocumentId: 'd', sourceDocumentVersion: 1, sourceContentHash: 'b'.repeat(64), metadataReviewId: null, metadataReviewVersion: null, metadataReviewHash: null, extraction: { status: 'ACTIVE', canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 1, sourceContentHash: 'b'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'b'.repeat(64) }, metadataReviews: [] } }],
    }) },
    apiIdempotencyKey: {
      findFirst: async ({ where }: any) => storedKeys.find((item) => item.tenantId === where.tenantId && item.operation === where.operation && item.key === where.key) ?? null,
      create: async ({ data }: any) => { storedKeys.push(data); return data; },
    },
    encompassHostWrite: {
      create: async ({ data }: any) => { storedWrite = { ...data, id: WRITE, status: 'AUTHORIZED' }; return { id: WRITE, status: 'AUTHORIZED' }; },
      findFirst: async () => storedWrite,
      updateMany: async ({ data }: any) => { if (!storedWrite) return { count: 0 }; storedWrite = { ...storedWrite, ...data }; return { count: 1 }; },
    },
    ...overrides,
  };
  return { tx, getWrite: () => storedWrite };
}

test('approved host map is durable and stores no borrower identity or field values', async () => {
  const state = transaction();
  const result = await authorizeHostWrite(state.tx as never, context, input);
  assert.equal(result.writeId, WRITE);
  assert.equal(result.fields['CX.FREEFLOW.APPROVAL.ID'], APPROVAL);
  assert.match(result.fieldMapHash, /^[0-9a-f]{64}$/);
  const persisted = state.getWrite() ?? {};
  assert.equal('fields' in persisted, false);
  assert.equal('primaryBorrowerName' in persisted, false);
  assert.equal('primaryBorrowerEmail' in persisted, false);
  assert.equal(persisted.tenantId, TENANT);
});

test('repeated authorization key returns the same hosted write', async () => {
  const state = transaction();
  const first = await authorizeHostWrite(state.tx as never, context, input);
  const second = await authorizeHostWrite(state.tx as never, context, input);
  assert.equal(second.writeId, first.writeId);
  assert.equal(second.replayed, true);
});

test('a new idempotency key cannot create a second write for the same approval', async () => {
  const state = transaction();
  const first = await authorizeHostWrite(state.tx as never, context, input);
  const second = await authorizeHostWrite(state.tx as never, context, { ...input, idempotencyKey: 'host-write-key-0002' });
  assert.equal(second.writeId, first.writeId);
  assert.equal(second.replayed, true);
});

test('cross-tenant or unavailable loan cannot authorize a hosted write', async () => {
  let created = false;
  const state = transaction({
    loanApplication: { findFirst: async () => null },
    encompassHostWrite: { create: async () => { created = true; } },
  });
  await assert.rejects(() => authorizeHostWrite(state.tx as never, context, input), (error: unknown) => error instanceof ApiError && error.code === 'LOAN_NOT_FOUND');
  assert.equal(created, false);
});

test('a stale loan version cannot authorize a hosted write', async () => {
  let created = false;
  const state = transaction({
    loanApplication: { findFirst: async () => ({ id: LOAN, version: 3, encompassGuid: 'encompass-guid', encompassIntegrationMode: 'ENCOMPASS_HOSTED' }) },
    encompassHostWrite: { create: async () => { created = true; } },
  });
  await assert.rejects(() => authorizeHostWrite(state.tx as never, context, input), (error: unknown) => error instanceof ApiError && error.code === 'STALE_APPROVAL');
  assert.equal(created, false);
});

test('host completion is stateful and idempotently reports the committed outcome', async () => {
  const state = transaction();
  const authorized = await authorizeHostWrite(state.tx as never, context, input);
  const completed = await completeHostWrite(state.tx as never, context, { writeId: WRITE, fieldMapHash: authorized.fieldMapHash, outcome: 'SUCCEEDED', idempotencyKey: 'host-complete-key-01' });
  assert.equal(completed.status, 'SUCCEEDED');
  const replay = await completeHostWrite(state.tx as never, context, { writeId: WRITE, fieldMapHash: authorized.fieldMapHash, outcome: 'SUCCEEDED', idempotencyKey: 'host-complete-key-01' });
  assert.equal(replay.status, 'SUCCEEDED');
  assert.equal(replay.replayed, true);
});
