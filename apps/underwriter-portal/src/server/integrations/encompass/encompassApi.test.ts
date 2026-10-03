import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassApiError, parseWithIncomeService } from './encompassApi';

test('parser adapter keeps only bounded metadata', async () => {
  const parsed = await parseWithIncomeService(new TextEncoder().encode('%PDF-x'), {
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

test('parser transport failures become a retryable safe error', async () => {
  await assert.rejects(
    () => parseWithIncomeService(new TextEncoder().encode('%PDF-x'), {
      parserUrl: 'http://parser.internal/parse',
      fetch: (async () => { throw new TypeError('fetch failed: internal address'); }) as typeof fetch,
    }),
    (error: unknown) => {
      assert.ok(error instanceof EncompassApiError);
      assert.equal(error.safeCode, 'DOCUMENT_PARSER_UNAVAILABLE');
      assert.equal(error.retryable, true);
      assert.equal(error.message.includes('internal address'), false);
      return true;
    },
  );
});
