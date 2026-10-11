import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import {
  STANDALONE_LOAN_SCHEMA_VERSION,
  createStandaloneLoanHandler,
  parseStandaloneLoanInput,
} from './standaloneLoanRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const context = {
  requestId: 'standalone-request-1',
  subject: 'synthetic-underwriter',
  tenantId: TENANT,
  membershipId: USER,
  permissions: ['income:process'] as const,
  authTime: new Date('2026-10-11T00:00:00.000Z'),
} satisfies RequestContext;

test('creates a tenant-scoped no-LOS loan, roster, immutable audit, and replayable result', async () => {
  const tx = transaction();
  let scope: { tenantId: string; principalId: string } | undefined;
  const handler = createStandaloneLoanHandler({
    withTenantTransaction: (async (nextScope, operation) => {
      scope = nextScope;
      return operation(tx as never);
    }) as never,
  });
  const body = input(2);

  const first = response();
  await handler(request(body), first.res, context);
  const replay = response();
  await handler(request(body), replay.res, { ...context, requestId: 'standalone-request-2' });

  assert.deepEqual(scope, { tenantId: TENANT, principalId: USER });
  assert.equal(first.state.status, 201);
  assert.equal(replay.state.status, 201);
  assert.equal(tx.state.loans.length, 1);
  assert.deepEqual(tx.state.loans[0], {
    id: LOAN,
    version: 1,
    tenantId: TENANT,
    loanProgram: 'CONVENTIONAL',
    encompassIntegrationMode: 'NONE',
    status: 'DRAFT',
  });
  assert.deepEqual(tx.state.borrowers, [
    { tenantId: TENANT, loanId: LOAN, borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' },
    { tenantId: TENANT, loanId: LOAN, borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' },
  ]);
  assert.equal(tx.state.auditEvents.length, 1);
  assert.equal(tx.state.auditEvents[0]?.action, 'STANDALONE_LOAN_CREATED');
  assert.equal(tx.state.auditEvents[0]?.entityType, 'LOAN_APPLICATION');
  assert.equal(tx.state.auditEvents[0]?.tenantId, TENANT);
  assert.equal(tx.state.auditEvents[0]?.ruleVersion, 'freeflow-normalized-loan-v1');
  assert.equal((first.state.body as { integrationMode: string }).integrationMode, 'NONE');
  assert.equal((replay.state.body as { loanId: string }).loanId, LOAN);
  assert.equal(JSON.stringify(tx.state).includes('encompassGuid'), false);
});

test('same idempotency key with different standalone content fails closed', async () => {
  const tx = transaction();
  const handler = createStandaloneLoanHandler({
    withTenantTransaction: (async (_scope, operation) => operation(tx as never)) as never,
  });
  const first = response();
  await handler(request(input(1)), first.res, context);
  const conflict = response();
  await handler(request({ ...input(1), loanProgram: 'FHA' }), conflict.res, context);

  assert.equal(first.state.status, 201);
  assert.equal(conflict.state.status, 409);
  assert.equal((conflict.state.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(tx.state.loans.length, 1);
});

test('strict standalone import rejects PII, unknown versions, USDA, and invalid rosters', () => {
  for (const [payload, code] of [
    [{ ...input(1), primaryBorrowerName: 'Synthetic Name' }, 'INVALID_STANDALONE_LOAN'],
    [{ ...input(1), schemaVersion: 'freeflow-standalone-loan-v2' }, 'UNSUPPORTED_STANDALONE_LOAN_VERSION'],
    [{ ...input(1), loanProgram: 'USDA' }, 'UNSUPPORTED_STANDALONE_PROGRAM'],
    [{ ...input(1), borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', ssn: '000-00-0000' }] }, 'INVALID_BORROWER_ROSTER'],
    [{ ...input(2), borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }, { borrowerKey: 'borrower-3', role: 'CO_BORROWER' }] }, 'INVALID_BORROWER_ROSTER'],
  ] as const) {
    assert.throws(
      () => parseStandaloneLoanInput(payload),
      (error: unknown) => error instanceof Error && error.message === code,
    );
  }
});

test('requires a bounded idempotency key before creating a loan', async () => {
  let enteredTransaction = false;
  const handler = createStandaloneLoanHandler({
    withTenantTransaction: (async () => { enteredTransaction = true; }) as never,
  });
  const result = response();
  await handler(request(input(1), ''), result.res, context);
  assert.equal(result.state.status, 400);
  assert.equal((result.state.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(enteredTransaction, false);
});

function input(count: number) {
  return {
    schemaVersion: STANDALONE_LOAN_SCHEMA_VERSION,
    loanProgram: 'CONVENTIONAL',
    borrowers: Array.from({ length: count }, (_, ordinal) => ({
      borrowerKey: `borrower-${ordinal + 1}`,
      role: ordinal === 0 ? 'PRIMARY' : 'CO_BORROWER',
    })),
  };
}

function request(body: unknown, idempotencyKey = 'standalone-key-00000001') {
  return {
    method: 'POST',
    body,
    headers: { 'idempotency-key': idempotencyKey },
  } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; },
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { state, res };
}

function transaction() {
  const state = {
    loans: [] as Array<Record<string, unknown>>,
    borrowers: [] as Array<Record<string, unknown>>,
    auditEvents: [] as Array<Record<string, unknown>>,
    idempotency: [] as Array<Record<string, unknown>>,
  };
  return {
    state,
    $executeRaw: async () => 0,
    loanApplication: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: LOAN, version: 1, ...data };
        state.loans.push(row);
        return { id: LOAN, version: 1 };
      },
    },
    loanBorrower: {
      findMany: async () => [],
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.borrowers.push(...data);
        return { count: data.length };
      },
    },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditEvents.push(data);
        return data;
      },
    },
    apiIdempotencyKey: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => state.idempotency.find((row) => (
        row.tenantId === where.tenantId && row.operation === where.operation && row.key === where.key
      )) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.idempotency.push(data);
        return data;
      },
    },
  };
}
