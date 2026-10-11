import { randomUUID } from 'node:crypto';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Prisma, type EncompassDocumentPullStatus } from '@prisma/client';
import { CustomConnectorAdapter, EncompassConnectorError, type EncompassConnector } from '@mortgage-pos/encompass-connector-contract';
import { prisma, setTenantContext } from '../../database/client';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import type { RequestContext } from '../../auth/requestContext';
import type { DocumentPullQueueMessage } from './documentPull';
import { parseWithIncomeService } from './encompassApi';
import {
  DOCUMENT_PULL_MAX_AGGREGATE_BYTES,
  DOCUMENT_PULL_MAX_AGGREGATE_PAGES,
  runDocumentPullJob,
  validateAggregateDocumentLimits,
  type ClaimedDocumentPull,
  type DocumentPullWorkerDependencies,
} from './documentPullWorker';
import { isUniqueViolation, logDocumentPullPersistRecovery } from './documentPullFailure';
import { emitOperationalEvent } from '../../observability/operationalEvents';
import {
  documentTargetsEqual,
  restorePersistedDocumentPullSelection,
  type EncompassDocumentTarget,
} from './documentPullSelection';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000001';
export const DOCUMENT_PULL_MAX_ATTEMPTS = 5;
export const DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS = 900;
export const DOCUMENT_PULL_STALE_AFTER_MS = 14 * 60_000;

type DocumentPullClaimState = Readonly<{
  status: 'QUEUED' | 'RETRYABLE_FAILURE' | 'IN_PROGRESS';
  attemptCount: number;
  startedAt: Date | null;
  encompassIntegrationMode: string;
}>;

export function documentPullClaimDecision(
  state: DocumentPullClaimState,
  nowMs = Date.now(),
): 'CLAIM' | 'ACTIVE' | 'EXHAUSTED' | 'INVALID' | 'WRONG_INTEGRATION_MODE' {
  if (!Number.isSafeInteger(state.attemptCount) || state.attemptCount < 0) return 'INVALID';
  if (state.encompassIntegrationMode !== 'CUSTOM_CONNECTOR') return 'WRONG_INTEGRATION_MODE';
  if (state.status === 'IN_PROGRESS') {
    if (!state.startedAt || !Number.isFinite(state.startedAt.getTime())) return 'INVALID';
    if (state.startedAt.getTime() > nowMs - DOCUMENT_PULL_STALE_AFTER_MS) return 'ACTIVE';
  }
  return state.attemptCount >= DOCUMENT_PULL_MAX_ATTEMPTS ? 'EXHAUSTED' : 'CLAIM';
}

type RuntimeDocumentPull = ClaimedDocumentPull & Readonly<{
  target: EncompassDocumentTarget;
}>;

type ClaimFailure = Readonly<{ kind: 'FAILED'; safeErrorCode: string }>;

const documentPullAuthorizationSelect = {
  workingLoanVersion: true,
  selectedAttachmentIds: true,
  selectionSchemaVersion: true,
  selectionHash: true,
  selectionTargetIntegrationMode: true,
  selectionTargetLenderId: true,
  selectionTargetDeploymentId: true,
  selectionTargetEncompassGuid: true,
  loanApplication: { select: { version: true, encompassGuid: true, encompassIntegrationMode: true } },
  tenant: { select: {
    configurations: { select: { enableEncompassDocumentPull: true } },
    encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
  } },
} as const satisfies Prisma.EncompassDocumentPullJobSelect;

type DocumentPullAuthorizationRecord = Prisma.EncompassDocumentPullJobGetPayload<{
  select: typeof documentPullAuthorizationSelect;
}>;

export type DocumentPullRuntimeInfrastructure = Readonly<{
  withTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  setTenantContext: typeof setTenantContext;
  createConnector(input: Readonly<{
    serviceBaseUrl: string;
    serviceId: string;
    signingKey: string;
    lenderId: string;
    deploymentId: string;
  }>): EncompassConnector;
  parse(bytes: Uint8Array, parserUrl: string): ReturnType<typeof parseWithIncomeService>;
}>;

const defaultRuntimeInfrastructure: DocumentPullRuntimeInfrastructure = {
  withTransaction: (operation) => prisma.$transaction(operation),
  setTenantContext,
  createConnector: (input) => new CustomConnectorAdapter({
    binding: {
      kind: 'custom', lenderId: input.lenderId, deploymentId: input.deploymentId,
      serviceBaseUrl: input.serviceBaseUrl,
    },
    serviceAuth: { kind: 'signed-hmac', serviceId: input.serviceId, signingKey: input.signingKey },
  }),
  parse: (bytes, parserUrl) => parseWithIncomeService(bytes, { parserUrl }),
};

