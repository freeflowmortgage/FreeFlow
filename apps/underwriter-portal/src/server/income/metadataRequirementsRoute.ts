import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { withTenantTransaction } from '../database/client';
import { ApiError, sendApiError } from '../http/apiError';
import { isUuid } from '../http/identifiers';
import { ExtractionMetadataRequiredError, mergeAuthoritativeExtractionInputs } from './authoritativeExtractionInput';

export function createMetadataRequirementsHandler(dependencies = { withTenantTransaction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'GET') { res.setHeader('Allow', ['GET']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.', requestId: context.requestId } }); }
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : null;
      const extractionId = typeof req.query.extractionId === 'string' && isUuid(req.query.extractionId) ? req.query.extractionId : null;
      if (!loanId || !extractionId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'The requested identifier is invalid.');
      const loaded = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, async (transaction) => {
        const extraction = await transaction.incomeExtraction.findFirst({
          where: { id: extractionId, loanId, tenantId: context.tenantId },
          select: { id: true, normalizedInput: true, canonicalHash: true, status: true, metadataReviews: { orderBy: { metadataVersion: 'desc' }, take: 1, select: { metadataVersion: true, assignments: true, extractionHash: true } } },
        });
        if (!extraction) return null;
        const roster = await transaction.loanBorrower.findMany({ where: { tenantId: context.tenantId, loanId }, orderBy: { ordinal: 'asc' }, select: { borrowerKey: true } });
        return { extraction, roster };
      });
      if (!loaded) throw new ApiError(404, 'EXTRACTION_NOT_FOUND', 'The requested extraction was not found for this loan.');
      const { extraction } = loaded;
      const review = extraction.metadataReviews[0] ?? null;
      let requirements: readonly unknown[] = [];
      try { mergeAuthoritativeExtractionInputs([{ extractionId, normalizedInput: extraction.normalizedInput, metadataAssignments: review?.assignments as never }], { borrowerRoster: loaded.roster.map((borrower) => borrower.borrowerKey) }); }
      catch (error) { if (error instanceof ExtractionMetadataRequiredError) requirements = error.requirements.filter((item) => item.extractionId === extractionId); else throw error; }
      return res.status(200).json({ extractionId, status: extraction.status, review: review ? { metadataVersion: review.metadataVersion, assignments: review.assignments, current: review.extractionHash === extraction.canonicalHash } : null, requirements, requestId: context.requestId });
    } catch (error) { if (error instanceof ApiError) return sendApiError(res, context.requestId, error); throw error; }
  };
}
