import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { PrismaBindingStore } from '../src/binding';
import {
  SYNTHETIC_FREEFLOW_DEV_MODE,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';
import {
  SKELETON_SERVICE_AUTH_KIND,
  assertProductionAllowsAuth,
  createConnectorRuntime,
} from '../src/boot';

const SECRET_TOKEN = 'must-not-appear-in-errors';

function assertSafeProductionRefusal(error: unknown): boolean {
  assert.ok(error instanceof EncompassConnectorError);
  assert.equal(error.safeCode, 'CONNECTOR_BEARER_STUB_FORBIDDEN_IN_PRODUCTION');
  assert.equal(error.retryable, false);
  const blob = `${error.name}\n${error.safeCode}\n${error.message}\n${error.stack ?? ''}`;
  assert.equal(blob.includes(SECRET_TOKEN), false);
  assert.equal(blob.includes('CONNECTOR_SERVICE_TOKEN'), false);
  return true;
}

test('production refuses to boot when the NON-PROD Bearer stub is selected', () => {
  assert.throws(
    () => assertProductionAllowsAuth('production', SKELETON_SERVICE_AUTH_KIND),
    assertSafeProductionRefusal,
  );
  assert.throws(
    () => createConnectorRuntime({
      NODE_ENV: 'production',
      CONNECTOR_MODE: SYNTHETIC_FREEFLOW_DEV_MODE,
      CONNECTOR_SERVICE_TOKEN: SECRET_TOKEN,
      CONNECTOR_BOUND_TENANT_ID: 'tenant-a',
      CONNECTOR_BOUND_LENDER_ID: 'lender-a',
      CONNECTOR_BOUND_DEPLOYMENT_ID: 'deploy-a',
    }),
    assertSafeProductionRefusal,
  );
});

test('non-production still boots the NON-PROD Bearer stub', () => {
  for (const nodeEnv of [undefined, '', 'development', 'test']) {
    const runtime = createConnectorRuntime({
      NODE_ENV: nodeEnv,
      PORT: '18080',
      CONNECTOR_SERVICE_TOKEN: SECRET_TOKEN,
      CONNECTOR_BOUND_TENANT_ID: 'tenant-a',
      CONNECTOR_BOUND_LENDER_ID: 'lender-a',
      CONNECTOR_BOUND_DEPLOYMENT_ID: 'deploy-a',
    });
    assert.equal(runtime.deps.authVerifier instanceof Object, true);
    assert.equal(
      'kind' in runtime.deps.authVerifier && runtime.deps.authVerifier.kind,
      SKELETON_SERVICE_AUTH_KIND,
    );
    assert.equal(runtime.port, 18080);
    assert.equal(runtime.deps.bindingStore instanceof PrismaBindingStore, true);
  }
});

test('synthetic connector mode is selectable only in the development runtime', () => {
  const runtime = createConnectorRuntime({
    NODE_ENV: 'development',
    FREEFLOW_RUNTIME_ENV: 'development',
    CONNECTOR_MODE: SYNTHETIC_FREEFLOW_DEV_MODE,
    CONNECTOR_SERVICE_TOKEN: SECRET_TOKEN,
    CONNECTOR_BOUND_TENANT_ID: '00000000-0000-4000-8000-000000000100',
  });
  assert.equal(runtime.deps.connector instanceof SyntheticFreeflowDevConnector, true);

  for (const env of [
    { NODE_ENV: 'test', FREEFLOW_RUNTIME_ENV: 'development' },
    { NODE_ENV: 'development', FREEFLOW_RUNTIME_ENV: 'staging' },
    { NODE_ENV: 'development', FREEFLOW_RUNTIME_ENV: 'development', CONNECTOR_BOUND_TENANT_ID: 'wrong-tenant' },
  ]) {
    assert.throws(
      () => createConnectorRuntime({
        CONNECTOR_BOUND_TENANT_ID: '00000000-0000-4000-8000-000000000100',
        ...env,
        CONNECTOR_MODE: SYNTHETIC_FREEFLOW_DEV_MODE,
      }),
      (error: unknown) => (
        error instanceof EncompassConnectorError
        && error.safeCode === 'CONNECTOR_SYNTHETIC_MODE_FORBIDDEN'
      ),
    );
  }
});