export function createRuntimeDependencies(
  environment: NodeJS.ProcessEnv = process.env,
  infrastructure: DocumentPullRuntimeInfrastructure = defaultRuntimeInfrastructure,
): DocumentPullWorkerDependencies {
  const parserUrl = required(environment.DOC_PARSER_SERVICE_URL, 'DOC_PARSER_SERVICE_URL');
  const serviceBaseUrl = required(environment.ENCOMPASS_CONNECTOR_SERVICE_URL, 'ENCOMPASS_CONNECTOR_SERVICE_URL');
  const serviceId = required(environment.ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID, 'ENCOMPASS_CONNECTOR_SIGNED_SERVICE_ID');
  const signingKey = required(environment.ENCOMPASS_CONNECTOR_SIGNING_KEY, 'ENCOMPASS_CONNECTOR_SIGNING_KEY');
  const clients = new Map<string, EncompassConnector>();

  const clientKey = (job: ClaimedDocumentPull) => `${job.jobId}:${job.claimToken}`;
  const clientFor = (job: ClaimedDocumentPull) => {
    const key = clientKey(job);
    let client = clients.get(key);
    if (!client) {
      client = infrastructure.createConnector({
        lenderId: job.lenderId,
        deploymentId: job.deploymentId,
        serviceBaseUrl,
        serviceId,
        signingKey,
      });
      clients.set(key, client);
    }
    return client;
  };

  return {
    claim: async (message) => {
      const outcome = await infrastructure.withTransaction<RuntimeDocumentPull | ClaimFailure | null>(async (transaction) => {
        await infrastructure.setTenantContext(transaction, { tenantId: message.tenantId, principalId: WORKER_PRINCIPAL_ID });
        const identityWhere: Prisma.EncompassDocumentPullJobWhereInput = {
          id: message.jobId,
          tenantId: message.tenantId,
          loanId: message.loanId,
          expectedLoanVersion: message.expectedLoanVersion,
          correlationId: message.correlationId,
        };
        const record = await transaction.encompassDocumentPullJob.findFirst({
          where: { ...identityWhere, status: { in: ['QUEUED', 'RETRYABLE_FAILURE', 'IN_PROGRESS'] } },
          select: {
            id: true,
            tenantId: true,
            loanId: true,
            status: true,
            attemptCount: true,
            startedAt: true,
            claimToken: true,
            requestedByUserId: true,
            expectedLoanVersion: true,
            correlationId: true,
            loanApplication: { select: { version: true, encompassGuid: true, encompassIntegrationMode: true } },
            selectedAttachmentIds: true,
            processedAttachmentIds: true,
            processedByteCount: true,
            processedPageCount: true,
            workingLoanVersion: true,
            selectionSchemaVersion: true,
            selectionHash: true,
            selectionTargetIntegrationMode: true,
            selectionTargetLenderId: true,
            selectionTargetDeploymentId: true,
            selectionTargetEncompassGuid: true,
            tenant: { select: {
              configurations: { select: { enableEncompassDocumentPull: true } },
              encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
            } },
          },
        });
        if (!record) return null;
        if (!isDocumentPullClaimStatus(record.status)) return null;
        const claimWhere: Prisma.EncompassDocumentPullJobWhereInput = {
          ...identityWhere,
          status: record.status,
          attemptCount: record.attemptCount,
          startedAt: record.startedAt,
          claimToken: record.claimToken,
          workingLoanVersion: record.workingLoanVersion,
          processedAttachmentIds: { equals: record.processedAttachmentIds },
          processedByteCount: record.processedByteCount,
          processedPageCount: record.processedPageCount,
        };
        const claimDecision = documentPullClaimDecision({
          status: record.status,
          attemptCount: record.attemptCount,
          startedAt: record.startedAt,
          encompassIntegrationMode: record.loanApplication.encompassIntegrationMode,
        });
        if (claimDecision === 'ACTIVE') return null;
        if (claimDecision === 'EXHAUSTED' || claimDecision === 'INVALID' || claimDecision === 'WRONG_INTEGRATION_MODE') {
          const safeErrorCode = claimDecision === 'EXHAUSTED'
            ? 'DOCUMENT_PULL_RETRY_LIMIT_REACHED'
            : claimDecision === 'WRONG_INTEGRATION_MODE'
              ? 'ENCOMPASS_CUSTOM_CONNECTOR_REQUIRED'
              : 'DOCUMENT_PULL_CLAIM_STATE_INVALID';
          return failDocumentPullClaim(transaction, record, claimWhere, safeErrorCode);
        }
        const selection = restorePersistedDocumentPullSelection({
          tenantId: record.tenantId,
          loanId: record.loanId,
          schemaVersion: record.selectionSchemaVersion,
          hash: canonicalStoredHash(record.selectionHash),
          targetIntegrationMode: record.selectionTargetIntegrationMode,
          targetLenderId: record.selectionTargetLenderId,
          targetDeploymentId: record.selectionTargetDeploymentId,
          targetEncompassGuid: record.selectionTargetEncompassGuid,
          attachmentIds: record.selectedAttachmentIds,
        });
        if (!selection || !validDocumentProgress(
          record.selectedAttachmentIds,
          record.processedAttachmentIds,
          record.workingLoanVersion,
          record.processedByteCount,
          record.processedPageCount,
        )) {
          return failDocumentPullClaim(transaction, record, claimWhere, 'ENCOMPASS_DOCUMENT_SELECTION_INVALID');
        }
        const configuration = record.tenant.configurations;
        if (record.loanApplication.version !== record.workingLoanVersion) {
          return failDocumentPullClaim(transaction, record, claimWhere, 'STALE_LOAN_VERSION');
        }
        const binding = record.tenant.encompassConnectorBinding;
        if (!configuration?.enableEncompassDocumentPull || !binding?.isEnabled || !record.loanApplication.encompassGuid) {
          return failDocumentPullClaim(transaction, record, claimWhere, 'ENCOMPASS_CONFIGURATION_INCOMPLETE');
        }
        const currentTarget: EncompassDocumentTarget = {
          integrationMode: 'CUSTOM_CONNECTOR',
          lenderId: binding.lenderId,
          deploymentId: binding.deploymentId,
          encompassLoanGuid: record.loanApplication.encompassGuid,
        };
        if (!documentTargetsEqual(selection.target, currentTarget)) {
          return failDocumentPullClaim(transaction, record, claimWhere, 'ENCOMPASS_DOCUMENT_TARGET_CHANGED');
        }
        const claimToken = randomUUID();
        const claimed = await transaction.encompassDocumentPullJob.updateMany({
          where: claimWhere,
          data: {
            status: 'IN_PROGRESS',
            attemptCount: { increment: 1 },
            safeErrorCode: null,
            startedAt: new Date(),
            claimToken,
          },
        });
        if (claimed.count !== 1) return null;
        return {
          jobId: record.id,
          tenantId: record.tenantId,
          loanId: record.loanId,
          correlationId: message.correlationId,
          requestedByUserId: record.requestedByUserId,
          expectedLoanVersion: record.expectedLoanVersion,
          claimToken,
          encompassLoanGuid: selection.target.encompassLoanGuid,
          lenderId: selection.target.lenderId,
          deploymentId: selection.target.deploymentId,
          totalAttachmentCount: selection.attachmentIds.length,
          processedCount: record.processedAttachmentIds.length,
          processedByteCount: record.processedByteCount,
          processedPageCount: record.processedPageCount,
          selectedAttachmentIds: selection.attachmentIds.filter((id) => !record.processedAttachmentIds.includes(id)),
          target: selection.target,
        } satisfies RuntimeDocumentPull;
      });
      if (!outcome) return null;
      if ('kind' in outcome) {
        emitOperationalEvent('document_pull_failure', outcome.safeErrorCode);
        return null;
      }
      return outcome;
    },
    listAttachments: async (job) => {
      await assertDocumentPullTargetAuthorized(job as RuntimeDocumentPull, infrastructure);
      return clientFor(job).listActiveAttachments(job, job.encompassLoanGuid);
    },
    download: async (job, attachmentId) => {
      await assertDocumentPullTargetAuthorized(job as RuntimeDocumentPull, infrastructure);
      return clientFor(job).downloadOriginalAttachment(job, job.encompassLoanGuid, attachmentId);
    },
    parse: async (bytes) => infrastructure.parse(bytes, parserUrl),
    saveResult: async (job, result) => infrastructure.withTransaction(async (transaction) => {
      await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
      const progress = await transaction.encompassDocumentPullJob.findFirst({
        where: { id: job.jobId, tenantId: job.tenantId, status: 'IN_PROGRESS', claimToken: job.claimToken },
        select: {
          workingLoanVersion: true,
          selectedAttachmentIds: true,
          processedAttachmentIds: true,
          processedByteCount: true,
          processedPageCount: true,
          selectionSchemaVersion: true,
          selectionHash: true,
          selectionTargetIntegrationMode: true,
          selectionTargetLenderId: true,
          selectionTargetDeploymentId: true,
          selectionTargetEncompassGuid: true,
          loanApplication: { select: { version: true, encompassGuid: true, encompassIntegrationMode: true } },
          tenant: { select: {
            configurations: { select: { enableEncompassDocumentPull: true } },
            encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
          } },
        },
      });
      if (!progress || !validDocumentProgress(
        progress.selectedAttachmentIds,
        progress.processedAttachmentIds,
        progress.workingLoanVersion,
        progress.processedByteCount,
        progress.processedPageCount,
      ) || !progress.selectedAttachmentIds.includes(result.attachmentId)
        || progress.processedAttachmentIds.includes(result.attachmentId)
        || !Number.isSafeInteger(result.byteCount) || result.byteCount < 1
        || !Number.isSafeInteger(result.parsed.pageCount) || result.parsed.pageCount < 1) {
        throw new EncompassConnectorError('DOCUMENT_PULL_CLAIM_LOST', 'The document pull claim is no longer current.', false);
      }
      assertAuthorizedDocumentPullRecord(job as RuntimeDocumentPull, progress);
      const processedByteCount = progress.processedByteCount + result.byteCount;
      const processedPageCount = progress.processedPageCount + result.parsed.pageCount;
      validateAggregateDocumentLimits({
        attachmentCount: progress.selectedAttachmentIds.length,
        bytes: processedByteCount,
        pages: processedPageCount,
        elapsedMs: 0,
      });
      const nextLoanVersion = await persistParsedExtraction(
        transaction,
        job,
        result,
        'WORKER',
        progress.workingLoanVersion!,
      );
      if (typeof nextLoanVersion !== 'number' || !Number.isSafeInteger(nextLoanVersion) || nextLoanVersion < 1) {
        throw new EncompassConnectorError('DOCUMENT_PULL_PROGRESS_INVALID', 'The document pull progress is invalid.', false);
      }
      const currentAuthorization = await transaction.encompassDocumentPullJob.findFirst({
        where: { id: job.jobId, tenantId: job.tenantId, status: 'IN_PROGRESS', claimToken: job.claimToken },
        select: documentPullAuthorizationSelect,
      });
      if (!currentAuthorization) {
        throw new EncompassConnectorError('DOCUMENT_PULL_CLAIM_LOST', 'The document pull claim is no longer current.', false);
      }
      assertAuthorizedDocumentPullRecord(job as RuntimeDocumentPull, currentAuthorization, nextLoanVersion);
      const processedAttachmentIds = [...progress.processedAttachmentIds, result.attachmentId];
      const advanced = await transaction.encompassDocumentPullJob.updateMany({
        where: {
          id: job.jobId,
          tenantId: job.tenantId,
          status: 'IN_PROGRESS',
          claimToken: job.claimToken,
          workingLoanVersion: progress.workingLoanVersion,
          processedAttachmentIds: { equals: progress.processedAttachmentIds },
          processedByteCount: progress.processedByteCount,
          processedPageCount: progress.processedPageCount,
        },
        data: {
          workingLoanVersion: nextLoanVersion,
          processedAttachmentIds,
          processedByteCount,
          processedPageCount,
          attachmentCount: progress.selectedAttachmentIds.length,
          processedCount: processedAttachmentIds.length,
        },
      });
      if (advanced.count !== 1) {
        throw new EncompassConnectorError('DOCUMENT_PULL_CLAIM_LOST', 'The document pull claim is no longer current.', false);
      }
    }),
    succeed: async (job, attachmentCount, processedCount) => {
      clients.delete(clientKey(job));
      const outcome = await finalizeDocumentPull(
        job as RuntimeDocumentPull,
        infrastructure,
        'SUCCEEDED',
        undefined,
        attachmentCount,
        processedCount,
      );
      if (outcome?.status === 'SUCCEEDED') {
        emitOperationalEvent('document_pull_success', 'DOCUMENT_PULL_SUCCEEDED');
      } else if (outcome?.status === 'FAILED') {
        emitOperationalEvent('document_pull_failure', outcome.safeErrorCode ?? 'DOCUMENT_PULL_FAILED');
      }
      return outcome?.status ?? 'FAILED';
    },
    fail: async (job, safeErrorCode, retryable) => {
      clients.delete(clientKey(job));
      if (retryable) {
        const transitioned = await retryDocumentPull(job as RuntimeDocumentPull, infrastructure, safeErrorCode);
        if (transitioned) emitOperationalEvent('document_pull_retry', safeErrorCode);
      } else {
        const outcome = await finalizeDocumentPull(job as RuntimeDocumentPull, infrastructure, 'FAILED', safeErrorCode);
        if (outcome) emitOperationalEvent('document_pull_failure', outcome.safeErrorCode ?? safeErrorCode);
      }
    },
  };
}

