import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { approveIncomeCalculation } from '../audit/approveIncome';
import { approvedHostFields } from '../integrations/encompass/hostWrite';
import { hasCurrentCalculationExtractions } from './extractionFreshness';
import {
  ExtractionMetadataRequiredError,
  mergeAuthoritativeExtractionInputs,
  namespacedBorrowerKeys,
  reconcileDuplicateWages,
  type ExtractionMetadataAssignment,
} from './authoritativeExtractionInput';
import { calculateProtectedBorrowerIncome } from './borrowerIncomeCalculation';
import { readBorrowerIncome, readLaunchBorrowers, type PersistedBorrower } from './loanBorrowerRoster';
import { parseMetadataReviewBody, reviewExtractionMetadata } from './reviewExtractionMetadata';

const ROSTER: readonly PersistedBorrower[] = [
  { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' },
  { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' },
];
const KEYS = ROSTER.map((borrower) => borrower.borrowerKey);

type RecordInput = Readonly<{
  extractionId: string;
  normalizedInput: unknown;
  metadataAssignments?: readonly ExtractionMetadataAssignment[];
}>;

function form(entityId: string, formName: string, fields: ReadonlyArray<{ sourceFieldId: string; value?: string; numericValue?: number }>) {
  return { entityId, form: formName, pageIndex: 0, fields };
}

function authorize(records: readonly RecordInput[]) {
  let blocked: ExtractionMetadataRequiredError | undefined;
  try {
    mergeAuthoritativeExtractionInputs(records, { borrowerRoster: KEYS });
  } catch (error) {
    if (error instanceof ExtractionMetadataRequiredError) blocked = error;
    else throw error;
  }
  const merged = mergeAuthoritativeExtractionInputs(records, { borrowerRoster: KEYS });
  const reconciliation = reconcileDuplicateWages(records);
  const calculationInput = {
    ...merged,
    ...(merged.w2Employers ? { w2Employers: merged.w2Employers.filter((row) => !reconciliation.dropEntityIds.has(row.entityId)) } : {}),
  };
  const result = calculateProtectedBorrowerIncome('CONVENTIONAL', ROSTER, calculationInput, namespacedBorrowerKeys(records));
  const combined = result.borrowerIncome.reduce((total, line) => total + Number(line.qualifyingMonthlyIncome), 0);
  assert.equal(combined.toFixed(2), result.qualifyingMonthlyIncome.toFixed(2));
  return { blocked, reconciliation, calculationInput, result };
}

function line(result: ReturnType<typeof authorize>['result'], borrowerKey: string) {
  return result.borrowerIncome.find((item) => item.borrowerKey === borrowerKey)!;
}

test('AC-01 two-borrower W-2 assignment, calculation, and review', () => {
  const records: RecordInput[] = [1, 2].map((ordinal) => ({
    extractionId: `00000000-0000-4000-8000-00000000010${ordinal}`,
    normalizedInput: { w2Records: [{ entityId: `w2-${ordinal}`, employerName: ordinal === 1 ? 'Northwind Labs' : 'Other Co', year: 2025, annualWages: ordinal === 1 ? 96000 : 72000, box5Wages: ordinal === 1 ? 96000 : 72000 }] },
    metadataAssignments: [{ entityId: `w2-${ordinal}`, employmentRole: 'CURRENT' as const, borrowerKey: `borrower-${ordinal}` }],
  }));
  assert.throws(() => mergeAuthoritativeExtractionInputs(records.map(({ metadataAssignments: _ignored, ...record }) => record), { borrowerRoster: KEYS }), (error: unknown) => error instanceof ExtractionMetadataRequiredError && error.requirements.some((item) => item.field === 'borrowerAssignment'));
  const { result } = authorize(records);
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '8000.00');
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '6000.00');
  assert.equal(result.qualifyingMonthlyIncome, 14000);
  parseMetadataReviewBody({ expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null, assignments: records[0].metadataAssignments });
});

