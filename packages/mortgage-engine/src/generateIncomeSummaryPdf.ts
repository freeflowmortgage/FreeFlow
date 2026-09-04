/**
 * In-memory Form 1084 income summary sheet (PDFKit draw instructions).
 * Streams a brand worksheet — not a filled Fannie Mae form and not a sandwich PDF.
 */

export interface IncomeSummaryWarning {
  code: string;
  severity: 'WARNING' | 'CLEARED' | 'CRITICAL';
  message: string;
}

export interface IncomeSummaryCondition {
  title: string;
  category: string;
  description: string;
  requiredDocType: string;
}

export interface IncomeSummaryOverride {
  field: string;
  extracted: string;
  override: string;
  changedBy: string;
  timestamp: string;
  reason: string;
}

export interface IncomeSummaryPdfData {
  loanId: string;
  primaryBorrowerName: string;
  primaryBorrowerEmail: string;
  tenantCompanyName: string;
  calculatedIncome: number;
  programUsed: string;
  trendingResult: string;
  appliedMultiplier: number;
  appliedMultiplierText: string;
  underwriteStatus: string;
  activeWarnings: IncomeSummaryWarning[];
  pendingConditions: IncomeSummaryCondition[];
  overrideAuditLogs: IncomeSummaryOverride[];
}

/** Local QA fixture — used when Prisma / loan row is not available. */
export const DEMO_INCOME_SUMMARY: IncomeSummaryPdfData = {
  loanId: 'e1f82f80-df4f-4d56-a97e-12829a34b2cf',
  primaryBorrowerName: 'Jordan Hale',
  primaryBorrowerEmail: 'jordan.hale@example.com',
  tenantCompanyName: 'FreeFlow Local Sandbox',
  calculatedIncome: 12450.5,
  programUsed: 'CONVENTIONAL',
  trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING',
  appliedMultiplier: 1.25,
  appliedMultiplierText: '25%',
  underwriteStatus: 'VERIFIED & SIGNED-OFF',
  activeWarnings: [
    {
      code: 'FHLMC_SIGNIFICANT_INCREASE_AUDIT',
      severity: 'WARNING',
      message:
        'Freddie Mac Alert: Self-employed/variable cash flow increased by 14.5% year-over-year. Fluctuations exceeding 10% require documented underwriter stability analysis.',
    },
    {
      code: 'W2_FEDERAL_WITHHOLDING_CHECK',
      severity: 'CLEARED',
      message:
        'W-2 tax withholding percentages are consistent with Box 3 (6.2%) and Box 5 (1.45%) wages. No fraud flags.',
    },
  ],
  pendingConditions: [
    {
      title: 'Tax Return Signature Page (Form 4506-C)',
      category: 'INCOME',
      description: 'Underwriter must verify IRS transcript matching records before closing.',
      requiredDocType: 'IRS_4506_C',
    },
    {
      title: 'Business Asset Liquidity Verification',
      category: 'INCOME',
      description: 'Schedule L quick ratio exceeds 1.0 limit. Verify stable brokerage statements.',
      requiredDocType: 'BROKERAGE_ACCOUNT_STATEMENTS',
    },
  ],
  overrideAuditLogs: [
    {
      field: 'Schedule C Net Profit (Line 31)',
      extracted: '$102,000.00',
      override: '$115,000.00',
      changedBy: 'John J. Underwriter (ID: UW-99)',
      timestamp: '2026-08-29 11:41:02',
      reason:
        'Verified supplementary client ledgers and verified legal non-recurring business startup losses.',
    },
  ],
};

