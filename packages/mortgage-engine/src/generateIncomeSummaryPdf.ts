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

/** One qualifying source type — never one row per rental property or K-1. */
export interface IncomeSummarySourceLine {
  source: string;
  method: string;
  monthly: number;
}

/** Per-property rent, finished 1038 net, and the PITIA the income tool parsed from the app. */
export interface IncomeSummaryRentalProperty {
  address: string;
  rent: number;
  /** Monthly 1038 after days-rented averaging and app PITIA (the calculator result). */
  form1038: number;
  /** Full monthly PITIA parsed from the 1003 / Encompass app. */
  pitia?: number | null;
}

export interface IncomeSummaryRentalSchedule {
  properties: IncomeSummaryRentalProperty[];
  /** One qualifying sum: added to income when the book nets positive. */
  toIncome: number;
  /** One qualifying sum: proposed liability when the book nets a loss. */
  toLiability: number;
  toHousing?: number;
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
  sourceLines?: IncomeSummarySourceLine[];
  rentalSchedule?: IncomeSummaryRentalSchedule;
  programNote?: string;
}

export function qualifyingProgramNote(program: string): string {
  switch (program.toUpperCase()) {
    case 'FHA':
      return 'FHA · 2-year default. 2–4 unit decline bands apply.';
    case 'VA':
      return 'VA · 2-year default. Decline warns only.';
    case 'USDA':
      return 'USDA · 2-year default. Subject purchase may use 75% market rent.';
    default:
      return 'Conventional · 1-year default; 2 years in file uses a 24-month average.';
  }
}

export function compactSourceLines(lines: IncomeSummarySourceLine[]): IncomeSummarySourceLine[] {
  return lines.filter((line) => Math.abs(line.monthly) > 0.005);
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

export function hasRentalSchedule(schedule?: IncomeSummaryRentalSchedule): boolean {
  if (!schedule) return false;
  return (
    schedule.properties.length > 0 ||
    Math.abs(schedule.toIncome) > 0.005 ||
    Math.abs(schedule.toLiability) > 0.005 ||
    Math.abs(schedule.toHousing ?? 0) > 0.005
  );
}

/** Local QA fixture — used when Prisma / loan row is not available. */
export const DEMO_INCOME_SUMMARY: IncomeSummaryPdfData = {
  loanId: 'e1f82f80-df4f-4d56-a97e-12829a34b2cf',
  primaryBorrowerName: 'Jordan Hale',
  primaryBorrowerEmail: 'jordan.hale@example.com',
  tenantCompanyName: 'FreeFlow Local Sandbox',
  calculatedIncome: 12450.5,
  programUsed: 'CONVENTIONAL',
  sourceLines: [
    { source: 'W-2 base', method: 'YTD average', monthly: 7200 },
    { source: 'W-2 variable', method: 'Current job only', monthly: 850 },
    { source: 'Schedule C', method: '1084 cash flow', monthly: 2100 },
  ],
  rentalSchedule: {
    properties: [
      { address: '1958 Easter Rd, Nashville, TN', rent: 18000, form1038: 900, pitia: 550 },
      { address: '1895 Broadway, Mesa, AZ', rent: 11700, form1038: 650, pitia: 450 },
      { address: '29685 Easter Ct, Gilbert, AZ', rent: 14500, form1038: 750.5, pitia: 450 },
    ],
    toIncome: 2300.5,
    toLiability: 0,
  },
  programNote: qualifyingProgramNote('CONVENTIONAL'),
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

  let sectionY = 286;
  const rental = hasRentalSchedule(data.rentalSchedule) ? data.rentalSchedule : undefined;
  const sources = compactSourceLines(data.sourceLines ?? []).filter(
    (line) => !(rental && /^schedule e$/i.test(line.source)),
  );
  if (sources.length || rental) {
    doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('By source', 40, sectionY);
    doc.fillColor(C.textSlate).font('Helvetica').text('Method', 175, sectionY);
    doc.text('Monthly', 500, sectionY);
    sectionY += 12;
    doc.moveTo(40, sectionY).lineTo(555, sectionY).strokeColor(C.borderLight).stroke();
    sectionY += 6;
    sources.forEach((line) => {
      doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text(line.source, 40, sectionY, { width: 125 });
      doc.fillColor(C.textSlate).font('Helvetica').text(line.method, 175, sectionY, { width: 300 });
      doc.fillColor(C.deepSlate).font('Helvetica-Bold').text(money(line.monthly), 470, sectionY, {
        width: 85,
        align: 'right',
      });
      sectionY += 13;
    });
    if (rental) {
      doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('Schedule E', 40, sectionY);
      sectionY += 12;
      rental.properties.forEach((property) => {
        const pitiaLabel =
          property.pitia == null ? 'PITIA --' : `PITIA ${money(property.pitia)}`;
        doc.fillColor(C.textSlate).font('Helvetica').fontSize(8).text(property.address, 52, sectionY, { width: 190 });
        doc.text(`Rent ${money(property.rent)}`, 245, sectionY, { width: 100 });
        doc.text(`1038 ${money(property.form1038)}`, 345, sectionY, { width: 100 });
        doc.text(pitiaLabel, 450, sectionY, { width: 105, align: 'right' });
        sectionY += 12;
      });
      const income = rental.toIncome;
      const liability = rental.toLiability;
      const housing = rental.toHousing ?? 0;
      if (income > 0.005 && liability <= 0.005) {
        doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('Added to income', 52, sectionY);
        doc.text(money(income), 470, sectionY, { width: 85, align: 'right' });
        sectionY += 13;
      } else if (liability > 0.005 && income <= 0.005) {
        doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('Proposed liability', 52, sectionY);
        doc.text(money(liability), 470, sectionY, { width: 85, align: 'right' });
        sectionY += 13;
      } else if (income > 0.005 || liability > 0.005) {
        if (income > 0.005) {
          doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('Added to income', 52, sectionY);
          doc.text(money(income), 470, sectionY, { width: 85, align: 'right' });
          sectionY += 13;
        }
        if (liability > 0.005) {
          doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(8).text('Proposed liability', 52, sectionY);
          doc.text(money(liability), 470, sectionY, { width: 85, align: 'right' });
          sectionY += 13;
        }
      }
      if (housing > 0.005) {
        doc.fillColor(C.textSlate).font('Helvetica').fontSize(8).text('Housing expense', 52, sectionY);
        doc.text(money(housing), 470, sectionY, { width: 85, align: 'right' });
        sectionY += 13;
      }
    }
    sectionY += 4;
  }
  if (data.programNote) {
    doc.fillColor(C.textSlate).font('Helvetica').fontSize(8).text(data.programNote, 40, sectionY, { width: 515 });
    sectionY += 16;
  }
  sectionY += 10;

  doc.fillColor(C.deepSlate).font('Helvetica-Bold').fontSize(10).text('3. COMPLIANCE AUDIT OVERRIDE LEDGER', 40, sectionY);

  const ledgerHead = sectionY + 15;
  doc.rect(40, ledgerHead, 515, 16).fill(C.deepSlate);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  doc.text('TARGET FIELD', 45, ledgerHead + 4);
  doc.text('EXTRACTED', 180, ledgerHead + 4);
  doc.text('OVERRIDE', 250, ledgerHead + 4);
  doc.text('MODIFIED BY & TIMESTAMP', 320, ledgerHead + 4);

  let yPos = ledgerHead + 16;
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
