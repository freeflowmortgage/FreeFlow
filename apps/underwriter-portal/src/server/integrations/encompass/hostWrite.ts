import type { Prisma } from '@prisma/client';
import {
  buildEncompassFieldUpdatePayload,
  type EncompassIncomeFieldMapOverrides,
} from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../../auth/requestContext';
import { appendAuditEvent, AUDIT_ACTIONS, hashAuditResult } from '../../audit/appendEvent';
import { resolveIdempotencyKey, storeIdempotencyResult } from '../../audit/idempotency';
import { hashCanonical } from '../../http/canonical';
import { ApiError } from '../../http/apiError';
import { hasCurrentCalculationExtractions } from '../../income/extractionFreshness';
import { borrowerIncomeFields, readBorrowerIncome } from '../../income/loanBorrowerRoster';

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
  if (input.outcome === 'SUCCEEDED') {
    throw new ApiError(
      503,
      'HOST_WRITE_SERVER_VERIFICATION_REQUIRED',
      'Hosted writeback cannot be marked successful without server-verifiable full-field readback.',
    );
  }
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
      data: { status: 'FAILED', safeErrorCode: 'HOST_COMMIT_FAILED', completedAt: new Date() },
    });
    if (updated.count !== 1) throw new ApiError(409, 'HOST_WRITE_ALREADY_COMPLETED', 'The hosted write was completed concurrently.');
    await appendAuditEvent(transaction, context, {
      loanId: write.loanId, entityType: 'ENCOMPASS_HOST_WRITE', entityId: write.id,
      expectedLoanVersion: write.expectedLoanVersion,
      action: AUDIT_ACTIONS.ENCOMPASS_HOST_WRITE_FAILED,
      reasonCode: 'HOST_COMMIT_FAILED',
      ruleVersion: 'encompass-host-write-v1', schemaVersion: 'audit-event-v1',
      resultHash: hashAuditResult({ writeId: write.id, approvalEventId: write.approvalEventId, fieldMapHash: write.fieldMapHash, status: 'FAILED' }),
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
      w2VariableMonthly: true, assetIncomeMonthly: true, socialSecurityMonthly: true, retirementIncomeMonthly: true,
      rentalMonthly: true, borrowerIncome: true,
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
  const fields = approvedHostFields({
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
    socialSecurityMonthly: numberOrUndefined(calculation.socialSecurityMonthly),
    retirementIncomeMonthly: numberOrUndefined(calculation.retirementIncomeMonthly),
    rentalMonthly: numberOrUndefined(calculation.rentalMonthly),
    borrowerIncome: calculation.borrowerIncome,
    auditUrl: `${input.appOrigin.replace(/\/$/, '')}/audit/${approval.id}`,
  });
  const fieldMapHash = hashCanonical({ loanId: loan.id, encompassLoanGuid: loan.encompassGuid, approvalEventId: approval.id, expectedLoanVersion: input.expectedLoanVersion, fields });
  return { loanId: loan.id, encompassLoanGuid: loan.encompassGuid, approvalEventId: approval.id, expectedLoanVersion: input.expectedLoanVersion, fields, fieldMapHash };
}

export function approvedHostFields(input: Readonly<{
  loanId: string;
  approvalId: string;
  qualifyingMonthlyIncome: number;
  trendingAnalysis: string;
  yearsAnalyzed: number[];
  scheduleCMonthlyTotal?: number;
  form1120SMonthlyTotal?: number;
  form1065MonthlyTotal?: number;
  form1120MonthlyTotal?: number;
  w2BaseMonthly?: number;
  w2VariableMonthly?: number;
  assetIncomeMonthly?: number;
  socialSecurityMonthly?: number;
  retirementIncomeMonthly?: number;
  rentalMonthly?: number;
  borrowerIncome: unknown;
  auditUrl: string;
}>, options: Readonly<{
  fieldMapOverrides?: EncompassIncomeFieldMapOverrides;
}> = {}): Record<string, string> {
  const lines = readBorrowerIncome(input.borrowerIncome);
  const mapped = buildEncompassFieldUpdatePayload(input.loanId, {
    qualifyingMonthlyIncome: input.qualifyingMonthlyIncome,
    trendingAnalysis: input.trendingAnalysis,
    yearsAnalyzed: input.yearsAnalyzed,
    scheduleC_MonthlyTotal: input.scheduleCMonthlyTotal,
    form1120S_MonthlyTotal: input.form1120SMonthlyTotal,
    form1065_MonthlyTotal: input.form1065MonthlyTotal,
    form1120_MonthlyTotal: input.form1120MonthlyTotal,
    w2BaseMonthly: input.w2BaseMonthly,
    w2VariableMonthly: input.w2VariableMonthly,
    assetIncomeMonthly: input.assetIncomeMonthly,
    socialSecurityMonthly: input.socialSecurityMonthly,
    retirementIncomeMonthly: input.retirementIncomeMonthly,
    rentalMonthly: input.rentalMonthly,
    borrowerMonthlyIncome: lines.map((line) => ({ ordinal: line.ordinal, qualifyingMonthlyIncome: Number(line.qualifyingMonthlyIncome) })),
    auditUrl: input.auditUrl,
  }, { fieldMapOverrides: options.fieldMapOverrides, includeSyncedAt: false });
  const borrowerFields = borrowerIncomeFields(lines);
  return Object.fromEntries([
    ...mapped.customFields,
    ...Object.entries(borrowerFields).map(([fieldName, value]) => ({ fieldName, value })),
    { fieldName: APPROVAL_FIELD, value: input.approvalId },
  ].map((field) => [field.fieldName, field.value]));
}

function numberOrUndefined(value: Prisma.Decimal | null): number | undefined { return value?.toNumber(); }
