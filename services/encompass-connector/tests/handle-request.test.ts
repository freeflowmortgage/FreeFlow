import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CONNECTOR_SERVICE_CONTRACT,
  CustomConnectorAdapter,
  EncompassConnectorError,
  createLenderConnectorBinding,
  type EncompassConnector,
} from '@mortgage-pos/encompass-connector-contract';
import { NonProdBearerServiceAuthVerifier } from '../src/auth';
import { MemoryBindingStore } from '../src/binding';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';
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

function deps(options: Readonly<{
  connector?: EncompassConnector;
  bindings?: ConstructorParameters<typeof MemoryBindingStore>[0];
}> = {}) {
  return {
    authVerifier: new NonProdBearerServiceAuthVerifier([
      { token: TOKEN, serviceId: 'portal', tenantId: TENANT },
    ]),
    bindingStore: new MemoryBindingStore(options.bindings ?? [
      { tenantId: TENANT, lenderId: LENDER, deploymentId: DEPLOYMENT },
    ]),
    connector: options.connector ?? unavailableConnector(),
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

test('list rejects an invalid service token', async () => {
  const response = await handleConnectorRequest(listRequest({}, 'Bearer invalid-token'), deps());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' });
});

test('list rejects a tenant/lender claim that does not match the server binding', async () => {
  const response = await handleConnectorRequest(listRequest({ tenantId: 'tenant-b' }), deps());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { safeCode: 'CONNECTOR_BINDING_MISMATCH' });
});

test('cross-tenant request is denied without exposing the bound tenant or loan identity', async () => {
  const response = await handleConnectorRequest(
    listRequest({ tenantId: 'tenant-b', loanId: 'loan-for-tenant-b' }),
    deps(),
  );
  assert.equal(response.status, 403);
  const payload = await response.json() as Record<string, unknown>;
  assert.deepEqual(payload, { safeCode: 'CONNECTOR_BINDING_MISMATCH' });
  assert.equal(JSON.stringify(payload).includes(TENANT), false);
  assert.equal(JSON.stringify(payload).includes('loan-for-tenant-b'), false);
});

test('binding enforcement rejects wrong lender and deployment claims', async () => {
  for (const overrides of [{ lenderId: 'wrong' }, { deploymentId: 'wrong' }]) {
    const response = await handleConnectorRequest(listRequest(overrides), deps());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { safeCode: 'CONNECTOR_BINDING_MISMATCH' });
  }
});

test('missing and disabled bindings fail closed', async () => {
  const missing = await handleConnectorRequest(listRequest(), deps({ bindings: [] }));
  assert.equal(missing.status, 403);
  assert.deepEqual(await missing.json(), { safeCode: 'CONNECTOR_BINDING_NOT_FOUND' });

  const disabled = await handleConnectorRequest(listRequest(), deps({
    bindings: [{ tenantId: TENANT, lenderId: LENDER, deploymentId: DEPLOYMENT, isEnabled: false }],
  }));
  assert.equal(disabled.status, 403);
  assert.deepEqual(await disabled.json(), { safeCode: 'CONNECTOR_BINDING_NOT_FOUND' });
});

test('authenticated and bound synthetic list/download returns deterministic verified PDF bytes', async () => {
  const syntheticDeps = deps({
    connector: new SyntheticFreeflowDevConnector(),
    bindings: [{
      tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
      lenderId: 'freeflow-dev',
      deploymentId: 'freeflow-dev',
    }],
  });
  syntheticDeps.authVerifier = new NonProdBearerServiceAuthVerifier([{
    token: TOKEN,
    serviceId: 'portal',
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  }]);
  const requestBody = {
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
    lenderId: 'freeflow-dev',
    deploymentId: 'freeflow-dev',
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  };

  const listed = await handleConnectorRequest(listRequest(requestBody), syntheticDeps);
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    attachments: SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.map((id) => ({ id })),
  });

  const downloaded = await handleConnectorRequest(new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.downloadPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
      ...requestBody,
      loanId: 'synthetic-loan',
      correlationId: 'synthetic-correlation',
      attachmentId: SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
    }),
  }), syntheticDeps);
  assert.equal(downloaded.status, 200);
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');
  assert.equal(downloaded.headers.get('x-content-sha256'), createHash('sha256').update(bytes).digest('hex'));

  for (const pack of SYNTHETIC_FREEFLOW_DEV_MORNING_PACK) {
    const packDownload = await handleConnectorRequest(new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.downloadPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
        ...requestBody,
        loanId: 'synthetic-loan',
        correlationId: 'synthetic-correlation',
        attachmentId: pack.id,
      }),
    }), syntheticDeps);
    assert.equal(packDownload.status, 200);
    const packBytes = new Uint8Array(await packDownload.arrayBuffer());
    assert.equal(new TextDecoder().decode(packBytes.subarray(0, 5)), '%PDF-');
    assert.equal(packDownload.headers.get('x-content-sha256'), pack.sha256);
    assert.equal(packDownload.headers.get('x-content-sha256'), createHash('sha256').update(packBytes).digest('hex'));
  }
});

