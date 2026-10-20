import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConsoleContext } from './protectedWorkflow';
import { mapIncomeFields } from './incomeFieldMap';
import { liveSchCPatch, liveWagePatch } from './liveHydrate';
import {
  fieldForInspection,
  inspectFieldIds,
  inspectOverlayFromField,
  kindsOf,
  pickDocumentForTab,
  scheduleEFilings,
  tabForKinds,
} from './livePacket';
import type { ScheduleEPropertyExtract } from './parseTypes';
import {
  protectedWorkspaceContext,
  protectedWorkspaceDocuments,
  rehydrateProtectedParseResponse,
} from './protectedWorkspace';

const extraction: ConsoleContext['extractions'][number] = {
  id: 'extraction-1',
  attachmentId: 'upload-1',
  sourceDocumentVersion: 1,
  parserVersion: 'income-parser-v5',
  schemaVersion: 'income-extraction-v2',
  status: 'ACTIVE',
  warnings: ['AUTHORITATIVE_TAX_YEAR_REQUIRED'],
  confidence: 98.5,
  normalizedInput: {
    w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 96000, pageIndex: 0, box1Wages: 95000, box5Wages: 96000 }],
    formRecords: [{
      entityId: 'Schedule C:business-1', form: 'Schedule C', pageIndex: 1,
      fields: [
        { sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' },
        { sourceFieldId: 'ent1-net', value: '120000.00', numericValue: 120000 },
      ],
    }],
    scheduleEProperties: [{ year: 2025, propertyAddress: '100 Synthetic Lane', propertyType: 'RENTAL', rentsReceived: 24000, netIncomeLoss: 12000, pageIndex: 2, column: 'B' }],
  },
  evidence: { fields: [
    { collection: 'w2Extracts', index: 0, field: 'box1', pageIndex: 0, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
    { collection: 'formExtracts', entityId: 'Schedule C:business-1', field: 'ent1-net', pageIndex: 1, box: { x: 0.2, y: 0.3, w: 0.2, h: 0.03 } },
    { collection: 'scheduleEProperties', index: 0, field: 'address', pageIndex: 2, box: { x: 0.15, y: 0.25, w: 0.35, h: 0.03 } },
    { collection: 'scheduleEProperties', index: 0, field: 'financials.3', pageIndex: 2, box: { x: 0.25, y: 0.35, w: 0.15, h: 0.03 } },
  ] },
  metadataReview: {
    id: 'review-1', metadataVersion: 1, current: true,
    assignments: [
      { entityId: 'w2-p0-0', borrowerKey: 'borrower-1', employmentRole: 'CURRENT' },
      { entityId: 'Schedule C:business-1', borrowerKey: 'borrower-2', taxYear: 2025 },
    ],
  },
};

