import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import {
  APPROVED_INCOME_JSON_PROFILE,
  MISMO_APPROVED_INCOME_PROFILE,
  MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  renderApprovedIncomeSummaryPdf,
  serializeApprovedIncomeJson,
  serializeApprovedIncomeMismo,
} from '../exports/approvedIncomeExports';
import { loadApprovedIncomeSnapshot } from '../exports/approvedIncomeSnapshot';
import { ApiError, sendApiError } from './apiError';
import { isUuid } from './identifiers';

type ExportFormat = 'json' | 'mismo' | 'summary';

export function createApprovedIncomeExportHandler(dependencies = {
  withTenantTransaction,
  renderPdf: renderApprovedIncomeSummaryPdf,
}) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId },
      });
    }
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : null;
      if (!loanId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'The loanId is not a valid identifier.');
      const format = readFormat(req.query.format);
      const snapshot = await dependencies.withTenantTransaction(
        { tenantId: context.tenantId, principalId: context.membershipId },
        (transaction) => loadApprovedIncomeSnapshot(transaction, context, loanId),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-FreeFlow-Snapshot-Hash', snapshot.snapshotHash);

      if (format === 'json') {
        const body = serializeApprovedIncomeJson(snapshot);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="FreeFlow_Approved_Income_${loanId}.json"`);
        res.setHeader('X-FreeFlow-Export-Profile', APPROVED_INCOME_JSON_PROFILE);
        return res.status(200).send(body);
      }
      if (format === 'mismo') {
        const body = serializeApprovedIncomeMismo(snapshot);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="FreeFlow_Approved_Income_${loanId}.xml"`);
        res.setHeader('X-FreeFlow-Export-Profile', MISMO_APPROVED_INCOME_PROFILE);
        res.setHeader('X-MISMO-Official-XSD-Validation', MISMO_OFFICIAL_XSD_VALIDATION_STATUS);
        return res.status(200).send(body);
      }

      const body = await dependencies.renderPdf(snapshot);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(body.byteLength));
      res.setHeader('Content-Disposition', `attachment; filename="FreeFlow_Approved_Income_Summary_${loanId}.pdf"`);
      res.setHeader('X-FreeFlow-Export-Profile', 'freeflow-approved-income-summary-pdf-v1');
      return res.status(200).send(body);
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      throw error;
    }
  };
}

function readFormat(value: string | string[] | undefined): ExportFormat {
  if (value === 'json' || value === 'mismo' || value === 'summary') return value;
  throw new ApiError(404, 'EXPORT_FORMAT_NOT_FOUND', 'The requested approved-income export format was not found.');
}
