import PDFDocument from 'pdfkit';
import {
  PAYSTUB_COL,
  PAYSTUB_EARNINGS_GAP,
  PAYSTUB_HEADER_H,
  PAYSTUB_INFO_ROW_H,
  PAYSTUB_INFO_TOP,
  PAYSTUB_LINE_H,
  PAYSTUB_PAGE,
  PAYSTUB_SECTION_H,
} from '../paystubLayout';

export interface PaystubValues {
  employer: string;
  borrower: string;
  hourly: number;
  hours: number;
  periodPay: number;
  ytdBase: number;
  ytdBonus: number;
  ytdOt: number;
}

const W = PAYSTUB_PAGE.width;
const H = PAYSTUB_PAGE.height;
const M = PAYSTUB_PAGE.margin;

const usd = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Draws a realistic payroll-provider style earnings statement for the demo
 * persona. Values mirror the income workspace state so the document always
 * matches the reconciliation math on screen.
 */
export function generatePaystubPdf(values: PaystubValues): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);

    const grossPeriod = values.periodPay;
    const ytdGross = values.ytdBase + values.ytdBonus + values.ytdOt;

    const fed = grossPeriod * 0.12;
    const ss = grossPeriod * 0.062;
    const medicare = grossPeriod * 0.0145;
    const retirement = grossPeriod * 0.05;
    const totalDeductions = fed + ss + medicare + retirement;
    const netPay = grossPeriod - totalDeductions;
    const ytdFed = ytdGross * 0.12;
    const ytdSs = ytdGross * 0.062;
    const ytdMedicare = ytdGross * 0.0145;
    const ytdRetirement = values.ytdBase * 0.05;

    // Header band
    doc.rect(0, 0, W, PAYSTUB_HEADER_H).fill('#10312b');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16).text(values.employer, M, 20);
    doc.font('Helvetica').fontSize(8).fillColor('#a9c8bf')
      .text('2210 Riverside Pkwy · Austin, TX 78704 · Payroll operated by NimbusPay HCM', M, 42);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
      .text('EARNINGS STATEMENT', M, 60);
    doc.font('Helvetica').fontSize(8).fillColor('#a9c8bf')
      .text('Advice # 2026-081547 · Non-negotiable', W - 240, 62, { width: 200, align: 'right' });

    // Employee / period block
    const infoTop = PAYSTUB_INFO_TOP;
    const rows: Array<[string, string, string, string]> = [
      ['Employee', values.borrower, 'Pay period', '08/01/2026 – 08/15/2026'],
      ['Employee ID', 'ATP-04417', 'Pay date', '08/15/2026'],
      ['SSN', 'XXX-XX-1847', 'Pay frequency', 'Semi-monthly (24/yr)'],
      ['Department', 'Client Engineering', 'Base rate', `$${usd(values.hourly)} / hr · ${values.hours} hr/wk`],
    ];
    doc.rect(M, infoTop - 8, W - 2 * M, rows.length * PAYSTUB_INFO_ROW_H + 14).lineWidth(0.8).stroke('#c7d2cd');
    rows.forEach((r, i) => {
      const y = infoTop + i * PAYSTUB_INFO_ROW_H;
      doc.font('Helvetica').fontSize(7.5).fillColor('#5c6f68').text(r[0].toUpperCase(), M + 10, y);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#132a24').text(r[1], M + 90, y - 1);
      doc.font('Helvetica').fontSize(7.5).fillColor('#5c6f68').text(r[2].toUpperCase(), 330, y);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#132a24').text(r[3], 420, y - 1);
    });

    // Table helper
    const col = [...PAYSTUB_COL];
    const tableWidth = W - 2 * M;
    let y = infoTop + rows.length * PAYSTUB_INFO_ROW_H + PAYSTUB_EARNINGS_GAP;

    const sectionHeader = (title: string) => {
      doc.rect(M, y, tableWidth, 18).fill('#e7efec');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#10312b').text(title.toUpperCase(), M + 10, y + 5);
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#5c6f68');
      doc.text('RATE', col[1], y + 6, { width: 70, align: 'right' });
      doc.text('HOURS', col[2], y + 6, { width: 70, align: 'right' });
      doc.text('CURRENT', col[3], y + 6, { width: 70, align: 'right' });
      doc.text('YTD', col[4], y + 6, { width: 72, align: 'right' });
      y += PAYSTUB_SECTION_H;
    };

    const line = (label: string, rate: string, hrs: string, current: string, ytd: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#132a24');
      doc.text(label, M + 10, y);
      doc.text(rate, col[1], y, { width: 70, align: 'right' });
      doc.text(hrs, col[2], y, { width: 70, align: 'right' });
      doc.text(current, col[3], y, { width: 70, align: 'right' });
      doc.text(ytd, col[4], y, { width: 72, align: 'right' });
      doc.moveTo(M, y + 12).lineTo(W - M, y + 12).lineWidth(0.4).stroke('#e2e8e5');
      y += PAYSTUB_LINE_H;
    };

    sectionHeader('Earnings');
    line('Regular', usd(values.hourly), '86.67', usd(grossPeriod), usd(values.ytdBase));
    line('Overtime', usd(values.hourly * 1.5), '0.00', '0.00', usd(values.ytdOt));
    line('Bonus', '—', '—', '0.00', usd(values.ytdBonus));
    line('Gross pay', '', '', usd(grossPeriod), usd(ytdGross), true);
    y += 8;

    sectionHeader('Taxes & deductions');
    line('Federal income tax', '', '', usd(fed), usd(ytdFed));
    line('Social Security', '', '', usd(ss), usd(ytdSs));
    line('Medicare', '', '', usd(medicare), usd(ytdMedicare));
    line('401(k) employee', '', '', usd(retirement), usd(ytdRetirement));
    line('Total deductions', '', '', usd(totalDeductions), '', true);
    y += 10;

    // Net pay band
    doc.rect(M, y, tableWidth, 30).fill('#10312b');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text('NET PAY', M + 10, y + 9);
    doc.font('Helvetica').fontSize(8).fillColor('#a9c8bf')
      .text('Deposited to checking ····4417 (ACH)', M + 90, y + 11);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
      .text(`$${usd(netPay)}`, col[3], y + 8, { width: 142, align: 'right' });
    y += 48;

    doc.font('Helvetica').fontSize(7).fillColor('#8aa39b').text(
      'Retain this statement for your records. FreeFlow sandbox document — synthetic data for product demonstration only.',
      M, y, { width: tableWidth },
    );

    doc.end();
  });
}
