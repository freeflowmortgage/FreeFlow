import type { Prisma } from '@prisma/client';
import { buildEncompassFieldUpdatePayload } from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';
import { hashCanonical } from '../../http/canonical';
import { ApiError } from '../../http/apiError';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';

export const HOST_WRITE_OPERATION = 'encompass-host-writes';
export const HOST_WRITE_COMPLETION_OPERATION = 'encompass-host-write-completions';
const APPROVAL_FIELD = 'CX.FREEFLOW.APPROVAL.ID';

type AuthorizationInput = Readonly<{ loanId: string; approvalEventId: string; expectedLoanVersion: number; idempotencyKey: string; appOrigin: string }>;
type CompletionInput = Readonly<{ writeId: string; fieldMapHash: string; outcome: 'SUCCEEDED' | 'FAILED'; idempotencyKey: string }>;

export async function authorizeHostWrite(transaction: Prisma.TransactionClient, context: RequestContext, input: AuthorizationInput) {
  const requestHash = hashCanonical({ loanId: input.loanId, approvalEventId: input.approvalEventId, expectedLoanVersion: input.expectedLoanVersion });
  const decision = await resolveIdempotencyKey(transaction, context, { operation: HOST_WRITE_OPERATION, key: input.idempotencyKey, requestHash });
  const approved = await loadApprovedFieldMap(transaction, context, input);
  if (decision.kind === 'replay') {
    const existing = await transaction.encompassHostWrite.findFirst({
      where: { id: decision.stored.responseReference, tenantId: context.tenantId, loanId: input.loanId },
      select: { id: true, status: true, fieldMapHash: true },
    });
    if (!existing || existing.fieldMapHash !== approved.fieldMapHash) throw new ApiError(409, 'IDEMPOTENCY_STATE_INVALID', 'The stored host-write state is unavailable.');
    return { ...approved, writeId: existing.id, status: existing.status, replayed: true };
  }
  const existingApprovalWrite = await transaction.encompassHostWrite.findFirst({
    where: { tenantId: context.tenantId, loanId: input.loanId, approvalEventId: input.approvalEventId },
    select: { id: true, status: true, fieldMapHash: true },
  });
  if (existingApprovalWrite) {
    if (existingApprovalWrite.fieldMapHash !== approved.fieldMapHash) throw new ApiError(409, 'HOST_WRITE_FIELD_MAP_CHANGED', 'The approved hosted field map has changed.');
    if (existingApprovalWrite.status === 'FAILED') throw new ApiError(409, 'HOST_WRITE_FAILED', 'The prior hosted write failed; a new approval is required before retrying.');
    await storeIdempotencyResult(transaction, context, {
      operation: HOST_WRITE_OPERATION, key: input.idempotencyKey, requestHash,
      responseCode: 200, responseReference: existingApprovalWrite.id,
    });
    return { ...approved, writeId: existingApprovalWrite.id, status: existingApprovalWrite.status, replayed: true };
  }
  const write = await transaction.encompassHostWrite.create({
    data: {
      tenantId: context.tenantId, loanId: input.loanId, approvalEventId: input.approvalEventId,
      requestedByUserId: context.membershipId, expectedLoanVersion: input.expectedLoanVersion,
      idempotencyKey: input.idempotencyKey, correlationId: context.requestId, fieldMapHash: approved.fieldMapHash,
    },
    select: { id: true, status: true },
  });
  await appendAuditEvent(transaction, context, {
    loanId: input.loanId, entityType: 'ENCOMPASS_HOST_WRITE', entityId: write.id,
    expectedLoanVersion: input.expectedLoanVersion, action: AUDIT_ACTIONS.ENCOMPASS_HOST_WRITE_AUTHORIZED,
    reasonCode: 'APPROVED_FIELD_MAP_AUTHORIZED', ruleVersion: 'encompass-host-write-v1', schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({ writeId: write.id, approvalEventId: input.approvalEventId, fieldMapHash: approved.fieldMapHash }),
  });
  await storeIdempotencyResult(transaction, context, {
    operation: HOST_WRITE_OPERATION, key: input.idempotencyKey, requestHash,
    responseCode: 201, responseReference: write.id,
  });
  return { ...approved, writeId: write.id, status: write.status, replayed: false };
}

