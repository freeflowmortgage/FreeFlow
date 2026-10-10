import { randomUUID } from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isUuid } from '../../http/identifiers';
import { EncompassApiError } from './encompassApi';
import { parseWithIncomeService } from './encompassApi';
import { persistParsedExtraction } from './documentPullWorkerRuntime';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;

function parserUrl(): string {
  const value = process.env.DOC_PARSER_SERVICE_URL?.trim();
  if (!value) throw new EncompassApiError('DOCUMENT_PARSER_UNAVAILABLE', 'Document processing is unavailable.', true);
  return value;
}

async function readPdf(req: NextApiRequest): Promise<Buffer> {
  const type = String(req.headers['content-type'] ?? '').toLowerCase().split(';')[0].trim();
  if (type !== 'application/pdf') throw new ApiError(422, 'UNSUPPORTED_DOCUMENT_MEDIA', 'Only PDF documents are supported.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_DOCUMENT_BYTES) throw new ApiError(422, 'DOCUMENT_TOO_LARGE', 'The document exceeds the allowed size.');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new ApiError(422, 'INVALID_PDF', 'The uploaded document is not a valid PDF.');
  return bytes;
}

/**
 * Direct customer upload intake. Bytes remain in memory only and are persisted
 * through the exact LoanDocument/IncomeExtraction provenance path used by pulls.
 */
export function createUploadIncomeDocumentHandler(dependencies = { withTenantTransaction, parse: parseWithIncomeService, persist: persistParsedExtraction }) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (req.method !== 'POST') { res.setHeader('Allow', ['POST']); return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported.', requestId: context.requestId } }); }
    let bytes: Buffer | undefined;
    try {
      const loanId = typeof req.query.loanId === 'string' && isUuid(req.query.loanId) ? req.query.loanId : null;
      if (!loanId) throw new ApiError(400, 'INVALID_IDENTIFIER', 'The loanId is not a valid identifier.');
      const loan = await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => transaction.loanApplication.findFirst({ where: { id: loanId, tenantId: context.tenantId }, select: { id: true } }));
      if (!loan) throw new ApiError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
      bytes = await readPdf(req);
      const attachmentId = `upload-${randomUUID()}`;
      const parsed = await dependencies.parse(bytes, { parserUrl: parserUrl() });
      const sha256 = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
      await dependencies.withTenantTransaction({ tenantId: context.tenantId, principalId: context.membershipId }, (transaction) => dependencies.persist(transaction, {
        jobId: `upload-${context.requestId}`, tenantId: context.tenantId, loanId, correlationId: context.requestId,
        encompassLoanGuid: '', lenderId: '', deploymentId: '', selectedAttachmentIds: [attachmentId],
      } as never, { attachmentId, sha256, parsed }, 'AUTHENTICATED_UPLOAD'));
      return res.status(201).json({ source: 'UPLOAD', attachmentId, status: 'PROCESSED', requestId: context.requestId });
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      if (error instanceof EncompassApiError) return res.status(error.retryable ? 503 : 422).json({ error: { code: error.retryable ? 'DOCUMENT_PROCESSOR_UNAVAILABLE' : 'DOCUMENT_PROCESSOR_REJECTED', message: 'The uploaded document could not be processed.', requestId: context.requestId } });
      throw error;
    } finally { bytes?.fill(0); }
  };
}
