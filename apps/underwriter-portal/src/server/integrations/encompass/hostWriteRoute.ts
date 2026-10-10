import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';
import { authorizeHostWrite, completeHostWrite } from './hostWrite';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._~-]{16,128}$/;
const SHA_256 = /^[0-9a-f]{64}$/;

export function createHostFieldMapHandler(dependencies = { withTenantTransaction, appOrigin: process.env.APP_ORIGIN }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') return methodNotAllowed(res);
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : '';
      const approvalEventId = typeof req.body?.approvalEventId === 'string' && isUuid(req.body.approvalEventId) ? req.body.approvalEventId : '';
      const expectedLoanVersion = Number(req.body?.expectedLoanVersion);
      const idempotencyKey = readIdempotencyKey(req);
      if (!loanId || !approvalEventId || !Number.isSafeInteger(expectedLoanVersion) || expectedLoanVersion < 1) throw new ApiError(400, 'INVALID_HOST_WRITE_REQUEST', 'The hosted write request is invalid.');
      const appOrigin = validOrigin(dependencies.appOrigin);
      const result = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => authorizeHostWrite(transaction, context, { loanId, approvalEventId, expectedLoanVersion, idempotencyKey, appOrigin }));
      return res.status(result.replayed ? 200 : 201).json({ ...result, requestId: context.requestId });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}

export function createHostWriteCompletionHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') return methodNotAllowed(res);
    try {
      const writeId = typeof req.query.writeId === 'string' && isUuid(req.query.writeId) ? req.query.writeId : '';
      const fieldMapHash = typeof req.body?.fieldMapHash === 'string' && SHA_256.test(req.body.fieldMapHash) ? req.body.fieldMapHash : '';
      const outcome = req.body?.outcome === 'SUCCEEDED' || req.body?.outcome === 'FAILED' ? req.body.outcome : '';
      const idempotencyKey = readIdempotencyKey(req);
      if (!writeId || !fieldMapHash || !outcome) throw new ApiError(400, 'INVALID_HOST_WRITE_COMPLETION', 'The hosted write completion is invalid.');
      const result = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => completeHostWrite(transaction, context, { writeId, fieldMapHash, outcome, idempotencyKey }));
      return res.status(200).json({ ...result, requestId: context.requestId });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}

function readIdempotencyKey(req: NextApiRequest): string {
  const value = req.headers['idempotency-key'];
  const key = Array.isArray(value) ? '' : value?.trim() ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required.');
  return key;
}
function validOrigin(value: string | undefined): string {
  try { const url = new URL(value ?? ''); if (url.protocol !== 'https:' || url.origin === 'null' || url.pathname !== '/' || url.search || url.hash) throw new Error(); return url.origin; }
  catch { throw new ApiError(503, 'HOST_WRITE_CONFIGURATION_UNAVAILABLE', 'Hosted write configuration is unavailable.'); }
}
function methodNotAllowed(res: NextApiResponse) { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED' } }); }
