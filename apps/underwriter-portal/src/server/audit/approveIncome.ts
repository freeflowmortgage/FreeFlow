import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { hashCanonical } from '../http/canonical';
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
  expectedLoanVersion: number;
  action: IncomeApprovalAction;
  reasonCode: string;
  reasonNarrative: string | null;
  idempotencyKey: string;
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
): Pick<IncomeApprovalRequest, 'expectedLoanVersion' | 'action' | 'reasonCode' | 'reasonNarrative'> {
  const payload = isRecord(body) ? body : {};
  const expectedLoanVersion = payload.expectedLoanVersion;
  if (typeof expectedLoanVersion !== 'number' || !Number.isInteger(expectedLoanVersion) || expectedLoanVersion < 1) {
    throw new ApiError(400, 'INVALID_LOAN_VERSION', 'A positive expectedLoanVersion is required.');
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

  return {
    expectedLoanVersion,
    action: requestedAction,
    reasonCode,
    reasonNarrative,
  };
}

export async function approveIncomeCalculation(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: IncomeApprovalRequest,
): Promise<IncomeApprovalResult> {
  const requestHash = hashCanonical({
    loanId: input.loanId,
    expectedLoanVersion: input.expectedLoanVersion,
    action: input.action,
    reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative,
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
    where: { loanId: loan.id, tenantId: context.tenantId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      qualifyingMonthlyIncome: true,
      totalAnnualCashFlow: true,
      yearsAnalyzed: true,
      calculationSchemaVersion: true,
      calculationSource: true,
    },
  });
  if (!calculation) {
    throw new ApiError(
      422,
      'CALCULATION_REQUIRED',
      'A server-side income calculation must exist before approval.',
    );
  }

  const event = await appendAuditEvent(transaction, context, {
    loanId: loan.id,
    entityType: 'FORM_1084_AUDIT',
    entityId: calculation.id,
    expectedLoanVersion: input.expectedLoanVersion,
    action: input.action,
    reasonCode: input.reasonCode,
    reasonNarrative: input.reasonNarrative,
    ruleVersion: calculation.calculationSchemaVersion,
    schemaVersion: 'audit-event-v1',
    resultHash: hashAuditResult({
      calculationId: calculation.id,
      calculationSchemaVersion: calculation.calculationSchemaVersion,
      calculationSource: calculation.calculationSource,
      qualifyingMonthlyIncome: calculation.qualifyingMonthlyIncome.toString(),
      totalAnnualCashFlow: calculation.totalAnnualCashFlow.toString(),
      yearsAnalyzed: calculation.yearsAnalyzed,
    }),
  });

  await transaction.form1084Audit.update({
    where: { id: calculation.id },
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
    calculationId: calculation.id,
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
