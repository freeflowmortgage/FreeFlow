import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
execFileSync(process.execPath, [resolve(appRoot, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: appRoot,
  env: { ...process.env, VITE_FREEFLOW_RUNTIME_MODE: 'encompass-hosted' },
  stdio: 'ignore',
});

const port = 3109;
const child = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: appRoot, env: { ...process.env, FREEFLOW_RUNTIME_MODE: 'protected-web', PORT: String(port) }, stdio: 'ignore',
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
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${hostedPort}/runtime-config.json`)).json(), {
    testHost: { enabled: false, loanGuid: null }, syntheticProductDemos: { enabled: false },
  });
  assert.equal((await fetch(`http://127.0.0.1:${hostedPort}/fixtures/urar-1004.pdf`)).status, 404);
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
    FREEFLOW_SYNTHETIC_PRODUCT_DEMOS: 'true',
    ENCOMPASS_TEST_HOST_LOAN_GUID: '00000000-0000-4000-8000-00000000d001', PORT: String(qualificationPort),
  },
  stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${qualificationPort}/runtime-config.json`)).json(), {
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' },
    syntheticProductDemos: { enabled: true },
  });
  const fixture = await fetch(`http://127.0.0.1:${qualificationPort}/fixtures/urar-1004.pdf`);
  assert.equal(fixture.status, 200);
  assert.equal(fixture.headers.get('content-type'), 'application/pdf');
  assert.ok((await fixture.arrayBuffer()).byteLength > 1_000);
  const fixtureMeta = await fetch(`http://127.0.0.1:${qualificationPort}/fixtures/urar-1004.meta.json`);
  assert.equal(fixtureMeta.status, 200);
  assert.deepEqual(await fixtureMeta.json(), { custom: false });
} finally {
  qualification.kill();
  await once(qualification, 'exit');
}

const productionFlagPort = 3113;
const productionFlag = spawn(process.execPath, ['scripts/serve-production.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    FREEFLOW_RUNTIME_MODE: 'protected-web', FREEFLOW_RUNTIME_ENV: 'production',
    FREEFLOW_SYNTHETIC_PRODUCT_DEMOS: 'true', PORT: String(productionFlagPort),
  },
  stdio: 'ignore',
});
try {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${productionFlagPort}/runtime-config.json`)).json(), {
    testHost: { enabled: false, loanGuid: null }, syntheticProductDemos: { enabled: false },
  });
  assert.equal((await fetch(`http://127.0.0.1:${productionFlagPort}/fixtures/urar-1004.pdf`)).status, 404);
} finally {
  productionFlag.kill();
  await once(productionFlag, 'exit');
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
