import PDFDocument from 'pdfkit';

const W = 612;
const H = 792;

function box(left: number, top: number, width: number, height: number) {
  return {
    x: (left / 100) * W,
    y: (top / 100) * H,
    w: (width / 100) * W,
    h: (height / 100) * H,
  };
}

function paper(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, W, H).fill('#f7f4ea');
}

function header(doc: PDFKit.PDFDocument, page: number) {
  doc.rect(0, 0, W, 48).fill('#ffffff');
  doc.moveTo(0, 48).lineTo(W, 48).lineWidth(1.5).stroke('#0f172a');
  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(7)
    .text('FREDDIE MAC FORM 70  ·  FANNIE MAE FORM 1004', 0, 10, { width: W, align: 'center' });
  doc.fillColor('#0f172a').fontSize(13)
    .text('Uniform Residential Appraisal Report', 0, 20, { width: W, align: 'center' });
  doc.fillColor('#64748b').font('Helvetica').fontSize(8)
    .text(`File # LN-2026-9043  ·  Page ${page} of 3  ·  FHA/VA Case 451-904322-B`, 0, 35, {
      width: W,
      align: 'center',
    });
}

function field(
  doc: PDFKit.PDFDocument,
  left: number,
  top: number,
  width: number,
  height: number,
  label: string,
  value: string,
  warn = false,
  blank = false,
) {
  const b = box(left, top, width, height);
  doc.save();
  doc.rect(b.x, b.y, b.w, b.h).fillAndStroke(!blank && warn ? '#fff1f2' : '#ffffff', !blank && warn ? '#e11d48' : '#94a3b8');
  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(6)
    .text(label.toUpperCase(), b.x + 4, b.y + 3, { width: b.w - 8 });
  if (!blank) {
    doc.fillColor(warn ? '#9f1239' : '#0f172a').font('Helvetica-Bold').fontSize(8)
      .text(value, b.x + 4, b.y + 12, { width: b.w - 8, height: b.h - 16 });
  }
  doc.restore();
}

function metaRow(doc: PDFKit.PDFDocument, blank = false) {
  const items = [
    ['Borrower', 'Sarah K. Vance'],
    ['FHA/VA case no.', '451-904322-B'],
    ['Lender/client', 'FreeFlow Mortgage Solutions'],
    ['Effective date', '08/24/2026'],
  ];
  items.forEach((item, index) => {
    const x = 24 + index * 147;
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(6).text(item[0].toUpperCase(), x, 56);
    if (!blank) {
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8).text(item[1], x, 66);
    }
  });
}

function pageOne(doc: PDFKit.PDFDocument, blank = false) {
  paper(doc);
  header(doc, 1);
  metaRow(doc, blank);
  field(doc, 12, 18, 76, 5, 'Subject property / contract', '742 Whispering Pines Dr, Austin TX 78745  ·  Purchase  ·  Contract $425,000  ·  Seller not owner of record', false, blank);
  field(doc, 12, 26, 24, 5, 'Year built', '1974 (pre-1978)', true, blank);
  field(doc, 38, 26, 24, 5, 'GLA / beds / baths', '1,850 sf  ·  3 / 2', false, blank);
  field(doc, 64, 26, 24, 5, 'Site / occupancy', 'Fee simple  ·  Owner', false, blank);
  field(
    doc,
    12,
    35,
    76,
    8,
    'Neighborhood · property values / demand / marketing time',
    'URAR checked STABLE. Demand/supply in balance. Marketing time < 3 months. 1004MC medians: $350,000 → $342,000 → $330,000 (−5.7%).',
    true,
    blank
  );
  field(doc, 12, 46, 37, 6, 'Prior sale / transfer', '07/15/2026  ·  $200,000  ·  17 days before contract', true, blank);
  field(doc, 51, 46, 37, 6, 'Contract date / assignment', '08/01/2026  ·  Non-arm’s length family sale', true, blank);
  field(doc, 12, 56, 76, 8, 'Neighborhood description', 'Suburban Austin. Mix of 1960s–1980s ranch product. Leased rooftop solar noted on subject. No view or locational amenities.', false, blank);
  field(doc, 12, 67, 76, 8, 'Site / zoning / highest & best use', 'Zoning SFR. Highest and best use as improved: Yes. Flood zone X. Public water/sewer. Typical for market.', false, blank);
  field(
    doc,
    12,
    78,
    76,
    10,
    'Improvements / condition',
    'Average Q4/C4. Peeling paint on exterior trim (lead-safe work required). Crawlspace not accessed. Utilities not on at inspection. Attic viewed from hatch only.',
    true,
    blank
  );
}

