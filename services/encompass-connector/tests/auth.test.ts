import assert from 'node:assert/strict';
import test from 'node:test';
import { NonProdBearerServiceAuthVerifier } from '../src/auth';

const TENANT = 'tenant-a';
const TOKEN = 'portal-s2s-token';

function verifier() {
  return new NonProdBearerServiceAuthVerifier([
    { token: TOKEN, serviceId: 'portal', tenantId: TENANT },
  ]);
}

test('auth stub accepts a matching Bearer service token', async () => {
  const result = await verifier().verify({ authorizationHeader: `Bearer ${TOKEN}` });
  assert.deepEqual(result, {
    ok: true,
    principal: { serviceId: 'portal', tenantId: TENANT },
  });
});

test('auth stub rejects a missing or blank Authorization header', async () => {
  const auth = verifier();
  assert.deepEqual(await auth.verify({}), {
    ok: false,
    safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING',
  });
  assert.deepEqual(await auth.verify({ authorizationHeader: '   ' }), {
    ok: false,
    safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING',
  });
});

test('auth stub rejects an unknown or non-Bearer service token', async () => {
  const auth = verifier();
  assert.deepEqual(await auth.verify({ authorizationHeader: 'Bearer other-token' }), {
    ok: false,
    safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID',
  });
  assert.deepEqual(await auth.verify({ authorizationHeader: TOKEN }), {
    ok: false,
    safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID',
  });
});

test('auth stub is marked non-prod and replaceable', () => {
  const auth = verifier();
  assert.equal(auth.kind, 'bearer-stub-non-prod');
});
