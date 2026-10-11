import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';
import { FieldReadbackValidationError, sanitizeFieldReadback } from './fieldReadback';

type SyncStatusDependencies = { withTenantTransaction: typeof withTenantTransaction };

export function createEncompassSyncStatusHandler(
  dependencies: SyncStatusDependencies = { withTenantTransaction },
) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId } });
    }
    try {
      const jobId = typeof req.query.jobId === 'string' && isUuid(req.query.jobId) ? req.query.jobId : null;
      if (!jobId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'jobId is invalid.');
      const job = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => transaction.encompassSyncJob.findFirst({
          where: { id: jobId, tenantId: context.tenantId },
          select: {
            id: true, loanId: true, approvalEventId: true, expectedLoanVersion: true,
            status: true, attemptCount: true, reconciliationCount: true, safeErrorCode: true,
            fieldReadback: true,
            createdAt: true, startedAt: true, completedAt: true,
          },
        }),
      );
      if (!job) throw new ApiError(404, 'SYNC_JOB_NOT_FOUND', 'The sync job was not found.');
      let fieldReadback = null;
      if (job.fieldReadback !== null) {
        if (job.status !== 'SUCCEEDED' && job.status !== 'FAILED') throw new FieldReadbackValidationError();
        fieldReadback = sanitizeFieldReadback(job.fieldReadback, { expectedOutcome: job.status });
      }
      return res.status(200).json({ ...job, fieldReadback, requestId: context.requestId });
    } catch (error) {
      if (error instanceof FieldReadbackValidationError) {
        return sendApiError(res, context.requestId, new ApiError(
          503,
          error.safeCode,
          'The sync readback evidence is unavailable.',
        ));
      }
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}
