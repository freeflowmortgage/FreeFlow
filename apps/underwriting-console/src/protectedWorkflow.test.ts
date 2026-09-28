import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveProtectedWorkflowState, readEvidenceFields, type ConsoleContext } from './protectedWorkflow';

const base = {
  loan: { id: 'loan', version: 1, status: 'DRAFT', program: 'CONVENTIONAL', borrowerName: null },
  attachments: [], extractions: [], calculation: null, approval: null, hostWrite: null,
} as unknown as ConsoleContext;

test('derives the protected workflow only from authoritative context and review requirements', () => {
  assert.equal(deriveProtectedWorkflowState(null, null, false), 'NO_LOAN_CONTEXT');
  assert.equal(deriveProtectedWorkflowState(base, [], true), 'BOUND');
  const uploaded = { ...base, attachments: [{ attachmentId: 'a' }] } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(uploaded, [], true), 'DOCUMENT_UPLOADED');
  const extracted = { ...uploaded, extractions: [{ id: 'e', status: 'ACTIVE' }] } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(extracted, null, true), 'EXTRACTED');
  assert.equal(deriveProtectedWorkflowState(extracted, [{ extractionId: 'e', entityId: 'w2', field: 'employmentRole', form: 'W-2' }], true), 'REVIEW_REQUIRED');
  assert.equal(deriveProtectedWorkflowState(extracted, [], true), 'READY_TO_CALCULATE');
  const calculated = { ...extracted, calculation: { id: 'c', current: true } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(calculated, [], true), 'CALCULATED');
  const approved = { ...calculated, approval: { id: 'p', current: true } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(approved, [], false), 'APPROVED');
  assert.equal(deriveProtectedWorkflowState(approved, [], true), 'READY_TO_WRITE');
  const written = { ...approved, hostWrite: { status: 'SUCCEEDED' } } as unknown as ConsoleContext;
  assert.equal(deriveProtectedWorkflowState(written, [], true), 'WRITTEN');
});

test('accepts only bounded persisted coordinate evidence', () => {
  assert.deepEqual(readEvidenceFields({ fields: [
    { collection: 'formExtracts', entityId: 'entity', field: 'ent1-net', pageIndex: 2, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    { collection: 'bad', field: 'outside', pageIndex: 0, box: { x: -1, y: 0, w: 1, h: 1 } },
  ] }), [{ collection: 'formExtracts', entityId: 'entity', field: 'ent1-net', pageIndex: 2, box: [0.1, 0.2, 0.3, 0.04] }]);
});
