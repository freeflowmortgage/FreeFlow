import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 3109;
const child = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url), env: { ...process.env, FREEFLOW_RUNTIME_MODE: 'protected', PORT: String(port) }, stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await fetch(`http://127.0.0.1:${port}/fixtures/income-smoke.pdf`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/parse`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
} finally {
  child.kill();
  await once(child, 'exit');
}
