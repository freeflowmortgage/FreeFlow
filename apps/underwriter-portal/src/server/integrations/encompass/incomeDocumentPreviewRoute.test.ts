import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { createIncomeDocumentPreviewHandler, parseIncomeDocumentPreview } from './incomeDocumentPreviewRoute';

const context = { requestId: 'request-1', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as RequestContext;
const originalParserUrl = process.env.DOC_PARSER_SERVICE_URL;
process.env.DOC_PARSER_SERVICE_URL = 'http://private-parser';
test.after(() => { process.env.DOC_PARSER_SERVICE_URL = originalParserUrl; });

test('returns full page and box evidence without persistence and erases the request buffer', async () => {
  let parserBytes: Uint8Array | undefined;
  const parsed = previewResult();
  const handler = createIncomeDocumentPreviewHandler({
    parse: async (bytes) => { parserBytes = bytes; return parsed; },
  });
  const result = response();
  await handler(request(Buffer.from('%PDF-synthetic preview')), result.res, context);
  assert.equal(result.state.status, 200);
  assert.deepEqual(result.state.body, parsed);
  assert.equal(parserBytes?.every((byte) => byte === 0), true);
});

test('rejects non-PDF input before calling the parser', async () => {
  let called = false;
  const handler = createIncomeDocumentPreviewHandler({ parse: async () => { called = true; return previewResult(); } });
  const result = response();
  await handler(request(Buffer.from('not a pdf')), result.res, context);
  assert.equal(result.state.status, 422);
  assert.equal((result.state.body as any).error.code, 'INVALID_PDF');
  assert.equal(called, false);
});

test('accepts only a bounded parser result with page words and highlight coordinates', async () => {
  const result = await parseIncomeDocumentPreview(new TextEncoder().encode('%PDF-test'), {
    parserUrl: 'http://private-parser',
    fetch: async () => Response.json({ result: previewResult() }),
  });
  assert.deepEqual((result.formExtracts as any[])[0].box, { x: 0.1, y: 0.2, w: 0.3, h: 0.04 });
  await assert.rejects(
    () => parseIncomeDocumentPreview(new TextEncoder().encode('%PDF-test'), {
      parserUrl: 'http://private-parser',
      fetch: async () => Response.json({ result: { ...previewResult(), total_pages_scanned: 151 } }),
    }),
    /DOCUMENT_PARSER_RESPONSE_INVALID|invalid page data/,
  );
});

function previewResult() {
  return {
    transaction_id: 'synthetic-preview', total_pages_scanned: 1, pages_extracted_count: 1,
    extracted_page_indices: [0], ocr_page_count: 1, has_business_returns: false,
    flags: [], classifications: { '0': ['W-2'] }, unresolved_statements: [],
    pages: [{ index: 0, formIds: ['W-2'], isNativeText: false, meanConfidence: 99, skewDegrees: 0, words: [], flags: [] }],
    formExtracts: [{ pageIndex: 0, form: 'W-2', sourceFieldId: 'w2-box1', boxLabel: '1', fieldLabel: 'Wages', lineNum: '1', category: 'income', value: '96000', numericValue: 96000, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } }],
  };
}

function request(bytes: Buffer, type = 'application/pdf'): NextApiRequest {
  const stream = Readable.from([bytes]) as NextApiRequest;
  stream.method = 'POST';
  stream.headers = { 'content-type': type };
  return stream;
}

function response() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    setHeader() {},
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { res, state };
}
