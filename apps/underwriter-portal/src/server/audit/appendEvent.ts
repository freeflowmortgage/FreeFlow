import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';

const SHA_256_HEX = /^[0-9a-f]{64}$/;

export type AuditEventInput = Readonly<{
  loanId: string;
  entityType: 'FORM_1084_AUDIT';
  entityId: string;
  expectedLoanVersion: number;
  action: 'INCOME_CALCULATION_COMPLETED';
  reasonCode: 'SYSTEM_CALCULATION';
  ruleVersion: string;
  schemaVersion: 'audit-event-v1';
  resultHash: string;
}>;

/**
 * Hashes a deliberately small, non-sensitive result projection. Callers must
 * not pass raw requests, document content, OCR text, borrower data, or secrets.
 */
export function hashAuditResult(value: Record<string, unknown>): string {
  return sha256(canonicalJson(value));
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
  const eventHash = sha256(canonicalJson({
    id,
    tenantId: context.tenantId,
    loanId: input.loanId,
    actorUserId: context.membershipId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    expectedLoanVersion: input.expectedLoanVersion,
    reasonCode: input.reasonCode,
    reasonNarrative: null,
    ruleVersion: input.ruleVersion,
    schemaVersion: input.schemaVersion,
    requestId: context.requestId,
    resultHash: input.resultHash,
    previousEventHash,
    occurredAt: occurredAt.toISOString(),
  }));

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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Audit hash input must contain finite numbers.');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  throw new Error('Audit hash input must be JSON-compatible.');
}