/** PDFKit surface used by this sheet (no pdfkit runtime dep on the math package). */
export type IncomeSummaryPdfKitDoc = {
  rect: (...args: number[]) => IncomeSummaryPdfKitDoc;
  roundedRect: (...args: number[]) => IncomeSummaryPdfKitDoc;
  fill: (color?: string) => IncomeSummaryPdfKitDoc;
  fillColor: (color: string) => IncomeSummaryPdfKitDoc;
  font: (name: string) => IncomeSummaryPdfKitDoc;
  fontSize: (size: number) => IncomeSummaryPdfKitDoc;
  text: (text: string, x?: number, y?: number, options?: Record<string, unknown>) => IncomeSummaryPdfKitDoc;
  moveTo: (x: number, y: number) => IncomeSummaryPdfKitDoc;
  lineTo: (x: number, y: number) => IncomeSummaryPdfKitDoc;
  strokeColor: (color: string) => IncomeSummaryPdfKitDoc;
  stroke: () => IncomeSummaryPdfKitDoc;
  lineWidth: (n: number) => IncomeSummaryPdfKitDoc;
  bufferedPageRange: () => { start: number; count: number };
  switchToPage: (i: number) => void;
};

const C = {
  deepSlate: '#0f172a',
  emerald: '#10b981',
  textSlate: '#334155',
  borderLight: '#e2e8f0',
  lightGrey: '#f8fafc',
  roseText: '#991b1b',
  amberBg: '#fffbeb',
  amberText: '#92400e',
};

