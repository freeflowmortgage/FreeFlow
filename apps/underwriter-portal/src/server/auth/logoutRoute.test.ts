import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogoutHandler } from './logoutRoute';

const env = {
  NODE_ENV: 'production', FREEFLOW_RUNTIME_ENV: 'production',
  TRUSTED_ORIGIN: 'https://dev.freeflowmortgage.com', APP_BASE_URL: 'https://dev.freeflowmortgage.com',
  OIDC_ISSUER: 'https://cognito-idp.us-west-2.amazonaws.com/us-west-2_example', OIDC_CLIENT_ID: 'client-123',
  ALB_AUTH_SESSION_COOKIE_NAME: 'FreeFlowDevAuth',
};
const identity = { subject: 'verified-subject', authTime: new Date(), expiresAt: new Date(Date.now() + 60_000) };

function request(headers: Record<string, string> = {}, method = 'POST'): NextApiRequest {
  return { method, headers: { origin: env.TRUSTED_ORIGIN, 'x-amzn-oidc-data': 'signed-token', ...headers } } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, string | string[]> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string | string[]) { state.headers[name.toLowerCase()] = value; return res; },
    status(status: number) { state.status = status; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { res, state };
}

function discovery(endpoint = 'https://freeflow-dev.auth.us-west-2.amazoncognito.com/logout') {
  return async () => Response.json({ end_session_endpoint: endpoint });
}

test('logs out a verified identity without requiring a tenant membership', async () => {
  let verifiedToken: string | undefined;
  const handler = createLogoutHandler({
    env, fetch: discovery() as typeof fetch,
    verifyToken: async (token) => { verifiedToken = token; return identity; },
  });
  const { res, state } = response();
  await handler(request(), res);

  assert.equal(state.status, 200);
  assert.equal(verifiedToken, 'signed-token');
  const logoutUrl = new URL((state.body as { logoutUrl: string }).logoutUrl);
  assert.equal(logoutUrl.origin, 'https://freeflow-dev.auth.us-west-2.amazoncognito.com');
  assert.equal(logoutUrl.searchParams.get('client_id'), 'client-123');
  assert.equal(logoutUrl.searchParams.get('logout_uri'), 'https://dev.freeflowmortgage.com/');
  const cookies = state.headers['set-cookie'] as string[];
  assert.ok(cookies.some((value) => value.startsWith('FreeFlowDevAuth=')));
  assert.ok(cookies.some((value) => value.startsWith('FreeFlowDevAuth-0=')));
  assert.ok(cookies.every((value) => value.includes('Max-Age=0') && value.includes('HttpOnly')));
});

test('rejects cross-site logout before identity verification or discovery', async () => {
  let called = false;
  const handler = createLogoutHandler({
    env,
    fetch: (async () => { called = true; return Response.json({}); }) as typeof fetch,
    verifyToken: async () => { called = true; return identity; },
  });
  const { res, state } = response();
  await handler(request({ origin: 'https://attacker.example' }), res);
  assert.equal(state.status, 403);
  assert.equal((state.body as { error: { code: string } }).error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(called, false);
});

test('rejects invalid identities and untrusted discovery logout endpoints', async () => {
  const invalidIdentity = createLogoutHandler({ env, fetch: discovery() as typeof fetch, verifyToken: async () => { throw new Error('invalid'); } });
  const first = response();
  await invalidIdentity(request(), first.res);
  assert.equal(first.state.status, 401);

  const maliciousDiscovery = createLogoutHandler({ env, fetch: discovery('https://attacker.example/logout') as typeof fetch, verifyToken: async () => identity });
  const second = response();
  await maliciousDiscovery(request(), second.res);
  assert.equal(second.state.status, 503);
  assert.equal((second.state.body as { error: { code: string } }).error.code, 'LOGOUT_DISCOVERY_INVALID');
  assert.equal(second.state.headers['set-cookie'], undefined);
});
