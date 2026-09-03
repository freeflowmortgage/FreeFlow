import type { NextApiRequest, NextApiResponse } from 'next';
import PDFDocument from 'pdfkit';
import { PrismaClient } from '@prisma/client';
import {
  DEMO_INCOME_SUMMARY,
  renderIncomeSummaryPdf,
  type IncomeSummaryPdfData,
} from '../../../../../packages/mortgage-engine/src/generateIncomeSummaryPdf';

const prisma = new PrismaClient();

/**
 * Streams a Form 1084 income summary PDF from RAM (PDFKit → res).
 * No temp files. Uses Prisma when DATABASE_URL + loan row exist; otherwise the local demo fixture.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const loanIdRaw = req.method === 'GET' ? req.query.loanId : req.body?.loanId;
  const loanId = Array.isArray(loanIdRaw) ? loanIdRaw[0] : loanIdRaw;
  const tenantId = req.headers['x-tenant-id'] as string | undefined;

  if (!loanId || typeof loanId !== 'string') {
    return res.status(400).json({ error: 'Invalid Request: Missing required string parameter [loanId].' });
  }

  try {
    const data = await loadSummaryData(loanId, tenantId);

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
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Summary PDF API Route Error] System Failure:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: `Document generation failed during in-memory PDF compilation: ${message}`,
      });
    }
  }
}

async function loadSummaryData(loanId: string, tenantId?: string): Promise<IncomeSummaryPdfData> {
  const fallback: IncomeSummaryPdfData = { ...DEMO_INCOME_SUMMARY, loanId };

  if (!process.env.DATABASE_URL) {
    return fallback;
  }

  try {
    const loanApp = await prisma.loanApplication.findFirst({
      where: tenantId ? { id: loanId, tenantId } : { id: loanId },
      include: { tenant: true, documents: true },
    });

    if (!loanApp) {
      return fallback;
    }

    return {
      ...fallback,
      primaryBorrowerName: loanApp.primaryBorrowerName,
      primaryBorrowerEmail: loanApp.primaryBorrowerEmail,
      tenantCompanyName: loanApp.tenant.companyName,
    };
  } catch {
    return fallback;
  }
}
