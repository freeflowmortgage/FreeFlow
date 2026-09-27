import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isIdempotencyKey, isUuid } from '../../http/identifiers';
import { createEncompassSyncJob, markSyncQueueFailure, publishEncompassSyncJob, type EncompassSyncQueueMessage } from './sync';

type Dependencies = {
  withTenantTransaction: typeof withTenantTransaction;
  publishJob: (message: EncompassSyncQueueMessage) => Promise<void>;
};

export function createEncompassSyncHandler(dependencies: Dependencies = {
  withTenantTransaction,
  publishJob: publishEncompassSyncJob,
}) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId } });
    }
    try {
      const loanId = readUuid(req.query.loanId, 'loanId');
      const approvalEventId = readUuid((req.body as { approvalEventId?: unknown } | null)?.approvalEventId, 'approvalEventId');
      const expectedLoanVersion = (req.body as { expectedLoanVersion?: unknown } | null)?.expectedLoanVersion;
      if (!Number.isSafeInteger(expectedLoanVersion) || Number(expectedLoanVersion) < 1) {
        throw new ApiError(400, 'INVALID_LOAN_VERSION', 'expectedLoanVersion must be a positive integer.');
      }
      const header = req.headers['idempotency-key'];
      if (Array.isArray(header) || typeof header !== 'string' || !isIdempotencyKey(header)) {
        throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
      }
      const result = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => createEncompassSyncJob(transaction, context, {
          loanId, approvalEventId, expectedLoanVersion: Number(expectedLoanVersion), idempotencyKey: header,
        }),
      );
      if (!['SUCCEEDED', 'FAILED', 'IN_PROGRESS', 'RECONCILING'].includes(result.status)) {
        const message: EncompassSyncQueueMessage = {
          jobId: result.id,
          tenantId: context.tenantId,
          loanId,
          approvalEventId,
          expectedLoanVersion: result.expectedLoanVersion,
          idempotencyKey: header,
          correlationId: result.correlationId,
        };
        try {
          await dependencies.publishJob(message);
        } catch {
          await dependencies.withTenantTransaction(
            { tenantId: context.tenantId, principalId: context.membershipId },
            (transaction) => markSyncQueueFailure(transaction, context, result.id),
          );
          return res.status(503).json({ error: { code: 'SYNC_QUEUE_UNAVAILABLE', message: 'The sync could not be queued. It is safe to retry.', requestId: context.requestId } });
        }
      }
      return res.status(202).json({ jobId: result.id, status: result.status, replayed: result.replayed, requestId: context.requestId });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}

function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) throw new ApiError(400, 'INVALID_IDENTIFIER', `${field} is invalid.`);
  return value;
}