async function assertDocumentPullTargetAuthorized(
  job: RuntimeDocumentPull,
  infrastructure: DocumentPullRuntimeInfrastructure,
): Promise<void> {
  const record = await infrastructure.withTransaction(async (transaction) => {
    await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    return transaction.encompassDocumentPullJob.findFirst({
      where: {
        id: job.jobId,
        tenantId: job.tenantId,
        status: 'IN_PROGRESS',
        claimToken: job.claimToken,
      },
      select: documentPullAuthorizationSelect,
    });
  });
  if (!record) {
    throw new EncompassConnectorError('DOCUMENT_PULL_CLAIM_LOST', 'The document pull claim is no longer current.', false);
  }
  assertAuthorizedDocumentPullRecord(job, record);
}

function assertAuthorizedDocumentPullRecord(
  job: RuntimeDocumentPull,
  record: DocumentPullAuthorizationRecord,
  expectedLoanVersion = record.workingLoanVersion,
): void {
  const selection = restorePersistedDocumentPullSelection({
    tenantId: job.tenantId,
    loanId: job.loanId,
    schemaVersion: record.selectionSchemaVersion,
    hash: canonicalStoredHash(record.selectionHash),
    targetIntegrationMode: record.selectionTargetIntegrationMode,
    targetLenderId: record.selectionTargetLenderId,
    targetDeploymentId: record.selectionTargetDeploymentId,
    targetEncompassGuid: record.selectionTargetEncompassGuid,
    attachmentIds: record.selectedAttachmentIds,
  });
  if (!selection || !documentTargetsEqual(selection.target, job.target)) {
    throw new EncompassConnectorError('ENCOMPASS_DOCUMENT_SELECTION_INVALID', 'The persisted document selection is no longer valid.', false);
  }
  const binding = record.tenant.encompassConnectorBinding;
  const targetStillAuthorized = record.tenant.configurations?.enableEncompassDocumentPull
    && binding?.isEnabled
    && record.loanApplication.encompassIntegrationMode === 'CUSTOM_CONNECTOR'
    && record.loanApplication.encompassGuid === job.target.encompassLoanGuid
    && binding.lenderId === job.target.lenderId
    && binding.deploymentId === job.target.deploymentId;
  if (!targetStillAuthorized) {
    throw new EncompassConnectorError('ENCOMPASS_DOCUMENT_TARGET_CHANGED', 'The Encompass document target is no longer authorized.', false);
  }
  if (expectedLoanVersion === null || record.loanApplication.version !== expectedLoanVersion) {
    throw new EncompassConnectorError('STALE_LOAN_VERSION', 'The loan changed while the document pull was running.', false);
  }
}

