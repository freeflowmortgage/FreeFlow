import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runRealConnectorParserSmoke } from '../scripts/realConnectorParserSmoke';

const pdf = new TextEncoder().encode('%PDF-1.7 smoke');
const sha256 = createHash('sha256').update(pdf).digest('hex');
const env = {
  SMOKE_TENANT_ID: '00000000-0000-4000-8000-000000000100',
  SMOKE_LENDER_ID: 'freeflow-dev', SMOKE_DEPLOYMENT_ID: 'freeflow-dev', SMOKE_LOAN_GUID: 'loan-guid',
  CONNECTOR_SERVICE_BASE_URL: 'http://encompass-connector.freeflow.local:8080',
  PARSER_SERVICE_BASE_URL: 'http://income-parser.freeflow.local:8080',
  SMOKE_SERVICE_ID: 'freeflow-connector-smoke', CONNECTOR_SIGNING_KEY: 'test-signing-key',
};

test('real smoke signs, forwards selected PDF bytes, reports only safe results, and clears the buffer', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const reports: Record<string, unknown>[] = [];
  let forwarded: Uint8Array | undefined;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/attachments/list')) return Response.json({ attachments: [{ id: 'selected-attachment' }] });
    if (String(url).includes('/attachments/download')) return new Response(pdf, { headers: { 'x-content-sha256': sha256 } });
    forwarded = new Uint8Array(init?.body as Uint8Array);
    return Response.json({ page_count: 1, ocr_page_count: 1, classifications: { document_type: 'income' } });
  }) as typeof fetch;
  await runRealConnectorParserSmoke({ env, fetch: fetchImpl, report: (value) => reports.push(value) });
  assert.match(new Headers(calls[0].init?.headers).get('x-freeflow-signature') ?? '', /^[a-f0-9]{64}$/);
  assert.equal(calls[2].url, 'http://income-parser.freeflow.local:8080/parse');
  assert.deepEqual([...forwarded!], [...pdf]);
  assert.deepEqual([...(calls[2].init?.body as Uint8Array)], Array(pdf.length).fill(0));
  assert.equal(reports[0].marker, 'REAL_CONNECTOR_PARSER_SMOKE=passed');
  assert.equal(JSON.stringify(reports[0]).includes('%PDF-'), false);
});

test('real smoke fails while still clearing downloaded bytes when parser rejects', async () => {
  let parserBody: Uint8Array | undefined;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes('/attachments/list')) return Response.json({ attachments: [{ id: 'selected-attachment' }] });
    if (String(url).includes('/attachments/download')) return new Response(pdf, { headers: { 'x-content-sha256': sha256 } });
    parserBody = new Uint8Array(init?.body as Uint8Array);
    return new Response('', { status: 500 });
  }) as typeof fetch;
  await assert.rejects(runRealConnectorParserSmoke({ env, fetch: fetchImpl }));
  assert.deepEqual([...parserBody!], [...pdf]);
});
