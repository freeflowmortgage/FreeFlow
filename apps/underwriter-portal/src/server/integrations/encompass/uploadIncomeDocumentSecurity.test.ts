import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { EncompassApiError } from './encompassApi';
import { createUploadIncomeDocumentHandler } from './uploadIncomeDocumentRoute';

const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const LOAN_ID = '00000000-0000-4000-8000-000000000200';
const context = {
  requestId: 'synthetic-upload-security-request',
  tenantId: TENANT_ID,
  membershipId: USER_ID,
} as RequestContext;

const originalParserUrl = process.env.DOC_PARSER_SERVICE_URL;
process.env.DOC_PARSER_SERVICE_URL = 'http://private-parser.invalid/parse';
test.after(() => {
  if (originalParserUrl === undefined) delete process.env.DOC_PARSER_SERVICE_URL;
  else process.env.DOC_PARSER_SERVICE_URL = originalParserUrl;
});

test('a missing or cross-tenant loan fails closed before document processing', async () => {
  let lookup: unknown;
  let parserCalled = false;
  let persistCalled = false;
  const handler = createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_databaseContext, operation) => operation({
      loanApplication: {
        findFirst: async (input: unknown) => {
          lookup = input;
          return null;
        },
      },
    } as never)) as never,
    parse: async () => {
      parserCalled = true;
      return parsedResult();
    },
    persist: async () => { persistCalled = true; },
  });
  const result = response();

  await handler(request([Buffer.from('%PDF-synthetic')]), result.res, context);

  assert.equal(result.state.status, 404);
  assert.equal(errorCode(result.state.body), 'LOAN_NOT_FOUND');
  assert.deepEqual(lookup, {
    where: { id: LOAN_ID, tenantId: TENANT_ID },
    select: { id: true },
  });
  assert.equal(parserCalled, false);
  assert.equal(persistCalled, false);
});

for (const scenario of [
  {
    name: 'unsupported media type',
    contentType: 'image/png',
    chunks: [Buffer.from('%PDF-synthetic')],
    code: 'UNSUPPORTED_DOCUMENT_MEDIA',
  },
  {
    name: 'empty body',
    contentType: 'application/pdf',
    chunks: [] as Buffer[],
    code: 'INVALID_PDF',
  },
  {
    name: 'non-PDF content',
    contentType: 'application/pdf',
    chunks: [Buffer.from('SYNTHETIC_NOT_A_PDF')],
    code: 'INVALID_PDF',
  },
] as const) {
  test(`rejects ${scenario.name} before parsing or persistence`, async () => {
    let parserCalled = false;
    let persistCalled = false;
    const handler = handlerForLoan({
      parse: async () => {
        parserCalled = true;
        return parsedResult();
      },
      persist: async () => { persistCalled = true; },
    });
    const result = response();

    await handler(request(scenario.chunks, scenario.contentType), result.res, context);

    assert.equal(result.state.status, 422);
    assert.equal(errorCode(result.state.body), scenario.code);
    assert.equal(parserCalled, false);
    assert.equal(persistCalled, false);
  });
}

test('rejects a document over 40 MiB without passing bytes to the parser or database writer', async () => {
  let parserCalled = false;
  let persistCalled = false;
  const handler = handlerForLoan({
    parse: async () => {
      parserCalled = true;
      return parsedResult();
    },
    persist: async () => { persistCalled = true; },
  });
  const result = response();

  await handler(streamingRequest(Readable.from(oversizedSyntheticPdf())), result.res, context);

  assert.equal(result.state.status, 422);
  assert.equal(errorCode(result.state.body), 'DOCUMENT_TOO_LARGE');
  assert.equal(parserCalled, false);
  assert.equal(persistCalled, false);
});

test('a parser rejection returns a generic response and erases the in-memory processing buffer', async () => {
  let parserBytes: Uint8Array | undefined;
  const handler = handlerForLoan({
    parse: async (bytes) => {
      parserBytes = bytes;
      throw new EncompassApiError(
        'DOCUMENT_PARSER_RESPONSE_INVALID',
        'SYNTHETIC_PROVIDER_BODY token=SYNTHETIC_TOKEN SSN=000-00-0000',
        false,
      );
    },
    persist: async () => assert.fail('persistence must not run'),
  });
  const result = response();

  await handler(request([Buffer.from('%PDF-synthetic malformed parser response')]), result.res, context);

  assert.equal(result.state.status, 422);
  assert.deepEqual(result.state.body, {
    error: {
      code: 'DOCUMENT_PROCESSOR_REJECTED',
      message: 'The uploaded document could not be processed.',
      requestId: context.requestId,
    },
  });
  assert.equal(parserBytes?.every((byte) => byte === 0), true);
  const serialized = JSON.stringify(result.state.body);
  assert.equal(serialized.includes('SYNTHETIC_PROVIDER_BODY'), false);
  assert.equal(serialized.includes('SYNTHETIC_TOKEN'), false);
  assert.equal(serialized.includes('000-00-0000'), false);
});

