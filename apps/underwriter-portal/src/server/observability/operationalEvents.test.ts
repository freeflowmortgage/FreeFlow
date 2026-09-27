import assert from 'node:assert/strict';
import test from 'node:test';
import { emitOperationalEvent } from './operationalEvents';

test('operational events contain only bounded safe labels', () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => { lines.push(String(line)); };
  try {
    emitOperationalEvent('sync_failure', 'ENCOMPASS_API_FAILED_500', 503);
    emitOperationalEvent('auth_denied', 'unsafe borrower text: Jane Doe', 401);
  } finally {
    console.info = original;
  }

  assert.deepEqual(JSON.parse(lines[0]!), {
    source: 'freeflow', event: 'sync_failure', code: 'ENCOMPASS_API_FAILED_500', status: 503,
  });
  assert.deepEqual(JSON.parse(lines[1]!), {
    source: 'freeflow', event: 'auth_denied', code: 'UNSAFE_CODE_REDACTED', status: 401,
  });
  assert.equal(lines.join('\n').includes('Jane Doe'), false);
});
