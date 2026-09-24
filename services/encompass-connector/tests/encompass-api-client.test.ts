import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { EncompassV3Connector, readEncompassRuntimeCredentials } from '../src/connector/encompassApiClient';

const PDF = new TextEncoder().encode('%PDF-1.4\nsynthetic-test-only\n%%EOF\n');
const context = { tenantId: 'tenant-a', loanId: 'loan-a', correlationId: 'corr-a' };

function connector(fetchImpl: typeof fetch) {
  return new EncompassV3Connector({
    clientId: 'client-id', clientSecret: 'client-secret', instanceId: 'instance-id', apiOrigin: 'https://encompass.example.test',
  }, fetchImpl);
}

test('real connector uses V3 list and short-lived download URLs without exposing credentials', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = connector((async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/v1/token')) return Response.json({ access_token: 'provider-token' });
    if (String(url).includes('/attachments?')) return Response.json({ attachments: [{ id: 'attachment-a' }] });
    if (String(url).endsWith('/attachmentDownloadUrl')) return Response.json({ attachments: [{ id: 'attachment-a', url: 'https://download.example.test/one', authorizationHeader: 'elli-signature-value' }] });
    return new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
  }) as typeof fetch);

  assert.deepEqual(await client.listActiveAttachments(context, 'loan-guid'), [{ id: 'attachment-a' }]);
  const downloaded = await client.downloadOriginalAttachment(context, 'loan-guid', 'attachment-a');
  assert.equal(downloaded.sha256, createHash('sha256').update(PDF).digest('hex'));
  assert.deepEqual(downloaded.bytes, PDF);
  assert.equal(calls[1].url.includes('/encompass/v3/loans/loan-guid/attachments?activeOnly=true&view=Summary'), true);
  assert.equal(calls[2].url.endsWith('/attachmentDownloadUrl'), true);
  assert.equal(calls.some((call) => call.url.includes('client-secret') || JSON.stringify(call).includes('client-secret')), false);
});

test('real connector rejects non-PDF, oversized, and malformed Encompass responses without persistence', async () => {
  for (const response of [
    new Response('not a pdf'),
    new Response(PDF, { headers: { 'content-length': String(40 * 1024 * 1024 + 1) } }),
  ]) {
    const client = connector((async (url) => {
      if (String(url).endsWith('/oauth2/v1/token')) return Response.json({ access_token: 'token' });
      if (String(url).endsWith('/attachmentDownloadUrl')) return Response.json({ attachments: [{ id: 'attachment-a', url: 'https://download.example.test/one' }] });
      return response;
    }) as typeof fetch);
    await assert.rejects(() => client.downloadOriginalAttachment(context, 'loan-guid', 'attachment-a'), EncompassConnectorError);
  }
});

test('real connector configuration is required and never includes a secret in the safe error', () => {
  assert.throws(() => readEncompassRuntimeCredentials({ ENCOMPASS_CLIENT_SECRET: 'secret-value' }), (error: unknown) => {
    assert.ok(error instanceof EncompassConnectorError);
    assert.equal(`${error.message}\n${error.stack}`.includes('secret-value'), false);
    return error.safeCode === 'ENCOMPASS_CONFIGURATION_MISSING';
  });
});
