import assert from 'node:assert/strict';
import test from 'node:test';
import { HmacSignedReplayServiceAuthVerifier, NonProdBearerServiceAuthVerifier, signCanonicalRequest } from '../src/auth';

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

test('signed production authentication verifies a canonical request once and rejects replay', async () => {
  const key = 'test-signing-key-not-a-secret';
  const auth = new HmacSignedReplayServiceAuthVerifier([{ serviceId: 'portal', tenantId: TENANT, signingKey: key }]);
  const timestamp = String(Date.now());
  const nonce = '0123456789abcdef';
  const material = {
    serviceIdHeader: 'portal', timestampHeader: timestamp, nonceHeader: nonce,
    requestMethod: 'POST', requestPath: '/v1/attachments/list', bodySha256: 'a'.repeat(64),
    signatureHeader: signCanonicalRequest(key, 'POST', '/v1/attachments/list', timestamp, nonce, 'a'.repeat(64)),
  };
  assert.deepEqual(await auth.verify(material), { ok: true, principal: { serviceId: 'portal', tenantId: TENANT } });
  assert.deepEqual(await auth.verify(material), { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' });
});
