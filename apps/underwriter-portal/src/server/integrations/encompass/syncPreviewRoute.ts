import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';
import {
  loadApprovedEncompassSyncPreview,
  readSyncPreviewConfiguration,
  type SyncPreviewConfiguration,
} from './syncPreview';

type Dependencies = Readonly<{
  withTenantTransaction: typeof withTenantTransaction;
  previewConfiguration: () => SyncPreviewConfiguration;
}>;

export function createEncompassSyncPreviewHandler(dependencies: Dependencies = {
  withTenantTransaction,
  previewConfiguration: readSyncPreviewConfiguration,
}) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    res.setHeader('Cache-Control', 'no-store');
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
      const preview = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => loadApprovedEncompassSyncPreview(transaction, context, {
          loanId,
          approvalEventId,
          expectedLoanVersion: Number(expectedLoanVersion),
        }, dependencies.previewConfiguration()),
      );
      return res.status(200).json({ ...preview, requestId: context.requestId });
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
