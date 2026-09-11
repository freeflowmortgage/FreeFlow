import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { hashCanonical } from '../http/canonical';

const SHA_256_HEX = /^[0-9a-f]{64}$/;

export const AUDIT_ACTIONS = {
  INCOME_CALCULATION_COMPLETED: 'INCOME_CALCULATION_COMPLETED',
  INCOME_APPROVED: 'INCOME_APPROVED',
  INCOME_OVERRIDE: 'INCOME_OVERRIDE',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_REASON_CODES = {
  SYSTEM_CALCULATION: 'SYSTEM_CALCULATION',
  UNDERWRITER_CONFIRMED: 'UNDERWRITER_CONFIRMED',
  INCOME_ADJUSTED: 'INCOME_ADJUSTED',
  DOCUMENTATION_EXCEPTION: 'DOCUMENTATION_EXCEPTION',
  MANUAL_RECALCULATION: 'MANUAL_RECALCULATION',
} as const;

export type AuditEventInput = Readonly<{
  loanId: string;
  entityType: 'FORM_1084_AUDIT';
  entityId: string;
  expectedLoanVersion: number;
  action: AuditAction;
  reasonCode: string;
  reasonNarrative?: string | null;
  ruleVersion: string;
  schemaVersion: 'audit-event-v1';
  resultHash: string;
}>;

/**
 * Hashes a deliberately small, non-sensitive result projection. Callers must
 * not pass raw requests, document content, OCR text, borrower data, or secrets.
 */
export function hashAuditResult(value: Record<string, unknown>): string {
  return hashCanonical(value);
}

/**
 * Appends a tenant-scoped audit event to the hash chain. The PostgreSQL advisory
 * lock serializes each tenant's tail read/write inside the caller's transaction.
 */
export async function appendAuditEvent(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: AuditEventInput,
) {
  if (!SHA_256_HEX.test(input.resultHash)) {
    throw new Error('Audit result hash must be a lowercase SHA-256 digest.');
  }

  const reasonNarrative = normalizeReasonNarrative(input);

  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId}, 0))
  `;

  const previousEvent = await transaction.auditEvent.findFirst({
    where: { tenantId: context.tenantId },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { eventHash: true },
  });

  const id = randomUUID();
  const occurredAt = new Date();
  const previousEventHash = previousEvent?.eventHash ?? null;
  const eventHash = hashCanonical({
    id,
    tenantId: context.tenantId,
    loanId: input.loanId,
    actorUserId: context.membershipId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    expectedLoanVersion: input.expectedLoanVersion,
    reasonCode: input.reasonCode,
    reasonNarrative,
    ruleVersion: input.ruleVersion,
    schemaVersion: input.schemaVersion,
    requestId: context.requestId,
    resultHash: input.resultHash,
    previousEventHash,
    occurredAt: occurredAt.toISOString(),
  });

  return transaction.auditEvent.create({
    data: {
      id,
      tenantId: context.tenantId,
      loanId: input.loanId,
      actorUserId: context.membershipId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      expectedLoanVersion: input.expectedLoanVersion,
      reasonCode: input.reasonCode,
      reasonNarrative,
      ruleVersion: input.ruleVersion,
      schemaVersion: input.schemaVersion,
      requestId: context.requestId,
      resultHash: input.resultHash,
      previousEventHash,
      eventHash,
      occurredAt,
    },
  });
}

function normalizeReasonNarrative(input: AuditEventInput): string | null {
  if (input.action === AUDIT_ACTIONS.INCOME_CALCULATION_COMPLETED) {
    return null;
  }

  const narrative = input.reasonNarrative?.trim() ?? '';
  if (input.action === AUDIT_ACTIONS.INCOME_OVERRIDE && narrative.length === 0) {
    throw new Error('Override events require a reason narrative.');
  }
  if (narrative.length > 500) {
    throw new Error('Audit reason narrative exceeds the stored length limit.');
  }
  return narrative.length === 0 ? null : narrative;
}
