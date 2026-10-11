import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  EncompassConnectorError,
  buildEncompassWritePreview,
  compareEncompassFieldReadback,
  executeApprovedIncomeRoundTrip,
} from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS,
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  SyntheticFreeflowDevConnector,
} from '../src/connector/syntheticFreeflowDevConnector';

const CONTEXT = {
  tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  loanId: '00000000-0000-4000-8000-000000000201',
  correlationId: 'synthetic-unit-test',
};

const APPROVAL_ID = '00000000-0000-4000-8000-000000000901';
const ROUND_TRIP_FIELDS = [
  { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: APPROVAL_ID },
  { fieldName: 'CX.FREEFLOW.W2.BASE', value: '4000.00' },
  { fieldName: 'CX.FREEFLOW.W2.VARIABLE', value: '1600.00' },
  { fieldName: 'CX.FREEFLOW.ASSET.INCOME', value: '1000.00' },
] as const;

test('synthetic freeflow-dev connector returns the in-memory W-2 and morning-pack fixtures', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  assert.deepEqual(
    await connector.listActiveAttachments(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID),
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.map((id) => ({ id })),
  );
  assert.equal(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS[0], SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID);
  assert.equal(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.length, 14);
  assert.equal(
    SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.at(-1),
    SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
  );
  for (const id of [
    SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID,
    SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
  ]) {
    assert.ok(SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.some((candidate) => candidate === id));
  }
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
    const packText = new TextDecoder().decode(downloaded.bytes);
    if (pack.id === SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID) {
      assert.ok(listedIds.includes(SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID));
      assert.match(packText, /Schedule B \\\(Form 1040\\\) Interest and Ordinary Dividends/);
      assert.match(packText, /1 0 0 1 72 602 Tm \(Total interest\) Tj/);
      assert.match(packText, /1 0 0 1 200 602 Tm \(12000\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID) {
      assert.match(packText, /Schedule C \\\(Form 1040\\\) Profit or Loss From Business/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Business name\) Tj/);
      assert.match(packText, /1 0 0 1 150 660 Tm \(Synthetic Consulting\) Tj/);
      assert.match(packText, /1 0 0 1 72 630 Tm \(Net profit or loss\) Tj/);
      assert.match(packText, /1 0 0 1 154 630 Tm \(96000\.00\) Tj/);
      assert.match(packText, /1 0 0 1 72 600 Tm \(13 Depreciation\) Tj/);
      assert.match(packText, /1 0 0 1 151 600 Tm \(8500\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID) {
      assert.match(packText, /Schedule F \\\(Form 1040\\\) Profit or Loss From Farming/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Farm name\) Tj/);
      assert.match(packText, /1 0 0 1 134 660 Tm \(Synthetic Farm\) Tj/);
      assert.match(packText, /1 0 0 1 72 630 Tm \(Net farm profit or loss\) Tj/);
      assert.match(packText, /1 0 0 1 174 630 Tm \(48000\.00\) Tj/);
      assert.match(packText, /1 0 0 1 72 600 Tm \(14 Depreciation\) Tj/);
      assert.match(packText, /1 0 0 1 151 600 Tm \(3200\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID) {
      assert.match(packText, /Schedule D \\\(Form 1040\\\) Capital Gains and Losses/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Combine lines 7 and 15\) Tj/);
      assert.match(packText, /1 0 0 1 183 660 Tm \(12000\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID) {
      assert.match(packText, /U\.S\. Income Tax Return for an S Corporation/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Name of corporation\) Tj/);
      assert.match(packText, /1 0 0 1 170 660 Tm \(Synthetic S Corp Return\) Tj/);
      assert.match(packText, /1 0 0 1 72 600 Tm \(Ordinary business income \\\(loss\\\)\) Tj/);
      assert.match(packText, /1 0 0 1 217 600 Tm \(142000\.00\) Tj/);
      assert.match(packText, /1 0 0 1 72 570 Tm \(Depreciation not claimed\) Tj/);
      assert.match(packText, /1 0 0 1 187 570 Tm \(18000\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID) {
      assert.match(packText, /Schedule K-1 \\\(Form 1120-S\\\)/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Corporation's name\) Tj/);
      assert.match(packText, /1 0 0 1 167 660 Tm \(Synthetic S Corp\) Tj/);
      assert.match(packText, /1 0 0 1 72 630 Tm \(Ordinary business income\) Tj/);
      assert.match(packText, /1 0 0 1 192 630 Tm \(100000\.00\) Tj/);
      assert.match(packText, /1 0 0 1 72 600 Tm \(Percentage of stock ownership\) Tj/);
      assert.match(packText, /1 0 0 1 211 600 Tm \(100%\) Tj/);
      assert.match(packText, /1 0 0 1 72 570 Tm \(Distributions\) Tj/);
      assert.match(packText, /1 0 0 1 138 570 Tm \(100000\.00\) Tj/);
    }
    if (pack.id === SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID) {
      assert.match(packText, /U\.S\. Corporation Income Tax Return/);
      assert.match(packText, /1 0 0 1 72 660 Tm \(Name of corporation\) Tj/);
      assert.match(packText, /1 0 0 1 170 660 Tm \(Synthetic C Corp\) Tj/);
      assert.match(packText, /1 0 0 1 72 600 Tm \(Taxable income\) Tj/);
      assert.match(packText, /1 0 0 1 152 600 Tm \(120000\.00\) Tj/);
      assert.match(packText, /1 0 0 1 72 570 Tm \(20 Depreciation\) Tj/);
      assert.match(packText, /1 0 0 1 151 570 Tm \(15000\.00\) Tj/);
    }
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

test('synthetic provider retrieves a deterministic versioned loan without SSN data', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  const first = await connector.retrieveLoanSnapshot(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID);
  const second = await connector.retrieveLoanSnapshot(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 'encompass-loan-snapshot-v1');
  assert.equal(first.simulated, true);
  assert.deepEqual(first.borrowers.map((borrower) => borrower.role), ['BORROWER', 'COBORROWER']);
  assert.equal(first.borrowers[0].employment[0].baseMonthlyIncome, 4000);
  const serialized = JSON.stringify(first);
  assert.equal(/socialSecurity|ssn|taxIdentification/i.test(serialized), false);
  await assert.rejects(
    () => connector.retrieveLoanSnapshot(
      { ...CONTEXT, tenantId: crypto.randomUUID() },
      SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    ),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'SYNTHETIC_LOAN_NOT_FOUND',
  );
});

test('explicit preview approval is required and repeated writes are idempotent', async () => {
  const connector = new SyntheticFreeflowDevConnector();
  const preview = buildEncompassWritePreview({ approvalEventId: APPROVAL_ID, fields: ROUND_TRIP_FIELDS });
  await assert.rejects(
    () => executeApprovedIncomeRoundTrip({
      connector,
      context: CONTEXT,
      loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
      preview,
      reviewerApproval: { approvalEventId: APPROVAL_ID, previewHash: '0'.repeat(64) },
    }),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'ENCOMPASS_WRITE_APPROVAL_MISMATCH',
  );
  assert.equal(connector.mutationCount, 0);

  const first = await executeApprovedIncomeRoundTrip({
    connector,
    context: CONTEXT,
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview,
    reviewerApproval: { approvalEventId: APPROVAL_ID, previewHash: preview.previewHash },
  });
  const second = await executeApprovedIncomeRoundTrip({
    connector,
    context: CONTEXT,
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview,
    reviewerApproval: { approvalEventId: APPROVAL_ID, previewHash: preview.previewHash },
  });
  assert.equal(first.readback.allSucceeded, true);
  assert.deepEqual(second, first);
  assert.equal(connector.mutationCount, 1);
  assert.equal(connector.writeAttemptCount, 2);
  assert.equal(JSON.stringify(first.readback).includes('4000.00'), false);
});

test('simulator reports rejected, unavailable, and conflicting fields independently', async () => {
  const connector = new SyntheticFreeflowDevConnector({
    fieldBehaviors: {
      'CX.FREEFLOW.W2.BASE': 'REJECTED',
      'CX.FREEFLOW.W2.VARIABLE': 'CONFLICT',
      'CX.FREEFLOW.ASSET.INCOME': 'UNAVAILABLE',
    },
  });
  const preview = buildEncompassWritePreview({ approvalEventId: APPROVAL_ID, fields: ROUND_TRIP_FIELDS });
  const result = await executeApprovedIncomeRoundTrip({
    connector,
    context: CONTEXT,
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview,
    reviewerApproval: { approvalEventId: APPROVAL_ID, previewHash: preview.previewHash },
  });
  assert.equal(result.readback.allSucceeded, false);
  assert.deepEqual(Object.fromEntries(result.readback.fields.map((field) => [field.fieldName, field.status])), {
    'CX.FREEFLOW.APPROVAL.ID': 'SUCCESS',
    'CX.FREEFLOW.ASSET.INCOME': 'UNAVAILABLE',
    'CX.FREEFLOW.W2.BASE': 'REJECTED',
    'CX.FREEFLOW.W2.VARIABLE': 'CONFLICT',
  });
});

test('unknown outcome and transient read retry reconcile without a duplicate mutation', async () => {
  const connector = new SyntheticFreeflowDevConnector({
    unknownWriteOutcomeOnce: true,
    readFailuresBeforeSuccess: 1,
  });
  const preview = buildEncompassWritePreview({ approvalEventId: APPROVAL_ID, fields: ROUND_TRIP_FIELDS });
  await assert.rejects(
    () => connector.applyApprovedIncomeUpdate(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, {
      approvalEventId: preview.approvalEventId,
      fields: preview.fields,
    }),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN',
  );
  assert.equal(connector.mutationCount, 1);
  await assert.rejects(
    () => connector.readFields(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, preview.fields.map((field) => field.fieldName)),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'SYNTHETIC_READ_TIMEOUT'
      && error.retryable,
  );
  const actual = await connector.readFields(
    CONTEXT,
    SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview.fields.map((field) => field.fieldName),
  );
  assert.equal(compareEncompassFieldReadback(preview.fields, actual).allSucceeded, true);
  const replay = await connector.applyApprovedIncomeUpdate(CONTEXT, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID, {
    approvalEventId: preview.approvalEventId,
    fields: preview.fields,
  });
  assert.match(replay.providerRevision ?? '', /^synthetic-/);
  assert.equal(connector.mutationCount, 1);
});
