import type { Prisma } from '@prisma/client';
import {
  buildEncompassWritePreview,
  type EncompassFieldWrite,
} from '@mortgage-pos/encompass-connector-contract';
import type { RequestContext } from '../../auth/requestContext';
import { AUDIT_ACTIONS } from '../../audit/appendEvent';
import { ApiError } from '../../http/apiError';
import { hashCanonical } from '../../http/canonical';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';
import { approvedHostFields } from './hostWrite';
import {
  LenderFieldMappingConfigurationError,
  fieldMapForAuthoritativeBinding,
  parseLenderFieldMappingConfiguration,
  type LenderFieldMappingConfiguration,
} from './lenderFieldMapping';

export const ENCOMPASS_WRITE_PREVIEW_SCHEMA_VERSION = 'encompass-write-preview-v2' as const;
const SHA_256 = /^[0-9a-f]{64}$/;

export type EncompassSyncTarget = Readonly<{
  integrationMode: 'CUSTOM_CONNECTOR';
  lenderId: string;
  deploymentId: string;
  encompassLoanGuid: string;
}>;

export type EncompassSyncPreview = Readonly<{
  schemaVersion: typeof ENCOMPASS_WRITE_PREVIEW_SCHEMA_VERSION;
  approvalEventId: string;
  target: EncompassSyncTarget;
  previewHash: string;
  fields: ReadonlyArray<EncompassFieldWrite>;
}>;

export type SyncPreviewConfiguration = Readonly<{
  appOrigin: string;
  lenderFieldMappings?: LenderFieldMappingConfiguration;
}>;

export function readSyncPreviewConfiguration(environment: NodeJS.ProcessEnv = process.env): SyncPreviewConfiguration {
  let appOrigin: string;
  try {
    const url = new URL(environment.APP_ORIGIN ?? '');
    if (url.protocol !== 'https:' || url.origin === 'null' || url.pathname !== '/' || url.search || url.hash) throw new Error();
    appOrigin = url.origin;
  } catch {
    throw new ApiError(503, 'ENCOMPASS_SYNC_CONFIGURATION_UNAVAILABLE', 'Encompass synchronization configuration is unavailable.');
  }
  try {
    return Object.freeze({
      appOrigin,
      lenderFieldMappings: parseLenderFieldMappingConfiguration(environment.ENCOMPASS_LENDER_FIELD_MAPPINGS_JSON),
    });
  } catch (error) {
    if (error instanceof LenderFieldMappingConfigurationError) {
      throw new ApiError(503, error.safeCode, 'Encompass synchronization configuration is unavailable.');
    }
    throw error;
  }
}

/**
 * Rebuilds the exact provider-bound field set from the immutable approval and
 * the tenant's authoritative lender binding. The returned preview is the only
 * field set an enqueue request may authorize.
 */