type ParsedResult = Omit<Parameters<DocumentPullWorkerDependencies['saveResult']>[1], 'byteCount'>;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const documentSelect = {
  id: true, version: true, sourceContentHash: true, sourceAttachmentId: true,
} as const;

type StoredDocument = Readonly<{
  id: string;
  version: number;
  sourceContentHash: string | null;
  sourceAttachmentId: string | null;
}>;

/**
 * Persists one parsed attachment. The source-attachment key is a nullable
 * compound unique, so this path does not use Prisma upsert/findUnique on it.
 * A failure from that upsert is not an Encompass* error and was reported as
 * DOCUMENT_PULL_UNEXPECTED after a successful parse. Insert or update by
 * primary key, and treat a unique conflict as a reload. CHAR(64) hashes are
 * trimmed before compare because PostgreSQL bpchar values can come back padded.
 */
export async function persistParsedExtraction(
  transaction: Prisma.TransactionClient,
  job: Pick<ClaimedDocumentPull, 'tenantId' | 'loanId'>,
  result: ParsedResult,
  writer: 'WORKER' | 'AUTHENTICATED_UPLOAD' = 'WORKER',
  expectedLoanVersion?: number,
): Promise<number | void> {
  if (!SHA256_HEX.test(result.sha256)
    || result.attachmentId.length < 1
    || result.attachmentId.length > 255
    || !SHA256_HEX.test(result.parsed.extraction.canonicalHash)) {
    throw new EncompassConnectorError('EXTRACTION_SOURCE_BINDING_INVALID', 'Source document provenance is incomplete.', false);
  }
  const lockKey = `${job.tenantId}:${job.loanId}:${result.attachmentId}`;
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  let existing = await findLoanDocument(transaction, job, result.attachmentId);
  let document: StoredDocument;
  if (existing) {
    document = await updateLoanDocument(transaction, job, existing, result);
  } else {
    try {
      document = await createLoanDocument(transaction, job, result);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      logDocumentPullPersistRecovery(error);
      existing = await findLoanDocument(transaction, job, result.attachmentId);
      if (!existing) throw error;
      document = await updateLoanDocument(transaction, job, existing, result);
    }
  }
  const persistedHash = canonicalStoredHash(document.sourceContentHash);
  if (!document.sourceAttachmentId || persistedHash !== result.sha256) {
    throw new EncompassConnectorError('EXTRACTION_SOURCE_BINDING_INVALID', 'Source document provenance is incomplete.', false);
  }
  const hashChanged = canonicalStoredHash(existing?.sourceContentHash) !== result.sha256;
  const extractionKey = {
    tenantId: job.tenantId, sourceDocumentId: document.id,
    sourceDocumentVersion: document.version, parserVersion: result.parsed.parserVersion,
  };
  const existingExtraction = await transaction.incomeExtraction.findUnique({
    where: { tenantId_sourceDocumentId_sourceDocumentVersion_parserVersion: extractionKey },
    select: { canonicalHash: true },
  });
  if (existingExtraction && canonicalStoredHash(existingExtraction.canonicalHash) !== result.parsed.extraction.canonicalHash) {
    throw new EncompassConnectorError('PARSER_RESULT_NONDETERMINISTIC', 'Repeated parsing produced inconsistent normalized output.', false);
  }
  let extractionCreated = false;
  if (!existingExtraction) {
    if (writer === 'AUTHENTICATED_UPLOAD') {
      const rows = await transaction.$queryRaw<Array<{ created: boolean }>>`
        SELECT app.persist_uploaded_income_extraction(
          ${job.tenantId}::uuid,
          ${job.loanId}::uuid,
          ${document.id}::uuid,
          ${document.sourceAttachmentId}::varchar,
          ${document.version}::integer,
          ${result.sha256}::char(64),
          ${result.parsed.parserVersion}::varchar,
          ${result.parsed.extraction.schemaVersion}::varchar,
          ${JSON.stringify(result.parsed.extraction.normalizedInput)}::jsonb,
          ${JSON.stringify(result.parsed.extraction.evidence)}::jsonb,
          ${Array.from(result.parsed.extraction.warnings)}::text[],
          ${confidenceParameter(result.parsed.confidence)}::numeric,
          ${result.parsed.extraction.canonicalHash}::char(64)
        ) AS created
      `;
      extractionCreated = rows[0]?.created === true;
    } else {
      await transaction.incomeExtraction.updateMany({
        where: { tenantId: job.tenantId, loanId: job.loanId, sourceDocumentId: document.id, status: 'ACTIVE' },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
      await transaction.incomeExtraction.create({
        data: {
          tenantId: job.tenantId, loanId: job.loanId, sourceDocumentId: document.id,
          sourceAttachmentId: document.sourceAttachmentId, sourceDocumentVersion: document.version,
          sourceContentHash: result.sha256, parserVersion: result.parsed.parserVersion,
          schemaVersion: result.parsed.extraction.schemaVersion,
          normalizedInput: result.parsed.extraction.normalizedInput as Prisma.InputJsonValue,
          evidence: result.parsed.extraction.evidence as Prisma.InputJsonValue,
          warnings: Array.from(result.parsed.extraction.warnings),
          confidence: confidenceDecimal(result.parsed.confidence),
          canonicalHash: result.parsed.extraction.canonicalHash,
        },
      });
      extractionCreated = true;
    }
  }
  if (!existing || hashChanged || extractionCreated) {
    const updated = await transaction.loanApplication.updateMany({
      where: {
        id: job.loanId,
        tenantId: job.tenantId,
        ...(expectedLoanVersion === undefined ? {} : { version: expectedLoanVersion }),
      },
      data: { version: { increment: 1 }, status: 'DOCS_UPLOADED' },
    });
    if (expectedLoanVersion !== undefined && updated.count !== 1) {
      throw new EncompassConnectorError('STALE_LOAN_VERSION', 'The loan changed while the document was being saved.', false);
    }
    return expectedLoanVersion === undefined ? undefined : expectedLoanVersion + 1;
  }
  return expectedLoanVersion;
}

function documentWrite(result: ParsedResult): {
  documentCategory: string;
  sourceContentHash: string;
  sourcePageCount: number;
  parserVersion: string;
  ocrConfidence: Prisma.Decimal | null;
} {
  return {
    documentCategory: result.parsed.documentCategory.slice(0, 100),
    sourceContentHash: result.sha256,
    sourcePageCount: result.parsed.pageCount,
    parserVersion: result.parsed.parserVersion,
    ocrConfidence: confidenceDecimal(result.parsed.confidence),
  };
}

async function findLoanDocument(
  transaction: Prisma.TransactionClient,
  job: Pick<ClaimedDocumentPull, 'tenantId' | 'loanId'>,
  attachmentId: string,
): Promise<StoredDocument | null> {
  return transaction.loanDocument.findFirst({
    where: { tenantId: job.tenantId, loanId: job.loanId, sourceAttachmentId: attachmentId },
    select: documentSelect,
  });
}

async function createLoanDocument(
  transaction: Prisma.TransactionClient,
  job: Pick<ClaimedDocumentPull, 'tenantId' | 'loanId'>,
  result: ParsedResult,
): Promise<StoredDocument> {
  return transaction.loanDocument.create({
    data: {
      id: randomUUID(),
      tenantId: job.tenantId,
      loanId: job.loanId,
      fileType: 'application/pdf',
      sourceAttachmentId: result.attachmentId,
      ...documentWrite(result),
    },
    select: documentSelect,
  });
}

async function updateLoanDocument(
  transaction: Prisma.TransactionClient,
  job: Pick<ClaimedDocumentPull, 'tenantId' | 'loanId'>,
  existing: StoredDocument,
  result: ParsedResult,
): Promise<StoredDocument> {
  const hashChanged = canonicalStoredHash(existing.sourceContentHash) !== result.sha256;
  return transaction.loanDocument.update({
    where: { tenantId_id: { tenantId: job.tenantId, id: existing.id } },
    data: {
      ...documentWrite(result),
      ...(hashChanged ? { version: { increment: 1 } } : {}),
    },
    select: documentSelect,
  });
}

/** Fit Decimal(5, 2) and the 0–100 check. A raw average can exceed the scale after a successful parse. */
function confidenceDecimal(value: number | null): Prisma.Decimal | null {
  const quantized = quantizeConfidence(value);
  return quantized === null ? null : new Prisma.Decimal(quantized);
}

function confidenceParameter(value: number | null): string | null {
  return quantizeConfidence(value);
}

function quantizeConfidence(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const clamped = Math.min(100, Math.max(0, Math.round(value * 100) / 100));
  return clamped.toFixed(2);
}

function canonicalStoredHash(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return SHA256_HEX.test(normalized) ? normalized : null;
}

export async function runQueueWorker(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const queueUrl = required(environment.DOCUMENT_PULL_QUEUE_URL, 'DOCUMENT_PULL_QUEUE_URL');
  const sqs = new SQSClient({});
  const dependencies = createRuntimeDependencies(environment);
  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });

  while (!stopping) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: DOCUMENT_PULL_VISIBILITY_TIMEOUT_SECONDS,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    for (const item of response.Messages ?? []) {
      if (!item.Body || !item.ReceiptHandle) continue;
      let outcome: Awaited<ReturnType<typeof runDocumentPullJob>> = 'FAILED';
      try {
        outcome = await runDocumentPullJob(parseMessage(item.Body), dependencies);
      } catch {
        // The message remains hidden until the visibility timeout and is retried.
        continue;
      }
      if (outcome !== 'RETRYABLE_FAILURE') {
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: item.ReceiptHandle }));
      }
    }
  }
  await prisma.$disconnect();
}