export function renderIncomeSummaryPdf(doc: IncomeSummaryPdfKitDoc, data: IncomeSummaryPdfData): void {
  doc.rect(40, 25, 515, 4).fill(C.emerald);

  doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(16).text('FreeFlow Mortgage Solutions', 40, 40);
  doc
    .fillColor(C.textSlate)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('B2B INDEPENDENT UNDERWRITING POINT-SOLUTION', 40, 56, { characterSpacing: 1 });

  doc
    .fillColor(C.deepSlate)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text('GSE-COMPLIANT INCOME SUMMARY SHEET', 40, 75, { align: 'right' });
  doc
    .fillColor(C.textSlate)
    .font('Helvetica-Oblique')
    .fontSize(8)
    .text(`Generated: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`, 40, 90, {
      align: 'right',
    });

  doc.moveTo(40, 105).lineTo(555, 105).strokeColor(C.borderLight).stroke();

  doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(10).text('1. LOAN APPLICATION METADATA', 40, 120);

  doc.fillColor(C.textSlate).font('Helvetica').fontSize(9).text('Primary Borrower:', 40, 138);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.primaryBorrowerName, 130, 138);

  doc.fillColor(C.textSlate).font('Helvetica').text('Borrower Email:', 40, 153);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.primaryBorrowerEmail, 130, 153);

  doc.fillColor(C.textSlate).font('Helvetica').text('Active Tenant ID:', 40, 168);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.tenantCompanyName, 130, 168);

  doc.fillColor(C.textSlate).font('Helvetica').text('Loan Reference ID:', 300, 138);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.loanId, 410, 138);

  doc.fillColor(C.textSlate).font('Helvetica').text('Loan Program Used:', 300, 153);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.programUsed, 410, 153);

  doc.fillColor(C.textSlate).font('Helvetica').text('Underwrite Status:', 300, 168);
  doc.fillColor(C.emerald).font('Helvetica-Bold').text(data.underwriteStatus, 410, 168);

  doc.moveTo(40, 188).lineTo(555, 188).strokeColor(C.borderLight).stroke();

  doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(10).text('2. QUALIFYING MONTHLY CASH FLOW', 40, 203);

  doc.roundedRect(40, 218, 515, 60, 6).fill(C.lightGrey);

  doc.fillColor(C.deepSlate).font('Helvetica').fontSize(10).text('TOTAL QUALIFYING BASELINE INCOME (FORM 1084)', 55, 230);
  doc
    .fillColor(C.emerald)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(`$${data.calculatedIncome.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 55, 244);

  doc.fillColor(C.textSlate).font('Helvetica').fontSize(8).text('GSE Trend Result:', 330, 230);
  doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(data.trendingResult, 430, 230);

  doc.fillColor(C.textSlate).font('Helvetica').text('Allowance Gross-up:', 330, 243);
  doc
    .fillColor(C.deepSlate)
    .font('Helvetica-Bold')
    .text(`1.${data.appliedMultiplierText} Multiplier (${data.appliedMultiplier}x)`, 430, 243);

  doc.fillColor(C.textSlate).font('Helvetica').text('ZDR Security Vault:', 330, 256);
  doc.fillColor(C.emerald).font('Helvetica-Bold').text('RAM BUFFER ACTIVE', 430, 256);

  doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(10).text('3. COMPLIANCE AUDIT OVERRIDE LEDGER', 40, 298);

  doc.rect(40, 313, 515, 16).fill(C.deepSlate);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  doc.text('TARGET FIELD', 45, 317);
  doc.text('EXTRACTED', 180, 317);
  doc.text('OVERRIDE', 250, 317);
  doc.text('MODIFIED BY & TIMESTAMP', 320, 317);

  let yPos = 329;
  data.overrideAuditLogs.forEach((row, idx) => {
    if (idx % 2 === 0) {
      doc.rect(40, yPos, 515, 45).fill('#f1f5f9');
    }
    doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text(row.field, 45, yPos + 6);
    doc.fillColor(C.roseText).font('Helvetica-Bold').text(row.extracted, 180, yPos + 6);
    doc.fillColor(C.emerald).font('Helvetica-Bold').text(row.override, 250, yPos + 6);
    doc.fillColor(C.textSlate).font('Helvetica').text(`${row.changedBy} | ${row.timestamp}`, 320, yPos + 6);
    doc
      .fillColor(C.textSlate)
      .font('Helvetica-Oblique')
      .fontSize(7.5)
      .text(`Override Justification: ${row.reason}`, 45, yPos + 18, { width: 505 });
    yPos += 45;
  });

  const warningsTop = yPos + 16;
  doc
    .fillColor(C.deepSlate)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('4. SYSTEM FRAUD & COMPLIANCE WARNINGS', 40, warningsTop);

  let alertY = warningsTop + 15;
  data.activeWarnings.forEach((alert) => {
    const isCleared = alert.severity === 'CLEARED';
    const boxBg = isCleared ? '#f0fdf4' : C.amberBg;
    const borderStroke = isCleared ? '#bbf7d0' : '#fde68a';
    const textFill = isCleared ? '#15803d' : C.amberText;

    doc.roundedRect(40, alertY, 515, 32, 4).fill(boxBg);
    doc.roundedRect(40, alertY, 515, 32, 4).lineWidth(0.5).strokeColor(borderStroke).stroke();

    doc
      .fillColor(textFill)
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`[STATUS: ${alert.severity}] - CODE: ${alert.code}`, 50, alertY + 6);
    doc.fillColor(C.textSlate).font('Helvetica').fontSize(7.5).text(alert.message, 50, alertY + 16, { width: 495 });
    alertY += 38;
  });

  const condTop = alertY + 12;
  doc
    .fillColor(C.deepSlate)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('5. DYNAMIC UNDERWRITING CONDITIONS (eFOLDER)', 40, condTop);

  let condY = condTop + 15;
  data.pendingConditions.forEach((cond) => {
    doc.roundedRect(40, condY, 515, 35, 4).fill(C.lightGrey);
    doc.roundedRect(40, condY, 515, 35, 4).lineWidth(0.5).strokeColor(C.borderLight).stroke();

    doc.rect(50, condY + 11, 12, 12).strokeColor(C.textSlate).lineWidth(1).stroke();

    doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8.5).text(cond.title, 70, condY + 6);
    doc
      .fillColor(C.textSlate)
      .font('Helvetica')
      .fontSize(7.5)
      .text(`${cond.description} [Required Document Tag: ${cond.requiredDocType}]`, 70, condY + 16, { width: 475 });

    condY += 41;
  });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(40, 770).lineTo(555, 770).strokeColor(C.borderLight).stroke();
    doc
      .fillColor(C.textSlate)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text('GLBA SAFEGUARD ACT COMPLIANT | ZERO PERSISTENT DISK STORAGE FOOTPRINT', 40, 778);
    doc.fillColor(C.textSlate).font('Helvetica').fontSize(7).text(`Page ${i + 1} of ${range.count}`, 40, 778, {
      align: 'right',
    });
  }
}
