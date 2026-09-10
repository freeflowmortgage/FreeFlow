import PDFDocument from 'pdfkit';

export interface W2Values {
  year: number;
  employer: string;
  ein: string;
  borrower: string;
  box1: number;
  /** Medicare wages (Box 5). Qualifying gross when present. */
  box5?: number;
  bonus: number;
  overtime: number;
}

const W = 612;
const H = 396;

const usd = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Drawn Copy-B style W-2 for the demo (no IRS blank required). Values come
 * from the Base Income prior-year fields so Inspect Coordinates can land on
 * Box 5 / Box 14 the same way the paystub does.
 */
export function generateW2Pdf(values: W2Values): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on('error', reject);

    const medicareWages = values.box5 ?? values.box1 + values.bonus + values.overtime;
    const ssWages = medicareWages;
    const fed = values.box1 * 0.12;
    const ssTax = ssWages * 0.062;
    const medicare = ssWages * 0.0145;
    const [first, ...rest] = values.borrower.split(' ');
    const last = rest.join(' ') || first;

    doc.rect(0, 0, W, 36).fill('#1e3a5f');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('Form W-2 Wage and Tax Statement', 16, 12);
    doc.font('Helvetica').fontSize(10).text(String(values.year), W - 70, 13, { width: 54, align: 'right' });

    const cell = (x: number, y: number, w: number, h: number, label: string, value: string, valueSize = 10) => {
      doc.rect(x, y, w, h).lineWidth(0.8).stroke('#1e3a5f');
      doc.font('Helvetica').fontSize(6.5).fillColor('#4b5d73').text(label, x + 4, y + 3, { width: w - 8 });
      doc.font('Helvetica-Bold').fontSize(valueSize).fillColor('#0f172a').text(value, x + 4, y + 16, { width: w - 8 });
    };

    cell(16, 48, 140, 40, 'a Employee’s social security number', 'XXX-XX-1847');
    cell(156, 48, 200, 40, 'b Employer identification number (EIN)', values.ein);
    cell(356, 48, 240, 40, 'd Control number', `W2-${values.year}-0447`);

    cell(16, 88, 340, 56, 'c Employer’s name, address, and ZIP code', `${values.employer}\n2210 Riverside Pkwy, Austin, TX 78704`, 8);
    cell(356, 88, 240, 56, 'e Employee’s first name and initial / Last name', `${first}  ${last}`, 9);

    cell(16, 144, 340, 40, 'f Employee’s address and ZIP code', '1847 Juniper Loop, Austin, TX 78741', 8);

    cell(356, 144, 120, 40, '1 Wages, tips, other compensation', usd(values.box1));
    cell(476, 144, 120, 40, '2 Federal income tax withheld', usd(fed));
    cell(356, 184, 120, 40, '3 Social security wages', usd(ssWages));
    cell(476, 184, 120, 40, '4 Social security tax withheld', usd(ssTax));
    cell(356, 224, 120, 40, '5 Medicare wages and tips', usd(medicareWages));
    cell(476, 224, 120, 40, '6 Medicare tax withheld', usd(medicare));

    cell(16, 184, 170, 40, '12a See instructions for box 12', `D  ${usd(4500)}`);
    cell(186, 184, 170, 80, '14 Other', `BONUS  ${usd(values.bonus)}\nOT  ${usd(values.overtime)}`, 9);

    doc.font('Helvetica').fontSize(7).fillColor('#64748b')
      .text('Copy B — To Be Filed With Employee’s FEDERAL Tax Return. FreeFlow sandbox document.', 16, 360, { width: 580 });

    doc.end();
  });
}
