import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPersistableParserExtraction } from './persistedParserExtraction';
import { EncompassApiError } from './encompassApi';
import { runDocumentPullJob } from './documentPullWorker';
import {
  DOCUMENT_PULL_MAX_ATTEMPTS,
  DOCUMENT_PULL_STALE_AFTER_MS,
  DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS,
  createRuntimeDependencies,
  documentPullClaimDecision,
  persistParsedExtraction,
} from './documentPullWorkerRuntime';
import { buildPersistedDocumentPullSelection } from './documentPullSelection';

const job = {
  jobId: 'job', tenantId: '00000000-0000-4000-8000-000000000100',
  loanId: '00000000-0000-4000-8000-000000000200', correlationId: 'request',
  encompassLoanGuid: 'guid', lenderId: 'lender', deploymentId: 'deployment', selectedAttachmentIds: ['attachment-1'],
};
const result = {
  attachmentId: 'attachment-1', sha256: 'a'.repeat(64),
  parsed: {
    pageCount: 1, documentCategory: 'W2_WAGE', parserVersion: 'income-parser-v5', confidence: 98,
    extraction: {
      schemaVersion: 'income-extraction-v1' as const,
      normalizedInput: { w2Employers: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', role: 'CURRENT', year: 2025, annualWages: 120000 }] },
      evidence: { fields: [] }, warnings: ['W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED'], canonicalHash: 'b'.repeat(64),
    },
  },
};

type DurableDocumentPullState = {
  status: 'QUEUED' | 'RETRYABLE_FAILURE' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  attemptCount: number;
  startedAt: Date | null;
  claimToken: string | null;
  workingLoanVersion: number;
  loanVersion: number;
  processedAttachmentIds: string[];
  processedByteCount: number;
  processedPageCount: number;
  safeErrorCode: string | null;
  documentPullEnabled: boolean;
  bindingLenderId: string;
  bindingDeploymentId: string;
  bindingEnabled: boolean;
  encompassLoanGuid: string;
};

function createDurableDocumentPullHarness(input: Readonly<{
  state?: Partial<DurableDocumentPullState>;
  beforeClaimCas?: (state: DurableDocumentPullState) => void;
}> = {}) {
  const selectedAttachmentIds = ['attachment-1', 'attachment-2'];
  const selection = buildPersistedDocumentPullSelection({
    tenantId: job.tenantId,
    loanId: job.loanId,
    target: {
      integrationMode: 'CUSTOM_CONNECTOR',
      lenderId: 'lender',
      deploymentId: 'deployment',
      encompassLoanGuid: 'guid',
    },
    attachmentIds: selectedAttachmentIds,
  });
  const state: DurableDocumentPullState = {
    status: 'QUEUED',
    attemptCount: 0,
    startedAt: null,
    claimToken: null,
    workingLoanVersion: 1,
    loanVersion: 1,
    processedAttachmentIds: [],
    processedByteCount: 0,
    processedPageCount: 0,
    safeErrorCode: null,
    documentPullEnabled: true,
    bindingLenderId: 'lender',
    bindingDeploymentId: 'deployment',
    bindingEnabled: true,
    encompassLoanGuid: 'guid',
    ...input.state,
  };
  const documents = new Map<string, {
    id: string;
    version: number;
    sourceContentHash: string;
    sourceAttachmentId: string;
  }>();
  const extractions = new Map<string, string>();
  const persistedAttachmentIds: string[] = [];
  const auditRows: Array<Record<string, unknown>> = [];
  let claimCasHookPending = Boolean(input.beforeClaimCas);

  const record = () => ({
    id: job.jobId,
    tenantId: job.tenantId,
    loanId: job.loanId,
    status: state.status,
    attemptCount: state.attemptCount,
    startedAt: state.startedAt,
    claimToken: state.claimToken,
    requestedByUserId: '00000000-0000-4000-8000-000000000300',
    expectedLoanVersion: 1,
    correlationId: job.correlationId,
    loanApplication: {
      version: state.loanVersion,
      encompassGuid: state.encompassLoanGuid,
      encompassIntegrationMode: 'CUSTOM_CONNECTOR',
    },
    selectedAttachmentIds: [...selectedAttachmentIds],
    processedAttachmentIds: [...state.processedAttachmentIds],
    processedByteCount: state.processedByteCount,
    processedPageCount: state.processedPageCount,
    workingLoanVersion: state.workingLoanVersion,
    selectionSchemaVersion: selection.schemaVersion,
    selectionHash: selection.hash,
    selectionTargetIntegrationMode: selection.target.integrationMode,
    selectionTargetLenderId: selection.target.lenderId,
    selectionTargetDeploymentId: selection.target.deploymentId,
    selectionTargetEncompassGuid: selection.target.encompassLoanGuid,
    tenant: {
      configurations: { enableEncompassDocumentPull: state.documentPullEnabled },
      encompassConnectorBinding: {
        lenderId: state.bindingLenderId,
        deploymentId: state.bindingDeploymentId,
        isEnabled: state.bindingEnabled,
      },
    },
  });

  const transaction = {
    $executeRaw: async () => 1,
    encompassDocumentPullJob: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => matchesDocumentPullWhere(record(), where) ? record() : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (claimCasHookPending && isIncrement(data.attemptCount)) {
          claimCasHookPending = false;
          input.beforeClaimCas?.(state);
        }
        if (!matchesDocumentPullWhere(record(), where)) return { count: 0 };
        if (isIncrement(data.attemptCount)) state.attemptCount += data.attemptCount.increment;
        if (typeof data.status === 'string') state.status = data.status as DurableDocumentPullState['status'];
        const startedAt = data.startedAt;
        const claimToken = data.claimToken;
        const safeErrorCode = data.safeErrorCode;
        if (startedAt === null) state.startedAt = null;
        else if (startedAt instanceof Date) state.startedAt = startedAt;
        if (claimToken === null) state.claimToken = null;
        else if (typeof claimToken === 'string') state.claimToken = claimToken;
        if (safeErrorCode === null) state.safeErrorCode = null;
        else if (typeof safeErrorCode === 'string') state.safeErrorCode = safeErrorCode;
        if (typeof data.workingLoanVersion === 'number') state.workingLoanVersion = data.workingLoanVersion;
        if (Array.isArray(data.processedAttachmentIds)) state.processedAttachmentIds = [...data.processedAttachmentIds];
        if (typeof data.processedByteCount === 'number') state.processedByteCount = data.processedByteCount;
        if (typeof data.processedPageCount === 'number') state.processedPageCount = data.processedPageCount;
        return { count: 1 };
      },
    },
    loanDocument: {
      findFirst: async ({ where }: { where: { sourceAttachmentId: string } }) => documents.get(where.sourceAttachmentId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const sourceAttachmentId = String(data.sourceAttachmentId);
        const document = {
          id: String(data.id),
          version: 1,
          sourceContentHash: String(data.sourceContentHash),
          sourceAttachmentId,
        };
        documents.set(sourceAttachmentId, document);
        return document;
      },
      update: async ({ where, data }: { where: { tenantId_id: { id: string } }; data: Record<string, unknown> }) => {
        const document = [...documents.values()].find((candidate) => candidate.id === where.tenantId_id.id);
        assert.ok(document);
        if (isIncrement(data.version)) document.version += data.version.increment;
        if (typeof data.sourceContentHash === 'string') document.sourceContentHash = data.sourceContentHash;
        return document;
      },
    },
    incomeExtraction: {
      findUnique: async ({ where }: { where: Record<string, Record<string, unknown>> }) => {
        const key = extractionKey(where.tenantId_sourceDocumentId_sourceDocumentVersion_parserVersion);
        const canonicalHash = extractions.get(key);
        return canonicalHash ? { canonicalHash } : null;
      },
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const key = extractionKey(data);
        extractions.set(key, String(data.canonicalHash));
        persistedAttachmentIds.push(String(data.sourceAttachmentId));
        return { id: `extraction-${extractions.size}` };
      },
    },
    loanApplication: {
      updateMany: async ({ where }: { where: { version?: number } }) => {
        if (where.version !== undefined && where.version !== state.loanVersion) return { count: 0 };
        state.loanVersion += 1;
        return { count: 1 };
      },
    },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return data;
      },
    },
  };

  return { state, transaction, documents, persistedAttachmentIds, auditRows };
}

function matchesDocumentPullWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, expected]) => {
    if (field === 'AND' && Array.isArray(expected)) {
      return expected.every((entry) => matchesDocumentPullWhere(record, entry as Record<string, unknown>));
    }
    const actual = record[field];
    if (isRecordValue(expected) && Array.isArray(expected.in)) return expected.in.includes(actual);
    if (isRecordValue(expected) && Object.hasOwn(expected, 'equals')) return valuesEqual(actual, expected.equals);
    return valuesEqual(actual, expected);
  });
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
  if (Array.isArray(actual) && Array.isArray(expected)) return JSON.stringify(actual) === JSON.stringify(expected);
  return actual === expected;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function isIncrement(value: unknown): value is { increment: number } {
  return isRecordValue(value) && typeof value.increment === 'number';
}

function extractionKey(value: Record<string, unknown>): string {
  return `${value.tenantId}:${value.sourceDocumentId}:${value.sourceDocumentVersion}:${value.parserVersion}`;
}

test('legacy, stale-version, and disabled-configuration claims fail terminally with one audit and no connector I/O', async () => {
  const selection = buildPersistedDocumentPullSelection({
    tenantId: job.tenantId,
    loanId: job.loanId,
    target: {
      integrationMode: 'CUSTOM_CONNECTOR',
      lenderId: 'lender',
      deploymentId: 'deployment',
      encompassLoanGuid: 'guid',
    },
    attachmentIds: ['attachment-1'],
  });
  const cases = [
    {
      name: 'legacy targetless job',
      code: 'ENCOMPASS_DOCUMENT_SELECTION_INVALID',
      override: {
        selectionSchemaVersion: null,
        selectionHash: null,
        selectionTargetIntegrationMode: null,
        selectionTargetLenderId: null,
        selectionTargetDeploymentId: null,
        selectionTargetEncompassGuid: null,
        workingLoanVersion: null,
      },
    },
    {
      name: 'stale loan version',
      code: 'STALE_LOAN_VERSION',
      override: { loanApplication: { version: 2, encompassGuid: 'guid', encompassIntegrationMode: 'CUSTOM_CONNECTOR' } },
    },
    {
      name: 'disabled configuration',
      code: 'ENCOMPASS_CONFIGURATION_INCOMPLETE',
      override: {
        tenant: {
          configurations: { enableEncompassDocumentPull: false },
          encompassConnectorBinding: { lenderId: 'lender', deploymentId: 'deployment', isEnabled: true },
        },
      },
    },
  ] as const;

  for (const item of cases) {
    let terminalUpdate: Record<string, unknown> | undefined;
    const auditRows: Array<Record<string, unknown>> = [];
    let connectorCreated = false;
    const record = {
      id: job.jobId,
      tenantId: job.tenantId,
      loanId: job.loanId,
      status: 'QUEUED',
      attemptCount: 0,
      startedAt: null,
      claimToken: null,
      requestedByUserId: '00000000-0000-4000-8000-000000000300',
      expectedLoanVersion: 1,
      correlationId: job.correlationId,
      loanApplication: { version: 1, encompassGuid: 'guid', encompassIntegrationMode: 'CUSTOM_CONNECTOR' },
      selectedAttachmentIds: ['attachment-1'],
      processedAttachmentIds: [],
      processedByteCount: 0,
      processedPageCount: 0,
      workingLoanVersion: 1,
      selectionSchemaVersion: selection.schemaVersion,
      selectionHash: selection.hash,
      selectionTargetIntegrationMode: selection.target.integrationMode,
      selectionTargetLenderId: selection.target.lenderId,
      selectionTargetDeploymentId: selection.target.deploymentId,
      selectionTargetEncompassGuid: selection.target.encompassLoanGuid,
      tenant: {
        configurations: { enableEncompassDocumentPull: true },
        encompassConnectorBinding: { lenderId: 'lender', deploymentId: 'deployment', isEnabled: true },
      },
      ...item.override,
    };
    const transaction = {
      $executeRaw: async () => 1,
      encompassDocumentPullJob: {
        findFirst: async () => record,
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          terminalUpdate = data;
          return { count: 1 };
        },
      },
      auditEvent: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          auditRows.push(data);
          return data;
        },
      },
    };
    const dependencies = createRuntimeDependencies({
      NODE_ENV: 'test',
      DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
      ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
      ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
      ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
    }, {
      withTransaction: async (operation) => operation(transaction as never),
      setTenantContext: async () => undefined,
      createConnector: () => { connectorCreated = true; return {} as never; },
      parse: async () => assert.fail('parser must not run during claim'),
    });
    const lines: string[] = [];
    const originalInfo = console.info;
    console.info = (line?: unknown) => { lines.push(String(line)); };
    try {
      assert.equal(await dependencies.claim({
        jobId: job.jobId,
        tenantId: job.tenantId,
        loanId: job.loanId,
        expectedLoanVersion: 1,
        correlationId: job.correlationId,
      }), null, item.name);
    } finally {
      console.info = originalInfo;
    }
    assert.equal(terminalUpdate?.status, 'FAILED', item.name);
    assert.equal(terminalUpdate?.safeErrorCode, item.code, item.name);
    assert.equal(connectorCreated, false, item.name);
    assert.equal(auditRows.length, 1, item.name);
    assert.equal(auditRows[0]?.action, 'ENCOMPASS_DOCUMENT_PULL_FAILED', item.name);
    assert.equal(auditRows[0]?.reasonCode, item.code, item.name);
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{
      source: 'freeflow', event: 'document_pull_failure', code: item.code,
    }], item.name);
  }
});

