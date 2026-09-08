import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect } from 'vite';
import PDFDocument from 'pdfkit';
import {
  DEMO_INCOME_SUMMARY,
  renderIncomeSummaryPdf,
  type IncomeSummaryPdfData,
  type IncomeSummaryRentalSchedule,
  type IncomeSummarySourceLine,
} from '../../../../packages/mortgage-engine/src/generateIncomeSummaryPdf';

function loanIdFromUrl(req: IncomingMessage): string | null {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  return url.searchParams.get('loanId');
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function asSourceLines(value: unknown): IncomeSummarySourceLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      if (typeof item.source !== 'string' || typeof item.method !== 'string') return null;
      const monthly = Number(item.monthly);
      if (!Number.isFinite(monthly)) return null;
      return { source: item.source, method: item.method, monthly };
    })
    .filter((row): row is IncomeSummarySourceLine => row !== null);
  return lines.length ? lines : undefined;
}

function asRentalSchedule(value: unknown): IncomeSummaryRentalSchedule | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.properties)) return undefined;
  const properties = item.properties
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const property = row as Record<string, unknown>;
      if (typeof property.address !== 'string') return null;
      const rent = Number(property.rent);
      const form1038 = Number(property.form1038);
      const pitia = Number(property.pitia);
      if (!Number.isFinite(rent)) return null;
      return {
        address: property.address,
        rent,
        form1038: Number.isFinite(form1038) ? form1038 : 0,
        pitia: Number.isFinite(pitia) ? pitia : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const toIncome = Number(item.toIncome);
  const toLiability = Number(item.toLiability);
  const toHousing = Number(item.toHousing);
  return {
    properties,
    toIncome: Number.isFinite(toIncome) ? toIncome : 0,
    toLiability: Number.isFinite(toLiability) ? toLiability : 0,
    toHousing: Number.isFinite(toHousing) ? toHousing : 0,
  };
}

function mergeSummaryData(loanId: string, body: Record<string, unknown>): IncomeSummaryPdfData {
  return {
    ...DEMO_INCOME_SUMMARY,
    loanId,
    primaryBorrowerName:
      typeof body.primaryBorrowerName === 'string' ? body.primaryBorrowerName : DEMO_INCOME_SUMMARY.primaryBorrowerName,
    programUsed: typeof body.programUsed === 'string' ? body.programUsed : DEMO_INCOME_SUMMARY.programUsed,
    calculatedIncome:
      typeof body.calculatedIncome === 'number' ? body.calculatedIncome : DEMO_INCOME_SUMMARY.calculatedIncome,
    sourceLines: asSourceLines(body.sourceLines) ?? DEMO_INCOME_SUMMARY.sourceLines,
    rentalSchedule: asRentalSchedule(body.rentalSchedule) ?? DEMO_INCOME_SUMMARY.rentalSchedule,
    programNote: typeof body.programNote === 'string' ? body.programNote : DEMO_INCOME_SUMMARY.programNote,
  };
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

    const finish = (data: IncomeSummaryPdfData) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        bufferPages: true,
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=FreeFlow_Income_Summary_Loan_${data.loanId}.pdf`);
      doc.pipe(res);
      renderIncomeSummaryPdf(doc as unknown as Parameters<typeof renderIncomeSummaryPdf>[0], data);
      doc.end();
    };

    if (req.method === 'POST') {
      void readJsonBody(req).then((body) => {
        const loanId =
          (typeof body.loanId === 'string' && body.loanId) || loanIdFromUrl(req) || DEMO_INCOME_SUMMARY.loanId;
        finish(mergeSummaryData(loanId, body));
      });
      return;
    }

    finish(mergeSummaryData(loanIdFromUrl(req) || DEMO_INCOME_SUMMARY.loanId, {}));
  };
}
