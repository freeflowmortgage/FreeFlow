import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import { ApiError, sendApiError } from '../http/apiError';
import { isIdempotencyKey, isUuid } from '../http/identifiers';
import { parseMetadataReviewBody, reviewExtractionMetadata } from './reviewExtractionMetadata';

export function createExtractionMetadataReviewHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId } }); }
    try {
      const loanId = pathUuid(req.query.loanId); const extractionId = pathUuid(req.query.extractionId);
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !isIdempotencyKey(key)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
      const body = parseMetadataReviewBody(req.body);
      const result = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => reviewExtractionMetadata(transaction, context, { loanId, extractionId, idempotencyKey: key, ...body }));
      return res.status(result.replayed ? 200 : 201).json({ ...result, requestId: context.requestId });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}
function pathUuid(value: string | string[] | undefined): string { if (typeof value !== 'string' || !isUuid(value)) throw new ApiError(400, 'INVALID_IDENTIFIER', 'A route identifier is invalid.'); return value; }