function parseMessage(body: string): DocumentPullQueueMessage {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error('Invalid queue message.'); }
  if (!isRecord(value)) throw new Error('Invalid queue message.');
  for (const field of ['jobId', 'tenantId', 'loanId'] as const) {
    if (typeof value[field] !== 'string' || !UUID.test(value[field])) throw new Error('Invalid queue message.');
  }
  if (!Number.isInteger(value.expectedLoanVersion) || Number(value.expectedLoanVersion) < 1) throw new Error('Invalid queue message.');
  if (typeof value.correlationId !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(value.correlationId)) throw new Error('Invalid queue message.');
  return value as DocumentPullQueueMessage;
}

async function failDocumentPullClaim(
  transaction: Prisma.TransactionClient,
  record: Readonly<{
    id: string;
    tenantId: string;
    loanId: string;
    requestedByUserId: string;
    correlationId?: string;
    expectedLoanVersion: number;
    status: EncompassDocumentPullStatus;
    selectedAttachmentIds: ReadonlyArray<string>;
    processedAttachmentIds: ReadonlyArray<string>;
  }>,
  claimWhere: Prisma.EncompassDocumentPullJobWhereInput,
  safeErrorCode: string,
): Promise<ClaimFailure | null> {
  const failed = await transaction.encompassDocumentPullJob.updateMany({
    where: claimWhere,
    data: { status: 'FAILED', safeErrorCode, completedAt: new Date(), claimToken: null },
  });
  if (failed.count !== 1) return null;
  await appendDocumentPullTerminalAudit(transaction, record, 'FAILED', safeErrorCode);
  return { kind: 'FAILED', safeErrorCode };
}

