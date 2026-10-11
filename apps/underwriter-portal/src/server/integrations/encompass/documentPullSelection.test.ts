import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentSelectionBindingHash,
  buildPersistedDocumentPullSelection,
  restorePersistedDocumentPullSelection,
} from './documentPullSelection';

const identity = {
  tenantId: '00000000-0000-4000-8000-000000000100',
  loanId: '00000000-0000-4000-8000-000000000200',
};
const target = {
  integrationMode: 'CUSTOM_CONNECTOR' as const,
  lenderId: 'synthetic-lender',
  deploymentId: 'synthetic-deployment',
  encompassLoanGuid: 'synthetic-loan-guid',
};

test('attachment list binding changes with every exact connector target component', () => {
  const original = buildDocumentSelectionBindingHash({ ...identity, target });
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.notEqual(original, buildDocumentSelectionBindingHash({
    ...identity,
    target: { ...target, lenderId: 'other-lender' },
  }));
  assert.notEqual(original, buildDocumentSelectionBindingHash({
    ...identity,
    target: { ...target, deploymentId: 'other-deployment' },
  }));
  assert.notEqual(original, buildDocumentSelectionBindingHash({
    ...identity,
    target: { ...target, encompassLoanGuid: 'other-guid' },
  }));
});

test('persisted selection is canonical and rejects legacy or tampered jobs', () => {
  const selection = buildPersistedDocumentPullSelection({
    ...identity,
    target,
    attachmentIds: ['attachment-2', 'attachment-1'],
  });
  assert.deepEqual(selection.attachmentIds, ['attachment-1', 'attachment-2']);
  assert.deepEqual(restorePersistedDocumentPullSelection({
    ...identity,
    schemaVersion: selection.schemaVersion,
    hash: selection.hash,
    targetIntegrationMode: selection.target.integrationMode,
    targetLenderId: selection.target.lenderId,
    targetDeploymentId: selection.target.deploymentId,
    targetEncompassGuid: selection.target.encompassLoanGuid,
    attachmentIds: selection.attachmentIds,
  }), selection);
  assert.equal(restorePersistedDocumentPullSelection({
    ...identity,
    schemaVersion: selection.schemaVersion,
    hash: selection.hash,
    targetIntegrationMode: selection.target.integrationMode,
    targetLenderId: selection.target.lenderId,
    targetDeploymentId: selection.target.deploymentId,
    targetEncompassGuid: selection.target.encompassLoanGuid,
    attachmentIds: ['attachment-1'],
  }), null);
  assert.equal(restorePersistedDocumentPullSelection({
    ...identity,
    schemaVersion: null,
    hash: null,
    targetIntegrationMode: null,
    targetLenderId: null,
    targetDeploymentId: null,
    targetEncompassGuid: null,
    attachmentIds: ['attachment-1'],
  }), null);
});