test('AC-02 same employer on the other borrower is not cross-assigned', () => {
  const borrowerOne = {
    extractionId: '00000000-0000-4000-8000-000000000202',
    normalizedInput: { w2Records: [{ entityId: 'w2-match', employerName: 'Northwind Labs', year: 2025, annualWages: 96000, box5Wages: 96000 }] },
    metadataAssignments: [{ entityId: 'w2-match', employmentRole: 'CURRENT' as const, borrowerKey: 'borrower-1' }],
  };
  const otherBorrowerSameEmployer = {
    extractionId: '00000000-0000-4000-8000-000000000203',
    normalizedInput: { w2Records: [{ entityId: 'w2-other', employerName: 'Northwind Labs', year: 2025, annualWages: 72000, box5Wages: 72000 }] },
    metadataAssignments: [{ entityId: 'w2-other', employmentRole: 'CURRENT' as const, borrowerKey: 'borrower-2' }],
  };
  const { reconciliation, result } = authorize([borrowerOne, otherBorrowerSameEmployer]);
  assert.equal(reconciliation.dropEntityIds.size, 0);
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '8000.00');
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '6000.00');
  const withPaystub = authorize([reviewedPaystub('00000000-0000-4000-8000-000000000201'), borrowerOne, otherBorrowerSameEmployer]);
  assert.equal(withPaystub.reconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000202:w2-match'), true);
  assert.equal(withPaystub.reconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000203:w2-other'), false);
  assert.equal(withPaystub.reconciliation.gaps.includes('PAYSTUB_W2_RECONCILED'), true);
  assert.equal(line(withPaystub.result, 'borrower-1').qualifyingMonthlyIncome, '5600.00');
  assert.equal(line(withPaystub.result, 'borrower-2').qualifyingMonthlyIncome, '6000.00');
});

test('AC-03 a reviewed paystub authorizes base and variable from annualizePaystub', () => {
  const paystub = reviewedPaystub('00000000-0000-4000-8000-000000000221');
  const { calculationInput, result } = authorize([paystub]);
  const wage = calculationInput.w2Employers?.[0];
  assert.equal(wage?.annualBaseIncome, 48000);
  assert.equal(wage?.annualVariableIncome, 19200);
  assert.equal(wage?.annualWages, undefined);
  assert.notEqual(wage?.annualBaseIncome, 30000);
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '5600.00');
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '0.00');
  parseMetadataReviewBody({ expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null, assignments: paystub.metadataAssignments });
});

test('AC-11 a paystub beside another employer W-2 keeps both wages and records the gap', () => {
  const packet = [
    reviewedPaystub('00000000-0000-4000-8000-000000000211'),
    {
      extractionId: '00000000-0000-4000-8000-000000000212',
      normalizedInput: { w2Records: [{ entityId: 'w2-other', employerName: 'Other Co', year: 2025, annualWages: 12000, box5Wages: 12000 }] },
      metadataAssignments: [{ entityId: 'w2-other', employmentRole: 'CONCURRENT' as const, borrowerKey: 'borrower-1' }],
    },
  ];
  const { reconciliation, result } = authorize(packet);
  assert.equal(reconciliation.dropEntityIds.size, 0);
  assert.deepEqual(reconciliation.gaps, ['PAYSTUB_EMPLOYER_UNMATCHED']);
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '6600.00');
});

test('AC-04 Schedule C assigns and calculates on the protected path', () => {
  const { result } = authorize([business('00000000-0000-4000-8000-000000000301', 'Schedule C', 'sch-c', [
    { sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' }, { sourceFieldId: 'ent1-net', numericValue: 96000 },
  ], { entityId: 'sch-c', taxYear: 2025, borrowerKey: 'borrower-2' })]);
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '8000.00');
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '0.00');
});

test('AC-05 Schedule F assigns and calculates on the protected path', () => {
  const { result } = authorize([business('00000000-0000-4000-8000-000000000302', 'Schedule F', 'sch-f', [
    { sourceFieldId: 'schedule-f-name', value: 'Synthetic Farm' }, { sourceFieldId: 'schedule-f-net', numericValue: 48000 },
  ], { entityId: 'sch-f', taxYear: 2025, borrowerKey: 'borrower-2' })]);
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '4000.00');
});

