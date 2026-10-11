import { hashCanonical } from '../../http/canonical';

const SHA_256_HEX = /^[0-9a-f]{64}$/;
const ATTACHMENT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const DOCUMENT_PULL_SELECTION_BINDING_SCHEMA_VERSION = 'encompass-document-selection-binding-v1' as const;
export const DOCUMENT_PULL_SELECTION_SCHEMA_VERSION = 'encompass-document-pull-selection-v1' as const;

export type EncompassDocumentTarget = Readonly<{
  integrationMode: 'CUSTOM_CONNECTOR';
  lenderId: string;
  deploymentId: string;
  encompassLoanGuid: string;
}>;

export type PersistedDocumentPullSelection = Readonly<{
  schemaVersion: typeof DOCUMENT_PULL_SELECTION_SCHEMA_VERSION;
  hash: string;
  target: EncompassDocumentTarget;
  attachmentIds: ReadonlyArray<string>;
}>;

/**
 * Returns a browser-safe opaque binding for the exact connector destination
 * used to list attachments. No lender, deployment, or provider loan id leaves
 * the server.
 */
export function buildDocumentSelectionBindingHash(input: Readonly<{
  tenantId: string;
  loanId: string;
  target: EncompassDocumentTarget;
}>): string {
  const target = normalizeTarget(input.target);
  return hashCanonical({
    schemaVersion: DOCUMENT_PULL_SELECTION_BINDING_SCHEMA_VERSION,
    tenantId: input.tenantId,
    loanId: input.loanId,
    target,
  });
}

export function buildPersistedDocumentPullSelection(input: Readonly<{
  tenantId: string;
  loanId: string;
  target: EncompassDocumentTarget;
  attachmentIds: ReadonlyArray<string>;
}>): PersistedDocumentPullSelection {
  const target = normalizeTarget(input.target);
  const attachmentIds = normalizeAttachmentIds(input.attachmentIds);
  const projection = {
    schemaVersion: DOCUMENT_PULL_SELECTION_SCHEMA_VERSION,
    tenantId: input.tenantId,
    loanId: input.loanId,
    target,
    attachmentIds,
  };
  return {
    schemaVersion: DOCUMENT_PULL_SELECTION_SCHEMA_VERSION,
    hash: hashCanonical(projection),
    target,
    attachmentIds,
  };
}

/** Restores only complete, internally consistent persisted v1 selections. */
export function restorePersistedDocumentPullSelection(input: Readonly<{
  tenantId: string;
  loanId: string;
  schemaVersion: string | null;
  hash: string | null;
  targetIntegrationMode: string | null;
  targetLenderId: string | null;
  targetDeploymentId: string | null;
  targetEncompassGuid: string | null;
  attachmentIds: ReadonlyArray<string>;
}>): PersistedDocumentPullSelection | null {
  if (input.schemaVersion !== DOCUMENT_PULL_SELECTION_SCHEMA_VERSION
    || !input.hash || !SHA_256_HEX.test(input.hash)
    || input.targetIntegrationMode !== 'CUSTOM_CONNECTOR'
    || !input.targetLenderId || !input.targetDeploymentId || !input.targetEncompassGuid) {
    return null;
  }
  try {
    const restored = buildPersistedDocumentPullSelection({
      tenantId: input.tenantId,
      loanId: input.loanId,
      target: {
        integrationMode: 'CUSTOM_CONNECTOR',
        lenderId: input.targetLenderId,
        deploymentId: input.targetDeploymentId,
        encompassLoanGuid: input.targetEncompassGuid,
      },
      attachmentIds: input.attachmentIds,
    });
    return restored.hash === input.hash ? restored : null;
  } catch {
    return null;
  }
}

export function documentTargetsEqual(
  left: EncompassDocumentTarget,
  right: EncompassDocumentTarget,
): boolean {
  return left.integrationMode === right.integrationMode
    && left.lenderId === right.lenderId
    && left.deploymentId === right.deploymentId
    && left.encompassLoanGuid === right.encompassLoanGuid;
}

function normalizeTarget(target: EncompassDocumentTarget): EncompassDocumentTarget {
  const lenderId = boundedTrimmed(target.lenderId);
  const deploymentId = boundedTrimmed(target.deploymentId);
  const encompassLoanGuid = boundedTrimmed(target.encompassLoanGuid);
  if (target.integrationMode !== 'CUSTOM_CONNECTOR' || !lenderId || !deploymentId || !encompassLoanGuid) {
    throw new Error('Encompass document target is incomplete.');
  }
  return { integrationMode: 'CUSTOM_CONNECTOR', lenderId, deploymentId, encompassLoanGuid };
}

function normalizeAttachmentIds(values: ReadonlyArray<string>): string[] {
  if (values.length < 1 || values.length > 20
    || values.some((value) => !ATTACHMENT_ID.test(value))
    || new Set(values).size !== values.length) {
    throw new Error('Encompass attachment selection is invalid.');
  }
  return [...values].sort();
}

function boundedTrimmed(value: string): string | null {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 255 && normalized === value ? normalized : null;
}