export async function completeHostWrite(transaction: Prisma.TransactionClient, context: RequestContext, input: CompletionInput) {
  const requestHash = hashCanonical({ writeId: input.writeId, fieldMapHash: input.fieldMapHash, outcome: input.outcome });
  const decision = await resolveIdempotencyKey(transaction, context, { operation: HOST_WRITE_COMPLETION_OPERATION, key: input.idempotencyKey, requestHash });
  const write = await transaction.encompassHostWrite.findFirst({
    where: { id: input.writeId, tenantId: context.tenantId },
    select: { id: true, loanId: true, approvalEventId: true, expectedLoanVersion: true, fieldMapHash: true, status: true },
  });
  if (!write) throw new ApiError(404, 'HOST_WRITE_NOT_FOUND', 'The hosted write was not found.');
  if (write.fieldMapHash !== input.fieldMapHash) throw new ApiError(409, 'HOST_WRITE_FIELD_MAP_CHANGED', 'The hosted field map does not match its authorization.');
  if (decision.kind === 'replay') return { writeId: write.id, status: write.status, replayed: true };
  if (write.status !== 'AUTHORIZED' && write.status !== input.outcome) throw new ApiError(409, 'HOST_WRITE_ALREADY_COMPLETED', 'The hosted write already has a different outcome.');
  if (write.status === 'AUTHORIZED') {
    const updated = await transaction.encompassHostWrite.updateMany({
      where: { id: write.id, tenantId: context.tenantId, status: 'AUTHORIZED', fieldMapHash: input.fieldMapHash },
      data: { status: input.outcome, safeErrorCode: input.outcome === 'FAILED' ? 'HOST_COMMIT_FAILED' : null, completedAt: new Date() },
    });
    if (updated.count !== 1) throw new ApiError(409, 'HOST_WRITE_ALREADY_COMPLETED', 'The hosted write was completed concurrently.');
    await appendAuditEvent(transaction, context, {
      loanId: write.loanId, entityType: 'ENCOMPASS_HOST_WRITE', entityId: write.id,
      expectedLoanVersion: write.expectedLoanVersion,
      action: input.outcome === 'SUCCEEDED' ? AUDIT_ACTIONS.ENCOMPASS_HOST_WRITE_SUCCEEDED : AUDIT_ACTIONS.ENCOMPASS_HOST_WRITE_FAILED,
      reasonCode: input.outcome === 'SUCCEEDED' ? 'HOST_READBACK_REPORTED' : 'HOST_COMMIT_FAILED',
      ruleVersion: 'encompass-host-write-v1', schemaVersion: 'audit-event-v1',
      resultHash: hashAuditResult({ writeId: write.id, approvalEventId: write.approvalEventId, fieldMapHash: write.fieldMapHash, status: input.outcome }),
    });
    if (input.outcome === 'SUCCEEDED') await transaction.loanApplication.updateMany({
      where: { id: write.loanId, tenantId: context.tenantId, version: write.expectedLoanVersion }, data: { status: 'EXPORTED_TO_LOS' },
    });
  }
  await storeIdempotencyResult(transaction, context, {
    operation: HOST_WRITE_COMPLETION_OPERATION, key: input.idempotencyKey, requestHash,
    responseCode: 200, responseReference: write.id,
  });
  return { writeId: write.id, status: input.outcome, replayed: false };
}

