import assert from 'node:assert/strict';
import test from 'node:test';
import { HmacSignedReplayServiceAuthVerifier } from '../src/auth';
import { MemoryBindingStore } from '../src/binding';
import {
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';
import { handleConnectorRequest } from '../src/http/handleRequest';
import { runPrivateSmoke } from '../scripts/privateSmoke';

test('private smoke uses signed replay auth and verifies the complete synthetic fixture catalog', async () => {
  const serviceId = 'freeflow-connector-smoke';
  const signingKey = 'synthetic-test-signing-key';
  const reports: string[] = [];
  const dependencies = {
    authVerifier: new HmacSignedReplayServiceAuthVerifier([{
      serviceId,
      tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
      signingKey,
    }]),
    bindingStore: new MemoryBindingStore([{
      tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
      lenderId: 'freeflow-dev',
      deploymentId: 'freeflow-dev',
    }]),
    connector: new SyntheticFreeflowDevConnector(),
  };

  await runPrivateSmoke({
    env: {
      CONNECTOR_SERVICE_BASE_URL: 'https://connector.example.test',
      CONNECTOR_SIGNED_SERVICE_ID: serviceId,
      CONNECTOR_SIGNING_KEY: signingKey,
      CONNECTOR_BOUND_TENANT_ID: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
    },
    fetch: (async (input, init) => handleConnectorRequest(new Request(String(input), init), dependencies)) as typeof fetch,
    report: (message) => reports.push(message),
  });

  assert.deepEqual(reports, ['SYNTHETIC_CONNECTOR_PRIVATE_SMOKE=passed']);
});
