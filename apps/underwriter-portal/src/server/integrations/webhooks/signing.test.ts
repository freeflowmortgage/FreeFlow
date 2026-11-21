import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  computeWebhookSignature,
  generateSigningSecret,
  isSigningSecret,
  verifyWebhookSignature,
  webhookSignatureHeader,
} from './signing';

const SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ROTATED = 'whsec_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ID = '6f0c1f43-58f0-4b6f-9a76-2f1f3f1c0e11';
const BODY = '{"id":"6f0c1f43-58f0-4b6f-9a76-2f1f3f1c0e11","type":"income.approved"}';

test('generated signing secrets are 256-bit and use the documented format', () => {
  const first = generateSigningSecret();
  const second = generateSigningSecret();
  assert.ok(isSigningSecret(first));
  assert.notEqual(first, second);
  assert.equal(Buffer.from(first.slice('whsec_'.length), 'base64url').length, 32);
  assert.equal(isSigningSecret('whsec_short'), false);
});

test('the signature is HMAC-SHA256 over id, timestamp, and the exact body', () => {
  const expected = createHmac('sha256', SECRET).update(`${ID}.1761660000.${BODY}`).digest('hex');
  assert.equal(computeWebhookSignature(SECRET, ID, 1761660000, BODY), expected);
  assert.equal(webhookSignatureHeader([SECRET], ID, 1761660000, BODY), `v1=${expected}`);
});

test('receivers accept a valid signature and reject tampering, replay, and wrong secrets', () => {
  const timestamp = 1761660000;
  const signature = webhookSignatureHeader([SECRET], ID, timestamp, BODY);
  const base = { secret: SECRET, id: ID, timestamp: String(timestamp), signature, body: BODY, nowSeconds: timestamp + 10 };
  assert.equal(verifyWebhookSignature(base), true);
  assert.equal(verifyWebhookSignature({ ...base, body: `${BODY} ` }), false);
  assert.equal(verifyWebhookSignature({ ...base, id: 'another-id' }), false);
  assert.equal(verifyWebhookSignature({ ...base, secret: ROTATED }), false);
  assert.equal(verifyWebhookSignature({ ...base, nowSeconds: timestamp + 301 }), false);
  assert.equal(verifyWebhookSignature({ ...base, timestamp: 'abc' }), false);
  assert.equal(verifyWebhookSignature({ ...base, signature: 'v0=deadbeef' }), false);
  assert.equal(verifyWebhookSignature({ ...base, signature: undefined }), false);
});

test('during rotation both the new and previous secrets verify the same request', () => {
  const timestamp = 1761660000;
  const header = webhookSignatureHeader([ROTATED, SECRET], ID, timestamp, BODY);
  assert.equal(header.split(' ').length, 2);
  for (const secret of [ROTATED, SECRET]) {
    assert.equal(verifyWebhookSignature({ secret, id: ID, timestamp: String(timestamp), signature: header, body: BODY, nowSeconds: timestamp }), true);
  }
  assert.throws(() => webhookSignatureHeader([], ID, timestamp, BODY));
});
