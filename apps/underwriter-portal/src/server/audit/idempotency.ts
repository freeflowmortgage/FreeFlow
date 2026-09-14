import { Prisma } from '@prisma/client';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';

export const INCOME_APPROVAL_OPERATION = 'income-approvals';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type StoredIdempotencyResponse = Readonly<{
  responseCode: number;
  responseReference: string;
}>;

export type IdempotencyDecision =
  | { kind: 'replay'; stored: StoredIdempotencyResponse }
  | { kind: 'proceed' };

/**
 * Serializes one tenant/operation/key inside the caller's transaction, then
 * either replays a stored safe reference or allows the mutation to proceed.
 */
export async function resolveIdempotencyKey(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{
    operation: string;
    key: string;
    requestHash: string;
  }>,
): Promise<IdempotencyDecision> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${input.operation}:${input.key}`}, 1))
  `;

  const existing = await transaction.apiIdempotencyKey.findFirst({
    where: {
      tenantId: context.tenantId,
      operation: input.operation,
      key: input.key,
    },
    select: {
      requestHash: true,
      responseCode: true,
      responseReference: true,
    },
  });

  if (!existing) return { kind: 'proceed' };
  if (existing.requestHash !== input.requestHash) {
    throw new ApiError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'The idempotency key was already used with a different request.',
    );
  }

  return {
    kind: 'replay',
    stored: {
      responseCode: existing.responseCode,
      responseReference: existing.responseReference,
    },
  };
}

export async function storeIdempotencyResult(
  transaction: Prisma.TransactionClient,
  context: RequestContext,
  input: Readonly<{
    operation: string;
    key: string;
    requestHash: string;
    responseCode: number;
    responseReference: string;
  }>,
): Promise<void> {
  try {
    await transaction.apiIdempotencyKey.create({
      data: {
        tenantId: context.tenantId,
        operation: input.operation,
        key: input.key,
        requestHash: input.requestHash,
        responseCode: input.responseCode,
        responseReference: input.responseReference,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'The idempotency key was already used with a different request.',
      );
    }
    throw error;
  }
}