test('successful finalization appends one audit and emits one safe operational event', async () => {
  let state: 'IN_PROGRESS' | 'SUCCEEDED' = 'IN_PROGRESS';
  const auditRows: Array<Record<string, unknown>> = [];
  const terminalUpdates: Array<Record<string, unknown>> = [];
  const runtimeJob = {
    ...job,
    requestedByUserId: '00000000-0000-4000-8000-000000000300',
    expectedLoanVersion: 1,
    claimToken: '00000000-0000-4000-8000-000000000400',
    totalAttachmentCount: 2,
    processedCount: 0,
    processedByteCount: 0,
    processedPageCount: 0,
    selectedAttachmentIds: ['attachment-1', 'attachment-2'],
    target: {
      integrationMode: 'CUSTOM_CONNECTOR' as const,
      lenderId: 'lender',
      deploymentId: 'deployment',
      encompassLoanGuid: 'guid',
    },
  };
  const terminalRecord = {
    id: job.jobId,
    tenantId: job.tenantId,
    loanId: job.loanId,
    requestedByUserId: runtimeJob.requestedByUserId,
    correlationId: job.correlationId,
    expectedLoanVersion: 1,
    selectedAttachmentIds: ['attachment-1', 'attachment-2'],
    processedAttachmentIds: ['attachment-1', 'attachment-2'],
    processedByteCount: 2,
    processedPageCount: 2,
    workingLoanVersion: 3,
    loanApplication: { version: 3, encompassGuid: 'guid', encompassIntegrationMode: 'CUSTOM_CONNECTOR' },
    tenant: {
      configurations: { enableEncompassDocumentPull: true },
      encompassConnectorBinding: { lenderId: 'lender', deploymentId: 'deployment', isEnabled: true },
    },
  };
  const transaction = {
    $executeRaw: async () => 1,
    encompassDocumentPullJob: {
      findFirst: async () => state === 'IN_PROGRESS' ? terminalRecord : null,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        terminalUpdates.push(data);
        state = 'SUCCEEDED';
        return { count: 1 };
      },
    },
    auditEvent: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data);
        return data;
      },
    },
  };
  const dependencies = createRuntimeDependencies({
    NODE_ENV: 'test',
    DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
    ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
    ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
    ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
  }, {
    withTransaction: async (operation) => operation(transaction as never),
    setTenantContext: async () => undefined,
    createConnector: () => assert.fail('finalization must not create a connector'),
    parse: async () => assert.fail('finalization must not parse'),
  });
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (line?: unknown) => { lines.push(String(line)); };
  try {
    assert.equal(await dependencies.succeed(runtimeJob, 2, 2), 'SUCCEEDED');
    assert.equal(await dependencies.succeed(runtimeJob, 2, 2), 'FAILED');
  } finally {
    console.info = originalInfo;
  }
  assert.equal(terminalUpdates.length, 1);
  assert.equal(terminalUpdates[0]?.status, 'SUCCEEDED');
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0]?.action, 'ENCOMPASS_DOCUMENT_PULL_SUCCEEDED');
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{
    source: 'freeflow', event: 'document_pull_success', code: 'DOCUMENT_PULL_SUCCEEDED',
  }]);
});

