import { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { hashCanonical } from '../http/canonical';
import { hasCurrentCalculationExtractions } from '../income/extractionFreshness';
import { readBorrowerIncome } from '../income/loanBorrowerRoster';
import {
  AUDIT_ACTIONS,
  AUDIT_REASON_CODES,
  appendAuditEvent,
  hashAuditResult,
} from './appendEvent';
import {
  INCOME_APPROVAL_OPERATION,
  resolveIdempotencyKey,
  storeIdempotencyResult,
} from './idempotency';

const APPROVABLE_LOAN_STATUSES = new Set([
  'DRAFT',
  'SUBMITTED',
  'DOCS_UPLOADED',
  'IN_QA_REVIEW',
  'VERIFIED',
]);

const APPROVAL_REASON_CODES = new Set<string>([AUDIT_REASON_CODES.UNDERWRITER_CONFIRMED]);
const OVERRIDE_REASON_CODES = new Set<string>([
  AUDIT_REASON_CODES.INCOME_ADJUSTED,
  AUDIT_REASON_CODES.DOCUMENTATION_EXCEPTION,
  AUDIT_REASON_CODES.MANUAL_RECALCULATION,
]);

export type IncomeApprovalAction = 'INCOME_APPROVED' | 'INCOME_OVERRIDE';

export type IncomeApprovalRequest = Readonly<{
  loanId: string;
  calculationId: string;
  expectedLoanVersion: number;
  action: IncomeApprovalAction;
  reasonCode: string;
  reasonNarrative: string | null;
  idempotencyKey: string;
  overrideQualifyingMonthlyIncome: number | null;
}>;

export type IncomeApprovalResult = Readonly<{
  auditEventId: string;
  loanVersion: number;
  calculationId: string;
  action: IncomeApprovalAction;
  replayed: boolean;
}>;

export function parseIncomeApprovalBody(
  body: unknown,
  defaults: { action?: IncomeApprovalAction } = {},
): Pick<IncomeApprovalRequest, 'calculationId' | 'expectedLoanVersion' | 'action' | 'reasonCode' | 'reasonNarrative' | 'overrideQualifyingMonthlyIncome'> {
  const payload = isRecord(body) ? body : {};
  const expectedLoanVersion = payload.expectedLoanVersion;
  if (typeof expectedLoanVersion !== 'number' || !Number.isInteger(expectedLoanVersion) || expectedLoanVersion < 1) {
    throw new ApiError(400, 'INVALID_LOAN_VERSION', 'A positive expectedLoanVersion is required.');
  }
  const calculationId = typeof payload.calculationId === 'string' && UUID.test(payload.calculationId)
    ? payload.calculationId
    : null;
  if (!calculationId) {
    throw new ApiError(400, 'CALCULATION_ID_REQUIRED', 'A reviewed calculationId is required.');
  }

  const requestedAction = payload.action ?? defaults.action ?? AUDIT_ACTIONS.INCOME_APPROVED;
  if (requestedAction !== AUDIT_ACTIONS.INCOME_APPROVED && requestedAction !== AUDIT_ACTIONS.INCOME_OVERRIDE) {
    throw new ApiError(400, 'INVALID_APPROVAL_ACTION', 'The approval action is not supported.');
  }

  const reasonNarrative = parseOptionalNarrative(payload.reasonNarrative);
  const reasonCode = parseReasonCode(requestedAction, payload.reasonCode);
  if (requestedAction === AUDIT_ACTIONS.INCOME_OVERRIDE && !reasonNarrative) {
    throw new ApiError(400, 'OVERRIDE_NARRATIVE_REQUIRED', 'An override requires a reason narrative.');
  }
  const overrideQualifyingMonthlyIncome = requestedAction === AUDIT_ACTIONS.INCOME_OVERRIDE
    ? parseOverrideIncome(payload.overrideQualifyingMonthlyIncome)
    : null;

  return {
    calculationId,
    expectedLoanVersion,
    action: requestedAction,
    reasonCode,
    reasonNarrative,
    overrideQualifyingMonthlyIncome,
  };
}

export async function approveIncomeCalculation(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: IncomeApprovalRequest,
): Promise<IncomeApprovalResult> {
  const requestHash = hashCanonical({
    loanId: input.loanId,
    calculationId: input.calculationId,
    expectedLoanVersion: input.expectedLoanVersion,
    action: input.action,
    reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative,
    overrideQualifyingMonthlyIncome: input.overrideQualifyingMonthlyIncome,
  });

  const idempotency = await resolveIdempotencyKey(transaction, context, {
    operation: INCOME_APPROVAL_OPERATION,
    key: input.idempotencyKey,
    requestHash,
  });
  if (idempotency.kind === 'replay') {
    return {
      ...parseStoredApproval(idempotency.stored.responseReference),
      replayed: true,
    };
  }

  const loan = await transaction.loanApplication.findFirst({
    where: { id: input.loanId, tenantId: context.tenantId },
    select: {
      id: true,
      tenantId: true,
      version: true,
      status: true,
    },
  });
  if (!loan) {
    throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
  }
  if (!APPROVABLE_LOAN_STATUSES.has(loan.status)) {
    throw new ApiError(409, 'LOAN_STATE_CONFLICT', 'The loan cannot be approved in its current state.');
  }
  if (loan.version !== input.expectedLoanVersion) {
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      'The loan changed since it was loaded. Reload and retry the approval.',
    );
  }

  const calculation = await transaction.form1084Audit.findFirst({
    where: { id: input.calculationId, loanId: loan.id, tenantId: context.tenantId },
    select: {
      id: true,
      qualifyingMonthlyIncome: true,
      totalAnnualCashFlow: true,
      yearsAnalyzed: true,
      calculationSchemaVersion: true,
      calculationSource: true,
      calculatedLoanVersion: true,
      canonicalInputHash: true,
      sourceDocumentHashes: true,
      mortgageRuleVersion: true,
      trendingResult: true,
      w2BaseMonthly: true,
      w2VariableMonthly: true,
      scheduleCMonthlyTotal: true,
      scheduleFMonthlyTotal: true,
      form1120SMonthlyTotal: true,
      form1065MonthlyTotal: true,
      form1120MonthlyTotal: true,
      assetIncomeMonthly: true,
      rentalMonthly: true,
      rentalLiabilityMonthly: true,
      housingExpenseAdjustment: true,
      borrowerIncome: true,
      entityType: true,
      extractionBindings: {
        select: {
          extractionId: true, extractionHash: true, sourceDocumentId: true,
          sourceDocumentVersion: true, sourceContentHash: true,
          metadataReviewId: true, metadataReviewVersion: true, metadataReviewHash: true,
          extraction: { select: {
            status: true, canonicalHash: true, sourceDocumentVersion: true, sourceContentHash: true,
            sourceDocument: { select: { version: true, sourceContentHash: true } },
            metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, canonicalHash: true } },
          } },
        },
      },
    },
  });
  if (!calculation) {
    throw new ApiError(
      422,
      'CALCULATION_REQUIRED',
      'A server-side income calculation must exist before approval.',
    );
  }
  if (calculation.calculatedLoanVersion !== input.expectedLoanVersion) {
    throw new ApiError(409, 'STALE_CALCULATION', 'The reviewed calculation is stale and must be recalculated.');
  }
  if (!hasCurrentCalculationExtractions(calculation.extractionBindings)) {
    throw new ApiError(409, 'STALE_CALCULATION_EXTRACTION', 'The reviewed calculation no longer has current extraction provenance.');
  }
  const borrowerLines = readBorrowerIncome(calculation.borrowerIncome);
  if (borrowerLines.length >= 2) {
    const roster = await transaction.loanBorrower.findMany({
      where: { tenantId: context.tenantId, loanId: loan.id },
      orderBy: { ordinal: 'asc' },
      select: { borrowerKey: true },
    });
    if (borrowerLines.length !== roster.length || borrowerLines.some((line, index) => line.borrowerKey !== roster[index]?.borrowerKey)) {
      throw new ApiError(409, 'STALE_BORROWER_ROSTER', 'The borrower roster changed after calculation.');
    }
  }

  const approvedCalculation = input.action === AUDIT_ACTIONS.INCOME_OVERRIDE
    ? await transaction.form1084Audit.create({
      data: {
        tenantId: context.tenantId,
        loanId: loan.id,
        entityType: calculation.entityType,
        yearsAnalyzed: calculation.yearsAnalyzed,
        trendingResult: calculation.trendingResult,
        totalAnnualCashFlow: new Prisma.Decimal(input.overrideQualifyingMonthlyIncome!).mul(12),
        qualifyingMonthlyIncome: new Prisma.Decimal(input.overrideQualifyingMonthlyIncome!),
        calculationSchemaVersion: calculation.calculationSchemaVersion,
        calculationSource: 'human-override',
        calculatedLoanVersion: calculation.calculatedLoanVersion,
        canonicalInputHash: hashCanonical({
          baseCalculationId: calculation.id,
          baseInputHash: calculation.canonicalInputHash,
          overrideQualifyingMonthlyIncome: input.overrideQualifyingMonthlyIncome,
          reasonCode: input.reasonCode,
          reasonNarrative: input.reasonNarrative,
        }),
        sourceDocumentHashes: calculation.sourceDocumentHashes,
        mortgageRuleVersion: calculation.mortgageRuleVersion,
        w2BaseMonthly: calculation.w2BaseMonthly,
        w2VariableMonthly: calculation.w2VariableMonthly,
        scheduleCMonthlyTotal: calculation.scheduleCMonthlyTotal,
        scheduleFMonthlyTotal: calculation.scheduleFMonthlyTotal,
        form1120SMonthlyTotal: calculation.form1120SMonthlyTotal,
        form1065MonthlyTotal: calculation.form1065MonthlyTotal,
        form1120MonthlyTotal: calculation.form1120MonthlyTotal,
        assetIncomeMonthly: calculation.assetIncomeMonthly,
        rentalMonthly: calculation.rentalMonthly,
        rentalLiabilityMonthly: calculation.rentalLiabilityMonthly,
        housingExpenseAdjustment: calculation.housingExpenseAdjustment,
        ...(borrowerLines.length ? { borrowerIncome: borrowerLines } : {}),
      },
      select: {
        id: true, qualifyingMonthlyIncome: true, totalAnnualCashFlow: true,
        yearsAnalyzed: true, calculationSchemaVersion: true, calculationSource: true,
        canonicalInputHash: true, sourceDocumentHashes: true, mortgageRuleVersion: true,
      },
    })
    : calculation;

  if (input.action === AUDIT_ACTIONS.INCOME_OVERRIDE) {
    await transaction.incomeCalculationExtraction.createMany({
      data: calculation.extractionBindings.map((binding) => ({
        tenantId: context.tenantId,
        loanId: loan.id,
        calculationId: approvedCalculation.id,
        extractionId: binding.extractionId,
        extractionHash: binding.extractionHash,
        sourceDocumentId: binding.sourceDocumentId,
        sourceDocumentVersion: binding.sourceDocumentVersion,
        sourceContentHash: binding.sourceContentHash,
      })),
    });
  }

  const event = await appendAuditEvent(transaction, context, {
    loanId: loan.id,
    entityType: 'FORM_1084_AUDIT',
    entityId: approvedCalculation.id,
    expectedLoanVersion: input.expectedLoanVersion,
    action: input.action,
    reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative,
    ruleVersion: approvedCalculation.mortgageRuleVersion,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      calculationId: approvedCalculation.id,
      calculationSchemaVersion: approvedCalculation.calculationSchemaVersion,
      calculationSource: approvedCalculation.calculationSource,
      canonicalInputHash: approvedCalculation.canonicalInputHash,
      sourceDocumentHashes: approvedCalculation.sourceDocumentHashes,
      mortgageRuleVersion: approvedCalculation.mortgageRuleVersion,
      qualifyingMonthlyIncome: approvedCalculation.qualifyingMonthlyIncome.toString(),
      totalAnnualCashFlow: approvedCalculation.totalAnnualCashFlow.toString(),
      yearsAnalyzed: approvedCalculation.yearsAnalyzed,
      borrowers: borrowerLines.map((line) => ({ borrowerKey: line.borrowerKey, ordinal: line.ordinal, qualifyingMonthlyIncome: line.qualifyingMonthlyIncome })),
    }),
  });

  await transaction.form1084Audit.update({
    where: { id: approvedCalculation.id },
    data: {
      isHumanVerified: true,
      verifiedAt: event.occurredAt,
      verifiedByUserId: context.membershipId,
    },
  });

  const versionBump = await transaction.loanApplication.updateMany({
    where: {
      id: loan.id,
      tenantId: context.tenantId,
      version: input.expectedLoanVersion,
    },
    data: {
      version: { increment: 1 },
      status: 'VERIFIED',
    },
  });
  if (versionBump.count !== 1) {
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      'The loan changed since it was loaded. Reload and retry the approval.',
    );
  }

  const result: IncomeApprovalResult = {
    auditEventId: event.id,
    loanVersion: input.expectedLoanVersion + 1,
    calculationId: approvedCalculation.id,
    action: input.action,
    replayed: false,
  };

  await storeIdempotencyResult(transaction, context, {
    operation: INCOME_APPROVAL_OPERATION,
    key: input.idempotencyKey,
    requestHash,
    responseCode: 201,
    responseReference: serializeStoredApproval(result),
  });

  return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOverrideIncome(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
    throw new ApiError(400, 'INVALID_OVERRIDE_INCOME', 'An override requires a bounded monthly income value.');
  }
  return new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();
}

