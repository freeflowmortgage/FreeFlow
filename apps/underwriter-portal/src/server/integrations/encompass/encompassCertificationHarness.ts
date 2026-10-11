import { createHash } from 'node:crypto';
import certificationFixture from './fixtures/encompass-certification-v1.json';
import {
  mergeAuthoritativeExtractionInputs,
  namespacedBorrowerKeys,
  reconcileDuplicateWages,
  type ExtractionMetadataAssignment,
} from '../../income/authoritativeExtractionInput';
import { calculateProtectedBorrowerIncome } from '../../income/borrowerIncomeCalculation';
import type { PersistedBorrower } from '../../income/loanBorrowerRoster';
import { approvedHostFields } from './hostWrite';

export const CERTIFICATION_BOUNDARY = 'POST_PARSE_SIMULATOR' as const;
export const CERTIFICATION_RESULT_SCHEMA_VERSION = 'freeflow-certification-result-v1' as const;
export const NORMALIZED_CALCULATION_SCHEMA_VERSION = 'authoritative-extractions-v1' as const;

export type CertificationWorkflow = 'INTEGRATED_POST_PARSE_PROJECTION' | 'STANDALONE_POST_PARSE_PROJECTION';

type CertificationRecord = Readonly<{
  extractionId: string;
  normalizedInput: unknown;
  metadataAssignments: readonly ExtractionMetadataAssignment[];
}>;

type MapperMonthly = Readonly<{
  w2Base: number;
  w2Variable: number;
  scheduleC: number;
  form1065: number;
  rental: number;
  asset: number;
}>;

export type CertificationRun = Readonly<{
  boundary: typeof CERTIFICATION_BOUNDARY;
  workflow: CertificationWorkflow;
  fixtureVersion: string;
  normalizedLoan: Readonly<Record<string, unknown>>;
  financialResult: Readonly<{
    qualifyingMonthlyIncome: number;
    borrowerIncome: Readonly<Record<string, string>>;
    trendingResult: string;
    yearsAnalyzed: readonly number[];
    mapperMonthly: MapperMonthly;
    reconciliationGaps: readonly string[];
  }>;
  jsonExport: string;
  summary: string;
  encompassFields: Readonly<Record<string, string>>;
  beforeAfter: Readonly<{
    boundary: typeof CERTIFICATION_BOUNDARY;
    mode: 'IN_MEMORY_FIELD_PROJECTION';
    before: Readonly<Record<string, string>>;
    intended: Readonly<Record<string, string>>;
    after: Readonly<Record<string, string>>;
    changedFields: readonly string[];
    projectionMatched: boolean;
  }>;
}>;

/**
 * Test-only, simulator-labelled certification seam. It starts after the external
 * connector/upload bytes have been parsed and deliberately calls the same
 * extraction projection, shared calculator, and approved Encompass mapper used
 * by the protected application. It is not evidence of a live ICE connection.
 */
export function runEncompassCertification(workflow: CertificationWorkflow): CertificationRun {
  const records = recordsFor(workflow);
  const roster = certificationFixture.loan.borrowers.map(({ borrowerKey, ordinal, role }) => ({
    borrowerKey,
    ordinal,
    role,
  })) as readonly PersistedBorrower[];
  const borrowerKeys = roster.map((borrower) => borrower.borrowerKey);
  const merged = mergeAuthoritativeExtractionInputs(records, { borrowerRoster: borrowerKeys });
  const reconciliation = reconcileDuplicateWages(records);
  const calculationInput = {
    ...merged,
    ...(merged.w2Employers
      ? { w2Employers: merged.w2Employers.filter((row) => !reconciliation.dropEntityIds.has(row.entityId)) }
      : {}),
  };
  const calculated = calculateProtectedBorrowerIncome(
    certificationFixture.loan.loanProgram as 'CONVENTIONAL' | 'FHA' | 'VA',
    roster,
    calculationInput,
    namespacedBorrowerKeys(records),
  );
  const mapperMonthly = mapperMonthlyFrom(calculated.slices);
  const borrowerIncome = Object.fromEntries(
    calculated.borrowerIncome.map((line) => [line.borrowerKey, line.qualifyingMonthlyIncome]),
  );
  const financialResult = {
    qualifyingMonthlyIncome: calculated.qualifyingMonthlyIncome,
    borrowerIncome,
    trendingResult: calculated.trendingResult,
    yearsAnalyzed: [...calculated.yearsAnalyzed],
    mapperMonthly,
    reconciliationGaps: [...reconciliation.gaps],
  };
  const encompassFields = approvedHostFields({
    loanId: certificationFixture.loan.loanId,
    approvalId: certificationFixture.expected.approvalId,
    qualifyingMonthlyIncome: financialResult.qualifyingMonthlyIncome,
    trendingAnalysis: financialResult.trendingResult,
    yearsAnalyzed: [...financialResult.yearsAnalyzed],
    scheduleCMonthlyTotal: mapperMonthly.scheduleC,
    form1065MonthlyTotal: mapperMonthly.form1065,
    w2BaseMonthly: mapperMonthly.w2Base,
    rentalMonthly: mapperMonthly.rental,
    borrowerIncome: calculated.borrowerIncome,
    auditUrl: `https://certification.invalid/audit/${certificationFixture.expected.approvalId}`,
  });
  const before = {
    'CX.FREEFLOW.INCOME': '1.00',
    'CX.FREEFLOW.APPROVAL.ID': 'prior-simulator-approval',
    'CX.CUSTOMER.UNRELATED': 'preserved',
  };
  const after = { ...before, ...encompassFields };
  const changedFields = Object.keys(encompassFields)
    .filter((fieldName) => before[fieldName as keyof typeof before] !== encompassFields[fieldName])
    .sort();
  const projectionMatched = Object.entries(encompassFields).every(([fieldName, value]) => after[fieldName] === value);
  const normalizedLoan = {
    certificationBoundary: CERTIFICATION_BOUNDARY,
    schemaVersion: NORMALIZED_CALCULATION_SCHEMA_VERSION,
    fixtureVersion: certificationFixture.fixtureVersion,
    sourceWorkflow: workflow,
    loanId: certificationFixture.loan.loanId,
    loanProgram: certificationFixture.loan.loanProgram,
    borrowerRoster: roster,
    documents: certificationFixture.documents.map((document, index) => ({
      fixtureKey: document.fixtureKey,
      sourceDocumentId: records[index].extractionId,
      sourceReference: workflow === 'INTEGRATED_POST_PARSE_PROJECTION'
        ? document.integratedSourceReference
        : document.standaloneSourceReference,
      sourceBoundary: certificationFixture.boundary,
      syntheticBoundaryHash: boundaryFixtureHash(document),
    })),
    calculationInput,
  };
  const exportPayload = {
    certificationBoundary: CERTIFICATION_BOUNDARY,
    schemaVersion: CERTIFICATION_RESULT_SCHEMA_VERSION,
    artifactClass: 'CERTIFICATION_HARNESS_ONLY',
    fixtureVersion: certificationFixture.fixtureVersion,
    loanId: certificationFixture.loan.loanId,
    loanProgram: certificationFixture.loan.loanProgram,
    borrowerRoster: roster,
    result: financialResult,
  };

  return {
    boundary: CERTIFICATION_BOUNDARY,
    workflow,
    fixtureVersion: certificationFixture.fixtureVersion,
    normalizedLoan,
    financialResult,
    jsonExport: `${JSON.stringify(exportPayload, null, 2)}\n`,
    summary: summaryFrom(financialResult),
    encompassFields,
    beforeAfter: {
      boundary: CERTIFICATION_BOUNDARY,
      mode: 'IN_MEMORY_FIELD_PROJECTION',
      before,
      intended: encompassFields,
      after,
      changedFields,
      projectionMatched,
    },
  };
}

