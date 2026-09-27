import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { withRequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { createIncomeApprovalHandler } from './incomeApprovalsRoute';

const originalNodeEnv = process.env.NODE_ENV;
const originalRuntimeEnv = process.env.FREEFLOW_RUNTIME_ENV;
const originalTrustedOrigin = process.env.TRUSTED_ORIGIN;
const mutableEnvironment = process.env as Record<string, string | undefined>;
mutableEnvironment.NODE_ENV = 'production';
mutableEnvironment.FREEFLOW_RUNTIME_ENV = 'production';
mutableEnvironment.TRUSTED_ORIGIN = 'https://app.freeflowmortgage.com';

test.after(() => {
  if (originalNodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
  else mutableEnvironment.NODE_ENV = originalNodeEnv;
  if (originalRuntimeEnv === undefined) delete mutableEnvironment.FREEFLOW_RUNTIME_ENV;
  else mutableEnvironment.FREEFLOW_RUNTIME_ENV = originalRuntimeEnv;
  if (originalTrustedOrigin === undefined) delete mutableEnvironment.TRUSTED_ORIGIN;
  else mutableEnvironment.TRUSTED_ORIGIN = originalTrustedOrigin;
});

const LOAN_ID = '00000000-0000-4000-8000-000000000200';
const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const OTHER_LOAN_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const CALCULATION_ID = '00000000-0000-4000-8000-000000000201';
const currentExtractionBindings = [{
  extractionId: '00000000-0000-4000-8000-000000000211', extractionHash: 'c'.repeat(64),
  sourceDocumentId: '00000000-0000-4000-8000-000000000212', sourceDocumentVersion: 1,
  sourceContentHash: 'b'.repeat(64),
  extraction: {
    status: 'ACTIVE' as const, canonicalHash: 'c'.repeat(64), sourceDocumentVersion: 1,
    sourceContentHash: 'b'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'b'.repeat(64) },
  },
}];

function request(overrides: {
  method?: string;
  loanId?: string | string[];
  headers?: Record<string, string | string[]>;
  body?: unknown;
} = {}): NextApiRequest {
  return {
    method: overrides.method ?? 'POST',
    query: { loanId: overrides.loanId ?? LOAN_ID },
    headers: {
      origin: 'https://app.freeflowmortgage.com',
      'x-amzn-oidc-data': 'signed-token',
      'idempotency-key': 'approval-key-0001',
      ...overrides.headers,
    },
    body: overrides.body ?? { calculationId: CALCULATION_ID, expectedLoanVersion: 1 },
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    destroy() {},
  } as unknown as NextApiResponse;
  return { res, state };
}

const identity = {
  subject: 'verified-subject',
  authTime: new Date('2026-09-11T12:00:00.000Z'),
  expiresAt: new Date('2026-09-11T12:05:00.000Z'),
};

function wrap(
  role: 'UNDERWRITER' | 'LOAN_OFFICER' | 'PROCESSOR',
  withTenantTransaction: (
    context: { tenantId: string; principalId: string },
    operation: (transaction: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
) {
  return withRequestContext(
    'income:approve',
    createIncomeApprovalHandler({ withTenantTransaction: withTenantTransaction as never }),
    {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role }),
    },
  );
}

test('loan officers cannot approve income', async () => {
  const wrapped = wrap('LOAN_OFFICER', async () => {
    throw new Error('handler must not reach the database');
  });
  const { res, state } = response();
  await wrapped(request(), res);
  assert.equal(state.status, 403);
  assert.equal((state.body as { error: { code: string } }).error.code, 'PERMISSION_DENIED');
});

test('processors can calculate but cannot approve', async () => {
  const wrapped = wrap('PROCESSOR', async () => {
    throw new Error('handler must not reach the database');
  });
  const { res, state } = response();
  await wrapped(request(), res);
  assert.equal(state.status, 403);
  assert.equal((state.body as { error: { code: string } }).error.code, 'PERMISSION_DENIED');
});

test('rejects a missing idempotency key before opening a tenant transaction', async () => {
  let opened = false;
  const wrapped = wrap('UNDERWRITER', async () => {
    opened = true;
    throw new Error('database must not be reached');
  });
  const { res, state } = response();
  await wrapped(request({ headers: { 'idempotency-key': '' } }), res);
  assert.equal(opened, false);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
});

test('rejects a non-UUID loan path before querying', async () => {
  const wrapped = wrap('UNDERWRITER', async () => {
    throw new Error('database must not be reached');
  });
  const { res, state } = response();
  await wrapped(request({ loanId: 'loan-from-client' }), res);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error: { code: string } }).error.code, 'INVALID_IDENTIFIER');
});