export async function loadApprovedEncompassSyncPreview(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{ loanId: string; approvalEventId: string; expectedLoanVersion: number }>,
  configuration: SyncPreviewConfiguration,
): Promise<EncompassSyncPreview> {
  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { id: true, version: true, encompassGuid: true, encompassIntegrationMode: true },
  });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  if (loan.version !== input.expectedLoanVersion) throw new ApiError(409, 'STALE_APPROVAL', 'The approved loan state is stale.');
  if (loan.encompassIntegrationMode !== 'CUSTOM_CONNECTOR') {
    throw new ApiError(422, 'ENCOMPASS_CUSTOM_CONNECTOR_REQUIRED', 'The loan is not authorized for custom connector synchronization.');
  }
  if (!loan.encompassGuid) throw new ApiError(422, 'ENCOMPASS_LOAN_NOT_LINKED', 'The loan is not linked to Encompass.');

  const configurationRow = await transaction.tenantConfiguration.findFirst({
    where: { tenantId: context.tenantId },
    select: { enableEncompassSync: true },
  });
  const binding = await transaction.encompassConnectorBinding.findFirst({
    where: { tenantId: context.tenantId, isEnabled: true },
    select: { lenderId: true, deploymentId: true },
  });
  if (!configurationRow?.enableEncompassSync || !binding) {
    throw new ApiError(422, 'ENCOMPASS_SYNC_DISABLED', 'Encompass synchronization is not enabled for this tenant.');
  }

  const approval = await transaction.auditEvent.findFirst({
    where: {
      id: input.approvalEventId,
      tenantId: context.tenantId,
      loanId: input.loanId,
      entityType: 'FORM_1084_AUDIT',
      action: { in: [AUDIT_ACTIONS.INCOME_APPROVED, AUDIT_ACTIONS.INCOME_OVERRIDE] },
    },
    select: { id: true, entityId: true, expectedLoanVersion: true },
  });
  if (!approval) throw new ApiError(422, 'APPROVAL_REQUIRED', 'An immutable approved calculation is required.');
  if (approval.expectedLoanVersion + 1 !== input.expectedLoanVersion) {
    throw new ApiError(409, 'STALE_APPROVAL', 'The approval does not match the current loan version.');
  }

  const calculation = await transaction.form1084Audit.findFirst({
    where: {
      id: approval.entityId,
      tenantId: context.tenantId,
      loanId: input.loanId,
      isHumanVerified: true,
      calculatedLoanVersion: approval.expectedLoanVersion,
    },
    select: {
      qualifyingMonthlyIncome: true,
      trendingResult: true,
      yearsAnalyzed: true,
      scheduleCMonthlyTotal: true,
      form1120SMonthlyTotal: true,
      form1065MonthlyTotal: true,
      form1120MonthlyTotal: true,
      w2BaseMonthly: true,
      w2VariableMonthly: true,
      assetIncomeMonthly: true,
      rentalMonthly: true,
      borrowerIncome: true,
      extractionBindings: { select: {
        extractionId: true, extractionHash: true, sourceDocumentId: true,
        sourceDocumentVersion: true, sourceContentHash: true,
        metadataReviewId: true, metadataReviewVersion: true, metadataReviewHash: true,
        extraction: { select: {
          status: true, canonicalHash: true, sourceDocumentVersion: true, sourceContentHash: true,
          sourceDocument: { select: { version: true, sourceContentHash: true } },
          metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, canonicalHash: true } },
        } },
      } },
    },
  });
  if (!calculation) throw new ApiError(422, 'APPROVED_CALCULATION_UNAVAILABLE', 'The approved calculation is unavailable.');
  if (!hasCurrentCalculationExtractions(calculation.extractionBindings)) {
    throw new ApiError(409, 'STALE_APPROVAL_EXTRACTION', 'The approved calculation is based on a superseded extraction.');
  }

  let fieldMapOverrides: ReturnType<typeof fieldMapForAuthoritativeBinding>;
  try {
    fieldMapOverrides = fieldMapForAuthoritativeBinding(configuration.lenderFieldMappings, binding);
  } catch (error) {
    if (error instanceof LenderFieldMappingConfigurationError) {
      throw new ApiError(503, error.safeCode, 'Encompass synchronization configuration is unavailable.');
    }
    throw error;
  }
  const fieldMap = approvedHostFields({
    loanId: input.loanId,
    approvalId: approval.id,
    qualifyingMonthlyIncome: calculation.qualifyingMonthlyIncome.toNumber(),
    trendingAnalysis: calculation.trendingResult,
    yearsAnalyzed: calculation.yearsAnalyzed,
    scheduleCMonthlyTotal: numberOrUndefined(calculation.scheduleCMonthlyTotal),
    form1120SMonthlyTotal: numberOrUndefined(calculation.form1120SMonthlyTotal),
    form1065MonthlyTotal: numberOrUndefined(calculation.form1065MonthlyTotal),
    form1120MonthlyTotal: numberOrUndefined(calculation.form1120MonthlyTotal),
    w2BaseMonthly: numberOrUndefined(calculation.w2BaseMonthly),
    w2VariableMonthly: numberOrUndefined(calculation.w2VariableMonthly),
    assetIncomeMonthly: numberOrUndefined(calculation.assetIncomeMonthly),
    rentalMonthly: numberOrUndefined(calculation.rentalMonthly),
    borrowerIncome: calculation.borrowerIncome,
    auditUrl: `${configuration.appOrigin}/audit/${approval.id}`,
  }, { fieldMapOverrides });
  return buildTargetBoundEncompassSyncPreview({
    approvalEventId: approval.id,
    fields: Object.entries(fieldMap).map(([fieldName, value]) => ({ fieldName, value })),
    target: {
      integrationMode: 'CUSTOM_CONNECTOR',
      lenderId: binding.lenderId,
      deploymentId: binding.deploymentId,
      encompassLoanGuid: loan.encompassGuid,
    },
  });
}