test('AC-06 Form 1120-S record calculates K-1 ordinary capped at equal distributions', () => {
  const { result } = authorize([business('00000000-0000-4000-8000-000000000303', 'Form 1120-S', 'scorp-1', [
    { sourceFieldId: 'scorp-name', value: 'Synthetic S Corp' },
    { sourceFieldId: 'scorp-ord', numericValue: 120000 },
    { sourceFieldId: 'scorp-dist', numericValue: 120000 },
    { sourceFieldId: 'scorp-own-pct', numericValue: 100 },
  ], { entityId: 'scorp-1', taxYear: 2025, borrowerKey: 'borrower-2', hasStableDistributions: false })]);
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '10000.00');
});

test('AC-07 Form 1065 record calculates K-1 ordinary capped at equal distributions', () => {
  const { result } = authorize([business('00000000-0000-4000-8000-000000000304', 'Form 1065', 'pt-1', [
    { sourceFieldId: 'pt-name', value: 'Synthetic Partnership' },
    { sourceFieldId: 'pt-ord', numericValue: 60000 },
    { sourceFieldId: 'pt-dist', numericValue: 60000 },
    { sourceFieldId: 'pt-profit-pct', numericValue: 100 },
  ], { entityId: 'pt-1', taxYear: 2025, borrowerKey: 'borrower-2', hasStableDistributions: false })]);
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '5000.00');
});

test('AC-08 Form 1120 stays liquidity-locked until reviewed balance-sheet facts are supplied', () => {
  const fields = [
    { sourceFieldId: 'c1120-name', value: 'Synthetic Corp' },
    { sourceFieldId: 'c1120-taxable', numericValue: 120000 },
  ];
  const locked = authorize([business('00000000-0000-4000-8000-000000000305', 'Form 1120', 'c1120-1', fields, { entityId: 'c1120-1', taxYear: 2025, borrowerKey: 'borrower-2', ownershipPercentage: 100 })]);
  assert.equal(line(locked.result, 'borrower-2').qualifyingMonthlyIncome, '0.00');
  assert.equal(locked.result.slices[0].warnings.some((warning) => warning.code === 'CORPORATE_LIQUIDITY_FAILED'), true);
  const opened = authorize([business('00000000-0000-4000-8000-000000000305', 'Form 1120', 'c1120-1', fields, {
    entityId: 'c1120-1', taxYear: 2025, borrowerKey: 'borrower-2', ownershipPercentage: 100, cash: 20000, currentLiabilities: 10000,
  })]);
  assert.equal(line(opened.result, 'borrower-2').qualifyingMonthlyIncome, '10000.00');
});

test('AC-09 Schedule B interest is blocked until an explicit include election', () => {
  const record = business('00000000-0000-4000-8000-000000000306', 'Schedule B', 'asset-1', [
    { sourceFieldId: 'schedule-b-interest', numericValue: 12000 },
  ], { entityId: 'asset-1', taxYear: 2025, borrowerKey: 'borrower-2' });
  assert.throws(() => authorize([record]), (error: unknown) => error instanceof ExtractionMetadataRequiredError && error.requirements.some((item) => item.field === 'assetElection'));
  const elected = authorize([{
    ...record,
    metadataAssignments: [{ ...record.metadataAssignments![0], includeInQualifyingIncome: true, hasThreeYearAssetSupport: true }],
  }]);
  assert.equal(line(elected.result, 'borrower-2').qualifyingMonthlyIncome, '1000.00');
  parseMetadataReviewBody({
    expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: [{ entityId: 'asset-1', taxYear: 2025, borrowerKey: 'borrower-2', includeInQualifyingIncome: true, hasThreeYearAssetSupport: true }],
  });
});