async function retryDocumentPull(
  job: RuntimeDocumentPull,
  infrastructure: DocumentPullRuntimeInfrastructure,
  safeErrorCode: string,
): Promise<boolean> {
  return infrastructure.withTransaction(async (transaction) => {
    await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    const updated = await transaction.encompassDocumentPullJob.updateMany({
      where: {
        id: job.jobId,
        tenantId: job.tenantId,
        status: 'IN_PROGRESS',
        claimToken: job.claimToken,
      },
      data: {
        status: 'RETRYABLE_FAILURE',
        safeErrorCode,
        startedAt: null,
        completedAt: null,
        claimToken: null,
      },
    });
    return updated.count === 1;
  });
}

async function finalizeDocumentPull(
  job: RuntimeDocumentPull,
  infrastructure: DocumentPullRuntimeInfrastructure,
  requestedStatus: 'SUCCEEDED' | 'FAILED',
  requestedSafeErrorCode?: string,
  reportedAttachmentCount?: number,
  reportedProcessedCount?: number,
): Promise<{ status: 'SUCCEEDED' | 'FAILED'; safeErrorCode?: string } | null> {
  return infrastructure.withTransaction(async (transaction) => {
    await infrastructure.setTenantContext(transaction, { tenantId: job.tenantId, principalId: WORKER_PRINCIPAL_ID });
    const record = await transaction.encompassDocumentPullJob.findFirst({
      where: {
        id: job.jobId,
        tenantId: job.tenantId,
        status: 'IN_PROGRESS',
        claimToken: job.claimToken,
      },
      select: {
        id: true,
        tenantId: true,
        loanId: true,
        requestedByUserId: true,
        correlationId: true,
        expectedLoanVersion: true,
        selectedAttachmentIds: true,
        processedAttachmentIds: true,
        processedByteCount: true,
        processedPageCount: true,
        workingLoanVersion: true,
        loanApplication: { select: { version: true, encompassGuid: true, encompassIntegrationMode: true } },
        tenant: { select: {
          configurations: { select: { enableEncompassDocumentPull: true } },
          encompassConnectorBinding: { select: { lenderId: true, deploymentId: true, isEnabled: true } },
        } },
      },
    });
    if (!record) return null;

    let status = requestedStatus;
    let safeErrorCode = requestedSafeErrorCode;
    if (status === 'SUCCEEDED') {
      const progressValid = validDocumentProgress(
        record.selectedAttachmentIds,
        record.processedAttachmentIds,
        record.workingLoanVersion,
        record.processedByteCount,
        record.processedPageCount,
      ) && record.processedAttachmentIds.length === record.selectedAttachmentIds.length
        && reportedAttachmentCount === record.selectedAttachmentIds.length
        && reportedProcessedCount === record.processedAttachmentIds.length;
      if (!progressValid) {
        status = 'FAILED';
        safeErrorCode = 'DOCUMENT_PULL_PROGRESS_INVALID';
      } else if (record.loanApplication.version !== record.workingLoanVersion) {
        status = 'FAILED';
        safeErrorCode = 'STALE_LOAN_VERSION';
      } else {
        const binding = record.tenant.encompassConnectorBinding;
        const targetStillAuthorized = record.tenant.configurations?.enableEncompassDocumentPull
          && binding?.isEnabled
          && record.loanApplication.encompassIntegrationMode === 'CUSTOM_CONNECTOR'
          && record.loanApplication.encompassGuid === job.target.encompassLoanGuid
          && binding.lenderId === job.target.lenderId
          && binding.deploymentId === job.target.deploymentId;
        if (!targetStillAuthorized) {
          status = 'FAILED';
          safeErrorCode = 'ENCOMPASS_DOCUMENT_TARGET_CHANGED';
        }
      }
    }

    const updated = await transaction.encompassDocumentPullJob.updateMany({
      where: {
        id: job.jobId,
        tenantId: job.tenantId,
        status: 'IN_PROGRESS',
        claimToken: job.claimToken,
      },
      data: {
        status,
        safeErrorCode: safeErrorCode ?? null,
        attachmentCount: record.selectedAttachmentIds.length,
        processedCount: record.processedAttachmentIds.length,
        completedAt: new Date(),
        claimToken: null,
      },
    });
    if (updated.count !== 1) return null;
    await appendDocumentPullTerminalAudit(transaction, record, status, safeErrorCode);
    return { status, ...(safeErrorCode ? { safeErrorCode } : {}) };
  });
}

