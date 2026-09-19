import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeveloperConnectAdapter,
  EncompassConnectorError,
  type DeveloperConnectClient,
} from '@mortgage-pos/encompass-connector-contract';
import { createPortalEncompassConnector } from './createEncompassConnector';
import { EncompassApiClient } from './encompassApi';

const context = { tenantId: 'tenant', loanId: 'loan', correlationId: 'corr-1' };

test('DeveloperConnectAdapter wraps the existing EncompassApiClient', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 synthetic');
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/oauth2/v1/token')) return Response.json({ access_token: 'access-token' });
    if (url.includes('/attachments?')) return Response.json({ attachments: [{ id: 'Attachment-1.pdf' }] });
    if (url.endsWith('/attachmentDownloadUrl')) {
      return Response.json({ attachments: [{ id: 'Attachment-1.pdf', url: 'https://download.example.test/file' }] });
    }
    return new Response(pdf, { status: 200, headers: { 'content-length': String(pdf.length) } });
  }) as typeof fetch;

  const client = new EncompassApiClient({
    clientId: 'client',
    clientSecret: 'secret',
    instanceId: 'BE123',
    fetch: fakeFetch,
  });
  const wrapped: DeveloperConnectClient = client;
  const adapter = new DeveloperConnectAdapter(wrapped);

  assert.deepEqual(await adapter.listActiveAttachments(context, 'loan-guid'), [{ id: 'Attachment-1.pdf' }]);
  const downloaded = await adapter.downloadOriginalAttachment(context, 'loan-guid', 'Attachment-1.pdf');
  assert.equal(new TextDecoder().decode(downloaded.bytes), '%PDF-1.7 synthetic');
});

test('portal factory refuses to host Developer Connect and does not read LOS secrets', () => {
  assert.throws(
    () => createPortalEncompassConnector({ ENCOMPASS_CONNECTOR_KIND: 'developer-connect' }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'DEVELOPER_CONNECT_DISABLED',
  );
});
