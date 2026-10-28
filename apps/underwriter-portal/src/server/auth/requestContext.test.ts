import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRequestContext, withRequestContext } from './requestContext';

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

function request(headers: Record<string, string> = {}, method = 'GET'): NextApiRequest {
  return { headers, method } as unknown as NextApiRequest;
}

function protectedPost(headers: Record<string, string> = {}): NextApiRequest {
  return request({ origin: 'https://app.freeflowmortgage.com', ...headers }, 'POST');
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
const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const USER_ID = '00000000-0000-4000-8000-000000000101';

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
    protectedPost({
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
  assert.equal(context.authTimeAsserted, false);
  assert.ok(Object.isFrozen(context));
});

test('carries a provider-asserted auth time into the request context', async () => {
  const context = await createRequestContext(
    protectedPost({ 'x-amzn-oidc-data': 'signed-token' }),
    'request-auth-time',
    'loan:read',
    {
      verifyToken: async () => ({ ...identity, authTimeAsserted: true }),
      resolveMembership: async () => ({ id: 'membership-1', tenantId: 'trusted-tenant', role: 'UNDERWRITER' }),
    },
  );
  assert.equal(context.authTimeAsserted, true);
  assert.equal(context.authTime.toISOString(), '2026-09-05T12:59:00.000Z');
});

test('rejects an unsafe request with no Origin header before the handler runs', async () => {
  const wrapped = withRequestContext(
    'income:calculate',
    async () => {
      throw new Error('handler must not run');
    },
    {
      verifyToken: async () => ({ subject: 'subject-1', authTime: new Date(), expiresAt: new Date() }),
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    },
  );
  const { res, state } = response();

  await wrapped(request({ 'x-amzn-oidc-data': 'signed-token' }, 'POST'), res);

  assert.equal(state.status, 403);
  assert.equal((state.body as { error: { code: string } }).error.code, 'ORIGIN_REQUIRED');
});

test('rejects a cross-site unsafe request even when its identity assertion is valid', async () => {
  const wrapped = withRequestContext(
    'income:calculate',
    async () => {
      throw new Error('handler must not run');
    },
    {
      verifyToken: async () => ({ subject: 'subject-1', authTime: new Date(), expiresAt: new Date() }),
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    },
  );
  const { res, state } = response();

  await wrapped(protectedPost({ origin: 'https://attacker.example', 'x-amzn-oidc-data': 'signed-token' }), res);

  assert.equal(state.status, 403);
  assert.equal((state.body as { error: { code: string } }).error.code, 'ORIGIN_NOT_ALLOWED');
});

test('freeflow-dev software host is allowed only beside the sales origin', async () => {
  const previousOrigin = process.env.TRUSTED_ORIGIN;
  const previousExtras = process.env.TRUSTED_ORIGINS;
  mutableEnvironment.TRUSTED_ORIGIN = 'https://dev.freeflowmortgage.com';
  delete mutableEnvironment.TRUSTED_ORIGINS;
  try {
    let handlerRan = false;
    const wrapped = withRequestContext('income:calculate', async () => { handlerRan = true; }, {
      verifyToken: async () => ({ subject: 'subject-1', authTime: new Date(), expiresAt: new Date() }),
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    });
    const allowed = response();
    await wrapped(request({
      origin: 'https://app.dev.freeflowmortgage.com',
      'x-amzn-oidc-data': 'signed-token',
    }, 'POST'), allowed.res);
    assert.equal(handlerRan, true);

    handlerRan = false;
    const rejected = response();
    await wrapped(request({
      origin: 'https://attacker.example',
      'x-amzn-oidc-data': 'signed-token',
    }, 'POST'), rejected.res);
    assert.equal(handlerRan, false);
    assert.equal(rejected.state.status, 403);
    assert.equal((rejected.state.body as { error: { code: string } }).error.code, 'ORIGIN_NOT_ALLOWED');
  } finally {
    mutableEnvironment.TRUSTED_ORIGIN = previousOrigin;
    if (previousExtras === undefined) delete mutableEnvironment.TRUSTED_ORIGINS;
    else mutableEnvironment.TRUSTED_ORIGINS = previousExtras;
  }
});

test('malformed extra trusted origins fail closed', async () => {
  const previousExtras = process.env.TRUSTED_ORIGINS;
  mutableEnvironment.TRUSTED_ORIGINS = 'not a url';
  try {
    const wrapped = withRequestContext('income:calculate', async () => {
      throw new Error('handler must not run');
    }, {
      verifyToken: async () => ({ subject: 'subject-1', authTime: new Date(), expiresAt: new Date() }),
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    });
    const { res, state } = response();
    await wrapped(protectedPost({ 'x-amzn-oidc-data': 'signed-token' }), res);
    assert.equal(state.status, 503);
    assert.equal((state.body as { error: { code: string } }).error.code, 'ORIGIN_VALIDATION_UNAVAILABLE');
  } finally {
    if (previousExtras === undefined) delete mutableEnvironment.TRUSTED_ORIGINS;
    else mutableEnvironment.TRUSTED_ORIGINS = previousExtras;
  }
});

test('allows a same-origin unsafe request after identity and membership verification', async () => {
  let handlerRan = false;
  const wrapped = withRequestContext(
    'income:calculate',
    async () => {
      handlerRan = true;
    },
    {
      verifyToken: async () => ({ subject: 'subject-1', authTime: new Date(), expiresAt: new Date() }),
      resolveMembership: async () => ({ id: USER_ID, tenantId: TENANT_ID, role: 'UNDERWRITER' }),
    },
  );
  const { res } = response();

  await wrapped(protectedPost({ 'x-amzn-oidc-data': 'signed-token' }), res);

  assert.equal(handlerRan, true);
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
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => { logged.push(values); };
  const wrapped = withRequestContext(
    'loan:read',
    async () => {
      throw new Error('database details for 1234567890 in borrower-statement.pdf must not escape');
    },
    {
      verifyToken: async () => identity,
      resolveMembership: async () => ({ id: 'membership-4', tenantId: 'trusted-tenant', role: 'UNDERWRITER' }),
    },
  );

  const req = request({ 'x-amzn-oidc-data': 'signed-token' });
  req.url = '/api/v1/loans/loan-1?npi=1234567890&filename=borrower-statement.pdf';
  try {
    await wrapped(req, res);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(state.status, 500);
  assert.equal((state.body as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(JSON.stringify(state.body), /database details/);
  assert.ok(state.headers['x-request-id']);
  assert.equal(state.headers['cache-control'], 'no-store');
  assert.equal(state.headers['x-content-type-options'], 'nosniff');
  assert.equal(state.headers['referrer-policy'], 'no-referrer');
  const log = JSON.stringify(logged);
  assert.match(log, /requestId/);
  assert.match(log, /"method":"GET"/);
  assert.match(log, /"path":"\/api\/v1\/loans\/loan-1"/);
  assert.match(log, /"errorName":"Error"/);
  assert.match(log, /"errorMessage":/);
  assert.doesNotMatch(log, /1234567890|borrower-statement\.pdf|\?npi=|filename=/);
});