test('maps a tenant-qualified missing loan to 404, not 403', async () => {
  const wrapped = wrap('UNDERWRITER', async (context, operation) => {
    assert.equal(context.tenantId, TENANT_ID);
    return operation({
      $executeRaw: async () => 0,
      apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
      loanApplication: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
      form1084Audit: { findFirst: async () => null, update: async () => ({}) },
      auditEvent: { findFirst: async () => null, create: async () => ({}) },
    });
  });
  const { res, state } = response();
  await wrapped(request({ loanId: OTHER_LOAN_ID }), res);
  assert.equal(state.status, 404);
  assert.equal((state.body as { error: { code: string } }).error.code, 'LOAN_NOT_FOUND');
});

test('ignores caller tenant headers and uses the verified membership tenant', async () => {
  let seenTenant: string | undefined;
  const wrapped = wrap('UNDERWRITER', async (context) => {
    seenTenant = context.tenantId;
    throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  });
  const { res, state } = response();
  await wrapped(request({
    headers: {
      'x-tenant-id': 'attacker-tenant',
      'x-user-role': 'SUPER_ADMIN',
    },
  }), res);
  assert.equal(seenTenant, TENANT_ID);
  assert.equal(state.status, 404);
});

test('returns the append-only approval identifiers on success', async () => {
  const wrapped = wrap('UNDERWRITER', async (_context, operation) => operation({
    $executeRaw: async () => 0,
    apiIdempotencyKey: {
      findFirst: async () => null,
      create: async () => ({}),
    },
    loanApplication: {
      findFirst: async () => ({
        id: LOAN_ID,
        tenantId: TENANT_ID,
        version: 1,
        status: 'IN_QA_REVIEW',
      }),
      updateMany: async () => ({ count: 1 }),
    },
    form1084Audit: {
      findFirst: async () => ({
        id: CALCULATION_ID,
        qualifyingMonthlyIncome: { toString: () => '8123.45' },
        totalAnnualCashFlow: { toString: () => '97481.40' },
        yearsAnalyzed: [2025, 2024],
        calculationSchemaVersion: 'form-1084-v9',
        calculationSource: 'authenticated-api',
        calculatedLoanVersion: 1,
        canonicalInputHash: 'a'.repeat(64),
        sourceDocumentHashes: ['b'.repeat(64)],
        mortgageRuleVersion: 'form-1084-v9',
        trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING',
        entityType: 'SCHEDULE_C',
        w2BaseMonthly: null,
        w2VariableMonthly: null,
        scheduleCMonthlyTotal: null,
        scheduleFMonthlyTotal: null,
        form1120SMonthlyTotal: null,
        form1065MonthlyTotal: null,
        form1120MonthlyTotal: null,
        assetIncomeMonthly: null,
        rentalMonthly: null,
        rentalLiabilityMonthly: null,
        housingExpenseAdjustment: null,
        extractionBindings: currentExtractionBindings,
      }),
      update: async () => ({}),
    },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: { id: string; occurredAt: Date } }) => data,
    },
  }));
  const { res, state } = response();
  await wrapped(request(), res);
  assert.equal(state.status, 201);
  const body = state.body as {
    auditEventId: string;
    loanVersion: number;
    action: string;
    calculationId: string;
    requestId: string;
  };
  assert.equal(body.action, 'INCOME_APPROVED');
  assert.equal(body.loanVersion, 2);
  assert.equal(body.calculationId, CALCULATION_ID);
  assert.match(body.auditEventId, /^[0-9a-f-]{36}$/i);
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
});

