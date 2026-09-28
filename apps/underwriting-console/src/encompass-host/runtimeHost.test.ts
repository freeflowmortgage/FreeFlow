import assert from 'node:assert/strict';
import test from 'node:test';
import type { EncompassScriptObject } from './bridge';
import { resolveEncompassHostBridge } from './runtimeHost';

test('runtime uses the real elli.script bridge when the dev test host is disabled', async () => {
  const runtime = globalThis as typeof globalThis & { elli?: { script?: EncompassScriptObject } };
  const original = runtime.elli;
  runtime.elli = {
    script: {
      async getObject() {
        return {
          async all() { return { id: 'real-host-loan' }; },
          async getField() { return ''; },
          async isReadOnly() { return false; },
          async setFields() {},
          async calculate() {},
          async commit() {},
        };
      },
    },
  };
  try {
    const bridge = resolveEncompassHostBridge({ testHost: { enabled: false, loanGuid: null } }, '');
    assert.equal((await bridge.activeLoan()).loanGuid, 'real-host-loan');
  } finally {
    runtime.elli = original;
  }
});

test('runtime creates the deterministic host only when explicitly enabled', async () => {
  const bridge = resolveEncompassHostBridge({
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' },
  }, '?testHostScenario=read-only');
  assert.equal((await bridge.activeLoan()).readOnly, true);
});