test('runtime redelivery resumes from durable attachment progress without extracting attachment one twice', async () => {
  const harness = createDurableDocumentPullHarness();
  const downloadedAttachmentIds: string[] = [];
  let attachmentTwoUnavailable = true;
  const dependencies = createRuntimeDependencies({
    NODE_ENV: 'test',
    DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
    ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
    ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
    ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
  }, {
    withTransaction: async (operation) => operation(harness.transaction as never),
    setTenantContext: async () => undefined,
    createConnector: () => ({
      listActiveAttachments: async () => [{ id: 'attachment-1' }, { id: 'attachment-2' }],
      downloadOriginalAttachment: async (_context: unknown, _loanGuid: string, attachmentId: string) => {
        downloadedAttachmentIds.push(attachmentId);
        if (attachmentId === 'attachment-2' && attachmentTwoUnavailable) {
          attachmentTwoUnavailable = false;
          throw new EncompassApiError('ENCOMPASS_API_FAILED_503', 'Synthetic connector outage.', true);
        }
        return {
          bytes: new Uint8Array([attachmentId === 'attachment-1' ? 1 : 2]),
          sha256: (attachmentId === 'attachment-1' ? '1' : '2').repeat(64),
        };
      },
    }) as never,
    parse: async () => ({
      pageCount: 1,
      documentCategory: 'W2_WAGE',
      parserVersion: 'income-parser-v5',
      confidence: 98,
      extraction: {
        schemaVersion: 'income-extraction-v2',
        normalizedInput: {
          w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000 }],
        },
        evidence: { fields: [] },
        warnings: [],
        canonicalHash: 'b'.repeat(64),
      },
    }),
  });
  const message = {
    jobId: job.jobId,
    tenantId: job.tenantId,
    loanId: job.loanId,
    expectedLoanVersion: 1,
    correlationId: job.correlationId,
  };
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = () => undefined;
  console.info = () => undefined;
  try {
    assert.equal(await runDocumentPullJob(message, dependencies), 'RETRYABLE_FAILURE');
    assert.equal(harness.state.status, 'RETRYABLE_FAILURE');
    assert.deepEqual(harness.state.processedAttachmentIds, ['attachment-1']);
    assert.equal(harness.state.workingLoanVersion, 2);
    assert.equal(harness.state.loanVersion, 2);
    assert.deepEqual(harness.persistedAttachmentIds, ['attachment-1']);

    assert.equal(await runDocumentPullJob(message, dependencies), 'SUCCEEDED');
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }

  assert.equal(harness.state.status, 'SUCCEEDED');
  assert.deepEqual(harness.state.processedAttachmentIds, ['attachment-1', 'attachment-2']);
  assert.equal(harness.state.workingLoanVersion, 3);
  assert.equal(harness.state.loanVersion, 3);
  assert.deepEqual(harness.persistedAttachmentIds, ['attachment-1', 'attachment-2']);
  assert.deepEqual(downloadedAttachmentIds, ['attachment-1', 'attachment-2', 'attachment-2']);
  assert.equal(harness.auditRows.length, 1);
  assert.equal(harness.auditRows[0]?.action, 'ENCOMPASS_DOCUMENT_PULL_SUCCEEDED');
});