test('override without a narrative fails closed with a stable envelope', async () => {
  const wrapped = wrap('UNDERWRITER', async () => {
    throw new Error('database must not be reached');
  });
  const { res, state } = response();
  await wrapped(request({
    body: {
      calculationId: CALCULATION_ID,
      expectedLoanVersion: 1,
      action: 'INCOME_OVERRIDE',
      reasonCode: 'INCOME_ADJUSTED',
    },
  }), res);
  assert.equal(state.status, 400);
  assert.equal((state.body as { error: { code: string } }).error.code, 'OVERRIDE_NARRATIVE_REQUIRED');
});

test('a reviewed calculation from an older loan version is stale', async () => {
  const wrapped = wrap('UNDERWRITER', async (_context, operation) => operation({
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: LOAN_ID, version: 1, status: 'IN_QA_REVIEW' }) },
    form1084Audit: { findFirst: async () => ({ id: CALCULATION_ID, calculatedLoanVersion: 0 }) },
  }));
  const { res, state } = response();
  await wrapped(request(), res);
  assert.equal(state.status, 409);
  assert.equal((state.body as { error: { code: string } }).error.code, 'STALE_CALCULATION');
});

test('a reviewed calculation with a superseded extraction is stale', async () => {
  const wrapped = wrap('UNDERWRITER', async (_context, operation) => operation({
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: LOAN_ID, version: 1, status: 'IN_QA_REVIEW' }) },
    form1084Audit: { findFirst: async () => ({
      id: CALCULATION_ID, calculatedLoanVersion: 1,
      extractionBindings: [{
        ...currentExtractionBindings[0],
        extraction: { ...currentExtractionBindings[0].extraction, status: 'SUPERSEDED' },
      }],
    }) },
  }));
  const { res, state } = response();
  await wrapped(request(), res);
  assert.equal(state.status, 409);
  assert.equal((state.body as { error: { code: string } }).error.code, 'STALE_CALCULATION_EXTRACTION');
});

test('override creates and approves an authoritative replacement calculation', async () => {
  const replacementId = '00000000-0000-4000-8000-000000000202';
  let created: Record<string, unknown> | undefined;
  const base = {
    id: CALCULATION_ID,
    qualifyingMonthlyIncome: { toString: () => '8123.45' }, totalAnnualCashFlow: { toString: () => '97481.40' },
    yearsAnalyzed: [2025, 2024], calculationSchemaVersion: 'calculation-request-v2',
    calculationSource: 'authenticated-api', calculatedLoanVersion: 1,
    canonicalInputHash: 'a'.repeat(64), sourceDocumentHashes: ['b'.repeat(64)], mortgageRuleVersion: 'form-1084-v9',
    trendingResult: 'CONVENTIONAL_DECLINING', entityType: 'SCHEDULE_C',
    w2BaseMonthly: null, w2VariableMonthly: null, scheduleCMonthlyTotal: null, scheduleFMonthlyTotal: null,
    form1120SMonthlyTotal: null, form1065MonthlyTotal: null, form1120MonthlyTotal: null,
    assetIncomeMonthly: null, rentalMonthly: null, rentalLiabilityMonthly: null, housingExpenseAdjustment: null,
    extractionBindings: currentExtractionBindings,
  };
  const wrapped = wrap('UNDERWRITER', async (_context, operation) => operation({
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: {
      findFirst: async () => ({ id: LOAN_ID, version: 1, status: 'IN_QA_REVIEW' }),
      updateMany: async () => ({ count: 1 }),
    },
    form1084Audit: {
      findFirst: async () => base,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return { ...base, ...data, id: replacementId };
      },
      update: async () => ({}),
    },
    incomeCalculationExtraction: { createMany: async () => ({ count: 1 }) },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: { id: string; occurredAt: Date } }) => data,
    },
  }));
  const { res, state } = response();
  await wrapped(request({ body: {
    calculationId: CALCULATION_ID, expectedLoanVersion: 1, action: 'INCOME_OVERRIDE',
    reasonCode: 'INCOME_ADJUSTED', reasonNarrative: 'Use supported recurring income.',
    overrideQualifyingMonthlyIncome: 7000.25,
  } }), res);
  assert.equal(state.status, 201);
  assert.equal((state.body as { calculationId: string }).calculationId, replacementId);
  assert.equal(String(created?.calculationSource), 'human-override');
  assert.equal(String(created?.qualifyingMonthlyIncome), '7000.25');
});
