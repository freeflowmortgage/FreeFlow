import assert from 'node:assert/strict';
import test from 'node:test';
import { annualizePaystub } from '@mortgage-pos/mortgage-engine';
import type { RequestContext } from '../auth/requestContext';
import { ApiError } from '../http/apiError';
import { approveIncomeCalculation, parseIncomeApprovalBody } from '../audit/approveIncome';
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
import { parseMetadataReviewBody, reviewExtractionMetadata } from './reviewExtractionMetadata';

const ROSTER = [
  { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' as const },
  { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' as const },
];
const KEYS = ROSTER.map((borrower) => borrower.borrowerKey);
const EXTRACTION = '00000000-0000-4000-8000-000000000701';

type RecordInput = Readonly<{
  extractionId: string;
  normalizedInput: unknown;
  metadataAssignments?: readonly ExtractionMetadataAssignment[];
}>;

function paystub(options: {
  extractionId?: string;
  entityId?: string;
  employer?: string;
  fields?: ReadonlyArray<{ sourceFieldId: string; value?: string; numericValue?: number }>;
  assignment?: ExtractionMetadataAssignment | null;
}): RecordInput {
  const entityId = options.entityId ?? 'paystub-1';
  const fields = options.fields ?? [
    { sourceFieldId: 'ps-employer-name', value: options.employer ?? 'Northwind Labs' },
    { sourceFieldId: 'ps-base-ytd', numericValue: 30000 },
    { sourceFieldId: 'ps-ot-ytd', numericValue: 7500 },
    { sourceFieldId: 'ps-bonus-ytd', numericValue: 1500 },
    { sourceFieldId: 'ps-commission-ytd', numericValue: 750 },
    { sourceFieldId: 'ps-tips-ytd', numericValue: 300 },
    { sourceFieldId: 'ps-rsu-ytd', numericValue: 1500 },
    { sourceFieldId: 'ps-other-ytd', numericValue: 450 },
  ];
  const assignment = options.assignment === null ? undefined : (options.assignment ?? {
    entityId, employmentRole: 'CURRENT' as const, taxYear: 2025, borrowerKey: 'borrower-1', elapsedMonths: 7.5, baseIncomeMethod: 'ytd' as const,
  });
  return {
    extractionId: options.extractionId ?? EXTRACTION,
    normalizedInput: { formRecords: [{ entityId, form: 'Paystub', pageIndex: 0, fields }] },
    ...(assignment ? { metadataAssignments: [assignment] } : {}),
  };
}

function w2(extractionId: string, entityId: string, employerName: string, annualWages: number, borrowerKey?: string): RecordInput {
  return {
    extractionId,
    normalizedInput: { w2Records: [{ entityId, employerName, year: 2025, annualWages }] },
    ...(borrowerKey ? { metadataAssignments: [{ entityId, employmentRole: 'CURRENT' as const, borrowerKey }] } : {}),
  };
}

function requirementsFor(records: readonly RecordInput[]): ExtractionMetadataRequiredError['requirements'] {
  try {
    mergeAuthoritativeExtractionInputs(records, { borrowerRoster: KEYS });
  } catch (error) {
    if (error instanceof ExtractionMetadataRequiredError) return error.requirements;
    throw error;
  }
  return [];
}

function citedReady() {
  return annualizePaystub({
    baseYtd: 30000, overtimeYtd: 7500, bonusYtd: 1500, commissionYtd: 750, tipsYtd: 300, rsuYtd: 1500, otherYtd: 450,
    elapsedMonths: 7.5, baseMethod: 'ytd',
  });
}

test('rule 1 reuses annualizePaystub for the protected projection', () => {
  const cited = citedReady();
  assert.equal(cited.status, 'READY');
  const projected = mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS });
  const row = projected.w2Employers?.[0];
  assert.equal(row?.annualBaseIncome, cited.annualBase);
  assert.equal(row?.annualVariableIncome, cited.annualVariable);
  assert.equal(row?.annualOvertimeIncome, cited.annualComponents.overtime);
  assert.equal(row?.annualBonusIncome, cited.annualComponents.bonus);
  assert.equal(row?.annualCommissionIncome, cited.annualComponents.commission);
  assert.equal(row?.annualTipsIncome, cited.annualComponents.tips);
  assert.equal(row?.annualRsuIncome, cited.annualComponents.rsu);
  assert.equal(row?.annualOtherIncome, cited.annualComponents.other);
  assert.equal(row?.annualBaseIncome, cited.annualComponents.base);
});

