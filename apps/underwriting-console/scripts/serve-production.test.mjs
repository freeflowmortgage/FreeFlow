import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const port = 3109;
const child = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url), env: { ...process.env, FREEFLOW_RUNTIME_MODE: 'protected-web', PORT: String(port) }, stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal((await fetch(`http://127.0.0.1:${port}/fixtures/income-smoke.pdf`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/parse`, { method: 'POST' })).status, 404);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(health.headers.get('content-security-policy') || '', /connect-src 'self' blob:/);
  assert.match(health.headers.get('content-security-policy') || '', /worker-src 'self' blob:/);
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
} finally {
  child.kill();
  await once(child, 'exit');
}

const hostedPort = 3110;
const hosted = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url), env: { ...process.env, FREEFLOW_RUNTIME_MODE: 'encompass-hosted', ENCOMPASS_FRAME_ANCESTORS: 'https://dev.freeflowmortgage.com', PORT: String(hostedPort) }, stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const response = await fetch(`http://127.0.0.1:${hostedPort}/health`);
  assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors https:\/\/dev\.freeflowmortgage\.com/);
  assert.equal(response.headers.has('x-frame-options'), false);
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${hostedPort}/runtime-config.json`)).json(), { testHost: { enabled: false, loanGuid: null } });
} finally {
  hosted.kill();
  await once(hosted, 'exit');
}

const qualificationPort = 3111;
const qualification = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    FREEFLOW_RUNTIME_MODE: 'encompass-hosted', FREEFLOW_RUNTIME_ENV: 'development',
    ENCOMPASS_FRAME_ANCESTORS: 'https://dev.freeflowmortgage.com',
    ENCOMPASS_TEST_HOST_ENABLED: 'true', ENCOMPASS_TEST_HOST_QUALIFICATION: 'true',
    ENCOMPASS_TEST_HOST_LOAN_GUID: '00000000-0000-4000-8000-00000000d001', PORT: String(qualificationPort),
  },
  stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${qualificationPort}/runtime-config.json`)).json(), {
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' },
  });
} finally {
  qualification.kill();
  await once(qualification, 'exit');
}

const forbidden = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    FREEFLOW_RUNTIME_MODE: 'encompass-hosted', FREEFLOW_RUNTIME_ENV: 'production',
    ENCOMPASS_FRAME_ANCESTORS: 'https://app.example.com',
    ENCOMPASS_TEST_HOST_ENABLED: 'true', ENCOMPASS_TEST_HOST_QUALIFICATION: 'true',
    ENCOMPASS_TEST_HOST_LOAN_GUID: '00000000-0000-4000-8000-00000000d001', PORT: '3112',
  },
  stdio: 'ignore',
});
const [forbiddenExit] = await once(forbidden, 'exit');
assert.notEqual(forbiddenExit, 0);
