import type { Prisma } from '@prisma/client';
import {
  buildEncompassWritePreview,
  type EncompassFieldWrite,
  type EncompassWritePreview,
} from '@mortgage-pos/encompass-connector-contract';
import type { RequestContext } from '../../auth/requestContext';
import { AUDIT_ACTIONS } from '../../audit/appendEvent';
import { ApiError } from '../../http/apiError';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';
import { approvedHostFields } from './hostWrite';
import {
  LenderFieldMappingConfigurationError,
  fieldMapForAuthoritativeBinding,
  parseLenderFieldMappingConfiguration,
  type LenderFieldMappingConfiguration,
} from './lenderFieldMapping';

export const ENCOMPASS_WRITE_PREVIEW_SCHEMA_VERSION = 'encompass-write-preview-v1' as const;
const SHA_256 = /^[0-9a-f]{64}$/;

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
): Promise<EncompassWritePreview> {
  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { id: true, version: true, encompassGuid: true },
  });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  if (loan.version !== input.expectedLoanVersion) throw new ApiError(409, 'STALE_APPROVAL', 'The approved loan state is stale.');
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
  return buildEncompassWritePreview({
    approvalEventId: approval.id,
    fields: Object.entries(fieldMap).map(([fieldName, value]) => ({ fieldName, value })),
  });
}

/** Restores a persisted preview only if all version, hash, and field checks pass. */
export function restorePersistedEncompassSyncPreview(input: Readonly<{
  schemaVersion: string | null;
  previewHash: string | null;
  approvalEventId: string;
  fields: unknown;
}>): EncompassWritePreview | null {
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
    const rebuilt = buildEncompassWritePreview({ approvalEventId: input.approvalEventId, fields });
    return rebuilt.previewHash === input.previewHash ? rebuilt : null;
  } catch {
    return null;
  }
}

function numberOrUndefined(value: Prisma.Decimal | null): number | undefined { return value?.toNumber(); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}