test('rule 2 never treats raw YTD as the annual wage', () => {
  const projected = mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS });
  const row = projected.w2Employers?.[0];
  assert.equal(row?.annualWages, undefined);
  assert.equal(row?.annualIncome, undefined);
  assert.equal(row?.annualBaseIncome, 48000);
  assert.notEqual(row?.annualBaseIncome, 30000);
  assert.notEqual(row?.annualVariableIncome, 7500);
  assert.equal(row?.annualVariableIncome, 19200);
  const result = calculateProtectedBorrowerIncome('CONVENTIONAL', ROSTER, projected, namespacedBorrowerKeys([paystub({})]));
  assert.equal(result.borrowerIncome[0].qualifyingMonthlyIncome, '5600.00');
  assert.notEqual(result.qualifyingMonthlyIncome, 30000);
});

test('rule 3 borrower assignment is required on a multi-borrower loan', () => {
  const blocked = paystub({
    assignment: { entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, elapsedMonths: 7.5, baseIncomeMethod: 'ytd' },
  });
  assert.deepEqual(requirementsFor([blocked]).map((item) => item.field), ['borrowerAssignment']);
  const unknown = paystub({
    assignment: { entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, borrowerKey: 'borrower-9', elapsedMonths: 7.5, baseIncomeMethod: 'ytd' },
  });
  assert.deepEqual(requirementsFor([unknown]).map((item) => item.field), ['borrowerAssignment']);
  const authorized = mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS });
  assert.equal(namespacedBorrowerKeys([paystub({})]).get(`${EXTRACTION}:paystub-1`), 'borrower-1');
  assert.equal(authorized.w2Employers?.[0].entityId, `${EXTRACTION}:paystub-1`);
});

test('rule 4 employer identity is required and an unmatched employer is an explicit gap', () => {
  const missing = paystub({
    fields: [{ sourceFieldId: 'ps-base-ytd', numericValue: 30000 }],
  });
  assert.equal(requirementsFor([missing]).some((item) => item.field === 'requiredParserField'), true);
  assert.equal(requirementsFor([missing]).some((item) => item.form === 'Paystub' && item.field === 'borrowerAssignment'), false);
  const unmatched = reconcileDuplicateWages([
    paystub({}),
    w2('00000000-0000-4000-8000-000000000702', 'w2-other', 'Other Co', 12000, 'borrower-1'),
  ]);
  assert.deepEqual(unmatched.gaps, ['PAYSTUB_EMPLOYER_UNMATCHED']);
  assert.equal(unmatched.dropEntityIds.size, 0);
});

