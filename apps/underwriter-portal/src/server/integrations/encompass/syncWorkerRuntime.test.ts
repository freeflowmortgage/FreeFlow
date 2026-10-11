import assert from 'node:assert/strict';
import test from 'node:test';
import type { EncompassApprovedIncomeUpdate } from '@mortgage-pos/encompass-connector-contract';
import type { EncompassSyncQueueMessage } from './sync';
import { buildTargetBoundEncompassSyncPreview } from './syncPreview';
import {
  createSyncRuntimeDependencies,
  STALE_SYNC_CLAIM_MS,
  SYNC_MESSAGE_VISIBILITY_SECONDS,
  type SyncRuntimeInfrastructure,
} from './syncWorkerRuntime';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const JOB = '00000000-0000-4000-8000-000000000400';
const preview = buildTargetBoundEncompassSyncPreview({
  approvalEventId: APPROVAL,
  fields: [
    { fieldName: 'CX.FREEFLOW.APPROVAL.ID', value: APPROVAL },
    { fieldName: 'CX.FREEFLOW.BORROWER.1.INCOME', value: '6000.00' },
    { fieldName: 'CX.FREEFLOW.BORROWER.2.INCOME', value: '3000.00' },
    { fieldName: 'CX.FREEFLOW.INCOME', value: '9000.00' },
  ],
  target: {
    integrationMode: 'CUSTOM_CONNECTOR',
    lenderId: 'lender-a',
    deploymentId: 'deployment-a',
    encompassLoanGuid: 'synthetic-encompass-guid',
  },
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
  const loanUpdates: any[] = [];
  const transaction = runtimeTransaction({
    status: 'QUEUED', attemptCount: 0, reconciliationCount: 0,
  }, updates, { loanUpdates });
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

  const finalized = await dependencies.succeed(claimed, 'revision-1', {
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

  assert.equal(finalized, true);
  assert.deepEqual(loanUpdates[0]?.where, {
    id: LOAN,
    tenantId: TENANT,
    version: 2,
    encompassGuid: 'synthetic-encompass-guid',
    encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  });
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

test('claim fails closed and audits exactly once when the approved target or connector mode changes', async () => {
  const scenarios = [
    {
      override: {
        tenant: {
          configurations: { enableEncompassSync: true },
          encompassConnectorBinding: { lenderId: 'lender-b', deploymentId: 'deployment-a', isEnabled: true },
        },
      },
      safeCode: 'ENCOMPASS_WRITE_TARGET_CHANGED',
    },
    {
      override: {
        loanApplication: {
          version: 2,
          encompassGuid: 'changed-encompass-guid',
          encompassIntegrationMode: 'CUSTOM_CONNECTOR',
        },
      },
      safeCode: 'ENCOMPASS_WRITE_TARGET_CHANGED',
    },
    {
      override: {
        loanApplication: {
          version: 2,
          encompassGuid: 'synthetic-encompass-guid',
          encompassIntegrationMode: 'ENCOMPASS_HOSTED',
        },
      },
      safeCode: 'ENCOMPASS_CUSTOM_CONNECTOR_REQUIRED',
    },
  ] as const;

  for (const scenario of scenarios) {
    const updates: any[] = [];
    const audits: any[] = [];
    const transaction = runtimeTransaction(scenario.override, updates, { audits });
    let connectorCreations = 0;
    const dependencies = createSyncRuntimeDependencies(environment, {
      withTransaction: async (operation) => operation(transaction as never),
      setTenantContext: (async () => {}) as never,
      createConnector: () => { connectorCreations += 1; throw new Error('connector must not be created'); },
    });
    const operationalLines: string[] = [];
    const originalInfo = console.info;
    console.info = (line?: unknown) => { operationalLines.push(String(line)); };
    try {
      assert.equal(await dependencies.claim(message), null);
      assert.equal(await dependencies.claim(message), null);
    } finally {
      console.info = originalInfo;
    }

    assert.equal(connectorCreations, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.status, 'FAILED');
    assert.equal(updates[0]?.safeErrorCode, scenario.safeCode);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.action, 'ENCOMPASS_SYNC_FAILED');
    assert.equal(audits[0]?.reasonCode, scenario.safeCode);
    assert.deepEqual(operationalLines.map((line) => JSON.parse(line).code), [scenario.safeCode]);
  }
});

test('successful readback cannot finalize success after a concurrent loan version change', async () => {
  const updates: any[] = [];
  const audits: any[] = [];
  const loanUpdates: any[] = [];
  const transaction = runtimeTransaction({}, updates, { audits, loanUpdates, loanUpdateCount: 0 });
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

  const originalInfo = console.info;
  console.info = () => {};
  let finalized: boolean;
  try {
    finalized = await dependencies.succeed(claimed, 'provider-revision', {
      schemaVersion: 'encompass-field-readback-v1',
      allSucceeded: true,
      fields: preview.fields.map((field) => ({
        fieldName: field.fieldName,
        status: 'SUCCESS',
        reasonCode: 'VALUE_CONFIRMED',
      })),
    });
  } finally {
    console.info = originalInfo;
  }

  assert.equal(finalized, false);
  assert.equal(loanUpdates.length, 1);
  assert.equal(updates.at(-1)?.status, 'FAILED');
  assert.equal(updates.at(-1)?.safeErrorCode, 'STALE_APPROVAL_AFTER_WRITE');
  assert.equal(updates.some((update) => update.status === 'SUCCEEDED'), false);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, 'ENCOMPASS_SYNC_FAILED');
  assert.equal(audits[0]?.reasonCode, 'STALE_APPROVAL_AFTER_WRITE');
});

test('queue visibility outlasts the stale claim threshold and stale reclaims reconcile read-only', async () => {
  assert.ok(SYNC_MESSAGE_VISIBILITY_SECONDS * 1_000 > STALE_SYNC_CLAIM_MS);
  const updates: any[] = [];
  const transaction = runtimeTransaction({
    status: 'IN_PROGRESS',
    startedAt: new Date(Date.now() - STALE_SYNC_CLAIM_MS - 1),
  }, updates);
  const dependencies = createSyncRuntimeDependencies(environment, {
    withTransaction: async (operation) => operation(transaction as never),
    setTenantContext: (async () => {}) as never,
    createConnector: () => ({
      kind: 'custom',
      retrieveLoanSnapshot: async () => { throw new Error('not used'); },
      listActiveAttachments: async () => [],
      downloadOriginalAttachment: async () => { throw new Error('not used'); },
      applyApprovedIncomeUpdate: async () => { throw new Error('reclaimed work must not apply again'); },
      readFields: async () => ({}),
    }),
  });
  const claimed = await dependencies.claim(message);

  assert.ok(claimed);
  assert.equal(claimed.mode, 'RECONCILE');
  assert.equal(updates[0]?.status, 'RECONCILING');
});

function runtimeTransaction(
  overrides: Record<string, unknown>,
  updates: any[],
  options: Readonly<{
    audits?: any[];
    loanUpdates?: any[];
    loanUpdateCount?: number;
    bindingAvailable?: boolean;
    syncEnabled?: boolean;
  }> = {},
) {
  const record = {
    id: JOB, tenantId: TENANT, loanId: LOAN, approvalEventId: APPROVAL,
    status: 'QUEUED', attemptCount: 0, reconciliationCount: 0, startedAt: null,
    requestedByUserId: USER, correlationId: message.correlationId, expectedLoanVersion: 2,
    writePreviewSchemaVersion: preview.schemaVersion, writePreviewHash: preview.previewHash,
    writePreviewFields: preview.fields,
    writeTargetIntegrationMode: preview.target.integrationMode,
    writeTargetLenderId: preview.target.lenderId,
    writeTargetDeploymentId: preview.target.deploymentId,
    writeTargetEncompassGuid: preview.target.encompassLoanGuid,
    loanApplication: {
      version: 2,
      encompassGuid: 'synthetic-encompass-guid',
      encompassIntegrationMode: 'CUSTOM_CONNECTOR',
    },
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
  let currentStatus = record.status;
  return {
    $executeRaw: async () => 1,
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: any) => { options.audits?.push(data); return data; },
    },
    encompassSyncJob: {
      findFirst: async ({ where }: any) => {
        const allowedStatuses = where?.status?.in;
        if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(currentStatus)) return null;
        return { ...record, status: currentStatus };
      },
      updateMany: async ({ where, data }: any) => {
        const expectedStatus = where?.status;
        const matches = typeof expectedStatus === 'string'
          ? currentStatus === expectedStatus
          : !Array.isArray(expectedStatus?.in) || expectedStatus.in.includes(currentStatus);
        if (!matches) return { count: 0 };
        updates.push(data);
        if (typeof data.status === 'string') currentStatus = data.status;
        return { count: 1 };
      },
    },
    form1084Audit: { findFirst: async () => ({ extractionBindings }) },
    tenantConfiguration: {
      findFirst: async () => ({ enableEncompassSync: options.syncEnabled ?? true }),
    },
    encompassConnectorBinding: {
      findFirst: async () => options.bindingAvailable === false ? null : ({ id: 'binding-id' }),
    },
    loanApplication: {
      updateMany: async (input: any) => {
        options.loanUpdates?.push(input);
        return { count: options.loanUpdateCount ?? 1 };
      },
    },
  };
}
