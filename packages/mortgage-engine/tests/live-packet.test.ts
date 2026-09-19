import type { MappedIncomeField, ParsePage, ParseResponse } from '../../../apps/underwriting-console/src/parseTypes';
import {
  classifyDocument,
  fieldForInspection,
  findDuplicate,
  firstPageForKind,
  inspectNavigation,
  inspectOverlayFromField,
  latestPageForKind,
  pageForKind,
  pickDocumentForTab,
  taxReturnFingerprint,
} from '../../../apps/underwriting-console/src/livePacket';

declare global {
  interface File {}
}

function page(index: number, formIds: string[]): ParsePage {
  return {
    index,
    formIds,
    isNativeText: true,
    meanConfidence: 99,
    skewDegrees: 0,
    flags: [],
    words: [],
  };
}

function response(pages: ParsePage[], extras: Partial<ParseResponse> = {}): ParseResponse {
  return {
    transaction_id: 't',
    total_pages_scanned: pages.length,
    pages_extracted_count: pages.length,
    extracted_page_indices: pages.map((item) => item.index),
    ocr_page_count: 0,
    has_business_returns: false,
    flags: [],
    classifications: Object.fromEntries(pages.map((item) => [String(item.index), item.formIds])),
    unresolved_statements: [],
    pages,
    ...extras,
  };
}

const scheduleEProps = {
  scheduleEProperties: [
    {
      pageIndex: 0,
      column: 'A' as const,
      year: 2025,
      address: '100 Main St',
      propertyType: '1',
      fairRentalDays: 365,
      financials: { '3': 24000 },
    },
  ],
};

