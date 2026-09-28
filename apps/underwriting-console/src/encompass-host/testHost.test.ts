import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassHostError } from './bridge';
import { createDeterministicTestHost } from './testHost';

const GUID = '00000000-0000-4000-8000-00000000d001';
const FIELDS = { 'CX.FREEFLOW.INCOME': '8000.00', 'CX.FREEFLOW.APPROVAL.ID': 'approval-1' };

test('deterministic host writes, calculates, commits, and reads back the approval marker', async () => {
  const host = createDeterministicTestHost(GUID);
  assert.equal((await host.bridge.activeLoan()).loanGuid, GUID);
  await host.bridge.writeApprovedResult(GUID, FIELDS);
  assert.deepEqual(host.snapshot().calls, ['setFields', 'calculate', 'commit']);
  assert.equal(host.snapshot().fields['CX.FREEFLOW.APPROVAL.ID'], 'approval-1');
});

test('deterministic host preserves read-only, changed-loan, malformed-map, and commit failures', async () => {
  await assert.rejects(() => createDeterministicTestHost(GUID, 'read-only').bridge.writeApprovedResult(GUID, FIELDS), (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_LOAN_READ_ONLY');
  const changed = createDeterministicTestHost(GUID, 'changed-loan'); await changed.bridge.activeLoan();
  await assert.rejects(() => changed.bridge.writeApprovedResult(GUID, FIELDS), (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_LOAN_CONTEXT_CHANGED');
  await assert.rejects(() => createDeterministicTestHost(GUID).bridge.writeApprovedResult(GUID, { BORROWER_NAME: 'forbidden' }), (error: unknown) => error instanceof EncompassHostError && error.code === 'ENCOMPASS_FIELD_NOT_ALLOWED');
  await assert.rejects(() => createDeterministicTestHost(GUID, 'commit-failure').bridge.writeApprovedResult(GUID, FIELDS), /TEST_HOST_COMMIT_FAILURE/);
});
