import type { NextApiRequest, NextApiResponse } from 'next';
import { type RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import { ApiError, sendApiError } from '../http/apiError';
import { isIdempotencyKey, isUuid } from '../http/identifiers';
import { approveIncomeCalculation, parseIncomeApprovalBody } from './approveIncome';

type ApprovalHandlerDependencies = {
  withTenantTransaction: typeof withTenantTransaction;
};

const defaultDependencies: ApprovalHandlerDependencies = {
  withTenantTransaction,
};

export function createIncomeApprovalHandler(
  dependencies: ApprovalHandlerDependencies = defaultDependencies,
) {
  return async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
    context: RequestContext,
  ) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST is supported.',
          requestId: context.requestId,
        },
      });
    }

    try {
      const loanId = readPathUuid(req.query.loanId, 'loanId');
      const idempotencyKey = readIdempotencyKey(req);
      const body = parseIncomeApprovalBody(req.body);

      const result = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => approveIncomeCalculation(transaction, context, {
          loanId,
          idempotencyKey,
          ...body,
        }),
      );

      return res.status(201).json({
        auditEventId: result.auditEventId,
        loanVersion: result.loanVersion,
        calculationId: result.calculationId,
        action: result.action,
        requestId: context.requestId,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return sendApiError(res, context.requestId, error);
      }
      throw error;
    }
  };
}

function readPathUuid(value: string | string[] | undefined, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ApiError(400, 'INVALID_IDENTIFIER', `The ${field} is not a valid identifier.`);
  }
  return value;
}

function readIdempotencyKey(req: NextApiRequest): string {
  const header = req.headers['idempotency-key'];
  if (Array.isArray(header) || typeof header !== 'string' || !isIdempotencyKey(header)) {
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
    );
  }
  return header;
}
