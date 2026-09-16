import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { withRequestContext } from '../../auth/requestContext';
import { createDocumentPullHandler } from './documentPullRoute';
import { createDocumentPullStatusHandler } from './documentPullStatusRoute';
import type { DocumentPullQueueMessage } from './documentPull';

const originalRuntimeEnv = process.env.FREEFLOW_RUNTIME_ENV;
const originalTrustedOrigin = process.env.TRUSTED_ORIGIN;
process.env.FREEFLOW_RUNTIME_ENV = 'production';
process.env.TRUSTED_ORIGIN = 'https://app.freeflowmortgage.com';

test.after(() => {
  if (originalRuntimeEnv === undefined) delete process.env.FREEFLOW_RUNTIME_ENV;
  else process.env.FREEFLOW_RUNTIME_ENV = originalRuntimeEnv;
  if (originalTrustedOrigin === undefined) delete process.env.TRUSTED_ORIGIN;
  else process.env.TRUSTED_ORIGIN = originalTrustedOrigin;
});

const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const LOAN_ID = '00000000-0000-4000-8000-000000000200';
const JOB_ID = '00000000-0000-4000-8000-000000000300';

function request(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: 'POST',
    query: { loanId: LOAN_ID },
    headers: {
      origin: 'https://app.freeflowmortgage.com',
      'x-amzn-oidc-data': 'signed-token',
      'idempotency-key': 'document-pull-key-0001',
    },
    body: { expectedLoanVersion: 3 },
    ...overrides,
  } as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    headersSent: false,
    setHeader(name: string, value: unknown) {
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
  authTime: new Date('2026-09-15T12:00:00.000Z'),
  expiresAt: new Date('2026-09-15T12:05:00.000Z'),
};

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: {
      findFirst: async () => null,
      create: async () => ({}),
    },
    loanApplication: {
      findFirst: async () => ({ id: LOAN_ID, version: 3, encompassGuid: 'encompass-loan-guid' }),
    },
    tenantConfiguration: {
      findFirst: async () => ({
        enableEncompassDocumentPull: true,
        encompassClientId: 'client-id',
        encompassInstanceId: 'instance-id',
      }),
    },
    encompassDocumentPullJob: {
      create: async () => ({
        id: JOB_ID,
        status: 'QUEUED',
        expectedLoanVersion: 3,
        correlationId: 'request-id',
      }),
      findFirst: async () => null,
      updateMany: async () => ({ count: 1 }),
    },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: unknown }) => data,
    },
    ...overrides,
  };
}

function wrapCreate(
  role: 'UNDERWRITER' | 'PROCESSOR' | 'LOAN_OFFICER',
  tx: ReturnType<typeof transaction>,
  publishJob: (message: DocumentPullQueueMessage) => Promise<void>,
) {
  return withRequestContext(
    'encompass:pull',
    createDocumentPullHandler({
      withTenantTransaction: (async (_context, operation) => operation(tx as never)) as never,
      publishJob,
    }),
    {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role }),
    },
  );
}

test('loan officers cannot request an Encompass document pull', async () => {
  let published = false;
  const handler = wrapCreate('LOAN_OFFICER', transaction(), async () => { published = true; });
  const { res, state } = response();
  await handler(request(), res);
  assert.equal(state.status, 403);
  assert.equal(published, false);
});

test('queues only identifiers for an authorized tenant loan', async () => {
  let message: DocumentPullQueueMessage | undefined;
  const handler = wrapCreate('PROCESSOR', transaction(), async (value) => { message = value; });
  const { res, state } = response();
  await handler(request(), res);

  assert.equal(state.status, 202);
  assert.deepEqual(Object.keys(message ?? {}).sort(), [
    'correlationId',
    'expectedLoanVersion',
    'jobId',
    'loanId',
    'tenantId',
  ]);
  assert.equal(message?.jobId, JOB_ID);
  assert.equal(message?.tenantId, TENANT_ID);
  assert.equal(JSON.stringify(message).includes('encompass-loan-guid'), false);
});

test('fails closed when the tenant has not enabled document pull', async () => {
  let published = false;
  const tx = transaction({
    tenantConfiguration: {
      findFirst: async () => ({
        enableEncompassDocumentPull: false,
        encompassClientId: 'client-id',
        encompassInstanceId: 'instance-id',
      }),
    },
  });
  const handler = wrapCreate('UNDERWRITER', tx, async () => { published = true; });
  const { res, state } = response();
  await handler(request(), res);
  assert.equal(state.status, 422);
  assert.equal(published, false);
});

test('records a safe retryable state when queue publication fails', async () => {
  let update: unknown;
  const tx = transaction({
    encompassDocumentPullJob: {
      create: async () => ({ id: JOB_ID, status: 'QUEUED', expectedLoanVersion: 3, correlationId: 'request-id' }),
      findFirst: async () => null,
      updateMany: async (input: unknown) => { update = input; return { count: 1 }; },
    },
  });
  const handler = wrapCreate('UNDERWRITER', tx, async () => { throw new Error('provider unavailable'); });
  const { res, state } = response();
  await handler(request(), res);
  assert.equal(state.status, 503);
  assert.match(JSON.stringify(update), /QUEUE_PUBLISH_FAILED/);
  assert.equal(JSON.stringify(update).includes('provider unavailable'), false);
});

test('status lookup does not reveal a missing or cross-tenant job', async () => {
  const handler = withRequestContext(
    'encompass:pull',
    createDocumentPullStatusHandler({
      withTenantTransaction: (async (_context, operation) => operation({
        encompassDocumentPullJob: { findFirst: async () => null },
      } as never)) as never,
    }),
    {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    },
  );
  const { res, state } = response();
  await handler(request({ method: 'GET', query: { jobId: JOB_ID } }), res);
  assert.equal(state.status, 404);
  assert.equal((state.body as { error: { code: string } }).error.code, 'DOCUMENT_PULL_NOT_FOUND');
});
