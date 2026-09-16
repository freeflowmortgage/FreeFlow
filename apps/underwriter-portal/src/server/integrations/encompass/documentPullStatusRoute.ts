import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';

type DocumentPullStatusDependencies = {
  withTenantTransaction: typeof withTenantTransaction;
};

const defaultDependencies: DocumentPullStatusDependencies = { withTenantTransaction };

export function createDocumentPullStatusHandler(
  dependencies: DocumentPullStatusDependencies = defaultDependencies,
) {
  return async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
    context: RequestContext,
  ) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId },
      });
    }

    try {
      const jobId = readJobId(req.query.jobId);
      const job = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => transaction.encompassDocumentPullJob.findFirst({
          where: { id: jobId, tenantId: context.tenantId },
          select: {
            id: true,
            loanId: true,
            status: true,
            expectedLoanVersion: true,
            attemptCount: true,
            safeErrorCode: true,
            attachmentCount: true,
            processedCount: true,
            createdAt: true,
            startedAt: true,
            completedAt: true,
          },
        }),
      );
      if (!job) throw new ApiError(404, 'DOCUMENT_PULL_NOT_FOUND', 'The document pull job was not found.');

      return res.status(200).json({ ...job, requestId: context.requestId });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}

function readJobId(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new ApiError(400, 'INVALID_IDENTIFIER', 'The jobId is not a valid identifier.');
  }
  return value;
}