test('authorization drift after claim blocks list and download before connector I/O', async () => {
  const cases = [
    {
      name: 'document pull disabled before list',
      mutate: (state: DurableDocumentPullState) => { state.documentPullEnabled = false; },
      invoke: (dependencies: ReturnType<typeof createRuntimeDependencies>, claimed: NonNullable<Awaited<ReturnType<ReturnType<typeof createRuntimeDependencies>['claim']>>>) => dependencies.listAttachments(claimed),
    },
    {
      name: 'connector retargeted before download',
      mutate: (state: DurableDocumentPullState) => { state.bindingDeploymentId = 'replacement-deployment'; },
      invoke: (dependencies: ReturnType<typeof createRuntimeDependencies>, claimed: NonNullable<Awaited<ReturnType<ReturnType<typeof createRuntimeDependencies>['claim']>>>) => dependencies.download(claimed, 'attachment-1'),
    },
  ] as const;

  for (const item of cases) {
    const harness = createDurableDocumentPullHarness();
    let connectorCreated = 0;
    let connectorCalls = 0;
    const dependencies = createRuntimeDependencies({
      NODE_ENV: 'test',
      DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
      ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
      ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
      ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
    }, {
      withTransaction: async (operation) => operation(harness.transaction as never),
      setTenantContext: async () => undefined,
      createConnector: () => {
        connectorCreated += 1;
        return {
          listActiveAttachments: async () => { connectorCalls += 1; return []; },
          downloadOriginalAttachment: async () => {
            connectorCalls += 1;
            return { bytes: new Uint8Array([1]), sha256: '1'.repeat(64) };
          },
        } as never;
      },
      parse: async () => assert.fail('parser must not run'),
    });
    const claimed = await dependencies.claim({
      jobId: job.jobId,
      tenantId: job.tenantId,
      loanId: job.loanId,
      expectedLoanVersion: 1,
      correlationId: job.correlationId,
    });
    assert.ok(claimed, item.name);
    item.mutate(harness.state);

    await assert.rejects(
      item.invoke(dependencies, claimed),
      (error: { safeCode?: string }) => error.safeCode === 'ENCOMPASS_DOCUMENT_TARGET_CHANGED',
      item.name,
    );
    assert.equal(connectorCreated, 0, item.name);
    assert.equal(connectorCalls, 0, item.name);
  }
});

