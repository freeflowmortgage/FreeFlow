import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';

const CONTEXT = {
  tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  loanId: '00000000-0000-4000-8000-000000000201',
  correlationId: 'synthetic-unit-test',
};

test('synthetic freeflow-dev connector returns deterministic metadata and in-memory PDF bytes', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  assert.deepEqual(await connector.listActiveAttachments(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID), [
    { id: SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID },
  ]);

  const first = await connector.downloadOriginalAttachment(
    CONTEXT,
    SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  );
  const second = await connector.downloadOriginalAttachment(
    CONTEXT,
    SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  );
  assert.equal(new TextDecoder().decode(first.bytes.subarray(0, 5)), '%PDF-');
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.sha256, createHash('sha256').update(first.bytes).digest('hex'));
  assert.equal(first.sha256, second.sha256);
});

test('synthetic freeflow-dev connector rejects every other tenant, loan, and attachment', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  await assert.rejects(
    () => connector.listActiveAttachments({ ...CONTEXT, tenantId: crypto.randomUUID() }, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'SYNTHETIC_LOAN_NOT_FOUND',
  );
  await assert.rejects(
    () => connector.listActiveAttachments(CONTEXT, crypto.randomUUID()),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'SYNTHETIC_LOAN_NOT_FOUND',
  );
  await assert.rejects(
    () => connector.downloadOriginalAttachment(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, 'wrong-attachment'),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'SYNTHETIC_ATTACHMENT_NOT_FOUND',
  );
});
