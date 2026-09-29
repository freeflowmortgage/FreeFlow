import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortalEncompassConnector } from './createEncompassConnector';

test('portal factory creates only the separate custom connector client', () => {
  const connector = createPortalEncompassConnector({
    ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
    ENCOMPASS_CONNECTOR_SERVICE_TOKEN: 'service-token',
  } as NodeJS.ProcessEnv, (async () => new Response('unused')) as typeof fetch);

  assert.equal(connector.kind, 'custom');
});
