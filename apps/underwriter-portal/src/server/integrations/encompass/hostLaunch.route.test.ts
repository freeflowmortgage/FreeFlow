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

function request() { return { method: 'POST', body: { encompassLoanGuid: GUID } } as NextApiRequest; }
function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = { status(code: number) { state.status = code; return res; }, json(body: unknown) { state.body = body; return res; } } as unknown as NextApiResponse;
  return { res, state };
}
