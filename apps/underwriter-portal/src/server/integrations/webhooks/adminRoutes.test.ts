import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { permissionsForRole } from '../../auth/permissions';
import { ApiError } from '../../http/apiError';
import {
  createWebhookDeliveriesHandler,
  createWebhookEndpointHandler,
  createWebhookRedeliveryHandler,
  createWebhookSecretRotationHandler,
} from './adminRoutes';
import { assertRecentAuthentication, REAUTHENTICATION_WINDOW_MS } from './endpointAdmin';
import { WebhookSecretStoreError, type WebhookSecretStore } from './secretStore';
import type { WebhookEgressPolicy } from './urlPolicy';

const TENANT = 'a7000000-0000-4000-8000-000000000001';
const USER = 'a7000000-0000-4000-8000-000000000002';
const POLICY: WebhookEgressPolicy = { protectedRuntime: true, allowedHosts: ['hooks.lender.example'], allowPrivateTargets: false };
const KEY = 'webhook-route-test-key-0001';

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'webhook-route-test',
    subject: 'synthetic-admin',
    tenantId: TENANT,
    membershipId: USER,
    permissions: permissionsForRole('BROKER_OWNER'),
    authTime: new Date(),
    authTimeAsserted: true,
    ...overrides,
  };
}

function request(method: string, body?: unknown, headers: Record<string, string> = {}, query: Record<string, string> = {}) {
  return { method, body, headers, query } as unknown as NextApiRequest;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; return res; },
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { state, res };
}

const unusedStore: WebhookSecretStore = {
  create: async () => { throw new Error('not expected'); },
  rotate: async () => { throw new Error('not expected'); },
  read: async () => { throw new Error('not expected'); },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    withTenantTransaction: (async () => { throw new Error('transaction not expected'); }) as never,
    secretStore: () => unusedStore,
    egressPolicy: () => POLICY,
    assertRecentAuthentication: () => undefined,
    ...overrides,
  };
}

test('only broker owners and super admins can manage webhooks', () => {
  assert.ok(permissionsForRole('BROKER_OWNER').includes('webhooks:manage'));
  assert.ok(permissionsForRole('SUPER_ADMIN').includes('webhooks:manage'));
  for (const role of ['UNDERWRITER', 'PROCESSOR', 'LOAN_OFFICER', 'BORROWER'] as const) {
    assert.equal(permissionsForRole(role).includes('webhooks:manage'), false, role);
  }
});