function parseReasonCode(action: IncomeApprovalAction, value: unknown): string {
  if (action === AUDIT_ACTIONS.INCOME_APPROVED) {
    const reasonCode = typeof value === 'string' && value.length > 0
      ? value
      : AUDIT_REASON_CODES.UNDERWRITER_CONFIRMED;
    if (!APPROVAL_REASON_CODES.has(reasonCode)) {
      throw new ApiError(400, 'INVALID_REASON_CODE', 'The approval reason code is not supported.');
    }
    return reasonCode;
  }

  if (typeof value !== 'string' || !OVERRIDE_REASON_CODES.has(value)) {
    throw new ApiError(400, 'INVALID_REASON_CODE', 'The override reason code is not supported.');
  }
  return value;
}

function parseOptionalNarrative(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'INVALID_REASON_NARRATIVE', 'The reason narrative is invalid.');
  }
  const narrative = value.trim();
  if (narrative.length > 500) {
    throw new ApiError(400, 'INVALID_REASON_NARRATIVE', 'The reason narrative exceeds 500 characters.');
  }
  return narrative.length === 0 ? null : narrative;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializeStoredApproval(
  result: Pick<IncomeApprovalResult, 'auditEventId' | 'loanVersion' | 'calculationId' | 'action'>,
): string {
  return JSON.stringify({
    auditEventId: result.auditEventId,
    loanVersion: result.loanVersion,
    calculationId: result.calculationId,
    action: result.action,
  });
}

function parseStoredApproval(reference: string): Omit<IncomeApprovalResult, 'replayed'> {
  const parsed = JSON.parse(reference) as Partial<IncomeApprovalResult>;
  if (
    typeof parsed.auditEventId !== 'string'
    || typeof parsed.loanVersion !== 'number'
    || typeof parsed.calculationId !== 'string'
    || (parsed.action !== AUDIT_ACTIONS.INCOME_APPROVED && parsed.action !== AUDIT_ACTIONS.INCOME_OVERRIDE)
  ) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'The stored approval reference is unusable.');
  }
  return {
    auditEventId: parsed.auditEventId,
    loanVersion: parsed.loanVersion,
    calculationId: parsed.calculationId,
    action: parsed.action,
  };
}
