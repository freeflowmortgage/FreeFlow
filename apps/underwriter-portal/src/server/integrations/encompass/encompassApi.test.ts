import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassApiClient, EncompassApiError, parseWithIncomeService } from './encompassApi';

test('uses ICE client credentials and V3 attachment contracts without leaking credentials', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const pdf = new TextEncoder().encode('%PDF-1.7 synthetic');
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/oauth2/v1/token')) return Response.json({ access_token: 'access-token' });
    if (url.includes('/attachments?')) return Response.json({ attachments: [{ id: 'Attachment-1.pdf', title: 'must-not-propagate' }] });
    if (url.endsWith('/attachmentDownloadUrl')) return Response.json({ attachments: [{ id: 'Attachment-1.pdf', url: 'https://download.example.test/file', authorizationHeader: 'elli-signature-value' }] });
    return new Response(pdf, { status: 200, headers: { 'content-length': String(pdf.length) } });
  }) as typeof fetch;

  const client = new EncompassApiClient({ clientId: 'client', clientSecret: 'secret', instanceId: 'BE123', fetch: fakeFetch });
  assert.deepEqual(await client.listActiveAttachments('loan/guid'), [{ id: 'Attachment-1.pdf' }]);
  const downloaded = await client.downloadOriginalAttachment('loan/guid', 'Attachment-1.pdf');
  assert.equal(new TextDecoder().decode(downloaded.bytes), '%PDF-1.7 synthetic');
  assert.match(downloaded.sha256, /^[0-9a-f]{64}$/);
  assert.equal(calls[0].url, 'https://api.elliemae.com/oauth2/v1/token');
  assert.equal(String(calls[0].init?.body), 'grant_type=client_credentials&instance_id=BE123&scope=lp');
  assert.match(String((calls[0].init?.headers as Record<string, string>).authorization), /^Basic /);
  assert.equal((calls[3].init?.headers as Record<string, string>).authorization, 'elli-signature-value');
  assert.equal(calls.some((call) => JSON.stringify(call).includes('must-not-propagate')), false);
});

test('rejects non-HTTPS provider download URLs', async () => {
  const fakeFetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/oauth2/v1/token')) return Response.json({ access_token: 'token' });
    return Response.json({ attachments: [{ id: 'a', url: 'http://127.0.0.1/private' }] });
  }) as typeof fetch;
  const client = new EncompassApiClient({ clientId: 'c', clientSecret: 's', instanceId: 'i', fetch: fakeFetch });
  await assert.rejects(() => client.downloadOriginalAttachment('loan', 'a'), (error: unknown) =>
    error instanceof EncompassApiError && error.safeCode === 'ENCOMPASS_DOWNLOAD_URL_REJECTED');
});

test('parser adapter keeps only bounded metadata', async () => {
  const parsed = await parseWithIncomeService(new TextEncoder().encode('%PDF-x'), {
    parserUrl: 'http://parser.internal/parse',
    fetch: (async () => Response.json({ result: {
      original_filename: 'borrower-ssn.pdf',
      total_pages_scanned: 2,
      classifications: { 0: ['W2_WAGE'] },
      pages: [{ meanConfidence: 94 }, { meanConfidence: 96 }],
      formExtracts: [{ ssn: 'never-persist-this' }],
    } })) as typeof fetch,
  });
  assert.deepEqual(parsed, { pageCount: 2, documentCategory: 'W2_WAGE', parserVersion: 'income-parser-v5', confidence: 95 });
  assert.equal(JSON.stringify(parsed).includes('ssn'), false);
});
