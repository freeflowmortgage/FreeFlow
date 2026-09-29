import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { createHostLaunchHandler } from './hostLaunchRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const OTHER_TENANT = '00000000-0000-4000-8000-000000000101';
const USER = '00000000-0000-4000-8000-000000000102';
const LOAN = '00000000-0000-4000-8000-000000000200';
const GUID = '11111111-1111-4111-8111-111111111111';
const context = { requestId: 'request-1', tenantId: TENANT, membershipId: USER } as RequestContext;

test('host launch creates an identity-only binding and replays the same tenant binding', async () => {
  const rows: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async () => 0,
    tenantConfiguration: { findFirst: async () => ({ encompassIntegrationMode: 'ENCOMPASS_HOSTED' }) },
    loanApplication: {
      findFirst: async ({ where }: { where: { tenantId: string; encompassGuid: string } }) => rows.find((row) => row.tenantId === where.tenantId && row.encompassGuid === where.encompassGuid) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { rows.push({ ...data, id: LOAN, version: 1 }); return { id: LOAN, version: 1 }; },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const handler = createHostLaunchHandler({ withTenantTransaction: async (_scope, run) => run(tx as never) } as never);
  const first = response(); await handler(request(), first.res, context);
  const second = response(); await handler(request(), second.res, context);
  assert.equal(first.state.status, 200);
  assert.equal(second.state.status, 200);
  assert.equal((first.state.body as any).loanId, LOAN);
  assert.equal((second.state.body as any).loanId, LOAN);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { tenantId: TENANT, encompassGuid: GUID, encompassIntegrationMode: 'ENCOMPASS_HOSTED', id: LOAN, version: 1 });
  assert.equal('primaryBorrowerName' in rows[0], false);
  assert.equal('primaryBorrowerEmail' in rows[0], false);
});

test('host launch lookup and creation are constrained to the authenticated tenant', async () => {
  const queries: unknown[] = [];
  const tx = {
    $executeRaw: async () => 0,
    tenantConfiguration: { findFirst: async ({ where }: any) => { queries.push(where); return { encompassIntegrationMode: 'ENCOMPASS_HOSTED' }; } },
    loanApplication: {
      findFirst: async ({ where }: any) => { queries.push(where); return where.tenantId === OTHER_TENANT ? { id: 'cross-tenant', version: 1 } : null; },
      create: async ({ data }: any) => { queries.push(data); return { id: LOAN, version: 1 }; },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const handler = createHostLaunchHandler({ withTenantTransaction: async (scope, run) => { assert.equal(scope.tenantId, TENANT); return run(tx as never); } } as never);
  const result = response(); await handler(request(), result.res, context);
  assert.equal((result.state.body as any).loanId, LOAN);
  assert.equal(queries.every((value: any) => value.tenantId === TENANT), true);
});

test('host launch is denied for a tenant configured with NONE', async () => {
  let loanQueried = false;
  const tx = {
    tenantConfiguration: { findFirst: async () => ({ encompassIntegrationMode: 'NONE' }) },
    loanApplication: { findFirst: async () => { loanQueried = true; return null; } },
  };
  const handler = createHostLaunchHandler({ withTenantTransaction: async (_scope, run) => run(tx as never) } as never);
  const result = response(); await handler(request(), result.res, context);
  assert.equal(result.state.status, 409);
  assert.equal((result.state.body as any).error.code, 'ENCOMPASS_HOSTED_NOT_ENABLED');
  assert.equal(loanQueried, false);
});

test('host launch rejects borrower names and persists the ordered key roster', async () => {
  const rows: Array<Record<string, unknown>> = [];
  let rosterWrites = 0;
  const tx = {
    $executeRaw: async () => 0,
    tenantConfiguration: { findFirst: async () => ({ encompassIntegrationMode: 'ENCOMPASS_HOSTED' }) },
    loanApplication: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { rows.push({ ...data, id: LOAN, version: 1 }); return { id: LOAN, version: 1 }; },
    },
    loanBorrower: {
      findMany: async () => [],
      createMany: async ({ data }: { data: unknown[] }) => { rosterWrites += 1; rows.push({ roster: data }); return { count: data.length }; },
    },
  };
  const handler = createHostLaunchHandler({ withTenantTransaction: async (_scope, run) => run(tx as never) } as never);
  const rejected = response();
  await handler(request({ borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', name: 'Synthetic' }, { borrowerKey: 'borrower-2', role: 'CO_BORROWER' }] }), rejected.res, context);
  assert.equal(rejected.state.status, 400);
  assert.equal((rejected.state.body as { error: { code: string } }).error.code, 'INVALID_BORROWER_ROSTER');
  assert.equal(rosterWrites, 0);
  const accepted = response();
  await handler(request({ borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }, { borrowerKey: 'borrower-2', role: 'CO_BORROWER' }] }), accepted.res, context);
  assert.equal(accepted.state.status, 200);
  assert.deepEqual((accepted.state.body as { borrowers: unknown }).borrowers, [
    { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' },
    { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' },
  ]);
  assert.equal(JSON.stringify(rows).includes('Synthetic'), false);
});

function request(extra: Record<string, unknown> = {}) { return { method: 'POST', body: { encompassLoanGuid: GUID, ...extra } } as NextApiRequest; }
function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return res; }, json(body: unknown) { state.body = body; return res; } } as unknown as NextApiResponse;
  return { res, state };
}