test('AC-09 Schedule D capital gain is blocked until an explicit include election', () => {
  const record = business('00000000-0000-4000-8000-000000000316', 'Schedule D', 'asset-d', [
    { sourceFieldId: 'schedule-d-capital-gain-loss', numericValue: 12000 },
  ], { entityId: 'asset-d', taxYear: 2025, borrowerKey: 'borrower-2' });
  assert.throws(() => authorize([record]), (error: unknown) => error instanceof ExtractionMetadataRequiredError && error.requirements.some((item) => item.field === 'assetElection' && item.form === 'Schedule D'));
  const elected = authorize([{
    ...record,
    metadataAssignments: [{ ...record.metadataAssignments![0], includeInQualifyingIncome: true, hasThreeYearAssetSupport: true }],
  }]);
  assert.equal(elected.result.slices[0].assetIncomeBreakdown[0].capitalGainsNetLoss, 12000);
  assert.equal(elected.result.slices[0].assetIncomeBreakdown[0].interestIncome, 0);
  assert.equal(line(elected.result, 'borrower-2').qualifyingMonthlyIncome, '1000.00');
  parseMetadataReviewBody({
    expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: [{ entityId: 'asset-d', taxYear: 2025, borrowerKey: 'borrower-2', includeInQualifyingIncome: true, hasThreeYearAssetSupport: true }],
  });
});

test('AC-10 multi Schedule E properties stay with the assigned borrower', () => {
  const property = (extractionId: string, addressIncome: number, borrowerKey: string) => ({
    extractionId,
    normalizedInput: { scheduleEProperties: [{ year: 2025, propertyAddress: '100 Synthetic Lane', propertyType: 'RENTAL' as const, netIncomeLoss: addressIncome }] },
    metadataAssignments: [{ entityId: 'schedule-e-0', borrowerKey }],
  });
  const { result } = authorize([
    property('00000000-0000-4000-8000-000000000307', 12000, 'borrower-1'),
    property('00000000-0000-4000-8000-000000000308', 24000, 'borrower-2'),
  ]);
  assert.equal(line(result, 'borrower-1').qualifyingMonthlyIncome, '1000.00');
  assert.equal(line(result, 'borrower-2').qualifyingMonthlyIncome, '2000.00');
  assert.equal(result.qualifyingMonthlyIncome, 3000);
});

