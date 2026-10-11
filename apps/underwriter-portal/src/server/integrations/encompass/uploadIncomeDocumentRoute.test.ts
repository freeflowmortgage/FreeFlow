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

test('repeated standalone bytes use one content-addressed source identity', async () => {
  const persisted: Array<{ attachmentId: string; sha256: string }> = [];
  const handler = createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_context, operation) => operation({
      loanApplication: { findFirst: async () => ({ id: LOAN_ID }) },
    } as never)) as never,
    parse: async () => ({ parserVersion: 'synthetic-parser', pages: [] }) as never,
    persist: async (_transaction, _job, downloaded) => { persisted.push(downloaded); },
  });

  const first = response();
  await handler(request(), first.res, { ...context, requestId: 'upload-repeat-1' });
  const second = response();
  await handler(request(), second.res, { ...context, requestId: 'upload-repeat-2' });

  assert.equal(first.state.status, 201);
  assert.equal(second.state.status, 201);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0]?.attachmentId, persisted[1]?.attachmentId);
  assert.equal(persisted[0]?.sha256, persisted[1]?.sha256);
  assert.match(persisted[0]?.attachmentId ?? '', /^upload-sha256-[0-9a-f]{64}$/);
  assert.equal((first.state.body as { attachmentId: string }).attachmentId, persisted[0]?.attachmentId);
  assert.equal((second.state.body as { attachmentId: string }).attachmentId, persisted[0]?.attachmentId);
});

test('scrubs request chunks and the parser buffer after a successful upload', async () => {
  const source = Buffer.from('%PDF-sensitive-synthetic-content');
  let parserBuffer: Buffer | undefined;
  const handler = createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_context, operation) => operation({
      loanApplication: { findFirst: async () => ({ id: LOAN_ID }) },
    } as never)) as never,
    parse: async (bytes) => {
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(bytes.toString('ascii'), '%PDF-sensitive-synthetic-content');
      parserBuffer = bytes;
      return { parserVersion: 'synthetic-parser', pages: [] } as never;
    },
    persist: async () => undefined,
  });
  const result = response();

  await handler(request(source), result.res, context);

  assert.equal(result.state.status, 201);
  assert.ok(source.every((byte) => byte === 0));
  assert.ok(parserBuffer?.every((byte) => byte === 0));
});

test('scrubs accumulated request chunks when PDF validation fails', async () => {
  const source = Buffer.from('synthetic non-pdf content');
  const handler = createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_context, operation) => operation({
      loanApplication: { findFirst: async () => ({ id: LOAN_ID }) },
    } as never)) as never,
    parse: async () => { throw new Error('parser must not run'); },
    persist: async () => { throw new Error('persistence must not run'); },
  });
  const result = response();

  await handler(request(source), result.res, context);

  assert.equal(result.state.status, 422);
  assert.equal((result.state.body as { error: { code: string } }).error.code, 'INVALID_PDF');
  assert.ok(source.every((byte) => byte === 0));
});

test('scrubs an oversized request chunk without retaining it', async () => {
  const source = Buffer.alloc((40 * 1024 * 1024) + 1, 0x61);
  const handler = createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_context, operation) => operation({
      loanApplication: { findFirst: async () => ({ id: LOAN_ID }) },
    } as never)) as never,
    parse: async () => { throw new Error('parser must not run'); },
    persist: async () => { throw new Error('persistence must not run'); },
  });
  const result = response();

  await handler(request(source), result.res, context);

  assert.equal(result.state.status, 422);
  assert.equal((result.state.body as { error: { code: string } }).error.code, 'DOCUMENT_TOO_LARGE');
  assert.ok(source.every((byte) => byte === 0));
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

function request(bytes = Buffer.from('%PDF-synthetic')): NextApiRequest {
  const req = Readable.from([bytes]) as NextApiRequest;
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