test('download response owns an independent copy before connector bytes are scrubbed', async () => {
  const expected = new TextEncoder().encode('%PDF-1.7\nsynthetic-copy-test\n%%EOF\n');
  const connectorBytes = expected.slice();
  const sha256 = createHash('sha256').update(expected).digest('hex');
  const connector: EncompassConnector = {
    ...unavailableConnector(),
    async downloadOriginalAttachment() { return { bytes: connectorBytes, sha256 }; },
  };
  const response = await handleConnectorRequest(new Request(`${ORIGIN}${CONNECTOR_SERVICE_CONTRACT.downloadPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
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
  }), deps({ connector }));

  assert.equal(response.status, 200);
  assert.equal(connectorBytes.every((value) => value === 0), true);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected);
});

test('authenticated synthetic boundary retrieves loan data and performs approved field write/readback', async () => {
  const synthetic = new SyntheticFreeflowDevConnector();
  const syntheticDeps = deps({
    connector: synthetic,
    bindings: [{
      tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
      lenderId: 'freeflow-dev',
      deploymentId: 'freeflow-dev',
    }],
  });
  syntheticDeps.authVerifier = new NonProdBearerServiceAuthVerifier([{
    token: TOKEN,
    serviceId: 'portal',
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  }]);
  const adapter = new CustomConnectorAdapter({
    binding: createLenderConnectorBinding({
      lenderId: 'freeflow-dev',
      deploymentId: 'freeflow-dev',
      serviceBaseUrl: ORIGIN,
    }),
    serviceAuth: { authorizationHeader: `Bearer ${TOKEN}` },
    fetch: (async (input, init) => handleConnectorRequest(
      new Request(String(input), init),
      syntheticDeps,
    )) as typeof fetch,
  });
  const context = {
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
    loanId: 'synthetic-loan',
    correlationId: 'synthetic-round-trip',
  };
  const snapshot = await adapter.retrieveLoanSnapshot(context, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID);
  assert.equal(snapshot.schemaVersion, 'encompass-loan-snapshot-v1');
  assert.equal(snapshot.simulated, true);
  assert.equal(snapshot.borrowers.length, 2);

  const approvalEventId = '00000000-0000-4000-8000-000000000901';
  const fields = [
    { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: approvalEventId },
    { fieldName: 'CX.FREEFLOW.W2.VARIABLE', value: '1600.00' },
  ];
  const write = await adapter.applyApprovedIncomeUpdate(context, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, {
    approvalEventId,
    fields,
  });
  assert.deepEqual(write.fieldResults, fields.map((field) => ({ fieldName: field.fieldName, status: 'APPLIED' })));
  assert.deepEqual(
    await adapter.readFields(context, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, fields.map((field) => field.fieldName)),
    Object.fromEntries(fields.map((field) => [field.fieldName, field.value])),
  );
  assert.equal(synthetic.mutationCount, 1);
});

test('connector failures retain a safe provider-neutral response', async () => {
  const listed = await handleConnectorRequest(listRequest(), deps());
  assert.equal(listed.status, 400);
  assert.deepEqual(await listed.json(), { safeCode: 'ENCOMPASS_CONFIGURATION_MISSING' });

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
  assert.equal(downloaded.status, 400);
  assert.deepEqual(await downloaded.json(), { safeCode: 'ENCOMPASS_CONFIGURATION_MISSING' });
});

function unavailableConnector(): EncompassConnector {
  return {
    kind: 'custom',
    async retrieveLoanSnapshot() {
      throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', 'not configured', false);
    },
    async listActiveAttachments() {
      throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', 'not configured', false);
    },
    async downloadOriginalAttachment() {
      throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', 'not configured', false);
    },
    async applyApprovedIncomeUpdate() {
      throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', 'not configured', false);
    },
    async readFields() {
      throw new EncompassConnectorError('ENCOMPASS_CONFIGURATION_MISSING', 'not configured', false);
    },
  };
}

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