describe('live packet routing', () => {
  test('keeps wage-field inspection scoped to the open PDF', () => {
    const fields = [
      { id: 'w2-a:w2-box5', sourceFieldId: 'w2-box5', documentId: 'w2-a', pageIndex: 0 },
      { id: 'w2-b:w2-box5', sourceFieldId: 'w2-box5', documentId: 'w2-b', pageIndex: 0 },
      { id: 'tax:ent2-rents', sourceFieldId: 'ent2-rents', documentId: 'tax', pageIndex: 8 },
    ] as MappedIncomeField[];

    expect(fieldForInspection(fields, 'w2-box5', 'w2-b')?.documentId).toBe('w2-b');
    expect(fieldForInspection(fields, 'ps-base-ytd', 'w2-b')).toBeUndefined();
    expect(fieldForInspection(fields, 'ent2-rents', 'w2-b')?.documentId).toBe('tax');
  });

  test('prefers the latest paystub page unless the current page already has the field', () => {
    const fields = [
      { id: 'ps-current-base', sourceFieldId: 'ps-current-base', documentId: 'stub', pageIndex: 0 },
      { id: 'ps-current-base--p1', sourceFieldId: 'ps-current-base', documentId: 'stub', pageIndex: 1 },
      { id: 'ps-current-base--p2', sourceFieldId: 'ps-current-base', documentId: 'stub', pageIndex: 2 },
    ] as MappedIncomeField[];

    expect(fieldForInspection(fields, 'ps-current-base', 'stub')?.pageIndex).toBe(2);
    expect(fieldForInspection(fields, 'ps-current-base', 'stub', undefined, 1)?.pageIndex).toBe(1);
    expect(fieldForInspection(fields, 'ps-current-base', 'stub', undefined, 9)?.pageIndex).toBe(2);
  });

  test('maps demo employer and frequency aliases to the latest live fields', () => {
    const fields = [
      { id: 'ps-employer-name', sourceFieldId: 'ps-employer-name', documentId: 'stub', pageIndex: 0 },
      { id: 'ps-employer-name--p2', sourceFieldId: 'ps-employer-name', documentId: 'stub', pageIndex: 2 },
      { id: 'ps-pay-frequency', sourceFieldId: 'ps-pay-frequency', documentId: 'stub', pageIndex: 2 },
    ] as MappedIncomeField[];

    expect(fieldForInspection(fields, 'ps-emp-name', 'stub')?.pageIndex).toBe(2);
    expect(fieldForInspection(fields, 'ps-frequency', 'stub')?.sourceFieldId).toBe('ps-pay-frequency');
  });

  test('live inspect never falls back to the generated paystub page', () => {
    expect(
      inspectNavigation({
        isLive: true,
        livePageIndex: 2,
        facsimilePage: 1,
      }),
    ).toEqual({ livePageIndex: 2 });
    expect(
      inspectNavigation({
        isLive: true,
        entityPageIndex: 3,
        facsimilePage: 1,
      }),
    ).toEqual({ livePageIndex: 3 });
    expect(
      inspectNavigation({
        isLive: false,
        facsimilePage: 1,
      }),
    ).toEqual({ livePageIndex: undefined, facsimilePage: 1 });
  });

  test('inspects the latest paystub page box, not the facsimile or page 0', () => {
    const fields = [
      {
        id: 'ps-current-base',
        sourceFieldId: 'ps-current-base',
        documentId: 'mypay',
        pageIndex: 0,
        box: { x: 0.1, y: 0.2, w: 0.08, h: 0.02 },
      },
      {
        id: 'ps-current-base--paystub-p2',
        sourceFieldId: 'ps-current-base',
        documentId: 'mypay',
        pageIndex: 2,
        box: { x: 0.12, y: 0.44, w: 0.11, h: 0.014 },
      },
    ] as MappedIncomeField[];

    const live = fieldForInspection(fields, 'ps-current-base', 'mypay');
    expect(live?.pageIndex).toBe(2);
    expect(inspectOverlayFromField(live)).toEqual({
      pageIndex: 2,
      box: { x: 0.12, y: 0.44, w: 0.11, h: 0.014 },
    });
    expect(fieldForInspection(fields, 'ps-emp-name', 'mypay')).toBeUndefined();
  });

  test('maps demo employer alias to the live employer field on the latest page', () => {
    const fields = [
      {
        id: 'ps-employer-name',
        sourceFieldId: 'ps-employer-name',
        documentId: 'mypay',
        pageIndex: 0,
        box: { x: 0.05, y: 0.05, w: 0.3, h: 0.03 },
      },
      {
        id: 'ps-employer-name--paystub-p2',
        sourceFieldId: 'ps-employer-name',
        documentId: 'mypay',
        pageIndex: 2,
        box: { x: 0.04, y: 0.06, w: 0.28, h: 0.03 },
      },
    ] as MappedIncomeField[];
    expect(fieldForInspection(fields, 'ps-emp-name', 'mypay')?.pageIndex).toBe(2);
  });

  test('classifies paystub, W-2, and Schedule E separately', () => {
    expect(classifyDocument(response([page(0, ['Paystub'])]))).toContain('paystub');
    expect(classifyDocument(response([page(0, ['W-2'])]))).toContain('w2');
    expect(classifyDocument(response([page(0, ['Schedule E (Page 1 - Rentals)'])]))).toContain('schedule-e');
  });

  test('classifies an unlabeled paystub from the file name', () => {
    expect(classifyDocument(response([page(0, [])]), 'March-paystub.pdf')).toContain('paystub');
    expect(classifyDocument(response([page(0, [])]), '2024-w2.pdf')).toContain('w2');
    expect(classifyDocument(response([page(0, [])]), 'k1-1120s.pdf')).toContain('scorp');
    expect(classifyDocument(response([page(0, [])]), 'k1-1065.pdf')).toContain('partnership');
  });

  test('keeps the paystub document when a tax return is added later', () => {
    const paystub = {
      id: 'ps',
      sha256: 'aaa',
      fileName: 'stub.pdf',
      file: {} as File,
      result: response([page(0, ['Paystub'])]),
    };
    const w2 = {
      id: 'w2',
      sha256: 'bbb',
      fileName: 'w2.pdf',
      file: {} as File,
      result: response([page(0, ['W-2'])]),
    };
    const scheduleE = {
      id: 'e',
      sha256: 'ccc',
      fileName: '1040-2025.pdf',
      file: {} as File,
      result: response([page(0, ['Schedule E (Page 1 - Rentals)'])], scheduleEProps),
    };
    const packet = [paystub, w2, scheduleE];
    expect(pickDocumentForTab(packet, 'PAYSTUB_RECONCILIATION', 'paystub')?.id).toBe('ps');
    expect(pickDocumentForTab(packet, 'PAYSTUB_RECONCILIATION', 'w2')?.id).toBe('w2');
    expect(pickDocumentForTab(packet, 'SCHEDULE_E')?.id).toBe('e');
  });

  test('falls back to the W-2 when the paystub tab has no paystub PDF', () => {
    const w2 = {
      id: 'w2',
      sha256: 'bbb',
      fileName: 'w2.pdf',
      file: {} as File,
      result: response([page(0, ['W-2'])]),
    };
    const scheduleE = {
      id: 'e',
      sha256: 'ccc',
      fileName: 'schedule-e.pdf',
      file: {} as File,
      result: response([page(0, ['Schedule E (Page 1 - Rentals)'])], scheduleEProps),
    };
    expect(pickDocumentForTab([w2, scheduleE], 'PAYSTUB_RECONCILIATION', 'paystub')?.id).toBe('w2');
  });

  test('opens a combined 1040 on the W-2 page, not page 1', () => {
    const combined = response(
      [page(0, ['Form 1040 (Individual Return)']), page(1, ['W-2']), page(2, ['Schedule E (Page 1 - Rentals)'])],
      scheduleEProps,
    );
    expect(firstPageForKind(combined, 'w2')).toBe(1);
    expect(firstPageForKind(combined, 'schedule-e')).toBe(2);
  });

  test('opens a multi-page paystub on the last page and leaves W-2 on the first match', () => {
    const stubs = response([page(0, ['Paystub']), page(1, ['Paystub']), page(2, ['Paystub'])]);
    expect(latestPageForKind(stubs, 'paystub')).toBe(2);
    expect(pageForKind(stubs, 'paystub')).toBe(2);
    expect(pageForKind(response([page(0, ['W-2']), page(1, ['W-2'])]), 'w2')).toBe(0);
  });

  test('rejects the same tax return by hash or Schedule E year/address', () => {
    const first = {
      fileName: '1040-2025.pdf',
      sha256: 'same-bytes',
      result: response([page(0, ['Schedule E (Page 1 - Rentals)'])], {
        scheduleEProperties: [
          {
            pageIndex: 0,
            column: 'A',
            year: 2025,
            address: '100 Main Street',
            propertyType: '1',
            fairRentalDays: 365,
            financials: { '3': 24000 },
          },
        ],
      }),
    };
    expect(
      findDuplicate([first], { sha256: 'same-bytes', fileName: 'copy.pdf', result: first.result })?.reason,
    ).toMatch(/Duplicate file/);
    expect(
      findDuplicate([first], {
        sha256: 'other-bytes',
        fileName: '1040-scan.pdf',
        result: response([page(0, ['Form 1040 (Individual Return)', 'Schedule E (Page 1 - Rentals)'])], {
          scheduleEProperties: [
            {
              pageIndex: 0,
              column: 'A',
              year: 2025,
              address: '100 Main St',
              propertyType: '1',
              fairRentalDays: 365,
              financials: { '3': 24000 },
            },
          ],
        }),
      })?.reason,
    ).toMatch(/Duplicate tax return/);
    expect(taxReturnFingerprint(first.result)).toContain('2025');
  });

  test('rejects a full 1040 that overlaps a standalone 2025 Schedule E', () => {
    const standalone = {
      fileName: '2025-schedule-e.pdf',
      sha256: 'e-only',
      result: response([page(0, ['Schedule E (Page 1 - Rentals)'])], scheduleEProps),
    };
    const fullReturn = {
      sha256: 'full-1040',
      fileName: '2025-tax-return.pdf',
      result: response(
        [page(0, ['Form 1040 (Individual Return)']), page(1, ['Schedule E (Page 1 - Rentals)'])],
        {
          scheduleEProperties: [
            {
              pageIndex: 1,
              column: 'A',
              year: 2025,
              address: '100 Main Street',
              propertyType: '1',
              fairRentalDays: 365,
              financials: { '3': 24000, '21': 9000 },
            },
            {
              pageIndex: 1,
              column: 'B',
              year: 2025,
              address: '200 Oak Ave',
              propertyType: '1',
              fairRentalDays: 365,
              financials: { '3': 18000 },
            },
          ],
        },
      ),
    };
    expect(findDuplicate([standalone], fullReturn)?.reason).toMatch(/Duplicate tax return/);
  });
});
