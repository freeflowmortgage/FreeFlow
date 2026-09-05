import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import {
  DEMO_INCOME_SUMMARY,
  renderIncomeSummaryPdf,
  type IncomeSummaryPdfData,
} from '@mortgage-pos/mortgage-engine';
import { isProtectedRuntime } from '../../../server/runtimeMode';
import { withRequestContext, type RequestContext } from '../../../server/auth/requestContext';
import { withTenantTransaction } from '../../../server/database/client';

/**
 * Streams a Form 1084 income summary PDF from RAM (PDFKit → res).
 * No temp files. Local development may use a synthetic fixture; protected
 * runtimes fail closed when the database or requested loan is unavailable.
 */
async function handler(req: NextApiRequest, res: NextApiResponse, context: RequestContext) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loanIdRaw = req.method === 'GET' ? req.query.loanId : req.body?.loanId;
  const loanId = Array.isArray(loanIdRaw) ? loanIdRaw[0] : loanIdRaw;

  if (!loanId || typeof loanId !== 'string') {
    return res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'loanId must be a non-empty string.' },
    });
  }

  try {
    const data = await loadSummaryData(loanId, context);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      bufferPages: true,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=FreeFlow_Income_Summary_Loan_${loanId}.pdf`);

    doc.pipe(res);
    renderIncomeSummaryPdf(doc as unknown as Parameters<typeof renderIncomeSummaryPdf>[0], data);
    doc.end();
  } catch (error: unknown) {
    const publicError = toPublicError(error);
    console.error('[summary-pdf] request failed', {
      code: publicError.code,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    if (!res.headersSent) {
      return res.status(publicError.status).json({
        error: { code: publicError.code, message: publicError.message },
      });
    }
    res.destroy();
  }
}

export default withRequestContext('loan:read', handler);

async function loadSummaryData(loanId: string, context: RequestContext): Promise<IncomeSummaryPdfData> {
  const fallback: IncomeSummaryPdfData = { ...DEMO_INCOME_SUMMARY, loanId };

  if (!process.env.DATABASE_URL) {
    if (isProtectedRuntime()) {
      throw new SummaryDataError(503, 'DATABASE_UNAVAILABLE', 'The summary data service is unavailable.');
    }
    return fallback;
  }

  try {
    const loanApp = await withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      (transaction) => transaction.loanApplication.findFirst({
        where: { id: loanId, tenantId: context.tenantId },
        include: { tenant: true, documents: true },
      }),
    );

    if (!loanApp) {
      if (isProtectedRuntime()) {
        throw new SummaryDataError(404, 'LOAN_NOT_FOUND', 'The requested loan was not found.');
      }
      return fallback;
    }

    return {
      ...fallback,
      primaryBorrowerName: loanApp.primaryBorrowerName,
      primaryBorrowerEmail: loanApp.primaryBorrowerEmail,
      tenantCompanyName: loanApp.tenant.companyName,
    };
  } catch (error) {
    if (error instanceof SummaryDataError) throw error;
    if (isProtectedRuntime()) {
      throw new SummaryDataError(503, 'DATABASE_UNAVAILABLE', 'The summary data service is unavailable.');
    }
    return fallback;
  }
}

class SummaryDataError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SummaryDataError';
  }
}

function toPublicError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof SummaryDataError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return {
    status: 500,
    code: 'DOCUMENT_GENERATION_FAILED',
    message: 'The summary document could not be generated.',
  };
}
