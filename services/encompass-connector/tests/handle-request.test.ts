import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONNECTOR_SERVICE_CONTRACT,
  CustomConnectorAdapter,
  EncompassConnectorError,
  createLenderConnectorBinding,
} from '@mortgage-pos/encompass-connector-contract';
import { NonProdBearerServiceAuthVerifier } from '../src/auth';
import { MemoryBindingStore } from '../src/binding';
import { CustomConnectorService } from '../src/connector/customConnectorService';
import { handleConnectorRequest } from '../src/http/handleRequest';

const TENANT = 'tenant-a';
const LENDER = 'lender-a';
const DEPLOYMENT = 'deploy-a';
const TOKEN = 'portal-s2s-token';
const ORIGIN = 'https://connector.example.test';

const BINDING = createLenderConnectorBinding({
  lenderId: LENDER,
  deploymentId: DEPLOYMENT,
  serviceBaseUrl: ORIGIN,
});

function deps() {
  return {
    authVerifier: new NonProdBearerServiceAuthVerifier([
      { token: TOKEN, serviceId: 'portal', tenantId: TENANT },
    ]),
    bindingStore: new MemoryBindingStore([
      { tenantId: TENANT, lenderId: LENDER, deploymentId: DEPLOYMENT },
    ]),
    connector: new CustomConnectorService(),
  };
}

function listRequest(overrides: Record<string, unknown> = {}, authorization = `Bearer ${TOKEN}`) {
  return new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.listPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization,
    },
    body: JSON.stringify({
      contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
      deploymentId: DEPLOYMENT,
      lenderId: LENDER,
      tenantId: TENANT,
      loanId: 'loan-1',
      loanGuid: 'guid-1',
      correlationId: 'corr-1',
      ...overrides,
    }),
  });
}

test('GET /health is unauthenticated and reports the stub contract version', async () => {
  const response = await handleConnectorRequest(
    new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.healthPath}`),
    deps(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    stub: true,
    contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
  });
});

test('list rejects missing service auth before touching the connector stub', async () => {
  const response = await handleConnectorRequest(listRequest({}, ''), deps());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING' });
});

test('list rejects a tenant/lender claim that does not match the server binding', async () => {
  const response = await handleConnectorRequest(listRequest({ tenantId: 'tenant-b' }), deps());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { safeCode: 'CONNECTOR_BINDING_MISMATCH' });
});

test('authenticated + bound list/download stay unimplemented (no PDF persist)', async () => {
  const service = new CustomConnectorService();
  await assert.rejects(
    () => service.downloadOriginalAttachment(
      { tenantId: TENANT, loanId: 'loan-1', correlationId: 'corr-1' },
      'guid-1',
      'att-1',
    ),
    (error: unknown) => (
      error instanceof EncompassConnectorError
      && error.safeCode === 'CONNECTOR_NOT_IMPLEMENTED'
      && error.retryable === false
    ),
  );

  const listed = await handleConnectorRequest(listRequest(), deps());
  assert.equal(listed.status, 501);
  assert.deepEqual(await listed.json(), { safeCode: 'CONNECTOR_NOT_IMPLEMENTED' });

  const downloaded = await handleConnectorRequest(
    new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.downloadPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
        deploymentId: DEPLOYMENT,
        lenderId: LENDER,
        tenantId: TENANT,
        loanId: 'loan-1',
        loanGuid: 'guid-1',
        correlationId: 'corr-1',
        attachmentId: 'att-1',
      }),
    }),
    deps(),
  );
  assert.equal(downloaded.status, 501);
  assert.deepEqual(await downloaded.json(), { safeCode: 'CONNECTOR_NOT_IMPLEMENTED' });
});

test('CustomConnectorAdapter reaches this service boundary and surfaces binding denial', async () => {
  const adapter = new CustomConnectorAdapter({
    binding: BINDING,
    serviceAuth: { authorizationHeader: `Bearer ${TOKEN}` },
    fetch: (async (input, init) => handleConnectorRequest(new Request(String(input), init), deps())) as typeof fetch,
  });

  await assert.rejects(
    () => adapter.listActiveAttachments(
      { tenantId: 'tenant-b', loanId: 'loan-b', correlationId: 'corr-b' },
      'guid-1',
    ),
    (error: unknown) => (
      error instanceof EncompassConnectorError
      && error.safeCode === 'CONNECTOR_SERVICE_FAILED_403'
    ),
  );
});

test('request bodies with LOS credential keys are rejected', async () => {
  const response = await handleConnectorRequest(listRequest({ clientSecret: 'nope' }), deps());
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { safeCode: 'LOS_CREDENTIALS_FORBIDDEN' });
});
