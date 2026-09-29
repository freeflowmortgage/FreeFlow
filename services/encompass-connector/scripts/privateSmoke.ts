import { createHash } from 'node:crypto';
import { CONNECTOR_SERVICE_CONTRACT } from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
} from '../src/connector/syntheticFreeflowDevConnector';

const origin = process.env.CONNECTOR_SERVICE_BASE_URL?.trim()
  || 'http://encompass-connector.freeflow.local:8080';
const token = required('CONNECTOR_SERVICE_TOKEN');
const tenantId = required('CONNECTOR_BOUND_TENANT_ID');
const baseBody = {
  contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
  deploymentId: 'freeflow-dev',
  lenderId: 'freeflow-dev',
  tenantId,
  loanId: '00000000-0000-4000-8000-000000000201',
  loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  correlationId: 'freeflow-dev-private-smoke',
};

async function main(): Promise<void> {
  if (tenantId !== SYNTHETIC_FREEFLOW_DEV_TENANT_ID) throw new Error('Unexpected synthetic tenant.');

  await expectError('missing-auth', '', {}, 401, 'CONNECTOR_SERVICE_AUTH_MISSING');
  await expectError('invalid-token', `Bearer ${token}-invalid`, {}, 401, 'CONNECTOR_SERVICE_AUTH_INVALID');
  await expectError('wrong-tenant', bearer(), { tenantId: '00000000-0000-4000-8000-000000000999' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError('wrong-lender', bearer(), { lenderId: 'wrong-lender' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError('wrong-deployment', bearer(), { deploymentId: 'wrong-deployment' }, 403, 'CONNECTOR_BINDING_MISMATCH');
  await expectError('los-credentials', bearer(), { clientSecret: 'synthetic-forbidden-value' }, 400, 'LOS_CREDENTIALS_FORBIDDEN');

  const listResponse = await post(CONNECTOR_SERVICE_CONTRACT.listPath, bearer(), baseBody);
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

  await expectPdfDownload(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID);
  for (const pack of SYNTHETIC_FREEFLOW_DEV_MORNING_PACK) {
    const actualHash = await expectPdfDownload(pack.id);
    if (actualHash !== pack.sha256) {
      throw new Error('Synthetic pack attachment hash did not match.');
    }
  }

  console.log('SYNTHETIC_CONNECTOR_PRIVATE_SMOKE=passed');
}

async function expectError(
  name: string,
  authorization: string,
  overrides: Record<string, unknown>,
  status: number,
  safeCode: string,
): Promise<void> {
  const response = await post(CONNECTOR_SERVICE_CONTRACT.listPath, authorization, {
    ...baseBody,
    ...overrides,
  });
  const body = await response.json() as { safeCode?: string };
  if (response.status !== status || body.safeCode !== safeCode) {
    throw new Error(`Synthetic smoke check failed: ${name}.`);
  }
}

async function expectPdfDownload(attachmentId: string): Promise<string> {
  const downloadResponse = await post(CONNECTOR_SERVICE_CONTRACT.downloadPath, bearer(), {
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
  return actualHash;
}

function post(path: string, authorization: string, body: unknown): Promise<Response> {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(body),
  });
}

function bearer(): string {
  return `Bearer ${token}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required smoke configuration is missing: ${name}`);
  return value;
}

main().catch(() => {
  console.error('Synthetic connector private smoke failed.');
  process.exitCode = 1;
});
