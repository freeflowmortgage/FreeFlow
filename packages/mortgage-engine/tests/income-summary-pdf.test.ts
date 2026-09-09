import {
  compactSourceLines,
  qualifyingProgramNote,
  renderIncomeSummaryPdf,
  DEMO_INCOME_SUMMARY,
  type IncomeSummaryPdfKitDoc,
} from '../src/generateIncomeSummaryPdf';

function recordingDoc() {
  const texts: string[] = [];
  const doc: IncomeSummaryPdfKitDoc & { texts: string[] } = {
    texts,
    rect: () => doc,
    roundedRect: () => doc,
    fill: () => doc,
    fillColor: () => doc,
    font: () => doc,
    fontSize: () => doc,
    text: (text: string) => {
      texts.push(text);
      return doc;
    },
    moveTo: () => doc,
    lineTo: () => doc,
    strokeColor: () => doc,
    stroke: () => doc,
    lineWidth: () => doc,
    bufferedPageRange: () => ({ start: 0, count: 1 }),
    switchToPage: () => undefined,
  };
  return doc;
}

describe('income summary source lines', () => {
  test('drops zero sources so multiple income types stay one row each', () => {
    const lines = compactSourceLines([
      { source: 'W-2 base', method: 'YTD average', monthly: 7200 },
      { source: 'Schedule C', method: '1084 cash flow', monthly: 0 },
      { source: 'Schedule E', method: '1038 - PITIA · 3 properties', monthly: 2300.5 },
      { source: 'Partnership', method: 'Guideline', monthly: 0 },
    ]);
    expect(lines.map((line) => line.source)).toEqual(['W-2 base', 'Schedule E']);
  });

  test('program note is a single short line per GSE', () => {
    expect(qualifyingProgramNote('CONVENTIONAL')).toMatch(/^Conventional ·/);
    expect(qualifyingProgramNote('FHA')).toMatch(/^FHA ·/);
    expect(qualifyingProgramNote('FHA').includes('\n')).toBe(false);
  });

  test('demo sheet lists each property rent and one Schedule E aggregate', () => {
    const doc = recordingDoc();
    renderIncomeSummaryPdf(doc, DEMO_INCOME_SUMMARY);
    const joined = doc.texts.join('\n');
    expect(joined).toContain('By source');
    expect(joined).toContain('Schedule E');
    expect(joined).toContain('1958 Easter Rd, Nashville, TN');
    expect(joined).toContain('1895 Broadway, Mesa, AZ');
    expect(joined).toContain('29685 Easter Ct, Gilbert, AZ');
    expect(joined).toContain('Rent $18,000.00');
    expect(joined).toContain('1038 $900.00');
    expect(joined).toContain('1038 $650.00');
    expect(joined).toContain('1038 $750.50');
    expect(joined).toContain('PITIA $550.00');
    expect(joined).toContain('PITIA $450.00');
    expect(joined).toContain('Added to income');
    expect(joined).toContain('$2,300.50');
    expect(joined).not.toContain('Line 21 net + Insurance');
    expect(joined).not.toContain('PITIA needed');
    expect(joined.match(/Added to income/g)?.length).toBe(1);
  });

  test('rental book that nets a loss is one liability, not three walkthroughs', () => {
    const doc = recordingDoc();
    renderIncomeSummaryPdf(doc, {
      ...DEMO_INCOME_SUMMARY,
      rentalSchedule: {
        properties: [
          { address: '1958 Easter Rd', rent: 18000, form1038: -200, pitia: 550 },
          { address: '1895 Broadway', rent: 11700, form1038: -210.25, pitia: 450 },
        ],
        toIncome: 0,
        toLiability: 410.25,
      },
    });
    const joined = doc.texts.join('\n');
    expect(joined).toContain('Proposed liability');
    expect(joined).toContain('$410.25');
    expect(joined).not.toContain('Added to income');
  });
});
