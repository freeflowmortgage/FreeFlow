import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEncompassConnector,
  DEVELOPER_CONNECT_ENABLED_DEFAULT,
  EncompassConnectorError,
  FREEFLOW_DEV_CONNECTOR_BINDING,
  type DeveloperConnectClient,
} from '../src/index';

const context = { tenantId: 'tenant', loanId: 'loan', correlationId: 'corr-1' };

function unusedClient(): DeveloperConnectClient {
  return {
    listActiveAttachments: async () => {
      throw new Error('Developer Connect client must not be called while disabled.');
    },
    downloadOriginalAttachment: async () => {
      throw new Error('Developer Connect client must not be called while disabled.');
    },
  };
}

// ECC-20 / ECC-21: custom is the default; Developer Connect stays selectable but OFF.
test('ECC-20/ECC-21: Developer Connect stays off by default', () => {
  assert.equal(DEVELOPER_CONNECT_ENABLED_DEFAULT, false);
  assert.equal(FREEFLOW_DEV_CONNECTOR_BINDING.kind, 'custom');
  assert.equal('clientId' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
  assert.equal('clientSecret' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
  assert.equal('instanceId' in FREEFLOW_DEV_CONNECTOR_BINDING, false);
});

// ECC-20: selecting developer-connect while the flag is OFF fails closed and never touches ICE.
test('ECC-20: factory fails closed for Developer Connect without enabling it, and never calls the wrapped client', () => {
  assert.throws(
    () => createEncompassConnector({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, kind: 'developer-connect' },
      developerConnectClient: unusedClient(),
    }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'DEVELOPER_CONNECT_DISABLED',
  );
});

// ECC-20: OFF path does not require an ICE client, secret, or instance id.
test('ECC-20: developer-connect OFF path does not require ICE client, secret, or instance', () => {
  assert.throws(
    () => createEncompassConnector({
      binding: { kind: 'developer-connect', deploymentId: 'unused', lenderId: 'unused' },
    }),
    (error: unknown) => (
      error instanceof EncompassConnectorError
      && error.safeCode === 'DEVELOPER_CONNECT_DISABLED'
      && !error.message.includes('client')
      && !error.message.includes('secret')
      && !error.message.includes('instance')
    ),
  );
});

test('ECC-20: factory wraps the Developer Connect client only when explicitly enabled', async () => {
  const connector = createEncompassConnector({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, kind: 'developer-connect' },
    developerConnectEnabled: true,
    developerConnectClient: {
      listActiveAttachments: async (loanGuid) => {
        assert.equal(loanGuid, 'guid');
        return [{ id: 'a1' }];
      },
      downloadOriginalAttachment: async () => {
        throw new Error('download unused');
      },
    },
  });
  assert.equal(connector.kind, 'developer-connect');
  assert.deepEqual(await connector.listActiveAttachments(context, 'guid'), [{ id: 'a1' }]);
});

// ECC-21: default/custom path does not require DC client/secret/instance.
test('ECC-21: custom factory path does not require a Developer Connect client', () => {
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
