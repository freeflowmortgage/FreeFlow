import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassApiError, parseWithIncomeService } from './encompassApi';

const pdf = new TextEncoder().encode('%PDF-x');

async function assertUnavailable(fetchImpl: typeof fetch): Promise<void> {
  await assert.rejects(
    () => parseWithIncomeService(pdf, { parserUrl: 'http://parser.internal/parse', fetch: fetchImpl }),
    (error: unknown) => error instanceof EncompassApiError
      && error.safeCode === 'DOCUMENT_PARSER_UNAVAILABLE'
      && error.retryable,
  );
}

test('parser adapter keeps only bounded metadata', async () => {
  const parsed = await parseWithIncomeService(pdf, {
    parserUrl: 'http://parser.internal/parse',
    fetch: (async () => Response.json({ result: {
      original_filename: 'borrower-ssn.pdf',
      total_pages_scanned: 2,
      classifications: { 0: ['W2_WAGE'] },
      pages: [{ meanConfidence: 94 }, { meanConfidence: 96 }],
      w2Extracts: [{ pageIndex: 0, year: 2025, employerName: 'Synthetic Employer', box1: 120000 }],
      formExtracts: [{ ssn: 'never-persist-this' }],
    } })) as typeof fetch,
  });
  assert.equal(parsed.pageCount, 2);
  assert.equal(parsed.documentCategory, 'W2_WAGE');
  assert.equal(parsed.parserVersion, 'income-parser-v6');
  assert.equal(parsed.confidence, 95);
  assert.equal(parsed.extraction.schemaVersion, 'income-extraction-v2');
  assert.equal(JSON.stringify(parsed).includes('ssn'), false);
});

test('maps parser network and timeout failures to a retryable unavailable error', async () => {
  await assertUnavailable((async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await assertUnavailable((async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch);
});

test('maps parser response body read failures to a retryable unavailable error', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('socket reset')); } });
  await assertUnavailable((async () => new Response(body, { status: 200 })) as typeof fetch);
});

test('maps a parser OCR-budget 503 to a retryable unavailable error', async () => {
  await assertUnavailable((async () => Response.json({ detail: { retryable: true } }, { status: 503 })) as typeof fetch);
});
