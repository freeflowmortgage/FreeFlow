import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { classifyResponseStatus, classifyTransportError, sendWebhookRequest, type WebhookRequest } from './sender';
import { verifyWebhookSignature } from './signing';
import { startTestHttpsReceiver } from './testHttpsReceiver';

const SECRET = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
let receiver: Awaited<ReturnType<typeof startTestHttpsReceiver>>;

before(async () => { receiver = await startTestHttpsReceiver(); });
after(async () => { await receiver.close(); });

function webhookRequest(overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  return {
    url: new URL(receiver.url()),
    address: { address: '127.0.0.1', family: 4 },
    deliveryId: '6f0c1f43-58f0-4b6f-9a76-2f1f3f1c0e11',
    eventType: 'income.approved',
    body: '{"id":"6f0c1f43-58f0-4b6f-9a76-2f1f3f1c0e11"}',
    secrets: [SECRET],
    timestampSeconds: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

test('status classification retries only transient receiver failures and never follows redirects', () => {
  assert.deepEqual(classifyResponseStatus(200), { kind: 'delivered', responseStatus: 200 });
  assert.deepEqual(classifyResponseStatus(204), { kind: 'delivered', responseStatus: 204 });
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(classifyResponseStatus(status).kind, 'retryable', String(status));
  }
  for (const status of [400, 401, 403, 404, 410, 422]) {
    assert.deepEqual(classifyResponseStatus(status), { kind: 'rejected', safeErrorCode: 'RECEIVER_REJECTED', responseStatus: status });
  }
  assert.deepEqual(classifyResponseStatus(302), { kind: 'rejected', safeErrorCode: 'RECEIVER_REDIRECT_REFUSED', responseStatus: 302 });
});

test('transport errors map to bounded safe codes', () => {
  assert.equal(classifyTransportError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'RECEIVER_CONNECTION_FAILED');
  assert.equal(classifyTransportError(Object.assign(new Error('x'), { code: 'WEBHOOK_TIMEOUT' })), 'RECEIVER_TIMEOUT');
  assert.equal(classifyTransportError(Object.assign(new Error('x'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })), 'RECEIVER_TLS_FAILED');
  assert.equal(classifyTransportError(Object.assign(new Error('x'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })), 'RECEIVER_TLS_FAILED');
  assert.equal(classifyTransportError('unknown'), 'RECEIVER_CONNECTION_FAILED');
});

test('the sender posts a verifiable signed request over verified TLS to the pinned address', async () => {
  receiver.respondWith([204]);
  const before = receiver.received.length;
  const request = webhookRequest();
  const result = await sendWebhookRequest(request);
  assert.deepEqual(result, { kind: 'delivered', responseStatus: 204 });
  const delivered = receiver.received[before]!;
  assert.equal(delivered.path, '/freeflow/webhooks');
  assert.equal(delivered.body, request.body);
  assert.equal(delivered.headers['content-type'], 'application/json');
  assert.equal(delivered.headers['freeflow-event-type'], 'income.approved');
  assert.equal(delivered.headers.host, `localhost:${receiver.port}`);
  assert.equal(verifyWebhookSignature({
    secret: SECRET,
    id: delivered.headers['freeflow-webhook-id'] as string,
    timestamp: delivered.headers['freeflow-webhook-timestamp'] as string,
    signature: delivered.headers['freeflow-webhook-signature'] as string,
    body: delivered.body,
  }), true);
});

test('redirects and receiver errors are classified without reading the response body', async () => {
  receiver.respondWith([307]);
  assert.deepEqual(await sendWebhookRequest(webhookRequest()), {
    kind: 'rejected', safeErrorCode: 'RECEIVER_REDIRECT_REFUSED', responseStatus: 307,
  });
  receiver.respondWith([503]);
  assert.deepEqual(await sendWebhookRequest(webhookRequest()), {
    kind: 'retryable', safeErrorCode: 'RECEIVER_RETRYABLE_STATUS', responseStatus: 503,
  });
  receiver.respondWith([204]);
});

test('the certificate is verified against the URL hostname, not the pinned IP', async () => {
  const result = await sendWebhookRequest(webhookRequest({ url: new URL(`https://not-localhost.example:${receiver.port}/x`) }));
  assert.deepEqual(result, { kind: 'retryable', safeErrorCode: 'RECEIVER_TLS_FAILED', responseStatus: null });
});

test('an unreachable receiver is a retryable connection failure', async () => {
  const result = await sendWebhookRequest(webhookRequest({ url: new URL('https://localhost:1/x') }));
  assert.deepEqual(result, { kind: 'retryable', safeErrorCode: 'RECEIVER_CONNECTION_FAILED', responseStatus: null });
});
