import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEncompassWritePreview, type EncompassApprovedIncomeUpdate } from '@mortgage-pos/encompass-connector-contract';
import type { EncompassSyncQueueMessage } from './sync';
import { createSyncRuntimeDependencies, type SyncRuntimeInfrastructure } from './syncWorkerRuntime';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const JOB = '00000000-0000-4000-8000-000000000400';
const preview = buildEncompassWritePreview({
  approvalEventId: APPROVAL,
  fields: [
    { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: APPROVAL },
    { fieldName: 'CX.FREEFLOW.BORROWER.1.INCOME', value: '6000.00' },
    { fieldName: 'CX.FREEFLOW.BORROWER.2.INCOME', value: '3000.00' },
    { fieldName: 'CX.FREEFLOW.INCOME', value: '9000.00' },
  ],
});
const message: EncompassSyncQueueMessage = {
  jobId: JOB, tenantId: TENANT, loanId: LOAN, approvalEventId: APPROVAL,
  expectedLoanVersion: 2, idempotencyKey: 'runtime-sync-key-01', correlationId: 'runtime-request-1',
};
const environment = {
  NODE_ENV: 'test' as const,
  ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example',
  ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'portal-worker',
  ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-signing-key',
};
const extractionBindings = [{
  extractionId: '00000000-0000-4000-8000-000000000302', extractionHash: 'c'.repeat(64),
  sourceDocumentId: '00000000-0000-4000-8000-000000000303', sourceDocumentVersion: 1,
  sourceContentHash: 'd'.repeat(64), metadataReviewId: null, metadataReviewVersion: null,
  metadataReviewHash: null,
  extraction: {
    status: 'ACTIVE', canonicalHash: 'c'.repeat(64), sourceDocumentVersion: 1,
    sourceContentHash: 'd'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'd'.repeat(64) },
    metadataReviews: [],
  },
}];

test('runtime applies only the immutable persisted preview, including borrower fields', async () => {
  let applied: EncompassApprovedIncomeUpdate | undefined;
  let scopedTenant = '';
  const updates: any[] = [];
  const transaction = runtimeTransaction({
    status: 'QUEUED', attemptCount: 0, reconciliationCount: 0,
  }, updates);
  const infrastructure: SyncRuntimeInfrastructure = {
    withTransaction: async (operation) => operation(transaction as never),
    setTenantContext: (async (_transaction, scope) => { scopedTenant = scope.tenantId; }) as never,
    createConnector: () => ({
      kind: 'custom',
      retrieveLoanSnapshot: async () => { throw new Error('not used'); },
      listActiveAttachments: async () => [],
      downloadOriginalAttachment: async () => { throw new Error('not used'); },
      applyApprovedIncomeUpdate: async (_context, _guid, update) => { applied = update; return {}; },
      readFields: async () => ({}),
    }),
  };
  const dependencies = createSyncRuntimeDependencies(environment, infrastructure);
  const claimed = await dependencies.claim(message);
  assert.ok(claimed);
  await dependencies.apply(claimed);

  assert.equal(scopedTenant, TENANT);
  assert.deepEqual(applied, { approvalEventId: APPROVAL, fields: preview.fields });
  assert.equal(updates[0]?.status, 'IN_PROGRESS');
  assert.equal(applied?.fields.some((field) => field.fieldName === 'CX.FREEFLOW.BORROWER.2.INCOME'), true);
});

