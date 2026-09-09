import { mapIncomeFields } from '../../../apps/underwriting-console/src/incomeFieldMap';
import type {
  ParsePage,
  ParseResponse,
  ParseWord
} from '../../../apps/underwriting-console/src/parseTypes';

// The engine package intentionally omits DOM libs; this parser-model test only
// needs the name used by LiveParseSession, not browser File behavior.
declare global {
  interface File {}
}

function words(lines: string[]): ParseWord[] {
  return lines.map((text, index) => ({
    text,
    x: 0.1,
    y: 0.1 + index * 0.05,
    w: 0.8,
    h: 0.02,
    confidence: 99
  }));
}

function response(pages: ParsePage[]): ParseResponse {
  return {
    transaction_id: 'parser-test',
    total_pages_scanned: pages.length,
    pages_extracted_count: pages.length,
    extracted_page_indices: pages.map((page) => page.index),
    ocr_page_count: 0,
    has_business_returns: false,
    flags: [],
    classifications: Object.fromEntries(
      pages.map((page) => [String(page.index), page.formIds])
    ),
    unresolved_statements: [],
    pages
  };
}

describe('entity-scoped income field mapping', () => {
  test('preserves multiple W-2 employers while retaining first-entity legacy IDs', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['W-2'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            "c Employer's name Acme Systems LLC",
            "b Employer identification number (EIN) 11-1111111",
            'Box 1 Wages tips other compensation 60000.00'
          ])
        },
        {
          index: 1,
          formIds: ['W-2'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            "c Employer's name Weekend Health Inc",
            "b Employer identification number (EIN) 22-2222222",
            'Box 1 Wages tips other compensation 24000.00'
          ])
        }
      ])
    );

    const wages = fields.filter((field) => field.sourceFieldId === 'w2-box1');
    const names = fields.filter((field) => field.sourceFieldId === 'w2-employer-name');

    expect(wages).toHaveLength(2);
    expect(wages[0].id).toBe('w2-box1');
    expect(wages[1].id).toBe('w2-box1--w-2-p1');
    expect(wages.map((field) => field.numericValue)).toEqual([60000, 24000]);
    expect(names.map((field) => field.value)).toEqual([
      'Acme Systems LLC',
      'Weekend Health Inc'
    ]);
    expect(wages[0].entityId).not.toBe(wages[1].entityId);
  });

  test('maps Schedule F and signed Schedule D values', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['Schedule F (Farm Income)'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            'Schedule F Profit or Loss From Farming',
            'Line 34 Net farm profit or loss 40000.00',
            'Line 14 Depreciation 10000.00'
          ])
        },
        {
          index: 1,
          formIds: ['Schedule D (Capital Gains)'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            'Schedule D Capital Gains and Losses',
            'Line 16 capital gain or loss (3000.00)'
          ])
        }
      ])
    );

    expect(fields.find((field) => field.sourceFieldId === 'schedule-f-net')).toMatchObject({
      form: 'Schedule F',
      numericValue: 40000
    });
    expect(fields.find((field) => field.sourceFieldId === 'schedule-f-depreciation')?.numericValue).toBe(10000);
    expect(fields.find((field) => field.sourceFieldId === 'schedule-d-capital-gain-loss')?.numericValue).toBe(-3000);
  });

  test('Schedule E grid fields keep official overlay boxes', () => {
    const fields = mapIncomeFields({
      transaction_id: 'e-grid',
      total_pages_scanned: 1,
      pages_extracted_count: 1,
      extracted_page_indices: [0],
      ocr_page_count: 0,
      has_business_returns: true,
      flags: [],
      classifications: { '0': ['Schedule E (Page 1 - Rentals)'] },
      unresolved_statements: [],
      pages: [
        {
          index: 0,
          formIds: ['Schedule E (Page 1 - Rentals)'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: [],
        },
      ],
      scheduleEProperties: [
        {
          pageIndex: 0,
          column: 'A',
          year: 2025,
          address: '100 Main St',
          propertyType: '1',
          fairRentalDays: 365,
          financials: { '3': 24000, '20': 9000, '21': 15000 },
          boxes: {
            address: { x: 0.1, y: 0.22, w: 0.7, h: 0.02 },
            financials: { '3': { x: 0.12, y: 0.4, w: 0.18, h: 0.02 } },
          },
        },
      ],
    });
    const rent = fields.find((field) => field.sourceFieldId === 'ent2-rent');
    expect(rent?.id).toBe('ent2-rent');
    expect(rent?.box).toEqual({ x: 0.12, y: 0.4, w: 0.18, h: 0.02 });
    expect(rent?.pageIndex).toBe(0);
  });

  test('does not map partnership guaranteed payments onto a W-2 or paystub', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['W-2'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            'Form W-2 Wage and Tax Statement',
            'Box 1 Wages tips other compensation 60000.00',
            'Profit sharing 12% Current Period Net Pay 1840.22'
          ])
        },
        {
          index: 1,
          formIds: ['Paystub'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: words([
            'Earnings Statement Current Period Regular 1800.00',
            'Year to Date 54000.00'
          ])
        }
      ])
    );
    expect(fields.some((field) => field.form === 'Form 1065')).toBe(false);
    expect(fields.find((field) => field.sourceFieldId === 'w2-box1')?.numericValue).toBe(60000);
    expect(fields.find((field) => field.sourceFieldId === 'ps-base-ytd')?.numericValue).toBe(54000);
  });

  function at(text: string, x: number, y: number, w = 0.18): ParseWord {
    return { text, x, y, w, h: 0.018, confidence: 99 };
  }

  test('maps IRS-style W-2 boxes when labels and amounts sit on stacked rows', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['W-2'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: [
            at('b Employer identification number (EIN)', 0.08, 0.18, 0.32),
            at('d Control number', 0.55, 0.18, 0.28),
            at('74-1234567', 0.08, 0.22, 0.18),
            at('W2-2025-0447', 0.55, 0.22, 0.18),
            at("c Employer's name, address, and ZIP code", 0.08, 0.28, 0.4),
            at('Apex Technology Partners LLC', 0.08, 0.32, 0.4),
            at('1 Wages, tips, other compensation', 0.52, 0.42, 0.22),
            at('2 Federal income tax withheld', 0.76, 0.42, 0.2),
            at('78,500.00', 0.52, 0.47, 0.16),
            at('9,420.00', 0.76, 0.47, 0.16),
          ],
        },
      ]),
    );
    expect(fields.find((field) => field.sourceFieldId === 'w2-employer-ein')?.value).toBe('74-1234567');
    expect(fields.find((field) => field.sourceFieldId === 'w2-employer-name')?.value).toMatch(/Apex Technology/);
    expect(fields.find((field) => field.sourceFieldId === 'w2-box1')?.numericValue).toBe(78500);
    expect(fields.find((field) => field.sourceFieldId === 'w2-box2')?.numericValue).toBe(9420);
  });

  test('reads W-2 employer name from the cell below a clustered Box c / Box e row', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['W-2'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: [
            at("c Employer’s name, address, and ZIP code", 0.03, 0.23, 0.4),
            at("e Employee’s first name and initial / Last name", 0.59, 0.229, 0.35),
            at('Digital Solutions Corp', 0.03, 0.262, 0.35),
            at('Sarah K. Vance', 0.59, 0.262, 0.28),
            at('1 Wages, tips, other compensation', 0.59, 0.37, 0.22),
            at('78,500.00', 0.59, 0.40, 0.16),
          ],
        },
      ]),
    );
    expect(fields.find((field) => field.sourceFieldId === 'w2-employer-name')?.value).toBe('Digital Solutions Corp');
  });

  test('maps paystub Regular row current and YTD, not the hourly rate', () => {
    const fields = mapIncomeFields(
      response([
        {
          index: 0,
          formIds: ['Paystub'],
          isNativeText: true,
          meanConfidence: 99,
          skewDegrees: 0,
          flags: [],
          words: [
            at('BASE RATE', 0.08, 0.16, 0.14),
            at('$45.00 / hr · 40 hr/wk', 0.6, 0.16, 0.28),
            at('RATE', 0.3, 0.2, 0.1),
            at('HOURS', 0.45, 0.2, 0.1),
            at('CURRENT', 0.6, 0.2, 0.1),
            at('YTD', 0.78, 0.2, 0.1),
            at('Regular', 0.08, 0.28, 0.14),
            at('45.00', 0.3, 0.28, 0.1),
            at('86.67', 0.45, 0.28, 0.1),
            at('3,600.00', 0.6, 0.28, 0.12),
            at('54,000.00', 0.78, 0.28, 0.12),
            at('Bonus', 0.08, 0.34, 0.14),
            at('0.00', 0.6, 0.34, 0.1),
            at('12,500.00', 0.78, 0.34, 0.12),
          ],
        },
      ]),
    );
    expect(fields.find((field) => field.sourceFieldId === 'ps-hourly-rate')?.numericValue).toBe(45);
    expect(fields.find((field) => field.sourceFieldId === 'ps-hours-week')?.numericValue).toBe(40);
    expect(fields.find((field) => field.sourceFieldId === 'ps-current-base')?.numericValue).toBe(3600);
    expect(fields.find((field) => field.sourceFieldId === 'ps-base-ytd')?.numericValue).toBe(54000);
    expect(fields.find((field) => field.sourceFieldId === 'ps-bonus-ytd')?.numericValue).toBe(12500);
  });
});