/**
 * Binds reviewer approval to both the exact sorted field set and the exact
 * server-authoritative Encompass target. The v1 connector-contract preview is
 * used for field validation and canonical ordering only.
 */
export function buildTargetBoundEncompassSyncPreview(input: Readonly<{
  approvalEventId: string;
  fields: ReadonlyArray<EncompassFieldWrite>;
  target: EncompassSyncTarget;
}>): EncompassSyncPreview {
  const fieldPreview = buildEncompassWritePreview({
    approvalEventId: input.approvalEventId,
    fields: input.fields,
  });
  const target = validateTarget(input.target);
  const canonical = {
    schemaVersion: ENCOMPASS_WRITE_PREVIEW_SCHEMA_VERSION,
    approvalEventId: fieldPreview.approvalEventId,
    target,
    fields: fieldPreview.fields,
  };
  return Object.freeze({
    ...canonical,
    previewHash: hashCanonical(canonical),
  });
}

/** Restores a persisted preview only if all version, hash, and field checks pass. */
export function restorePersistedEncompassSyncPreview(input: Readonly<{
  schemaVersion: string | null;
  previewHash: string | null;
  approvalEventId: string;
  fields: unknown;
  target: Readonly<{
    integrationMode: string | null;
    lenderId: string | null;
    deploymentId: string | null;
    encompassLoanGuid: string | null;
  }>;
}>): EncompassSyncPreview | null {
  if (
    input.schemaVersion !== ENCOMPASS_WRITE_PREVIEW_SCHEMA_VERSION
    || typeof input.previewHash !== 'string'
    || !SHA_256.test(input.previewHash)
    || !Array.isArray(input.fields)
  ) return null;
  try {
    const fields = input.fields.map((field): EncompassFieldWrite => {
      if (!isRecord(field) || !onlyKeys(field, ['fieldName', 'value'])
        || typeof field.fieldName !== 'string' || typeof field.value !== 'string') {
        throw new Error('Invalid persisted preview field.');
      }
      return { fieldName: field.fieldName, value: field.value };
    });
    if (input.target.integrationMode !== 'CUSTOM_CONNECTOR'
      || !input.target.lenderId || !input.target.deploymentId || !input.target.encompassLoanGuid) return null;
    const rebuilt = buildTargetBoundEncompassSyncPreview({
      approvalEventId: input.approvalEventId,
      fields,
      target: {
        integrationMode: input.target.integrationMode,
        lenderId: input.target.lenderId,
        deploymentId: input.target.deploymentId,
        encompassLoanGuid: input.target.encompassLoanGuid,
      },
    });
    return rebuilt.previewHash === input.previewHash ? rebuilt : null;
  } catch {
    return null;
  }
}

function validateTarget(target: EncompassSyncTarget): EncompassSyncTarget {
  if (target.integrationMode !== 'CUSTOM_CONNECTOR') {
    throw new Error('Invalid Encompass write target.');
  }
  if ([target.lenderId, target.deploymentId, target.encompassLoanGuid].some(
    (value) => typeof value !== 'string' || value.length < 1 || value.length > 255 || value.trim() !== value,
  )) {
    throw new Error('Invalid Encompass write target.');
  }
  return Object.freeze({
    integrationMode: target.integrationMode,
    lenderId: target.lenderId,
    deploymentId: target.deploymentId,
    encompassLoanGuid: target.encompassLoanGuid,
  });
}

function numberOrUndefined(value: Prisma.Decimal | null): number | undefined { return value?.toNumber(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