test('runtime strips legacy value hashes before persisting field readback', async () => {
  const updates: any[] = [];
  const transaction = runtimeTransaction({
    status: 'QUEUED', attemptCount: 0, reconciliationCount: 0,
  }, updates);
  const dependencies = createSyncRuntimeDependencies(environment, {
    withTransaction: async (operation) => operation(transaction as never),
    setTenantContext: (async () => {}) as never,
    createConnector: () => ({
      kind: 'custom',
      retrieveLoanSnapshot: async () => { throw new Error('not used'); },
      listActiveAttachments: async () => [],
      downloadOriginalAttachment: async () => { throw new Error('not used'); },
      applyApprovedIncomeUpdate: async () => ({}),
      readFields: async () => ({}),
    }),
  });
  const claimed = await dependencies.claim(message);
  assert.ok(claimed);

  await dependencies.succeed(claimed, 'revision-1', {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: true,
    fields: preview.fields.map((field) => ({
      fieldName: field.fieldName,
      status: 'SUCCESS',
      reasonCode: 'VALUE_CONFIRMED',
      expectedValueSha256: 'a'.repeat(64),
      actualValueSha256: 'a'.repeat(64),
    })),
  } as never);

  const persisted = updates.at(-1)?.fieldReadback;
  assert.deepEqual(persisted, {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: true,
    fields: preview.fields.map((field) => ({
      fieldName: field.fieldName,
      status: 'SUCCESS',
      reasonCode: 'VALUE_CONFIRMED',
    })),
  });
  assert.doesNotMatch(JSON.stringify(persisted), /ValueSha256/);
});

test('runtime fails closed when the persisted preview is absent or reconciliation is exhausted', async () => {
  for (const scenario of [
    { previewFields: null, status: 'QUEUED', reconciliationCount: 0, safeCode: 'ENCOMPASS_WRITE_PREVIEW_INVALID' },
    { previewFields: preview.fields, status: 'RECONCILING', reconciliationCount: 5, safeCode: 'SYNC_RECONCILIATION_LIMIT_REACHED' },
  ]) {
    const updates: any[] = [];
    const transaction = runtimeTransaction({
      status: scenario.status,
      attemptCount: 0,
      reconciliationCount: scenario.reconciliationCount,
      writePreviewFields: scenario.previewFields,
      writePreviewSchemaVersion: scenario.previewFields ? preview.schemaVersion : null,
      writePreviewHash: scenario.previewFields ? preview.previewHash : null,
    }, updates);
    const dependencies = createSyncRuntimeDependencies(environment, {
      withTransaction: async (operation) => operation(transaction as never),
      setTenantContext: (async () => {}) as never,
      createConnector: () => { throw new Error('connector must not be created'); },
    });
    assert.equal(await dependencies.claim(message), null);
    assert.equal(updates.at(-1)?.status, 'FAILED');
    assert.equal(updates.at(-1)?.safeErrorCode, scenario.safeCode);
  }
});

function runtimeTransaction(overrides: Record<string, unknown>, updates: any[]) {
  const record = {
    id: JOB, tenantId: TENANT, loanId: LOAN, approvalEventId: APPROVAL,
    status: 'QUEUED', attemptCount: 0, reconciliationCount: 0, startedAt: null,
    requestedByUserId: USER, correlationId: message.correlationId, expectedLoanVersion: 2,
    writePreviewSchemaVersion: preview.schemaVersion, writePreviewHash: preview.previewHash,
    writePreviewFields: preview.fields,
    loanApplication: { version: 2, encompassGuid: 'synthetic-encompass-guid' },
    approvalEvent: {
      action: 'INCOME_APPROVED', entityType: 'FORM_1084_AUDIT',
      entityId: CALCULATION, expectedLoanVersion: 1,
    },
    tenant: {
      configurations: { enableEncompassSync: true },
      encompassConnectorBinding: { lenderId: 'lender-a', deploymentId: 'deployment-a', isEnabled: true },
    },
    ...overrides,
  };
  return {
    $executeRaw: async () => 1,
    auditEvent: {
      findFirst: async () => null,
      create: async () => ({}),
    },
    encompassSyncJob: {
      findFirst: async () => record,
      updateMany: async ({ data }: any) => { updates.push(data); return { count: 1 }; },
    },
    form1084Audit: { findFirst: async () => ({ extractionBindings }) },
    loanApplication: { updateMany: async () => ({ count: 1 }) },
  };
}