test('demo gate fixture calculates paystub plus matching W-2, self-employed stack, Schedule E, and an asset', () => {
  const packet = [
    reviewedPaystub('00000000-0000-4000-8000-000000000401'),
    {
      extractionId: '00000000-0000-4000-8000-000000000402',
      normalizedInput: { w2Records: [{ entityId: 'w2-b1', employerName: 'Northwind Labs', year: 2025, annualWages: 96000, box5Wages: 96000 }] },
      metadataAssignments: [{ entityId: 'w2-b1', employmentRole: 'CURRENT' as const, borrowerKey: 'borrower-1' }],
    },
    business('00000000-0000-4000-8000-000000000403', 'Schedule C', 'sch-c', [
      { sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' }, { sourceFieldId: 'ent1-net', numericValue: 96000 },
    ], { entityId: 'sch-c', taxYear: 2025, borrowerKey: 'borrower-2' }),
    business('00000000-0000-4000-8000-000000000406', 'Form 1065', 'pt-1', [
      { sourceFieldId: 'pt-name', value: 'Synthetic Partnership' },
      { sourceFieldId: 'pt-ord', numericValue: 60000 },
      { sourceFieldId: 'pt-dist', numericValue: 60000 },
      { sourceFieldId: 'pt-profit-pct', numericValue: 100 },
    ], { entityId: 'pt-1', taxYear: 2025, borrowerKey: 'borrower-2', hasStableDistributions: false }),
    {
      extractionId: '00000000-0000-4000-8000-000000000404',
      normalizedInput: { scheduleEProperties: [{ year: 2025, propertyAddress: '200 Rental Road', propertyType: 'RENTAL' as const, netIncomeLoss: 24000 }] },
      metadataAssignments: [{ entityId: 'schedule-e-0', borrowerKey: 'borrower-2' }],
    },
    business('00000000-0000-4000-8000-000000000405', 'Schedule B', 'asset-1', [
      { sourceFieldId: 'schedule-b-interest', numericValue: 12000 },
    ], { entityId: 'asset-1', taxYear: 2025, borrowerKey: 'borrower-2', includeInQualifyingIncome: true, hasThreeYearAssetSupport: true }),
  ];
  const authorized = authorize(packet);
  assert.equal(authorized.reconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000402:w2-b1'), true);
  assert.equal(authorized.reconciliation.gaps.includes('PAYSTUB_W2_RECONCILED'), true);
  assert.equal(authorized.calculationInput.w2Employers?.some((row) => row.annualWages === 96000), false);
  assert.equal(line(authorized.result, 'borrower-1').qualifyingMonthlyIncome, '5600.00');
  assert.equal(line(authorized.result, 'borrower-2').qualifyingMonthlyIncome, '16000.00');
  assert.equal(authorized.result.qualifyingMonthlyIncome, 21600);
  const fields = approvedHostFields({
    loanId: '00000000-0000-4000-8000-000000000200', approvalId: 'approval-1', qualifyingMonthlyIncome: authorized.result.qualifyingMonthlyIncome,
    trendingAnalysis: authorized.result.trendingResult, yearsAnalyzed: [...authorized.result.yearsAnalyzed], borrowerIncome: authorized.result.borrowerIncome,
    auditUrl: 'https://console.example/audit/approval-1',
  });
  assert.equal(fields['CX.FREEFLOW.BORROWER.1.INCOME'], '5600.00');
  assert.equal(fields['CX.FREEFLOW.BORROWER.2.INCOME'], '16000.00');
  assert.equal(fields['CX.FREEFLOW.INCOME'], '21600.00');
  assert.equal(fields['CX.FREEFLOW.APPROVAL.ID'], 'approval-1');
  assert.equal(JSON.stringify(fields).includes('Northwind'), false);
  assert.equal(JSON.stringify(fields).includes('30000'), false);
});

test('AC-11 K-1 ordinary is not added again when a return line is present', () => {
  // Existing engine rule in calculateForm1084Income: K-1 boxes count at 100%.
  // Ownership applies only to entity return lines such as meals. A doubled
  // ordinary figure would be 200000, not 98000.
  const scorp = authorize([business('00000000-0000-4000-8000-000000000321', 'Form 1120-S', 'scorp-k1', [
    { sourceFieldId: 'scorp-name', value: 'Synthetic S Corp' },
    { sourceFieldId: 'scorp-ord', numericValue: 100000 },
    { sourceFieldId: 'scorp-meals', numericValue: 4000 },
    { sourceFieldId: 'scorp-own-pct', numericValue: 50 },
  ], { entityId: 'scorp-k1', taxYear: 2025, borrowerKey: 'borrower-2', hasStableDistributions: true })]);
  assert.equal(scorp.result.slices[0].form1120SBreakdown?.[0].k1EligibleIncome, 98000);
  assert.notEqual(scorp.result.slices[0].form1120SBreakdown?.[0].k1EligibleIncome, 200000);
  assert.equal(line(scorp.result, 'borrower-2').qualifyingMonthlyIncome, '8166.67');
  const partnership = authorize([business('00000000-0000-4000-8000-000000000322', 'Form 1065', 'pt-k1', [
    { sourceFieldId: 'pt-name', value: 'Synthetic Partnership' },
    { sourceFieldId: 'pt-ord', numericValue: 100000 },
    { sourceFieldId: 'pt-meals', numericValue: 4000 },
    { sourceFieldId: 'pt-profit-pct', numericValue: 50 },
  ], { entityId: 'pt-k1', taxYear: 2025, borrowerKey: 'borrower-2', hasStableDistributions: true })]);
  assert.equal(partnership.result.slices[0].form1065Breakdown?.[0].k1EligibleIncome, 98000);
  assert.notEqual(partnership.result.slices[0].form1065Breakdown?.[0].k1EligibleIncome, 200000);
  assert.equal(line(partnership.result, 'borrower-2').qualifyingMonthlyIncome, '8166.67');
});

test('AC-12 unknown borrower blocks review', async () => {
  assert.throws(() => readLaunchBorrowers({ borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY', name: 'Hidden' }, { borrowerKey: 'borrower-2', role: 'CO_BORROWER' }] }), (error: unknown) => error instanceof ApiError && error.code === 'INVALID_BORROWER_ROSTER');
  let where: { tenantId?: string; loanId?: string } | undefined;
  await assert.rejects(reviewExtractionMetadata(reviewTransaction(() => [], (captured) => { where = captured; }) as never, reviewContext(), reviewInput('borrower-9')), (error: unknown) => error instanceof ApiError && error.code === 'UNKNOWN_BORROWER');
  assert.equal(where?.tenantId, reviewContext().tenantId);
  assert.equal(where?.loanId, '00000000-0000-4000-8000-000000000200');
});

test('AC-13 a borrower key on another tenant or loan is denied', async () => {
  const tenantId = reviewContext().tenantId;
  const loanId = '00000000-0000-4000-8000-000000000200';
  const otherTenant = '00000000-0000-4000-8000-000000000199';
  const otherLoan = '00000000-0000-4000-8000-000000000299';
  const rows = [
    { tenantId: otherTenant, loanId, borrowerKey: 'borrower-1' },
    { tenantId, loanId: otherLoan, borrowerKey: 'borrower-1' },
  ];
  let where: { tenantId?: string; loanId?: string } | undefined;
  await assert.rejects(reviewExtractionMetadata(reviewTransaction(
    () => rows.filter((row) => row.tenantId === where?.tenantId && row.loanId === where?.loanId).map((row) => ({ borrowerKey: row.borrowerKey })),
    (captured) => { where = captured; },
  ) as never, reviewContext(), { ...reviewInput('borrower-1'), idempotencyKey: 'cross-tenant-key-0001' }), (error: unknown) => error instanceof ApiError && error.code === 'UNKNOWN_BORROWER');
  assert.equal(where?.tenantId, tenantId);
  assert.equal(where?.loanId, loanId);
  assert.equal(rows.filter((row) => row.tenantId === where?.tenantId && row.loanId === where?.loanId).length, 0);
});

test('AC-14 reassignment changes the review hash and invalidates calculation provenance', async () => {
  const reviews: Array<{ id: string; metadataVersion: number; canonicalHash: string; assignments: unknown }> = [];
  let loanVersion = 1;
  const transaction = {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: { findFirst: async () => ({ id: '00000000-0000-4000-8000-000000000200', version: loanVersion }), updateMany: async () => { loanVersion += 1; return { count: 1 }; } },
    incomeExtraction: { findFirst: async () => ({
      id: '00000000-0000-4000-8000-000000000300', status: 'ACTIVE', normalizedInput: { w2Records: [{ entityId: 'w2-1' }] }, canonicalHash: 'a'.repeat(64),
      sourceDocumentId: '00000000-0000-4000-8000-000000000301', sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64),
      sourceDocument: { version: 1, sourceContentHash: 'a'.repeat(64) },
      metadataReviews: reviews.length ? [{ metadataVersion: reviews[0].metadataVersion, assignments: reviews[0].assignments }] : [],
    }) },
    incomeExtractionMetadataReview: { create: async ({ data }: { data: { metadataVersion: number; canonicalHash: string; assignments: unknown } }) => { const id = `review-${reviews.length + 1}`; reviews.unshift({ id, ...data }); return { id }; } },
    loanBorrower: { findMany: async () => [{ borrowerKey: 'borrower-1' }, { borrowerKey: 'borrower-2' }] },
    auditEvent: { findFirst: async () => null, create: async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? 'audit-1' }) },
  };
  const first = await reviewExtractionMetadata(transaction as never, reviewContext(), { ...reviewInput('borrower-1'), expectedLoanVersion: 1, expectedMetadataVersion: 0, idempotencyKey: 'reassign-key-00000001' });
  const second = await reviewExtractionMetadata(transaction as never, reviewContext(), { ...reviewInput('borrower-2'), expectedLoanVersion: 2, expectedMetadataVersion: 1, idempotencyKey: 'reassign-key-00000002' });
  assert.notEqual(first.canonicalHash, second.canonicalHash);
  assert.equal(hasCurrentCalculationExtractions([{
    extractionId: '00000000-0000-4000-8000-000000000300', extractionHash: 'a'.repeat(64), sourceDocumentId: '00000000-0000-4000-8000-000000000301',
    sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64), metadataReviewId: first.reviewId, metadataReviewVersion: 1, metadataReviewHash: first.canonicalHash,
    extraction: { status: 'ACTIVE', canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'a'.repeat(64) }, metadataReviews: [{ id: second.reviewId, metadataVersion: 2, canonicalHash: second.canonicalHash }] },
  }]), false);
});

