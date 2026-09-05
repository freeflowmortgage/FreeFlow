import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRequestContext, withRequestContext } from './requestContext';

const originalNodeEnv = process.env.NODE_ENV;
const originalRuntimeEnv = process.env.FREEFLOW_RUNTIME_ENV;
process.env.NODE_ENV = 'production';
process.env.FREEFLOW_RUNTIME_ENV = 'production';

test.after(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalRuntimeEnv === undefined) delete process.env.FREEFLOW_RUNTIME_ENV;
  else process.env.FREEFLOW_RUNTIME_ENV = originalRuntimeEnv;
});

function request(headers: Record<string, string> = {}): NextApiRequest {
  return { headers } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string>; headersSent: boolean } = {
    headers: {},
    headersSent: false,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
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
      state.headersSent = true;
      return res;
    },
    destroy() {
      state.headersSent = true;
    },
  } as unknown as NextApiResponse;
  return { res, state };
}

const identity = {
  subject: 'verified-subject',
  authTime: new Date('2026-09-05T12:59:00.000Z'),
  expiresAt: new Date('2026-09-05T13:05:00.000Z'),
};

test('rejects anonymous requests', async () => {
  await assert.rejects(
    createRequestContext(request(), 'request-1', 'loan:read', {
      verifyToken: async () => identity,
      resolveMembership: async () => null,
    }),
    (error: unknown) => error instanceof Error && error.message === 'AUTHENTICATION_REQUIRED',
  );
});

test('uses the verified membership and ignores caller tenant and role headers', async () => {
  const context = await createRequestContext(
    request({
      'x-amzn-oidc-data': 'signed-token',
      'x-tenant-id': 'attacker-tenant',
      'x-user-role': 'SUPER_ADMIN',
    }),
    'request-2',
    'income:calculate',
    {
      verifyToken: async () => identity,
      resolveMembership: async (subject) => {
        assert.equal(subject, 'verified-subject');
        return { id: 'membership-1', tenantId: 'trusted-tenant', role: 'UNDERWRITER' };
      },
    },
  );

  assert.equal(context.subject, 'verified-subject');
  assert.equal(context.tenantId, 'trusted-tenant');
  assert.equal(context.membershipId, 'membership-1');
  assert.ok(context.permissions.includes('income:calculate'));
  assert.ok(Object.isFrozen(context));
});

test('rejects verified subjects without an active membership', async () => {
  await assert.rejects(
    createRequestContext(request({ 'x-amzn-oidc-data': 'signed-token' }), 'request-3', 'loan:read', {
      verifyToken: async () => identity,
      resolveMembership: async () => null,
    }),
    (error: unknown) => error instanceof Error && error.message === 'MEMBERSHIP_REQUIRED',
  );
});

test('denies a membership that lacks the required operation permission', async () => {
  await assert.rejects(
    createRequestContext(request({ 'x-amzn-oidc-data': 'signed-token' }), 'request-4', 'income:approve', {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: 'membership-2', tenantId: 'trusted-tenant', role: 'LOAN_OFFICER' }),
    }),
    (error: unknown) => error instanceof Error && error.message === 'PERMISSION_DENIED',
  );
});

test('rejects duplicate identity headers', async () => {
  await assert.rejects(
    createRequestContext(
      request({ 'x-amzn-oidc-data': ['token-one', 'token-two'] as unknown as string }),
      'request-5',
      'loan:read',
      {
        verifyToken: async () => identity,
        resolveMembership: async () => ({ id: 'membership-3', tenantId: 'trusted-tenant', role: 'UNDERWRITER' }),
      },
    ),
    (error: unknown) => error instanceof Error && error.message === 'INVALID_IDENTITY_ASSERTION',
  );
});

test('converts an authenticated handler failure into a stable 500 envelope', async () => {
  const { res, state } = response();
  const wrapped = withRequestContext(
    'loan:read',
    async () => {
      throw new Error('database details must not escape');
    },
    {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: 'membership-4', tenantId: 'trusted-tenant', role: 'UNDERWRITER' }),
    },
  );

  await wrapped(request({ 'x-amzn-oidc-data': 'signed-token' }), res);
  assert.equal(state.status, 500);
  assert.equal((state.body as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(state.body), /database details/);
  assert.ok(state.headers['x-request-id']);
  assert.equal(state.headers['cache-control'], 'no-store');
});
