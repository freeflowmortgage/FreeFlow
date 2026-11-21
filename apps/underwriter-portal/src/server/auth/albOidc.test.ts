import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  AlbOidcVerificationError,
  verifyAlbOidcToken,
  type AlbOidcConfig,
} from './albOidc';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const nowMs = Date.UTC(2026, 8, 5, 13, 0, 0);
const config: AlbOidcConfig = {
  region: 'us-east-1',
  expectedSignerArn:
    'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/freeflow/abc123',
  expectedIssuer: 'https://issuer.example.test',
  expectedClientId: 'freeflow-client',
  expectedAudience: 'freeflow-client',
};

function token(overrides: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) {
  const header = {
    alg: 'ES256',
    kid: '12345678-1234-1234-1234-123456789012',
    signer: config.expectedSignerArn,
    iss: config.expectedIssuer,
    client: config.expectedClientId,
    exp: Math.floor(nowMs / 1000) + 300,
    ...overrides,
  };
  const payload = { sub: 'provider-subject-123', auth_time: Math.floor(nowMs / 1000) - 30, ...claims };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}

const keyProvider = async () => publicKeyPem;

test('accepts an authentic, unexpired ALB identity assertion', async () => {
  const identity = await verifyAlbOidcToken(token(), config, keyProvider, nowMs);
  assert.equal(identity.subject, 'provider-subject-123');
  assert.equal(identity.expiresAt.getTime(), nowMs + 300_000);
  assert.equal(identity.authTime.getTime(), nowMs - 30_000);
  assert.equal(identity.authTimeAsserted, true);
  assert.ok(Object.isFrozen(identity));
});

test('marks auth time as unasserted when the provider omits auth_time', async () => {
  const identity = await verifyAlbOidcToken(token({}, { auth_time: undefined }), config, keyProvider, nowMs);
  assert.equal(identity.authTime.getTime(), nowMs);
  assert.equal(identity.authTimeAsserted, false);
});

for (const [name, overrides, code] of [
  ['signer', { signer: `${config.expectedSignerArn}-forged` }, 'WRONG_SIGNER'],
  ['issuer', { iss: 'https://attacker.example.test' }, 'WRONG_ISSUER'],
  ['audience', { client: 'different-client' }, 'WRONG_AUDIENCE'],
  ['algorithm', { alg: 'none' }, 'INVALID_ALGORITHM'],
] as const) {
  test(`rejects a wrong ${name}`, async () => {
    await assert.rejects(
      verifyAlbOidcToken(token(overrides), config, keyProvider, nowMs),
      (error: unknown) => error instanceof AlbOidcVerificationError && error.code === code,
    );
  });
}

test('rejects expired assertions', async () => {
  await assert.rejects(
    verifyAlbOidcToken(token({ exp: Math.floor(nowMs / 1000) - 10 }), config, keyProvider, nowMs),
    (error: unknown) => error instanceof AlbOidcVerificationError && error.code === 'TOKEN_EXPIRED',
  );
});

test('rejects a forged signature', async () => {
  const [header, payload, encodedSignature] = token().split('.');
  const forgedSignature = Buffer.from(encodedSignature, 'base64url');
  forgedSignature[0] ^= 0xff;
  const forged = `${header}.${payload}.${forgedSignature.toString('base64url')}`;
  await assert.rejects(
    verifyAlbOidcToken(forged, config, keyProvider, nowMs),
    (error: unknown) => error instanceof AlbOidcVerificationError && error.code === 'INVALID_SIGNATURE',
  );
});

test('rejects malformed key IDs before calling the key endpoint', async () => {
  let keyFetches = 0;
  await assert.rejects(
    verifyAlbOidcToken(
      token({ kid: '../attacker' }),
      config,
      async () => {
        keyFetches += 1;
        return publicKeyPem;
      },
      nowMs,
    ),
    (error: unknown) => error instanceof AlbOidcVerificationError && error.code === 'INVALID_KEY_ID',
  );
  assert.equal(keyFetches, 0);
});