test('AC-15 borrower lines sum to the combined total', () => {
  const borrowerIncome = [
    { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' as const, qualifyingMonthlyIncome: '8000.00', name: 'Must Not Persist' },
    { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' as const, qualifyingMonthlyIncome: '11000.00' },
  ];
  const sanitized = readBorrowerIncome(borrowerIncome);
  assert.equal(sanitized.reduce((total, item) => total + Number(item.qualifyingMonthlyIncome), 0).toFixed(2), '19000.00');
  assert.equal(JSON.stringify(sanitized).includes('Must Not Persist'), false);
  assert.deepEqual(Object.keys(sanitized[0]).sort(), ['borrowerKey', 'ordinal', 'qualifyingMonthlyIncome', 'role']);
});

test('AC-16 approved host fields are written once and omit borrower names', () => {
  const borrowerIncome = [
    { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' as const, qualifyingMonthlyIncome: '8000.00', name: 'Must Not Persist' },
    { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' as const, qualifyingMonthlyIncome: '11000.00' },
  ];
  const fields = approvedHostFields({
    loanId: '00000000-0000-4000-8000-000000000200', approvalId: 'approval-1', qualifyingMonthlyIncome: 19000,
    trendingAnalysis: 'SINGLE_YEAR', yearsAnalyzed: [2025], borrowerIncome, auditUrl: 'https://console.example/audit/approval-1',
  });
  assert.equal(fields['CX.FREEFLOW.BORROWER.1.INCOME'], '8000.00');
  assert.equal(fields['CX.FREEFLOW.BORROWER.2.INCOME'], '11000.00');
  assert.equal(fields['CX.FREEFLOW.INCOME'], '19000.00');
  assert.equal(fields['CX.FREEFLOW.APPROVAL.ID'], 'approval-1');
  assert.equal(fields['CX.FREEFLOW.SYNCED.AT'], undefined);
  assert.equal(Object.keys(fields).filter((key) => key === 'CX.FREEFLOW.BORROWER.1.INCOME').length, 1);
  assert.equal(JSON.stringify(fields).includes('Must Not Persist'), false);
});

test('AC-14 a roster change after calculation blocks approval', async () => {
  await assert.rejects(approveIncomeCalculation(approvalTransaction([{ borrowerKey: 'borrower-9' }, { borrowerKey: 'borrower-2' }]) as never, reviewContext(), {
    loanId: '00000000-0000-4000-8000-000000000200', calculationId: '00000000-0000-4000-8000-000000000501', expectedLoanVersion: 1,
    action: 'INCOME_APPROVED', reasonCode: 'UNDERWRITER_CONFIRMED', reasonNarrative: null, overrideQualifyingMonthlyIncome: null, idempotencyKey: 'approve-key-00000001',
  }), (error: unknown) => error instanceof ApiError && error.code === 'STALE_BORROWER_ROSTER');
});

function reviewedPaystub(extractionId: string): RecordInput {
  return {
    extractionId,
    normalizedInput: { formRecords: [form('paystub-1', 'Paystub', [
      { sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' },
      { sourceFieldId: 'ps-base-ytd', numericValue: 30000 },
      { sourceFieldId: 'ps-ot-ytd', numericValue: 7500 },
      { sourceFieldId: 'ps-bonus-ytd', numericValue: 1500 },
      { sourceFieldId: 'ps-commission-ytd', numericValue: 750 },
      { sourceFieldId: 'ps-tips-ytd', numericValue: 300 },
      { sourceFieldId: 'ps-rsu-ytd', numericValue: 1500 },
      { sourceFieldId: 'ps-other-ytd', numericValue: 450 },
    ])] },
    metadataAssignments: [{ entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, borrowerKey: 'borrower-1', elapsedMonths: 7.5, baseIncomeMethod: 'ytd' }],
  };
}

function business(
  extractionId: string,
  formName: string,
  entityId: string,
  fields: ReadonlyArray<{ sourceFieldId: string; value?: string; numericValue?: number }>,
  assignment: ExtractionMetadataAssignment,
): RecordInput {
  return { extractionId, normalizedInput: { formRecords: [form(entityId, formName, fields)] }, metadataAssignments: [assignment] };
}

function reviewContext(): RequestContext {
  return { requestId: 'request-1', subject: 'subject', tenantId: '00000000-0000-4000-8000-000000000100', membershipId: '00000000-0000-4000-8000-000000000101', permissions: ['income:metadata:review'], authTime: new Date() };
}

function reviewInput(borrowerKey: string) {
  return {
    loanId: '00000000-0000-4000-8000-000000000200', extractionId: '00000000-0000-4000-8000-000000000300', expectedLoanVersion: 1, expectedMetadataVersion: 0,
    source: 'DOCUMENT_VISUAL_REVIEW' as const, reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: [{ entityId: 'w2-1', employmentRole: 'CURRENT' as const, borrowerKey }], idempotencyKey: 'review-key-00000001',
  };
}

function reviewTransaction(load: () => unknown[], capture?: (where: { tenantId: string; loanId: string }) => void) {
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: { findFirst: async () => ({ id: '00000000-0000-4000-8000-000000000200', version: 1 }), updateMany: async () => ({ count: 1 }) },
    incomeExtraction: { findFirst: async () => ({
      id: '00000000-0000-4000-8000-000000000300', status: 'ACTIVE', normalizedInput: { w2Records: [{ entityId: 'w2-1' }] }, canonicalHash: 'a'.repeat(64),
      sourceDocumentId: '00000000-0000-4000-8000-000000000301', sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64),
      sourceDocument: { version: 1, sourceContentHash: 'a'.repeat(64) }, metadataReviews: [],
    }) },
    loanBorrower: { findMany: async ({ where }: { where: { tenantId: string; loanId: string } }) => { capture?.(where); return load(); } },
    incomeExtractionMetadataReview: { create: async () => ({ id: 'review-1' }) },
    auditEvent: { findFirst: async () => null, create: async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? 'audit-1' }) },
  };
}

function approvalTransaction(roster: ReadonlyArray<{ borrowerKey: string }>) {
  const hash = 'b'.repeat(64);
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: '00000000-0000-4000-8000-000000000200', tenantId: reviewContext().tenantId, version: 1, status: 'DOCS_UPLOADED' }) },
    form1084Audit: { findFirst: async () => ({
      id: '00000000-0000-4000-8000-000000000501', qualifyingMonthlyIncome: { toString: () => '19000.00' }, totalAnnualCashFlow: { toString: () => '228000.00' },
      yearsAnalyzed: [2025], calculationSchemaVersion: 'authoritative-extractions-v1', calculationSource: 'persisted-parser-extractions', calculatedLoanVersion: 1,
      canonicalInputHash: hash, sourceDocumentHashes: [hash], mortgageRuleVersion: 'form-1084-v9', trendingResult: 'SINGLE_YEAR', borrowerIncome: [
        { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '8000.00' },
        { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER', qualifyingMonthlyIncome: '11000.00' },
      ], extractionBindings: [{
        extractionId: '00000000-0000-4000-8000-000000000300', extractionHash: hash, sourceDocumentId: '00000000-0000-4000-8000-000000000301',
        sourceDocumentVersion: 1, sourceContentHash: hash,
        extraction: { status: 'ACTIVE', canonicalHash: hash, sourceDocumentVersion: 1, sourceContentHash: hash, sourceDocument: { version: 1, sourceContentHash: hash } },
      }],
    }) },
    loanBorrower: { findMany: async () => roster },
  };
}