async function appendDocumentPullTerminalAudit(
  transaction: Prisma.TransactionClient,
  record: Readonly<{
    id: string;
    tenantId: string;
    loanId: string;
    requestedByUserId: string;
    correlationId?: string;
    expectedLoanVersion: number;
    selectedAttachmentIds: ReadonlyArray<string>;
    processedAttachmentIds: ReadonlyArray<string>;
  }>,
  status: 'SUCCEEDED' | 'FAILED',
  safeErrorCode?: string,
): Promise<void> {
  await appendAuditEvent(transaction, documentPullWorkerContext(record), {
    loanId: record.loanId,
    entityType: 'ENCOMPASS_DOCUMENT_PULL_JOB',
    entityId: record.id,
    expectedLoanVersion: record.expectedLoanVersion,
    action: status === 'SUCCEEDED'
      ? AUDIT_ACTIONS.ENCOMPASS_DOCUMENT_PULL_SUCCEEDED
      : AUDIT_ACTIONS.ENCOMPASS_DOCUMENT_PULL_FAILED,
    reasonCode: status === 'SUCCEEDED' ? 'DOCUMENT_PULL_COMPLETED' : (safeErrorCode ?? 'DOCUMENT_PULL_FAILED'),
    ruleVersion: 'encompass-document-pull-v2',
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      jobId: record.id,
      status,
      safeErrorCode: safeErrorCode ?? null,
      attachmentCount: record.selectedAttachmentIds.length,
      processedCount: record.processedAttachmentIds.length,
    }),
  });
}

