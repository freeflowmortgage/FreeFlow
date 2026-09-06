import assert from 'node:assert/strict';
import test from 'node:test';
import { hashAuditResult } from './appendEvent';

test('audit result hashes are stable across object key order', () => {
  const first = hashAuditResult({
    qualifyingMonthlyIncome: 8123.45,
    yearsAnalyzed: [2025, 2024],
    calculationEngine: 'FORM_1084',
  });
  const second = hashAuditResult({
    calculationEngine: 'FORM_1084',
    yearsAnalyzed: [2025, 2024],
    qualifyingMonthlyIncome: 8123.45,
  });

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('audit result hashing rejects non-JSON-safe values', () => {
  assert.throws(
    () => hashAuditResult({ qualifyingMonthlyIncome: Number.NaN }),
    /finite numbers/,
  );
  assert.throws(
    () => hashAuditResult({ omitted: undefined }),
    /JSON-compatible/,
  );
});
