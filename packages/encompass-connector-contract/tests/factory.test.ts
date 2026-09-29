import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEncompassConnector,
  FREEFLOW_DEV_CONNECTOR_BINDING,
} from '../src/index';

test('the custom connector is the only supported binding kind', () => {
  assert.equal(FREEFLOW_DEV_CONNECTOR_BINDING.kind, 'custom');
  assert.equal('clientId' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
  assert.equal('clientSecret' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
  assert.equal('instanceId' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
});

test('custom factory path requires no LOS credentials', () => {
  const connector = createEncompassConnector({
    binding: {
      ...FREEFLOW_DEV_CONNECTOR_BINDING,
      serviceBaseUrl: 'https://connector.example.test',
    },
    connectorServiceAuth: { authorizationHeader: 'Bearer service-token' },
    fetch: (async () => new Response('nope')) as typeof fetch,
  });
  assert.equal(connector.kind, 'custom');
});
