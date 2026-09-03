function tjStream(rows: Array<[number, number, string]>): Buffer {
  const chunks = ['BT /F1 11 Tf'];
  for (const [x, y, text] of rows) {
    const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    chunks.push(`1 0 0 1 ${x} ${y} Tm (${safe}) Tj`);
  }
  chunks.push('ET');
  return Buffer.from(chunks.join(' '));
}

export function generateIncomeSmokePdf(): Buffer {
  const page1 = tjStream([
    [72, 720, 'Form W-2 Wage and Tax Statement'],
    [72, 700, 'Employee Name Jordan Hale'],
    [72, 670, 'Box 1 Wages tips other compensation 150000.00'],
    [72, 650, 'Box 2 Federal income tax withheld 18500.00'],
    [72, 630, 'Box 3 Social security wages 150000.00'],
    [72, 610, 'Box 4 Social security tax withheld 9300.00'],
    [72, 590, 'Box 5 Medicare wages and tips 150000.00'],
    [72, 570, 'Box 6 Medicare tax withheld 2175.00'],
  ]);
  const page2 = tjStream([
    [72, 720, 'Schedule C Profit or Loss From Business'],
    [72, 700, 'U.S. Individual Income Tax Return Form 1040'],
    [72, 660, 'Line 31 Net profit or loss 102000.00'],
    [72, 640, 'Line 13 Depreciation 8500.00'],
    [72, 620, 'Line 44a Business miles add-back 4500.00'],
  ]);

  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    ),
    Buffer.concat([Buffer.from(`<< /Length ${page1.length} >>\nstream\n`), page1, Buffer.from('\nendstream')]),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
    ),
    Buffer.concat([Buffer.from(`<< /Length ${page2.length} >>\nstream\n`), page2, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ];

  const out: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (let i = 0; i < objs.length; i += 1) {
    offsets.push(out.reduce((sum, chunk) => sum + chunk.length, 0));
    out.push(Buffer.from(`${i + 1} 0 obj\n`), objs[i], Buffer.from('\nendobj\n'));
  }
  const xref = out.reduce((sum, chunk) => sum + chunk.length, 0);
  out.push(Buffer.from(`xref\n0 ${objs.length + 1}\n`));
  out.push(Buffer.from('0000000000 65535 f \n'));
  for (const off of offsets.slice(1)) {
    out.push(Buffer.from(`${off.toString().padStart(10, '0')} 00000 n \n`));
  }
  out.push(
    Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`),
  );
  return Buffer.concat(out);
}