async function loadApprovedFieldMap(transaction: Prisma.TransactionClient, context: RequestContext, input: AuthorizationInput) {
  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: { id: true, version: true, encompassGuid: true, encompassIntegrationMode: true },
  });
  if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  if (loan.version !== input.expectedLoanVersion) throw new ApiError(409, 'STALE_APPROVAL', 'The approved loan state is stale.');
  if (!loan.encompassGuid || loan.encompassIntegrationMode !== 'ENCOMPASS_HOSTED') throw new ApiError(422, 'ENCOMPASS_HOST_BINDING_REQUIRED', 'The loan is not bound to the Encompass host.');
  const configuration = await transaction.tenantConfiguration.findFirst({ where: { tenantId: context.tenantId }, select: { encompassIntegrationMode: true } });
  if (configuration?.encompassIntegrationMode !== 'ENCOMPASS_HOSTED') throw new ApiError(422, 'ENCOMPASS_HOSTED_NOT_ENABLED', 'Hosted Encompass integration is not enabled for this tenant.');
  const approval = await transaction.auditEvent.findFirst({
    where: { id: input.approvalEventId, tenantId: context.tenantId, loanId: input.loanId, entityType: 'FORM_1084_AUDIT', action: { in: [AUDIT_ACTIONS.INCOME_APPROVED, AUDIT_ACTIONS.INCOME_OVERRIDE] } },
    select: { id: true, entityId: true, expectedLoanVersion: true },
  });
  if (!approval || approval.expectedLoanVersion + 1 !== input.expectedLoanVersion) throw new ApiError(409, 'STALE_APPROVAL', 'A current immutable approval is required.');
  const calculation = await transaction.form1084Audit.findFirst({
    where: { id: approval.entityId, tenantId: context.tenantId, loanId: input.loanId, isHumanVerified: true, calculatedLoanVersion: approval.expectedLoanVersion },
    select: {
      qualifyingMonthlyIncome: true, trendingResult: true, yearsAnalyzed: true, scheduleCMonthlyTotal: true,
      form1120SMonthlyTotal: true, form1065MonthlyTotal: true, form1120MonthlyTotal: true, w2BaseMonthly: true,
      rentalMonthly: true,
      extractionBindings: { select: {
        extractionId: true, extractionHash: true, sourceDocumentId: true, sourceDocumentVersion: true,
        sourceContentHash: true, metadataReviewId: true, metadataReviewVersion: true, metadataReviewHash: true,
        extraction: { select: { status: true, canonicalHash: true, sourceDocumentVersion: true, sourceContentHash: true,
          sourceDocument: { select: { version: true, sourceContentHash: true } },
          metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, canonicalHash: true } },
        } },
      } },
    },
  });
  if (!calculation) throw new ApiError(422, 'APPROVED_CALCULATION_UNAVAILABLE', 'The approved calculation is unavailable.');
  if (!hasCurrentCalculationExtractions(calculation.extractionBindings)) throw new ApiError(409, 'STALE_APPROVAL_EXTRACTION', 'The approved calculation is based on superseded evidence.');
  const mapped = buildEncompassFieldUpdatePayload(input.loanId, {
    qualifyingMonthlyIncome: calculation.qualifyingMonthlyIncome.toNumber(), trendingAnalysis: calculation.trendingResult,
    yearsAnalyzed: calculation.yearsAnalyzed, scheduleC_MonthlyTotal: numberOrUndefined(calculation.scheduleCMonthlyTotal),
    form1120S_MonthlyTotal: numberOrUndefined(calculation.form1120SMonthlyTotal), form1065_MonthlyTotal: numberOrUndefined(calculation.form1065MonthlyTotal),
    form1120_MonthlyTotal: numberOrUndefined(calculation.form1120MonthlyTotal), w2BaseMonthly: numberOrUndefined(calculation.w2BaseMonthly),
    rentalMonthly: numberOrUndefined(calculation.rentalMonthly),
    auditUrl: `${input.appOrigin.replace(/\/$/, '')}/audit/${approval.id}`,
  });
  const fields = Object.fromEntries([...mapped.customFields.filter((field) => field.fieldName !== 'CX.FREEFLOW.SYNCED.AT'), { fieldName: APPROVAL_FIELD, value: approval.id }].map((field) => [field.fieldName, field.value]));
  const fieldMapHash = hashCanonical({ loanId: loan.id, encompassLoanGuid: loan.encompassGuid, approvalEventId: approval.id, expectedLoanVersion: input.expectedLoanVersion, fields });
  return { loanId: loan.id, encompassLoanGuid: loan.encompassGuid, approvalEventId: approval.id, expectedLoanVersion: input.expectedLoanVersion, fields, fieldMapHash };
}

function numberOrUndefined(value: Prisma.Decimal | null): number | undefined { return value?.toNumber(); }