test('protected runtimes require a recent, provider-asserted sign-in for webhook changes', () => {
  const env = { FREEFLOW_RUNTIME_ENV: 'production' } as unknown as NodeJS.ProcessEnv;
  const now = Date.parse('2026-10-28T17:00:00.000Z');
  assert.doesNotThrow(() => assertRecentAuthentication(context({ authTime: new Date(now - 60_000) }), env, now));
  for (const stale of [
    context({ authTime: new Date(now - REAUTHENTICATION_WINDOW_MS - 1) }),
    context({ authTime: new Date(now), authTimeAsserted: false }),
    context({ authTime: new Date(now), authTimeAsserted: undefined }),
    context({ authTime: new Date(now + 5 * 60_000) }),
  ]) {
    assert.throws(
      () => assertRecentAuthentication(stale, env, now),
      (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === 'REAUTHENTICATION_REQUIRED',
    );
  }
  assert.doesNotThrow(() => assertRecentAuthentication(
    context({ authTime: new Date(0), authTimeAsserted: false }),
    { FREEFLOW_RUNTIME_ENV: 'development' } as unknown as NodeJS.ProcessEnv,
    now,
  ));
});

test('mutating webhook routes enforce methods, re-authentication, and idempotency keys before any database work', async () => {
  const unsupported = response();
  await createWebhookEndpointHandler(dependencies())(request('DELETE'), unsupported.res, context());
  assert.equal(unsupported.state.status, 405);
  assert.deepEqual(unsupported.state.headers.Allow, ['GET', 'PUT']);

  const reauth = response();
  await createWebhookEndpointHandler(dependencies({
    assertRecentAuthentication: () => { throw new ApiError(403, 'REAUTHENTICATION_REQUIRED', 'Sign in again.'); },
  }))(request('PUT', { url: 'https://hooks.lender.example/x', isEnabled: true }, { 'idempotency-key': KEY }), reauth.res, context());
  assert.equal(reauth.state.status, 403);
  assert.equal((reauth.state.body as { error: { code: string } }).error.code, 'REAUTHENTICATION_REQUIRED');

  const upsertMissingKey = response();
  await createWebhookEndpointHandler(dependencies())(request('PUT', { expectedVersion: 1 }), upsertMissingKey.res, context());
  assert.equal(upsertMissingKey.state.status, 400);
  assert.equal((upsertMissingKey.state.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const rotateMissingKey = response();
  await createWebhookSecretRotationHandler(dependencies())(request('POST', { expectedVersion: 1 }), rotateMissingKey.res, context());
  assert.equal(rotateMissingKey.state.status, 400);
  assert.equal((rotateMissingKey.state.body as { error: { code: string } }).error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const redeliverBadId = response();
  await createWebhookRedeliveryHandler(dependencies())(
    request('POST', undefined, { 'idempotency-key': KEY }, { deliveryId: 'not-a-uuid' }),
    redeliverBadId.res,
    context(),
  );
  assert.equal(redeliverBadId.state.status, 400);
  assert.equal((redeliverBadId.state.body as { error: { code: string } }).error.code, 'INVALID_IDENTIFIER');

  const badLimit = response();
  await createWebhookDeliveriesHandler(dependencies())(request('GET', undefined, {}, { limit: '500' }), badLimit.res, context());
  assert.equal(badLimit.state.status, 400);
  assert.equal((badLimit.state.body as { error: { code: string } }).error.code, 'INVALID_LIMIT');
});

test('missing secret or egress configuration fails closed with a 503', async () => {
  const unconfigured = response();
  await createWebhookEndpointHandler(dependencies({
    secretStore: () => { throw new WebhookSecretStoreError('WEBHOOK_SECRETS_UNCONFIGURED'); },
  }))(request('PUT', { url: 'https://hooks.lender.example/x', isEnabled: true }, { 'idempotency-key': KEY }), unconfigured.res, context());
  assert.equal(unconfigured.state.status, 503);
  assert.equal((unconfigured.state.body as { error: { code: string } }).error.code, 'WEBHOOKS_UNAVAILABLE');
});

test('URL policy failures are returned as 422 with a safe code and a human message', async () => {
  const transaction = {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null },
  };
  const rejected = response();
  await createWebhookEndpointHandler(dependencies({
    withTenantTransaction: async (_tenant: unknown, operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
  }))(
    request('PUT', { url: 'http://hooks.lender.example/x', isEnabled: true, expectedVersion: null }, { 'idempotency-key': KEY }),
    rejected.res,
    context(),
  );
  assert.equal(rejected.state.status, 422);
  assert.deepEqual(rejected.state.body, {
    error: { code: 'WEBHOOK_URL_HTTPS_REQUIRED', message: 'The webhook URL must use HTTPS.', requestId: 'webhook-route-test' },
  });
});

test('a new endpoint returns its signing secret exactly once with a 201', async () => {
  const created: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const transaction = {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    outboundWebhookEndpoint: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return {
          id: data.id, url: data.url, isEnabled: data.isEnabled, version: 1, signingSecretRef: data.signingSecretRef,
          signingSecretVersion: 1, signingSecretRotatedAt: null, updatedAt: new Date('2026-10-28T17:00:00.000Z'),
        };
      },
    },
    outboundWebhookEndpointAuditEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return { id: 'audit' }; },
    },
  };
  const store: WebhookSecretStore = {
    ...unusedStore,
    create: async ({ tenantId, endpointId }) => ({
      reference: `local-dev:${tenantId}/${endpointId}`,
      secret: 'whsec_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    }),
  };
  const result = response();
  await createWebhookEndpointHandler(dependencies({
    secretStore: () => store,
    withTenantTransaction: async (_tenant: unknown, operation: (tx: unknown) => Promise<unknown>) => operation(transaction),
  }))(
    request('PUT', { url: 'https://hooks.lender.example/freeflow', isEnabled: true, expectedVersion: null }, { 'idempotency-key': KEY }),
    result.res,
    context(),
  );
  assert.equal(result.state.status, 201);
  const body = result.state.body as { signingSecret: string; endpoint: { url: string; configured: boolean } };
  assert.equal(body.signingSecret, 'whsec_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
  assert.equal(body.endpoint.url, 'https://hooks.lender.example/freeflow');
  assert.equal(JSON.stringify(body.endpoint).includes('local-dev'), false);
  assert.equal(created.length, 1);
  assert.equal(JSON.stringify(created[0]).includes('whsec_'), false);
  assert.equal(audits[0]!.action, 'WEBHOOK_ENDPOINT_CREATED');
  assert.equal(audits[0]!.urlHost, 'hooks.lender.example');
  assert.match(String(audits[0]!.urlHash), /^[0-9a-f]{64}$/);
});