const context: ConsoleContext = {
  loan: { id: 'loan-1', version: 3, status: 'DOCS_UPLOADED', program: 'CONVENTIONAL', borrowerName: 'Synthetic Borrower' },
  borrowers: [
    { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' },
    { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' },
  ],
  attachments: [{ attachmentId: 'upload-1', category: 'W2_WAGE', version: 1, pageCount: 3, parserVersion: 'income-parser-v5' }],
  extractions: [extraction],
  calculation: { id: 'calculation-1', calculatedLoanVersion: 3, qualifyingMonthlyIncome: '18000.00', trendingResult: 'STABLE', yearsAnalyzed: [2025], current: true },
  approval: null,
  hostWrite: null,
};

test('rehydrates persisted fields and coordinate evidence for Nate\'s workspace without OCR text', () => {
  const result = rehydrateProtectedParseResponse(extraction, 3);
  assert.equal(result.pages.length, 3);
  assert.deepEqual(result.pages[0]?.formIds, ['W-2']);
  assert.deepEqual(result.pages[1]?.formIds, ['Schedule C']);
  assert.deepEqual(result.pages[2]?.formIds, ['Schedule E']);
  assert.equal(result.pages.every((page) => page.words.length === 0), true);
  assert.equal(result.w2Extracts?.[0]?.box1, 95000);
  assert.equal(result.w2Extracts?.[0]?.box5, 96000);
  assert.deepEqual(result.w2Extracts?.[0]?.boxes?.box1, { x: 0.1, y: 0.2, w: 0.3, h: 0.04 });
  assert.equal(result.formExtracts?.find((field) => field.sourceFieldId === 'ent1-net')?.fieldLabel, 'Net Profit or Loss (Line 31)');
  assert.deepEqual(result.formExtracts?.find((field) => field.sourceFieldId === 'ent1-net')?.box, { x: 0.2, y: 0.3, w: 0.2, h: 0.03 });
  assert.equal(result.scheduleEProperties?.[0]?.address, '100 Synthetic Lane');
  assert.equal(result.scheduleEProperties?.[0]?.column, 'B');
  assert.deepEqual(result.scheduleEProperties?.[0]?.boxes?.financials?.['3'], { x: 0.25, y: 0.35, w: 0.15, h: 0.03 });
  assert.equal(JSON.stringify(result).includes('rawOcrText'), false);

  const mapped = mapIncomeFields(result);
  assert.equal(liveWagePatch(mapped)?.w2Year1Box5, 96000);
  assert.equal(liveSchCPatch(mapped)?.line31, 120000);
  assert.deepEqual(mapped.find((field) => field.sourceFieldId === 'ent1-net')?.box, { x: 0.2, y: 0.3, w: 0.2, h: 0.03 });
});

test('includes only active persisted extractions whose original PDF remains in the browser session', () => {
  const file = new File(['%PDF-synthetic'], 'income.pdf', { type: 'application/pdf' });
  const documents = protectedWorkspaceDocuments(context, [
    { file, attachmentId: 'upload-1' },
    { file: new File(['%PDF-pending'], 'pending.pdf', { type: 'application/pdf' }), attachmentId: null },
  ]);
  assert.equal(documents.length, 1);
  assert.equal(documents[0]?.file, file);
  assert.equal(documents[0]?.result.transaction_id, 'extraction-1');
});

test('maps authoritative loan identity and reviewed borrower assignments without defaulting documents', () => {
  const workspace = protectedWorkspaceContext(context);
  assert.equal(workspace?.loanId, 'loan-1');
  assert.equal(workspace?.borrowers[0]?.name, 'Synthetic Borrower');
  assert.equal(workspace?.borrowers[1]?.name, 'Co-borrower (borrower-2)');
  assert.equal(workspace?.authoritativeMonthlyIncome, 18000);
  assert.deepEqual(workspace?.borrowerAssignments, {
    'upload-1:0:W-2': 'borrower-1',
    'upload-1:1:Schedule C': 'borrower-2',
  });
});

test('preserves a live parser box through field mapping into the PDF highlight overlay', () => {
  const mapped = mapIncomeFields({
    transaction_id: 'preview-1', total_pages_scanned: 1, pages_extracted_count: 1,
    extracted_page_indices: [0], ocr_page_count: 1, has_business_returns: false,
    flags: [], classifications: { '0': ['Schedule C'] }, unresolved_statements: [],
    pages: [{ index: 0, formIds: ['Schedule C'], isNativeText: false, meanConfidence: 99, skewDegrees: 0, words: [], flags: [] }],
    formExtracts: [{
      pageIndex: 0, form: 'Schedule C', sourceFieldId: 'ent1-net', boxLabel: '31',
      fieldLabel: 'Net Profit or Loss', lineNum: '31', category: 'income', value: '120000',
      numericValue: 120000, box: { x: 0.11, y: 0.22, w: 0.33, h: 0.044 },
    }],
  }).map((field) => ({ ...field, documentId: 'preview-document' }));
  const field = fieldForInspection(mapped, 'schc-l31', 'preview-document', undefined, 0);
  assert.deepEqual(inspectOverlayFromField(field), {
    pageIndex: 0,
    box: { x: 0.11, y: 0.22, w: 0.33, h: 0.044 },
  });
});

test('routes a rehydrated Form 1120 to the C-corp tab and keeps Form 1120-S on the S-corp tab', () => {
  const corporate = (form: string, fieldId: string): ConsoleContext['extractions'][number] => ({
    ...extraction,
    normalizedInput: { formRecords: [{ entityId: `${form}:p0`, form, pageIndex: 0, fields: [{ sourceFieldId: fieldId, numericValue: 250000 }] }] },
    evidence: { fields: [] },
  });
  const cCorp = rehydrateProtectedParseResponse(corporate('Form 1120', 'c1120-taxable'), 1);
  assert.deepEqual(kindsOf({ fileName: 'upload.pdf', result: cCorp }), ['ccorp']);
  assert.equal(tabForKinds(kindsOf({ fileName: 'upload.pdf', result: cCorp })).tab, 'CCORP');
  assert.equal(pickDocumentForTab([{ id: 'c', sha256: 'c', file: new File([], 'upload.pdf'), fileName: 'upload.pdf', result: cCorp }], 'CCORP')?.id, 'c');

  const sCorp = rehydrateProtectedParseResponse(corporate('Form 1120-S', 'scorp-return-ord'), 1);
  assert.deepEqual(kindsOf({ fileName: 'upload.pdf', result: sCorp }), ['scorp']);
});

test('keeps a second Schedule E for the same address and year as its own filing', () => {
  const rental = (documentId: string, year: number, rents: number): ScheduleEPropertyExtract & { documentId: string } => ({
    documentId,
    year,
    pageIndex: 0,
    column: 'A',
    address: '742 Evergreen Terrace, Springfield, IL 62704',
    propertyType: '1',
    fairRentalDays: 365,
    financials: { '3': rents },
  });
  const borrower2025 = rental('borrower-2025', 2025, 12000);
  const borrower2024 = rental('borrower-2024', 2024, 11000);
  const coBorrower2025 = rental('co-borrower-2025', 2025, 12000);

  const unassigned = scheduleEFilings([borrower2025, borrower2024, coBorrower2025]);
  assert.equal(unassigned.length, 2);
  assert.deepEqual(
    unassigned.map((filing) => [filing.latest.documentId, filing.prior?.documentId]),
    [['borrower-2025', 'borrower-2024'], ['co-borrower-2025', undefined]],
  );

  const owners: Record<string, string> = {
    'borrower-2025': 'borrower-1',
    'borrower-2024': 'borrower-1',
    'co-borrower-2025': 'borrower-2',
  };
  // Listed so that, without owners, the co-borrower's 2025 would take the 2024 prior.
  const assigned = scheduleEFilings([coBorrower2025, borrower2025, borrower2024], (row) => owners[row.documentId]);
  assert.deepEqual(
    assigned.map((filing) => [filing.ownerId, filing.latest.documentId, filing.prior?.documentId]),
    [['borrower-2', 'co-borrower-2025', undefined], ['borrower-1', 'borrower-2025', 'borrower-2024']],
  );

  const twoYears = scheduleEFilings([borrower2024, borrower2025]);
  assert.equal(twoYears.length, 1);
  assert.equal(twoYears[0].latest.year, 2025);
  assert.equal(twoYears[0].prior?.year, 2024);
});

test('maps worksheet highlight ids back to parser ids across supported income families', () => {
  assert.equal(inspectFieldIds('schc-l31').includes('ent1-net'), true);
  assert.equal(inspectFieldIds('ccorp-ti').includes('c1120-taxable'), true);
  assert.equal(inspectFieldIds('farm-net').includes('schedule-f-net'), true);
  assert.equal(inspectFieldIds('asset-capitalGainsNetLoss').includes('schedule-d-capital-gain-loss'), true);
  assert.equal(inspectFieldIds('k1-oi-y1').includes('pt-return-other'), true);
});