function tableCell(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, text: string, warn = false, blank = false) {
  doc.rect(x, y, w, h).fillAndStroke(!blank && warn ? '#fff1f2' : '#ffffff', '#94a3b8');
  if (!blank) {
    doc.fillColor(warn ? '#9f1239' : '#0f172a').font('Helvetica').fontSize(7)
      .text(text, x + 3, y + 5, { width: w - 6, height: h - 6 });
  }
}

function pageTwo(doc: PDFKit.PDFDocument, blank = false) {
  paper(doc);
  header(doc, 2);
  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8)
    .text('SALES COMPARISON APPROACH', 36, 58);

  const headers = ['Feature', 'Subject', 'Comp 1', 'Comp 2', 'Comp 3'];
  const rows = [
    ['Address', '742 Whispering Pines', '142 Maplewood Ave', '98 Oak Ridge Rd', '33 Clover Lane'],
    ['Proximity', '—', '0.45 mi', '1.20 mi', '0.80 mi'],
    ['Sale price', '$425,000', '$425,000', '$410,000', '$435,000'],
    ['GLA', '1,850', '1,900', '1,780', '1,840'],
    ['Net / gross adj.', '—', '+$15k / 5.9%', '−$8k / 11.7%', '+$2k / 2.8%'],
  ];
  const colW = [90, 96, 96, 96, 96];
  const startX = 36;
  let y = 74;
  let x = startX;
  headers.forEach((label, i) => {
    doc.rect(x, y, colW[i], 16).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(6).text(label.toUpperCase(), x + 3, y + 5, { width: colW[i] - 6 });
    x += colW[i];
  });
  y += 16;
  rows.forEach((row, rowIndex) => {
    x = startX;
    row.forEach((cell, col) => {
      const warn = (rowIndex === 1 && col === 3) || (rowIndex === 4 && col === 3);
      tableCell(doc, x, y, colW[col], 16, cell, warn, blank);
      x += colW[col];
    });
    y += 16;
  });

  field(doc, 35, 22, 15, 4, 'Comp 1 net', '+$15,000', false, blank);
  field(
    doc,
    12,
    55,
    76,
    6,
    'Physical repairs / condition of improvements',
    'Peeling/chipping paint on eaves and window trim. Pre-1978. Scrape, prime, repaint under lead-safe practices before FHA/VA close.',
    true,
    blank
  );
  field(
    doc,
    12,
    64,
    76,
    10,
    'Comparables commentary',
    'Comp 2 is West Lake Hills (superior location) with a −$18,000 location adjustment and −$30,000 GLA line. Gross adjustment 11.7% exceeds GSE 10% review threshold. Comp 1 is the primary indicator.',
    true,
    blank
  );
  field(doc, 12, 78, 37, 8, 'Indicated value by sales comparison', '$425,000', false, blank);
  field(doc, 51, 78, 37, 8, '1004MC addendum', 'Attached. Median sale price declining three periods.', true, blank);
}

function pageThree(doc: PDFKit.PDFDocument, blank = false) {
  paper(doc);
  header(doc, 3);
  doc.fillColor('#64748b').font('Helvetica-Bold').fontSize(8)
    .text('RECONCILIATION & CERTIFICATION', 36, 58);
  field(doc, 12, 14, 76, 8, 'Reconciliation', 'Sales comparison given all weight. Cost approach not developed. Income approach N/A. Appraised value $425,000 as of 08/24/2026.', false, blank);
  field(doc, 12, 26, 37, 8, 'Appraiser', 'Robert J. Miller  ·  TX A-1084  ·  Supervisory: none', false, blank);
  field(doc, 51, 26, 37, 8, 'Exposure time', '30–60 days  ·  Typical of neighborhood', false, blank);
  field(
    doc,
    12,
    38,
    76,
    12,
    'Additional comments — physical inspection',
    'Attic viewed from hatch only (not head-and-shoulders). Crawlspace access blocked by stored items — not inspected. Water, electric, and gas were off at inspection. Crawl space shows moisture accumulation and mild dampness. Potential mold spores along baseboards of detached utility closet.',
    true,
    blank
  );
  field(
    doc,
    15,
    60,
    70,
    5,
    'Crawlspace access / MPR',
    'CRAWLSPACE NOT ACCESSED. FHA 4000.1 / VA Ch. 12 head-and-shoulders inspection incomplete.',
    true,
    blank
  );
  field(
    doc,
    12,
    70,
    76,
    12,
    'Appraiser certification',
    'I certify the statements of fact are correct. I have no present or prospective interest. Hypothetical condition: none. Extraordinary assumption: utilities will function when restored. Digital signature on file.',
    false,
    blank
  );
}

export function generateUrarPdf(blank = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.addPage();
    pageOne(doc, blank);
    doc.addPage();
    pageTwo(doc, blank);
    doc.addPage();
    pageThree(doc, blank);
    doc.end();
  });
}
