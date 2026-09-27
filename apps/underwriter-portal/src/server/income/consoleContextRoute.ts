import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import { ApiError, sendApiError } from '../http/apiError';
import { isUuid } from '../http/identifiers';

export function createConsoleContextHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'GET') { res.setHeader('Allow', ['GET']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId } }); }
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : null;
      if (!loanId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'The loanId is not a valid identifier.');
      const loan = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => transaction.loanApplication.findFirst({
        where: { id: loanId, tenantId: context.tenantId },
        select: {
          id: true, version: true, status: true, loanProgram: true, primaryBorrowerName: true,
          documents: { where: { sourceAttachmentId: { not: null } }, orderBy: { uploadedAt: 'desc' }, select: { sourceAttachmentId: true, documentCategory: true, version: true, sourcePageCount: true, parserVersion: true } },
          incomeExtractions: { orderBy: { createdAt: 'desc' }, select: { id: true, sourceAttachmentId: true, sourceDocumentVersion: true, parserVersion: true, schemaVersion: true, status: true, warnings: true, confidence: true, canonicalHash: true, metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { id: true, metadataVersion: true, assignments: true, source: true, reasonCode: true, createdAt: true, extractionHash: true } } } },
          form1084Audits: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, calculatedLoanVersion: true, qualifyingMonthlyIncome: true, trendingResult: true, yearsAnalyzed: true, calculationSchemaVersion: true, calculationSource: true, createdAt: true } },
          auditEvents: { where: { action: { in: ['INCOME_APPROVED', 'INCOME_OVERRIDE'] } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, action: true, entityId: true, expectedLoanVersion: true, occurredAt: true } },
          encompassDocumentPullJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, expectedLoanVersion: true, attachmentCount: true, processedCount: true, safeErrorCode: true, completedAt: true } },
          encompassSyncJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, approvalEventId: true, expectedLoanVersion: true, safeErrorCode: true, completedAt: true } },
        },
      }));
      if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
      const calculation = loan.form1084Audits[0] ?? null;
      const approval = loan.auditEvents[0] ?? null;
      return res.status(200).json({
        loan: { id: loan.id, version: loan.version, status: loan.status, program: loan.loanProgram, borrowerName: loan.primaryBorrowerName },
        attachments: loan.documents.map((item) => ({ attachmentId: item.sourceAttachmentId, category: item.documentCategory, version: item.version, pageCount: item.sourcePageCount, parserVersion: item.parserVersion })),
        providerAttachmentListing: { available: false, reason: 'PROVIDER_ATTACHMENT_LISTING_NOT_CONFIGURED' },
        extractions: loan.incomeExtractions.map((item) => ({ id: item.id, attachmentId: item.sourceAttachmentId, sourceDocumentVersion: item.sourceDocumentVersion, parserVersion: item.parserVersion, schemaVersion: item.schemaVersion, status: item.status, warnings: item.warnings, confidence: item.confidence, metadataReview: item.metadataReviews[0] ? { ...item.metadataReviews[0], current: item.metadataReviews[0].extractionHash === item.canonicalHash } : null })),
        calculation: calculation ? { ...calculation, current: calculation.calculatedLoanVersion === loan.version } : null,
        approval: approval ? { ...approval, current: approval.expectedLoanVersion <= loan.version && approval.entityId === calculation?.id } : null,
        documentPull: loan.encompassDocumentPullJobs[0] ?? null,
        sync: loan.encompassSyncJobs[0] ?? null,
        requestId: context.requestId,
      });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}
