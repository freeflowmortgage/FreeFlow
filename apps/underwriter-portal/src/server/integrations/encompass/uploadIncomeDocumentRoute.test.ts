import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { parseWithIncomeService } from './encompassApi';
import { createUploadIncomeDocumentHandler } from './uploadIncomeDocumentRoute';

const LOAN_ID = '00000000-0000-4000-8000-000000000200';
const context = {
  requestId: 'request-parser-unavailable',
  tenantId: '00000000-0000-4000-8000-000000000100',
  membershipId: '00000000-0000-4000-8000-000000000101',
} as RequestContext;
const originalParserUrl = process.env.DOC_PARSER_SERVICE_URL;
process.env.DOC_PARSER_SERVICE_URL = 'http://private-parser/parse';
test.after(() => {
  if (originalParserUrl === undefined) delete process.env.DOC_PARSER_SERVICE_URL;
  else process.env.DOC_PARSER_SERVICE_URL = originalParserUrl;
});

const unavailableFetches: Array<{ name: string; fetch: typeof fetch }> = [
  { name: 'network rejection', fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch },
  { name: 'timeout', fetch: (async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch },
  {
    name: 'response body read failure',
    fetch: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('socket reset')); },
    }), { status: 200 })) as typeof fetch,
  },
];

for (const scenario of unavailableFetches) {
  test(`returns 503 DOCUMENT_PROCESSOR_UNAVAILABLE on parser ${scenario.name}`, async () => {
    const handler = createUploadIncomeDocumentHandler({
      withTenantTransaction: (async (_context, operation) => operation({
        loanApplication: { findFirst: async () => ({ id: LOAN_ID }) },
      } as never)) as never,
      parse: (bytes, options) => parseWithIncomeService(bytes, { ...options, fetch: scenario.fetch }),
      persist: async () => { throw new Error('persistence must not run'); },
    });
    const result = response();

    await handler(request(), result.res, context);

    assert.equal(result.state.status, 503);
    assert.deepEqual(result.state.body, {
      error: {
        code: 'DOCUMENT_PROCESSOR_UNAVAILABLE',
        message: 'The uploaded document could not be processed.',
        requestId: context.requestId,
      },
    });
  });
}

function request(): NextApiRequest {
  const req = Readable.from([Buffer.from('%PDF-synthetic')]) as NextApiRequest;
  req.method = 'POST';
  req.query = { loanId: LOAN_ID };
  req.headers = { 'content-type': 'application/pdf' };
  return req;
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
