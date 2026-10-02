import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CONNECTOR_SERVICE_CONTRACT } from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
} from '../src/connector/syntheticFreeflowDevConnector';

type SmokeDependencies = Readonly<{
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  report?: (message: string) => void;
}>;

export async function runPrivateSmoke(dependencies: SmokeDependencies = {}): Promise<void> {
  const env = dependencies.env ?? process.env;
  const fetchImpl = dependencies.fetch ?? fetch;
  const report = dependencies.report ?? console.log;
  const origin = env.CONNECTOR_SERVICE_BASE_URL?.trim()
    || 'http://encompass-connector.freeflow.local:8080';
  const signingKey = required(env, 'CONNECTOR_SIGNING_KEY');
  const serviceId = required(env, 'CONNECTOR_SIGNED_SERVICE_ID');
  const tenantId = required(env, 'CONNECTOR_BOUND_TENANT_ID');
  const baseBody = {
    contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
    deploymentId: 'freeflow-dev',
    lenderId: 'freeflow-dev',
    tenantId,
    loanId: '00000000-0000-4000-8000-000000000201',
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    correlationId: 'freeflow-dev-private-smoke',
  };

  if (tenantId !== SYNTHETIC_FREEFLOW_DEV_TENANT_ID) throw new Error('Unexpected synthetic tenant.');

  await expectError(fetchImpl, origin, serviceId, signingKey, 'missing-auth', {}, 401, 'CONNECTOR_SERVICE_AUTH_MISSING', 'missing');
  await expectError(fetchImpl, origin, serviceId, `${signingKey}-invalid`, 'invalid-signature', {}, 401, 'CONNECTOR_SERVICE_AUTH_INVALID');
  await expectError(fetchImpl, origin, serviceId, signingKey, 'wrong-tenant', { tenantId: '00000000-0000-4000-8000-000000000999' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError(fetchImpl, origin, serviceId, signingKey, 'wrong-lender', { lenderId: 'wrong-lender' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError(fetchImpl, origin, serviceId, signingKey, 'wrong-deployment', { deploymentId: 'wrong-deployment' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError(fetchImpl, origin, serviceId, signingKey, 'los-credentials', { clientSecret: 'synthetic-forbidden-value' }, 400, 'LOS_CREDENTIALS_FORBIDDEN');

  const listResponse = await post(fetchImpl, origin, CONNECTOR_SERVICE_CONTRACT.listPath, serviceId, signingKey, baseBody);
  if (!listResponse.ok) throw new Error(`Synthetic list failed with HTTP ${listResponse.status}.`);
  const list = await listResponse.json() as { attachments?: Array<{ id?: string }> };
  const ids = list.attachments?.map((attachment) => attachment.id);
  const expectedIds = [...SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS];
  if (!ids || ids.length !== expectedIds.length || ids.some((id, index) => id !== expectedIds[index])) {
    throw new Error('Synthetic attachment list was not deterministic.');
  }
  if (ids[0] !== SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID) {
    throw new Error('Synthetic attachment list was not deterministic.');
  }

  await expectPdfDownload(fetchImpl, origin, serviceId, signingKey, baseBody, SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID);
  for (const pack of SYNTHETIC_FREEFLOW_DEV_MORNING_PACK) {
    const actualHash = await expectPdfDownload(fetchImpl, origin, serviceId, signingKey, baseBody, pack.id);
    if (actualHash !== pack.sha256) {
      throw new Error('Synthetic pack attachment hash did not match.');
    }
  }

  report('SYNTHETIC_CONNECTOR_PRIVATE_SMOKE=passed');
}

async function expectError(
  fetchImpl: typeof globalThis.fetch,
  origin: string,
  serviceId: string,
  signingKey: string,
  name: string,
  overrides: Record<string, unknown>,
  status: number,
  safeCode: string,
  auth: 'signed' | 'missing' = 'signed',
): Promise<void> {
  const response = await post(fetchImpl, origin, CONNECTOR_SERVICE_CONTRACT.listPath, serviceId, signingKey, {
    contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
    deploymentId: 'freeflow-dev',
    lenderId: 'freeflow-dev',
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
    loanId: '00000000-0000-4000-8000-000000000201',
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    correlationId: 'freeflow-dev-private-smoke',
    ...overrides,
  }, auth);
  const body = await response.json() as { safeCode?: string };
  if (response.status !== status || body.safeCode !== safeCode) {
    throw new Error(`Synthetic smoke check failed: ${name}.`);
  }
}

async function expectPdfDownload(
  fetchImpl: typeof globalThis.fetch,
  origin: string,
  serviceId: string,
  signingKey: string,
  baseBody: Record<string, unknown>,
  attachmentId: string,
): Promise<string> {
  const downloadResponse = await post(fetchImpl, origin, CONNECTOR_SERVICE_CONTRACT.downloadPath, serviceId, signingKey, {
    ...baseBody,
    attachmentId,
  });
  if (!downloadResponse.ok) throw new Error(`Synthetic download failed with HTTP ${downloadResponse.status}.`);
  const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (downloadResponse.headers.get('x-content-sha256') !== actualHash) {
    throw new Error('Synthetic attachment hash did not match response bytes.');
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Synthetic attachment was not a PDF.');
  }
  bytes.fill(0);
  return actualHash;
}

function post(
  fetchImpl: typeof globalThis.fetch,
  origin: string,
  path: string,
  serviceId: string,
  signingKey: string,
  body: unknown,
  auth: 'signed' | 'missing' = 'signed',
): Promise<Response> {
  const bodyText = JSON.stringify(body);
  return fetchImpl(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth === 'signed' ? signedHeaders(serviceId, signingKey, path, bodyText) : {}),
    },
    body: bodyText,
  });
}

function signedHeaders(serviceId: string, signingKey: string, path: string, body: string): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomBytes(24).toString('base64url');
  const bodySha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = `POST\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`;
  return {
    'x-freeflow-service-id': serviceId,
    'x-freeflow-timestamp': timestamp,
    'x-freeflow-nonce': nonce,
    'x-freeflow-signature': createHmac('sha256', signingKey).update(canonical, 'utf8').digest('hex'),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required smoke configuration is missing: ${name}`);
  return value;
}

if (require.main === module) {
  runPrivateSmoke().catch(() => {
    console.error('Synthetic connector private smoke failed.');
    process.exitCode = 1;
  });
}