test('authorization drift after parse rejects save before durable document, extraction, or progress writes', async () => {
  const cases = [
    {
      name: 'document pull disabled before save',
      mutate: (state: DurableDocumentPullState) => { state.documentPullEnabled = false; },
    },
    {
      name: 'connector retargeted before save',
      mutate: (state: DurableDocumentPullState) => { state.bindingLenderId = 'replacement-lender'; },
    },
  ] as const;

  for (const item of cases) {
    const harness = createDurableDocumentPullHarness();
    let connectorCalls = 0;
    const dependencies = createRuntimeDependencies({
      NODE_ENV: 'test',
      DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
      ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
      ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
      ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
    }, {
      withTransaction: async (operation) => operation(harness.transaction as never),
      setTenantContext: async () => undefined,
      createConnector: () => ({
        listActiveAttachments: async () => { connectorCalls += 1; return [{ id: 'attachment-1' }]; },
        downloadOriginalAttachment: async () => {
          connectorCalls += 1;
          return { bytes: new Uint8Array([1]), sha256: '1'.repeat(64) };
        },
      }) as never,
      parse: async () => ({
        pageCount: 1,
        documentCategory: 'W2_WAGE',
        parserVersion: 'income-parser-v5',
        confidence: 98,
        extraction: {
          schemaVersion: 'income-extraction-v2',
          normalizedInput: {
            w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 120000 }],
          },
          evidence: { fields: [] },
          warnings: [],
          canonicalHash: 'b'.repeat(64),
        },
      }),
    });
    const claimed = await dependencies.claim({
      jobId: job.jobId,
      tenantId: job.tenantId,
      loanId: job.loanId,
      expectedLoanVersion: 1,
      correlationId: job.correlationId,
    });
    assert.ok(claimed, item.name);
    await dependencies.listAttachments(claimed);
    const downloaded = await dependencies.download(claimed, 'attachment-1');
    const parsed = await dependencies.parse(downloaded.bytes);
    item.mutate(harness.state);
    try {
      await assert.rejects(
        dependencies.saveResult(claimed, {
          attachmentId: 'attachment-1',
          sha256: downloaded.sha256,
          byteCount: downloaded.bytes.byteLength,
          parsed,
        }),
        (error: { safeCode?: string }) => error.safeCode === 'ENCOMPASS_DOCUMENT_TARGET_CHANGED',
        item.name,
      );
    } finally {
      downloaded.bytes.fill(0);
    }

    assert.equal(connectorCalls, 2, item.name);
    assert.equal(harness.documents.size, 0, item.name);
    assert.deepEqual(harness.persistedAttachmentIds, [], item.name);
    assert.deepEqual(harness.state.processedAttachmentIds, [], item.name);
    assert.equal(harness.state.processedByteCount, 0, item.name);
    assert.equal(harness.state.processedPageCount, 0, item.name);
    assert.equal(harness.state.workingLoanVersion, 1, item.name);
    assert.equal(harness.state.loanVersion, 1, item.name);
  }
});

test('stale reclaim CAS rejects both durable progress and working-version advancement after its read', async () => {
  const races = [
    {
      name: 'idempotent extraction advances only the durable progress snapshot',
      advance: (state: DurableDocumentPullState) => {
        state.processedAttachmentIds = ['attachment-1'];
        state.processedByteCount = 1;
        state.processedPageCount = 1;
      },
    },
    {
      name: 'new extraction advances the job-owned working loan version',
      advance: (state: DurableDocumentPullState) => {
        state.workingLoanVersion = 2;
        state.loanVersion = 2;
      },
    },
  ] as const;

  for (const race of races) {
    let connectorCreated = false;
    const priorClaimToken = '00000000-0000-4000-8000-000000000400';
    const harness = createDurableDocumentPullHarness({
      state: {
        status: 'IN_PROGRESS',
        attemptCount: 1,
        startedAt: new Date(Date.now() - DOCUMENT_PULL_STALE_AFTER_MS - 1),
        claimToken: priorClaimToken,
      },
      beforeClaimCas: race.advance,
    });
    const dependencies = createRuntimeDependencies({
      NODE_ENV: 'test',
      DOC_PARSER_SERVICE_URL: 'https://parser.example.test',
      ENCOMPASS_CONNECTOR_SERVICE_URL: 'https://connector.example.test',
      ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID: 'synthetic-service',
      ENCOMPASS_CONNECTOR_SIGNING_KEY: 'synthetic-key',
    }, {
      withTransaction: async (operation) => operation(harness.transaction as never),
      setTenantContext: async () => undefined,
      createConnector: () => { connectorCreated = true; return {} as never; },
      parse: async () => assert.fail('parser must not run during claim'),
    });

    assert.equal(await dependencies.claim({
      jobId: job.jobId,
      tenantId: job.tenantId,
      loanId: job.loanId,
      expectedLoanVersion: 1,
      correlationId: job.correlationId,
    }), null, race.name);
    assert.equal(harness.state.claimToken, priorClaimToken, race.name);
    assert.equal(harness.state.attemptCount, 1, race.name);
    assert.equal(connectorCreated, false, race.name);
  }
});