test('rule 5 matching paystub and W-2 reconcile once and 1003 wages are not invented', () => {
  const matchedW2 = w2('00000000-0000-4000-8000-000000000703', 'w2-match', 'Northwind Labs', 96000, 'borrower-1');
  const otherBorrower = w2('00000000-0000-4000-8000-000000000704', 'w2-b2', 'Northwind Labs', 72000, 'borrower-2');
  const records = [paystub({}), matchedW2, otherBorrower];
  const reconciliation = reconcileDuplicateWages(records);
  assert.equal(reconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000703:w2-match'), true);
  assert.equal(reconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000704:w2-b2'), false);
  assert.equal(reconciliation.gaps.includes('PAYSTUB_W2_RECONCILED'), true);
  const merged = mergeAuthoritativeExtractionInputs(records, { borrowerRoster: KEYS });
  const wages = (merged.w2Employers ?? []).filter((row) => !reconciliation.dropEntityIds.has(row.entityId));
  assert.equal(wages.some((row) => row.annualWages === 96000), false);
  assert.equal(wages.some((row) => row.annualWages === 72000), true);
  assert.equal(JSON.stringify(merged).includes('urla'), false);
  assert.equal(JSON.stringify(merged).includes('statedWage'), false);
  const prior = paystub({
    fields: [{ sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' }],
    assignment: { entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, borrowerKey: 'borrower-1', baseIncomeMethod: 'prior' },
  });
  assert.deepEqual(requirementsFor([prior]).map((item) => item.field), ['unsupportedCalculation']);
  const priorRecords = [prior, matchedW2, otherBorrower];
  const withPriorW2 = mergeAuthoritativeExtractionInputs(priorRecords, { borrowerRoster: KEYS });
  const priorRow = withPriorW2.w2Employers?.find((row) => row.entityId.endsWith('paystub-1'));
  const cited = annualizePaystub({ priorYearW2Wages: 96000, baseMethod: 'prior' });
  assert.equal(priorRow?.annualBaseIncome, cited.annualBase);
  assert.equal(priorRow?.annualBaseIncome, 96000);
  assert.equal(priorRow?.annualWages, undefined);
  const priorReconciliation = reconcileDuplicateWages(priorRecords);
  assert.equal(priorReconciliation.dropEntityIds.has('00000000-0000-4000-8000-000000000703:w2-match'), true);
  const priorResult = calculateProtectedBorrowerIncome('CONVENTIONAL', ROSTER, {
    ...withPriorW2,
    w2Employers: (withPriorW2.w2Employers ?? []).filter((row) => !priorReconciliation.dropEntityIds.has(row.entityId)),
  }, namespacedBorrowerKeys(priorRecords));
  assert.equal(priorResult.borrowerIncome[0].qualifyingMonthlyIncome, '8000.00');
  assert.equal(priorResult.borrowerIncome[1].qualifyingMonthlyIncome, '6000.00');
  assert.equal(priorResult.qualifyingMonthlyIncome, 14000);
});

test('rule 6 component annuals stay separated through projection', () => {
  const row = mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS }).w2Employers?.[0];
  assert.deepEqual([
    row?.annualBaseIncome, row?.annualOvertimeIncome, row?.annualBonusIncome, row?.annualCommissionIncome,
    row?.annualTipsIncome, row?.annualRsuIncome, row?.annualOtherIncome,
  ], [48000, 12000, 2400, 1200, 480, 2400, 720]);
  assert.notEqual(row?.annualBaseIncome, row?.annualOvertimeIncome);
  assert.notEqual(row?.annualBonusIncome, row?.annualCommissionIncome);
  assert.equal(row?.annualBonusIncome, 2400);
  assert.equal(row?.annualRsuIncome, 2400);
  const result = calculateProtectedBorrowerIncome('CONVENTIONAL', ROSTER, mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS }), namespacedBorrowerKeys([paystub({})]));
  assert.equal(result.slices[0].w2EmployerBreakdown[0].annualBaseIncome, 48000);
  assert.equal(result.slices[0].w2EmployerBreakdown[0].annualVariableIncome, 19200);
  assert.notEqual(result.slices[0].w2EmployerBreakdown[0].annualBaseIncome, result.slices[0].w2EmployerBreakdown[0].annualVariableIncome);
});

