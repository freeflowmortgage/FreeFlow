import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConsoleRuntimeMode } from './runtimeMode';

test('protected runtime is the production default and does not enable demo data', () => {
  assert.deepEqual(resolveConsoleRuntimeMode(undefined, { production: true }), { mode: 'protected', demoEnabled: false, protected: true });
});

test('production fails closed when a demo or QA runtime is requested', () => {
  assert.throws(() => resolveConsoleRuntimeMode('demo', { production: true }), /DEMO_MODE_FORBIDDEN/);
  assert.throws(() => resolveConsoleRuntimeMode('qa', { production: true }), /DEMO_MODE_FORBIDDEN/);
});

test('local demo and QA modes preserve the existing demonstration experience', () => {
  assert.equal(resolveConsoleRuntimeMode('demo', { production: false }).demoEnabled, true);
  assert.equal(resolveConsoleRuntimeMode('qa', { production: false }).demoEnabled, true);
});