test('document-pull claim recovery waits for active work and reclaims only after visibility expiry', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS + 1), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'ACTIVE');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'CLAIM');
  assert.ok(DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS * 1_000 > DOCUMENT_PULL_STALE_AFTER_MS);
});

test('document-pull retry exhaustion becomes terminal instead of remaining retryable forever', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'RETRYABLE_FAILURE', attemptCount: DOCUMENT_PULL_MAX_ATTEMPTS, startedAt: null, encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'EXHAUSTED');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: DOCUMENT_PULL_MAX_ATTEMPTS,
    startedAt: new Date(now - DOCUMENT_PULL_STALE_AFTER_MS), encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'EXHAUSTED');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: null, encompassIntegrationMode: 'CUSTOM_CONNECTOR',
  }, now), 'INVALID');
});

test('document-pull claim rejects hosted loans before custom connector work can begin', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  assert.equal(documentPullClaimDecision({
    status: 'QUEUED', attemptCount: 0, startedAt: null, encompassIntegrationMode: 'ENCOMPASS_HOSTED',
  }, now), 'WRONG_INTEGRATION_MODE');
  assert.equal(documentPullClaimDecision({
    status: 'IN_PROGRESS', attemptCount: 1, startedAt: new Date(now), encompassIntegrationMode: 'ENCOMPASS_HOSTED',
  }, now), 'WRONG_INTEGRATION_MODE');
});

test('repeated parser persistence is idempotent for the same document version and canonical hash', async () => {
  let created = false;
  let loanUpdated = false;
  let versionIncremented = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        versionIncremented = Object.hasOwn(data, 'version');
        return { id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId };
      },
      create: async () => assert.fail('must not insert a new document for the same attachment'),
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: result.parsed.extraction.canonicalHash }),
      updateMany: async () => assert.fail('must not supersede an idempotent extraction'),
      create: async () => { created = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never);
  assert.equal(created, false);
  assert.equal(loanUpdated, false);
  assert.equal(versionIncremented, false);
});

test('a new source hash atomically advances the job-owned expected loan version', async () => {
  let supersedeWhere: unknown;
  let createdData: Record<string, unknown> | undefined;
  let loanUpdate: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: 'c'.repeat(64), sourceAttachmentId: result.attachmentId }),
      update: async ({ data }: { data: { version?: unknown } }) => {
        assert.deepEqual(data.version, { increment: 1 });
        return { id: 'document', version: 2, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId };
      },
      create: async () => assert.fail('must update the existing document'),
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async ({ where }: { where: unknown }) => { supersedeWhere = where; return { count: 1 }; },
      create: async ({ data }: { data: Record<string, unknown> }) => { createdData = data; return { id: 'extraction' }; },
    },
    loanApplication: { updateMany: async (args: unknown) => { loanUpdate = args; return { count: 1 }; } },
  };
  const nextLoanVersion = await persistParsedExtraction(transaction as never, job, result as never, 'WORKER', 7);
  assert.match(JSON.stringify(supersedeWhere), /ACTIVE/);
  assert.equal(createdData?.sourceDocumentVersion, 2);
  assert.equal(createdData?.sourceContentHash, result.sha256);
  assert.equal(createdData?.canonicalHash, result.parsed.extraction.canonicalHash);
  assert.deepEqual(loanUpdate, {
    where: { id: job.loanId, tenantId: job.tenantId, version: 7 },
    data: { version: { increment: 1 }, status: 'DOCS_UPLOADED' },
  });
  assert.equal(nextLoanVersion, 8);
});

test('same parser version producing a different canonical result fails closed', async () => {
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
      update: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: { findUnique: async () => ({ canonicalHash: 'c'.repeat(64) }) },
  };
  await assert.rejects(
    persistParsedExtraction(transaction as never, job, result as never),
    (error: { safeCode?: string }) => error.safeCode === 'PARSER_RESULT_NONDETERMINISTIC',
  );
});