function documentPullWorkerContext(record: Readonly<{
  correlationId?: string;
  tenantId: string;
  requestedByUserId: string;
}>): RequestContext {
  return Object.freeze({
    requestId: record.correlationId ?? 'document-pull-worker',
    subject: 'encompass-document-pull-worker',
    tenantId: record.tenantId,
    membershipId: record.requestedByUserId,
    permissions: ['encompass:pull'] as const,
    authTime: new Date(),
  });
}

function validDocumentProgress(
  selectedAttachmentIds: ReadonlyArray<string>,
  processedAttachmentIds: ReadonlyArray<string>,
  workingLoanVersion: number | null,
  processedByteCount: number,
  processedPageCount: number,
): boolean {
  const selected = new Set(selectedAttachmentIds);
  return Number.isSafeInteger(workingLoanVersion)
    && Number(workingLoanVersion) > 0
    && selectedAttachmentIds.length >= 1
    && selectedAttachmentIds.length <= 20
    && selected.size === selectedAttachmentIds.length
    && new Set(processedAttachmentIds).size === processedAttachmentIds.length
    && processedAttachmentIds.every((id) => selected.has(id))
    && Number.isSafeInteger(processedByteCount)
    && processedByteCount >= 0
    && processedByteCount <= DOCUMENT_PULL_MAX_AGGREGATE_BYTES
    && Number.isSafeInteger(processedPageCount)
    && processedPageCount >= 0
    && processedPageCount <= DOCUMENT_PULL_MAX_AGGREGATE_PAGES;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function isDocumentPullClaimStatus(value: string): value is DocumentPullClaimState['status'] {
  return value === 'QUEUED' || value === 'RETRYABLE_FAILURE' || value === 'IN_PROGRESS';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
