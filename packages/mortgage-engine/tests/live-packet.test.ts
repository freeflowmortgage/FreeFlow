import type { ParsePage, ParseResponse } from '../../../apps/underwriting-console/src/parseTypes';
import {
  classifyDocument,
  findDuplicate,
  firstPageForKind,
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
  test('classifies paystub, W-2, and Schedule E separately', () => {
    expect(classifyDocument(response([page(0, ['Paystub'])]))).toContain('paystub');
    expect(classifyDocument(response([page(0, ['W-2'])]))).toContain('w2');
    expect(classifyDocument(response([page(0, ['Schedule E (Page 1 - Rentals)'])]))).toContain('schedule-e');
  });

  test('classifies an unlabeled paystub from the file name', () => {
    expect(classifyDocument(response([page(0, [])]), 'March-paystub.pdf')).toContain('paystub');
    expect(classifyDocument(response([page(0, [])]), '2024-w2.pdf')).toContain('w2');
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