test('authenticated upload uses only the constrained database writer for authoritative extraction rows', async () => {
  let rawCalls = 0;
  let lockCalls = 0;
  let directMutation = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => { lockCalls += 1; return 1; },
    $queryRaw: async () => { rawCalls += 1; return [{ created: true }]; },
    loanDocument: {
      findFirst: async () => null,
      create: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async () => { directMutation = true; },
      create: async () => { directMutation = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; return { count: 1 }; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never, 'AUTHENTICATED_UPLOAD');
  assert.equal(lockCalls, 1);
  assert.equal(rawCalls, 1);
  assert.equal(directMutation, false);
  assert.equal(loanUpdated, true);
});

test('persists a minimal W-2 extraction and quantizes confidence onto Decimal(5, 2)', async () => {
  const extraction = selectPersistableParserExtraction({
    flags: [],
    w2Extracts: [{
      pageIndex: 0, year: 2025, employerName: 'FreeFlow Synthetic Payroll LLC', ein: '00-0000000',
      box1: 120000, box5: 120000, box6: 1740,
      boxes: { box1: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    }],
  });
  const w2Result = {
    attachmentId: 'synthetic-income-document-1',
    sha256: '50eb5ac04498465000f569680a030df85c44dac939ba117411b43588e3a2ba2b',
    parsed: {
      pageCount: 1, documentCategory: 'W-2', parserVersion: 'income-parser-v5', confidence: 100.004,
      extraction,
    },
  };
  let createdDocument: Record<string, unknown> | undefined;
  let createdExtraction: Record<string, unknown> | undefined;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdDocument = data;
        return { id: 'document', version: 1, sourceContentHash: w2Result.sha256, sourceAttachmentId: w2Result.attachmentId };
      },
    },
    incomeExtraction: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, unknown> }) => { createdExtraction = data; return { id: 'extraction' }; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; return { count: 1 }; } },
  };
  await persistParsedExtraction(transaction as never, job, w2Result as never);
  assert.equal(createdDocument?.documentCategory, 'W-2');
  assert.equal(createdDocument?.sourceContentHash, w2Result.sha256);
  assert.equal(createdDocument?.sourceAttachmentId, w2Result.attachmentId);
  assert.equal((createdDocument?.ocrConfidence as { toFixed: (digits: number) => string }).toFixed(2), '100.00');
  const employers = (createdExtraction?.normalizedInput as { w2Records: Array<Record<string, unknown>> }).w2Records;
  assert.equal(employers[0]?.employerName, 'FreeFlow Synthetic Payroll LLC');
  assert.equal(employers[0]?.annualWages, 120000);
  assert.equal(createdExtraction?.schemaVersion, 'income-extraction-v2');
  assert.equal(createdExtraction?.canonicalHash, extraction.canonicalHash);
  assert.equal((createdExtraction?.confidence as { toFixed: (digits: number) => string }).toFixed(2), '100.00');
  assert.equal(loanUpdated, true);
  assert.equal(JSON.stringify(createdExtraction).includes('%PDF'), false);
});

test('a padded CHAR hash is the same document version and does not bump the loan', async () => {
  let versionIncremented = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => ({
        id: 'document', version: 1, sourceContentHash: `${result.sha256}  `, sourceAttachmentId: result.attachmentId,
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        versionIncremented = Object.hasOwn(data, 'version');
        return { id: 'document', version: 1, sourceContentHash: `${result.sha256} `, sourceAttachmentId: result.attachmentId };
      },
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: `${result.parsed.extraction.canonicalHash} ` }),
      updateMany: async () => assert.fail('must not supersede'),
      create: async () => assert.fail('must not insert'),
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  await persistParsedExtraction(transaction as never, job, result as never);
  assert.equal(versionIncremented, false);
  assert.equal(loanUpdated, false);
});

test('a unique conflict on insert reloads the document instead of failing the parse', async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line?: unknown) => { lines.push(String(line)); };
  let finds = 0;
  let created = false;
  let loanUpdated = false;
  const transaction = {
    $executeRaw: async () => 1,
    loanDocument: {
      findFirst: async () => {
        finds += 1;
        return finds === 1 ? null : {
          id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId,
        };
      },
      create: async () => {
        const error = new Error('Unique constraint failed jane@example.com %PDF-1.4');
        error.name = 'PrismaClientKnownRequestError';
        (error as Error & { code: string }).code = 'P2002';
        throw error;
      },
      update: async () => ({ id: 'document', version: 1, sourceContentHash: result.sha256, sourceAttachmentId: result.attachmentId }),
    },
    incomeExtraction: {
      findUnique: async () => ({ canonicalHash: result.parsed.extraction.canonicalHash }),
      create: async () => { created = true; },
    },
    loanApplication: { updateMany: async () => { loanUpdated = true; } },
  };
  try {
    await persistParsedExtraction(transaction as never, job, result as never);
  } finally {
    console.info = original;
  }
  assert.equal(created, false);
  assert.equal(loanUpdated, false);
  const recovered = lines.map((line) => JSON.parse(line) as { event?: string; prismaCode?: string });
  assert.equal(recovered.some((line) => line.event === 'document_pull_persist_recovered' && line.prismaCode === 'P2002'), true);
  assert.equal(lines.join('\n').includes('jane@example.com'), false);
  assert.equal(lines.join('\n').includes('%PDF'), false);
});