export function certificationFixtureManifest() {
  return certificationFixture;
}

function boundaryFixtureHash(document: (typeof certificationFixture.documents)[number]): string {
  return createHash('sha256')
    .update(JSON.stringify({
      normalizedInput: document.normalizedInput,
      metadataAssignments: document.metadataAssignments,
    }), 'utf8')
    .digest('hex');
}

function recordsFor(workflow: CertificationWorkflow): readonly CertificationRecord[] {
  const extractionRange = workflow === 'INTEGRATED_POST_PARSE_PROJECTION' ? 700 : 800;
  return certificationFixture.documents.map((document, index) => ({
    extractionId: `00000000-0000-4000-8000-${String(extractionRange + index).padStart(12, '0')}`,
    normalizedInput: structuredClone(document.normalizedInput),
    metadataAssignments: structuredClone(document.metadataAssignments) as readonly ExtractionMetadataAssignment[],
  }));
}

function mapperMonthlyFrom(slices: readonly CertificationCalculationSlice[]): MapperMonthly {
  const latestYear = Math.max(...slices.flatMap((slice) => slice.summary.yearsAnalyzed));
  return {
    w2Base: annualRows(slices, 'w2EmployerBreakdown', latestYear, 'annualBaseIncome') / 12,
    w2Variable: annualRows(slices, 'w2EmployerBreakdown', latestYear, 'annualVariableIncome') / 12,
    scheduleC: annualRows(slices, 'scheduleCBreakdown', latestYear, 'totalAdjustedIncome') / 12,
    form1065: annualRows(slices, 'form1065Breakdown', latestYear, 'totalCombinedQualifying') / 12,
    rental: annualRows(slices, 'scheduleEPropertiesBreakdown', latestYear, 'totalCashFlow') / 12,
    asset: annualRows(slices, 'assetIncomeBreakdown', latestYear, 'qualifyingAssetIncome') / 12,
  };
}

type CertificationCalculationSlice = ReturnType<typeof calculateProtectedBorrowerIncome>['slices'][number];
type BreakdownKey = 'w2EmployerBreakdown' | 'scheduleCBreakdown' | 'form1065Breakdown'
  | 'scheduleEPropertiesBreakdown' | 'assetIncomeBreakdown';

function annualRows(
  slices: readonly CertificationCalculationSlice[],
  breakdown: BreakdownKey,
  year: number,
  amountField: string,
): number {
  return slices.flatMap((slice) => slice[breakdown] as ReadonlyArray<Record<string, unknown>>)
    .filter((row) => row.year === year)
    .reduce((total, row) => total + (typeof row[amountField] === 'number' ? row[amountField] as number : 0), 0);
}

function summaryFrom(result: CertificationRun['financialResult']): string {
  const borrowerLines = Object.entries(result.borrowerIncome)
    .map(([borrowerKey, amount]) => `${borrowerKey}: $${amount} monthly`)
    .join('\n');
  return [
    'FREEFLOW SYNTHETIC CERTIFICATION SUMMARY',
    `Boundary: ${CERTIFICATION_BOUNDARY}`,
    'Simulator evidence only; not a customer-facing approved export.',
    `Fixture: ${certificationFixture.fixtureVersion}`,
    `Program: ${certificationFixture.loan.loanProgram}`,
    `Qualifying monthly income: $${result.qualifyingMonthlyIncome.toFixed(2)}`,
    `Trend: ${result.trendingResult}`,
    `Years analyzed: ${result.yearsAnalyzed.join(', ')}`,
    borrowerLines,
    '',
  ].join('\n');
}
