import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect } from 'vite';
import PDFDocument from 'pdfkit';
import {
  DEMO_INCOME_SUMMARY,
  renderIncomeSummaryPdf,
} from '../../../../Packages/mortgage-engine/src/generateIncomeSummaryPdf';

function loanIdFromRequest(req: IncomingMessage): string | null {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const fromQuery = url.searchParams.get('loanId');
  if (fromQuery) return fromQuery;
  return DEMO_INCOME_SUMMARY.loanId;
}

export function summaryPdfMiddleware(): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const path = (req.url || '').split('?')[0];
    if (path !== '/api/underwrite/summary-pdf') {
      next();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, POST');
      res.end();
      return;
    }

    const loanId = loanIdFromRequest(req);
    if (!loanId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing required string parameter [loanId].' }));
      return;
    }

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      bufferPages: true,
    });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=FreeFlow_Income_Summary_Loan_${loanId}.pdf`);

    doc.pipe(res);
    renderIncomeSummaryPdf(doc as unknown as Parameters<typeof renderIncomeSummaryPdf>[0], {
      ...DEMO_INCOME_SUMMARY,
      loanId,
    });
    doc.end();
  };
}
