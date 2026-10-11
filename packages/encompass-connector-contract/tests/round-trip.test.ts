import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EncompassConnectorError,
  buildEncompassWritePreview,
  compareEncompassFieldReadback,
  executeApprovedIncomeRoundTrip,
  type EncompassConnector,
} from '../src';

const APPROVAL = '00000000-0000-4000-8000-000000000901';
const CONTEXT = { tenantId: 'tenant', loanId: 'loan', correlationId: 'correlation' };
const FIELDS = [
  { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: APPROVAL },
  { fieldName: 'CX.FREEFLOW.W2.VARIABLE', value: '1600.00' },
] as const;

test('preview is deterministic and a mismatched reviewer approval cannot mutate', async () => {
  const preview = buildEncompassWritePreview({ approvalEventId: APPROVAL, fields: FIELDS });
  assert.deepEqual(preview, buildEncompassWritePreview({
    approvalEventId: APPROVAL,
    fields: [...FIELDS].reverse(),
  }));
  let writes = 0;
  await assert.rejects(
    () => executeApprovedIncomeRoundTrip({
      connector: connector({ apply: async () => { writes += 1; return {}; } }),
      context: CONTEXT,
      loanGuid: 'guid',
      preview,
      reviewerApproval: { approvalEventId: APPROVAL, previewHash: '0'.repeat(64) },
    }),
    (error: unknown) => error instanceof EncompassConnectorError
      && error.safeCode === 'ENCOMPASS_WRITE_APPROVAL_MISMATCH',
  );
  assert.equal(writes, 0);
});

test('round trip requires independent full-field readback before success', async () => {
  const preview = buildEncompassWritePreview({ approvalEventId: APPROVAL, fields: FIELDS });
  const result = await executeApprovedIncomeRoundTrip({
    connector: connector({
      apply: async () => ({ providerRevision: 'revision-1' }),
      read: async () => Object.fromEntries(FIELDS.map((field) => [field.fieldName, field.value])),
    }),
    context: CONTEXT,
    loanGuid: 'guid',
    preview,
    reviewerApproval: { approvalEventId: APPROVAL, previewHash: preview.previewHash },
  });
  assert.equal(result.providerRevision, 'revision-1');
  assert.equal(result.readback.allSucceeded, true);
  assert.equal(result.readback.fields.every((field) => field.status === 'SUCCESS'), true);
  assert.equal(JSON.stringify(result.readback).includes('1600.00'), false);
});

test('readback classification uses closed statuses and hashes only', () => {
  const report = compareEncompassFieldReadback(
    [
      ...FIELDS,
      { fieldName: 'CX.FREEFLOW.ASSET.INCOME', value: '1000.00' },
      { fieldName: 'CX.FREEFLOW.W2.BASE', value: '4000.00' },
    ],
    {
      'CX.FREEFLOW.APPROVAL.ID': APPROVAL,
      'CX.FREEFLOW.W2.VARIABLE': '1599.99',
      'CX.FREEFLOW.W2.BASE': '4000.00',
    },
    [{ fieldName: 'CX.FREEFLOW.W2.BASE', status: 'REJECTED' }],
  );
  assert.deepEqual(report.fields.map((field) => field.status), [
    'SUCCESS', 'CONFLICT', 'UNAVAILABLE', 'REJECTED',
  ]);
  assert.equal(report.allSucceeded, false);
  assert.equal(JSON.stringify(report).includes('1599.99'), false);
  assert.equal(report.fields.every((field) => /^[0-9a-f]{64}$/.test(field.expectedValueSha256)), true);
});

function connector(overrides: Readonly<{
  apply?: EncompassConnector['applyApprovedIncomeUpdate'];
  read?: EncompassConnector['readFields'];
}> = {}): EncompassConnector {
  return {
    kind: 'custom',
    async retrieveLoanSnapshot() {
      throw new Error('not used');
    },
    async listActiveAttachments() { return []; },
    async downloadOriginalAttachment() { throw new Error('not used'); },
    applyApprovedIncomeUpdate: overrides.apply ?? (async () => ({})),
    readFields: overrides.read ?? (async () => ({})),
  };
}
