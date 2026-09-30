import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';

const CONTEXT = {
  tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  loanId: '00000000-0000-4000-8000-000000000201',
  correlationId: 'synthetic-unit-test',
};

test('synthetic freeflow-dev connector returns the in-memory W-2 and morning-pack fixtures', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  assert.deepEqual(
    await connector.listActiveAttachments(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID),
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.map((id) => ({ id })),
  );
  assert.equal(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS[0], SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID);
  assert.equal(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.length, 7);
  assert.deepEqual(
    SYNTHETIC_FREEFLOW_DEV_MORNING_PACK.map((attachment) => attachment.id),
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.slice(1),
  );
  const listedIds = (await connector.listActiveAttachments(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID))
    .map((attachment) => attachment.id);
  const packW2Ids = listedIds.filter((id) => id.startsWith('synthetic-pack-w2-'));
  assert.ok(packW2Ids.length >= 2);
  assert.deepEqual(packW2Ids, [
    SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
    SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
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

  const pdf = new TextDecoder().decode(first.bytes);
  assert.match(pdf, /1 0 0 1 72 756 Tm \(Form W-2 Wage and Tax Statement 2025\) Tj/);
  assert.match(pdf, /1 0 0 1 42 710 Tm \(00-0000000\) Tj/);
  assert.match(pdf, /1 0 0 1 42 680 Tm \(FreeFlow Synthetic Payroll LLC\) Tj/);
  assert.match(pdf, /1 0 0 1 340 710 Tm \(120000\.00\) Tj/);
  assert.match(pdf, /1 0 0 1 340 664 Tm \(120000\.00\) Tj/);
  assert.match(pdf, /1 0 0 1 462 664 Tm \(1740\.00\) Tj/);

  for (const pack of SYNTHETIC_FREEFLOW_DEV_MORNING_PACK) {
    const downloaded = await connector.downloadOriginalAttachment(
      CONTEXT,
      SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
      pack.id,
    );
    const repeated = await connector.downloadOriginalAttachment(
      CONTEXT,
      SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
      pack.id,
    );
    assert.equal(new TextDecoder().decode(downloaded.bytes.subarray(0, 5)), '%PDF-');
    assert.equal(downloaded.sha256, pack.sha256);
    assert.equal(downloaded.sha256, createHash('sha256').update(downloaded.bytes).digest('hex'));
    assert.deepEqual(downloaded.bytes, repeated.bytes);
    assert.equal(downloaded.sha256, repeated.sha256);
  }
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
  await assert.rejects(
    () => connector.downloadOriginalAttachment(
      { ...CONTEXT, tenantId: crypto.randomUUID() },
      SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
      SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
    ),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'SYNTHETIC_LOAN_NOT_FOUND',
  );
});