test('rule 7 variable continuity is YTD divided by elapsed months', () => {
  const record = paystub({
    fields: [
      { sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' },
      { sourceFieldId: 'ps-current-base', numericValue: 1000 },
      { sourceFieldId: 'ps-pay-frequency', value: 'Weekly' },
      { sourceFieldId: 'ps-ot-ytd', numericValue: 2600 },
      { sourceFieldId: 'ps-bonus-ytd', numericValue: 500 },
    ],
    assignment: { entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, borrowerKey: 'borrower-1', elapsedMonths: 2, baseIncomeMethod: 'period' },
  });
  const cited = annualizePaystub({
    currentPeriodBasePay: 1000, payFrequency: 'WEEKLY', baseMethod: 'period', overtimeYtd: 2600, bonusYtd: 500, elapsedMonths: 2,
  });
  const row = mergeAuthoritativeExtractionInputs([record], { borrowerRoster: KEYS }).w2Employers?.[0];
  assert.equal(cited.components.overtime, 1300);
  assert.equal(row?.annualOvertimeIncome, cited.annualComponents.overtime);
  assert.equal(row?.annualBonusIncome, cited.annualComponents.bonus);
  assert.notEqual(row?.annualOvertimeIncome, 2600 * 52);
  assert.notEqual(row?.annualOvertimeIncome, 2600);
});

test('rule 8 fail closed until annualizePaystub is READY', () => {
  const incomplete = paystub({
    fields: [
      { sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' },
      { sourceFieldId: 'ps-base-ytd', numericValue: 54000 },
    ],
    assignment: null,
  });
  assert.equal(annualizePaystub({ baseYtd: 54000 }).status, 'GAPS');
  assert.deepEqual(requirementsFor([incomplete]).map((item) => item.field), ['borrowerAssignment', 'elapsedMonths', 'employmentRole', 'taxYear']);
  const noBase = paystub({
    fields: [{ sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' }],
    assignment: { entityId: 'paystub-1', employmentRole: 'CURRENT', taxYear: 2025, borrowerKey: 'borrower-1' },
  });
  assert.equal(annualizePaystub({}).status, 'GAPS');
  assert.deepEqual(requirementsFor([noBase]).map((item) => item.field), ['unsupportedCalculation']);
  const ready = mergeAuthoritativeExtractionInputs([paystub({})], { borrowerRoster: KEYS });
  assert.equal(ready.w2Employers?.[0].annualBaseIncome, citedReady().annualBase);
});

test('rule 9 a paystub metadata change stales approval until recalculation or override', async () => {
  const reviews: Array<{ id: string; metadataVersion: number; canonicalHash: string }> = [];
  let loanVersion = 1;
  const transaction = {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null, create: async () => ({}) },
    loanApplication: { findFirst: async () => ({ id: '00000000-0000-4000-8000-000000000200', version: loanVersion }), updateMany: async () => { loanVersion += 1; return { count: 1 }; } },
    incomeExtraction: { findFirst: async () => ({
      id: '00000000-0000-4000-8000-000000000300', status: 'ACTIVE', canonicalHash: 'a'.repeat(64),
      normalizedInput: { formRecords: [{ entityId: 'paystub-1', form: 'Paystub', pageIndex: 0, fields: [{ sourceFieldId: 'ps-employer-name', value: 'Northwind Labs' }] }] },
      sourceDocumentId: '00000000-0000-4000-8000-000000000301', sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64),
      sourceDocument: { version: 1, sourceContentHash: 'a'.repeat(64) },
      metadataReviews: reviews.length ? [{ metadataVersion: reviews[0].metadataVersion, assignments: [] }] : [],
    }) },
    incomeExtractionMetadataReview: { create: async ({ data }: { data: { metadataVersion: number; canonicalHash: string } }) => { const id = `review-${reviews.length + 1}`; reviews.unshift({ id, ...data }); return { id }; } },
    loanBorrower: { findMany: async () => [{ borrowerKey: 'borrower-1' }, { borrowerKey: 'borrower-2' }] },
    auditEvent: { findFirst: async () => null, create: async ({ data }: { data: { id?: string } }) => ({ id: data.id ?? 'audit-1' }) },
  };
  const context = reviewContext();
  const first = await reviewExtractionMetadata(transaction as never, context, {
    ...reviewBody(7.5), expectedLoanVersion: 1, expectedMetadataVersion: 0, idempotencyKey: 'paystub-stale-00000001',
  });
  const second = await reviewExtractionMetadata(transaction as never, context, {
    ...reviewBody(8), expectedLoanVersion: 2, expectedMetadataVersion: 1, idempotencyKey: 'paystub-stale-00000002',
  });
  assert.notEqual(first.canonicalHash, second.canonicalHash);
  assert.equal(hasCurrentCalculationExtractions([{
    extractionId: '00000000-0000-4000-8000-000000000300', extractionHash: 'a'.repeat(64), sourceDocumentId: '00000000-0000-4000-8000-000000000301',
    sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64), metadataReviewId: first.reviewId, metadataReviewVersion: 1, metadataReviewHash: first.canonicalHash,
    extraction: {
      status: 'ACTIVE', canonicalHash: 'a'.repeat(64), sourceDocumentVersion: 1, sourceContentHash: 'a'.repeat(64),
      sourceDocument: { version: 1, sourceContentHash: 'a'.repeat(64) },
      metadataReviews: [{ id: second.reviewId, metadataVersion: 2, canonicalHash: second.canonicalHash }],
    },
  }]), false);
  await assert.rejects(approveIncomeCalculation(approvalTransaction({ calculatedLoanVersion: 1, loanVersion: 2 }) as never, context, approvalInput(2, 'approve-key-00000001')), (error: unknown) => error instanceof ApiError && error.code === 'STALE_CALCULATION');
  await assert.rejects(approveIncomeCalculation(approvalTransaction({
    calculatedLoanVersion: 2, loanVersion: 2, metadataReviewId: first.reviewId, latestReviewId: second.reviewId, latestHash: second.canonicalHash,
  }) as never, context, approvalInput(2, 'approve-key-00000002')), (error: unknown) => error instanceof ApiError && error.code === 'STALE_CALCULATION_EXTRACTION');
  assert.throws(() => parseIncomeApprovalBody({
    calculationId: '00000000-0000-4000-8000-000000000501', expectedLoanVersion: 2, action: 'INCOME_OVERRIDE', reasonCode: 'MANUAL_RECALCULATION', overrideQualifyingMonthlyIncome: 5600,
  }), (error: unknown) => error instanceof ApiError && error.code === 'OVERRIDE_NARRATIVE_REQUIRED');
  const override = parseIncomeApprovalBody({
    calculationId: '00000000-0000-4000-8000-000000000501', expectedLoanVersion: 2, action: 'INCOME_OVERRIDE', reasonCode: 'MANUAL_RECALCULATION',
    reasonNarrative: 'Reviewed paystub elapsed months changed after calculation.', overrideQualifyingMonthlyIncome: 5600,
  });
  assert.equal(override.action, 'INCOME_OVERRIDE');
  assert.equal(override.overrideQualifyingMonthlyIncome, 5600);
});

test('rule 10 paystub approval keeps borrower provenance and omits employer and raw YTD from the host map', () => {
  const records = [paystub({})];
  const merged = mergeAuthoritativeExtractionInputs(records, { borrowerRoster: KEYS });
  const result = calculateProtectedBorrowerIncome('CONVENTIONAL', ROSTER, merged, namespacedBorrowerKeys(records));
  assert.equal(merged.w2Employers?.[0].entityId.startsWith(`${EXTRACTION}:`), true);
  assert.equal(result.borrowerIncome[0].borrowerKey, 'borrower-1');
  assert.equal(JSON.stringify(result.borrowerIncome).includes('Northwind'), false);
  const fields = approvedHostFields({
    loanId: '00000000-0000-4000-8000-000000000200', approvalId: 'approval-paystub', qualifyingMonthlyIncome: result.qualifyingMonthlyIncome,
    trendingAnalysis: result.trendingResult, yearsAnalyzed: [...result.yearsAnalyzed], borrowerIncome: result.borrowerIncome,
    auditUrl: 'https://console.example/audit/approval-paystub',
  });
  assert.equal(fields['CX.FREEFLOW.BORROWER.1.INCOME'], '5600.00');
  assert.equal(fields['CX.FREEFLOW.APPROVAL.ID'], 'approval-paystub');
  assert.equal(Object.keys(fields).filter((key) => key === 'CX.FREEFLOW.BORROWER.1.INCOME').length, 1);
  assert.equal(JSON.stringify(fields).includes('Northwind'), false);
  assert.equal(JSON.stringify(fields).includes('30000'), false);
  parseMetadataReviewBody({
    expectedLoanVersion: 1, expectedMetadataVersion: 0, source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: records[0].metadataAssignments ?? [],
  });
});

function reviewContext(): RequestContext {
  return { requestId: 'request-1', subject: 'subject', tenantId: '00000000-0000-4000-8000-000000000100', membershipId: '00000000-0000-4000-8000-000000000101', permissions: ['income:metadata:review', 'income:approve'], authTime: new Date() };
}

function reviewBody(elapsedMonths: number) {
  return {
    loanId: '00000000-0000-4000-8000-000000000200', extractionId: '00000000-0000-4000-8000-000000000300',
    source: 'DOCUMENT_VISUAL_REVIEW' as const, reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
    assignments: [{ entityId: 'paystub-1', employmentRole: 'CURRENT' as const, borrowerKey: 'borrower-1', taxYear: 2025, elapsedMonths, baseIncomeMethod: 'ytd' as const }],
  };
}

function approvalInput(expectedLoanVersion: number, idempotencyKey: string) {
  return {
    loanId: '00000000-0000-4000-8000-000000000200', calculationId: '00000000-0000-4000-8000-000000000501', expectedLoanVersion,
    action: 'INCOME_APPROVED' as const, reasonCode: 'UNDERWRITER_CONFIRMED', reasonNarrative: null, overrideQualifyingMonthlyIncome: null, idempotencyKey,
  };
}

function approvalTransaction(options: { calculatedLoanVersion: number; loanVersion: number; metadataReviewId?: string; latestReviewId?: string; latestHash?: string }) {
  const hash = 'b'.repeat(64);
  return {
    $executeRaw: async () => 0,
    apiIdempotencyKey: { findFirst: async () => null },
    loanApplication: { findFirst: async () => ({ id: '00000000-0000-4000-8000-000000000200', tenantId: reviewContext().tenantId, version: options.loanVersion, status: 'DOCS_UPLOADED' }) },
    form1084Audit: { findFirst: async () => ({
      id: '00000000-0000-4000-8000-000000000501', qualifyingMonthlyIncome: { toString: () => '5600.00' }, totalAnnualCashFlow: { toString: () => '67200.00' },
      yearsAnalyzed: [2025], calculationSchemaVersion: 'authoritative-extractions-v1', calculationSource: 'persisted-parser-extractions', calculatedLoanVersion: options.calculatedLoanVersion,
      canonicalInputHash: hash, sourceDocumentHashes: [hash], mortgageRuleVersion: 'form-1084-v9', trendingResult: 'SINGLE_YEAR', borrowerIncome: [
        { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '5600.00' },
      ], extractionBindings: [{
        extractionId: '00000000-0000-4000-8000-000000000300', extractionHash: hash, sourceDocumentId: '00000000-0000-4000-8000-000000000301',
        sourceDocumentVersion: 1, sourceContentHash: hash, metadataReviewId: options.metadataReviewId ?? null, metadataReviewVersion: options.metadataReviewId ? 1 : null, metadataReviewHash: options.metadataReviewId ? hash : null,
        extraction: {
          status: 'ACTIVE', canonicalHash: hash, sourceDocumentVersion: 1, sourceContentHash: hash,
          sourceDocument: { version: 1, sourceContentHash: hash },
          metadataReviews: options.latestReviewId ? [{ id: options.latestReviewId, metadataVersion: 2, canonicalHash: options.latestHash }] : [],
        },
      }],
    }) },
  };
}