test('successful processing persists bounded metadata only and erases the parser buffer', async () => {
  const source = Buffer.from('%PDF-synthetic income document');
  const expectedHash = createHash('sha256').update(source).digest('hex');
  let parserBytes: Uint8Array | undefined;
  let persisted: unknown;
  let provenance: unknown;
  const handler = handlerForLoan({
    parse: async (bytes) => {
      parserBytes = bytes;
      return parsedResult();
    },
    persist: async (_transaction, job, result, writer) => {
      provenance = { job, writer };
      persisted = result;
    },
  });
  const result = response();

  await handler(request([source]), result.res, context);

  assert.equal(result.state.status, 201);
  assert.equal(parserBytes?.every((byte) => byte === 0), true);
  assert.equal((persisted as { sha256: string }).sha256, expectedHash);
  assert.equal(Object.hasOwn(persisted as object, 'bytes'), false);
  assert.equal(JSON.stringify(persisted).includes('%PDF'), false);
  assert.equal((provenance as { writer: string }).writer, 'AUTHENTICATED_UPLOAD');
  assert.equal((provenance as { job: { tenantId: string; loanId: string } }).job.tenantId, TENANT_ID);
  assert.equal((provenance as { job: { tenantId: string; loanId: string } }).job.loanId, LOAN_ID);
});

test('an unexpected database failure still erases the in-memory processing buffer', async () => {
  let parserBytes: Uint8Array | undefined;
  const handler = handlerForLoan({
    parse: async (bytes) => {
      parserBytes = bytes;
      return parsedResult();
    },
    persist: async () => {
      throw new Error('synthetic persistence failure');
    },
  });
  const result = response();

  await assert.rejects(
    handler(request([Buffer.from('%PDF-synthetic persistence failure')]), result.res, context),
    /synthetic persistence failure/,
  );
  assert.equal(parserBytes?.every((byte) => byte === 0), true);
});

function handlerForLoan(overrides: Readonly<{
  parse: (bytes: Uint8Array) => Promise<ReturnType<typeof parsedResult>>;
  persist: (...args: any[]) => Promise<void>;
}>) {
  const transaction = { loanApplication: { findFirst: async () => ({ id: LOAN_ID }) } };
  return createUploadIncomeDocumentHandler({
    withTenantTransaction: (async (_databaseContext, operation) => operation(transaction as never)) as never,
    parse: overrides.parse as never,
    persist: overrides.persist as never,
  });
}

function parsedResult() {
  return {
    pageCount: 1,
    documentCategory: 'W-2',
    parserVersion: 'income-parser-v6',
    confidence: 100,
    extraction: {
      schemaVersion: 'income-extraction-v2' as const,
      normalizedInput: {
        w2Records: [{
          entityId: 'synthetic-w2-1',
          employerName: 'Synthetic Employer',
          year: 2025,
          annualWages: 120000,
        }],
      },
      evidence: { fields: [] },
      warnings: [],
      canonicalHash: 'a'.repeat(64),
    },
  };
}

function request(chunks: readonly Buffer[], contentType = 'application/pdf'): NextApiRequest {
  return streamingRequest(Readable.from(chunks), contentType);
}

function streamingRequest(stream: Readable, contentType = 'application/pdf'): NextApiRequest {
  const req = stream as NextApiRequest;
  req.method = 'POST';
  req.query = { loanId: LOAN_ID };
  req.headers = { 'content-type': contentType };
  return req;
}

async function* oversizedSyntheticPdf(): AsyncGenerator<Buffer> {
  yield Buffer.from('%PDF-');
  const oneMiB = Buffer.alloc(1024 * 1024, 0x53);
  for (let index = 0; index < 41; index += 1) yield oneMiB;
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

function errorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: string } } | undefined)?.error?.code;
}
