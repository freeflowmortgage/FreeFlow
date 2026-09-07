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
});
