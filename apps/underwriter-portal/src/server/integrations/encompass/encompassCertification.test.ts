import assert from 'node:assert/strict';
import test from 'node:test';
import { ExtractionMetadataRequiredError, mergeAuthoritativeExtractionInputs } from '../../income/authoritativeExtractionInput';
import {
  CERTIFICATION_BOUNDARY,
  CERTIFICATION_RESULT_SCHEMA_VERSION,
  certificationFixtureManifest,
  runEncompassCertification,
} from './encompassCertificationHarness';

test('equivalent post-parse records with integrated and standalone provenance produce identical financial and mapped outputs', () => {
  const fixture = certificationFixtureManifest();
  const integrated = runEncompassCertification('INTEGRATED_POST_PARSE_PROJECTION');
  const standalone = runEncompassCertification('STANDALONE_POST_PARSE_PROJECTION');

  assert.equal(integrated.boundary, CERTIFICATION_BOUNDARY);
  assert.equal(standalone.boundary, CERTIFICATION_BOUNDARY);
  assert.equal(fixture.classification, 'SYNTHETIC_POST_PARSE_SIMULATOR_ONLY');
  assert.equal(fixture.boundary, 'POST_PARSE_PERSISTED_EXTRACTION_SHAPE');
  assert.equal(fixture.documentBytesIncluded, false);
  assert.deepEqual(integrated.normalizedLoan.borrowerRoster, standalone.normalizedLoan.borrowerRoster);
  assert.deepEqual(
    withoutSourceEntityIds(integrated.normalizedLoan.calculationInput),
    withoutSourceEntityIds(standalone.normalizedLoan.calculationInput),
  );
  assert.deepEqual(
    documentHashes(integrated.normalizedLoan),
    documentHashes(standalone.normalizedLoan),
  );
  assert.notDeepEqual(integrated.normalizedLoan.documents, standalone.normalizedLoan.documents);
  assert.deepEqual(integrated.financialResult, standalone.financialResult);
  assert.equal(integrated.jsonExport, standalone.jsonExport);
  assert.equal(integrated.summary, standalone.summary);
  assert.deepEqual(integrated.encompassFields, standalone.encompassFields);

  // These figures are specified in the fixture from hand-worked annual / 12
  // arithmetic, independently of calculateProtectedBorrowerIncome.
  assert.equal(integrated.financialResult.qualifyingMonthlyIncome, fixture.expected.qualifyingMonthlyIncome);
  assert.deepEqual(integrated.financialResult.borrowerIncome, fixture.expected.borrowerIncome);
  assert.equal(integrated.financialResult.trendingResult, fixture.expected.trendingResult);
  assert.deepEqual(integrated.financialResult.yearsAnalyzed, fixture.expected.yearsAnalyzed);
  assert.deepEqual(integrated.financialResult.mapperMonthly, fixture.expected.mapperMonthly);
  assert.deepEqual(integrated.financialResult.reconciliationGaps, ['PAYSTUB_W2_RECONCILED']);
});

function documentHashes(normalizedLoan: Readonly<Record<string, unknown>>): readonly unknown[] {
  return (normalizedLoan.documents as ReadonlyArray<Record<string, unknown>>)
    .map((document) => document.syntheticBoundaryHash);
}

function withoutSourceEntityIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSourceEntityIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'entityId')
        .map(([key, item]) => [key, withoutSourceEntityIds(item)]),
    );
  }
  return value;
}

test('certification JSON is source-neutral, versioned, deterministic, and explicitly non-production evidence', () => {
  const first = runEncompassCertification('STANDALONE_POST_PARSE_PROJECTION');
  const second = runEncompassCertification('STANDALONE_POST_PARSE_PROJECTION');
  assert.deepEqual(first, second);

  const exported = JSON.parse(first.jsonExport) as Record<string, unknown>;
  assert.equal(exported.certificationBoundary, CERTIFICATION_BOUNDARY);
  assert.equal(exported.schemaVersion, CERTIFICATION_RESULT_SCHEMA_VERSION);
  assert.equal(exported.artifactClass, 'CERTIFICATION_HARNESS_ONLY');
  assert.equal(Object.hasOwn(exported, 'workflow'), false);
  assert.match(first.summary, /Simulator evidence only; not a customer-facing approved export/);
  assert.equal(first.normalizedLoan.certificationBoundary, CERTIFICATION_BOUNDARY);
  assert.equal(first.normalizedLoan.schemaVersion, 'authoritative-extractions-v1');
  assert.equal(first.normalizedLoan.sourceWorkflow, 'STANDALONE_POST_PARSE_PROJECTION');

  const serialized = JSON.stringify(first);
  for (const forbidden of ['clientSecret', 'access_token', 'socialSecurityNumber', 'ssnLast4', '%PDF-']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('the actual approved field mapper yields the exact current in-memory projection', () => {
  const run = runEncompassCertification('INTEGRATED_POST_PARSE_PROJECTION');
  assert.deepEqual(run.encompassFields, {
    'CX.FREEFLOW.INCOME': '21600.00',
    'CX.FREEFLOW.TRENDING': 'SINGLE_YEAR',
    'CX.FREEFLOW.AUDIT.URL': 'https://certification.invalid/audit/00000000-0000-4000-8000-000000000901',
    'CX.FREEFLOW.YEARS': '2025',
    'CX.FREEFLOW.SCH.C': '8000.00',
    'CX.FREEFLOW.FORM.1065': '5000.00',
    'CX.FREEFLOW.W2.BASE': '4000.00',
    'CX.FREEFLOW.W2.VARIABLE': '1600.00',
    'CX.FREEFLOW.ASSET.INCOME': '1000.00',
    'CX.FREEFLOW.RENTAL': '2000.00',
    'CX.FREEFLOW.BORROWER.1.INCOME': '5600.00',
    'CX.FREEFLOW.BORROWER.2.INCOME': '16000.00',
    'CX.FREEFLOW.APPROVAL.ID': '00000000-0000-4000-8000-000000000901',
  });
  assert.equal(run.beforeAfter.mode, 'IN_MEMORY_FIELD_PROJECTION');
  assert.equal(run.beforeAfter.projectionMatched, true);
  assert.equal(run.beforeAfter.after['CX.CUSTOMER.UNRELATED'], 'preserved');
  assert.equal(run.beforeAfter.after['CX.FREEFLOW.APPROVAL.ID'], '00000000-0000-4000-8000-000000000901');
  assert.equal(new Set(run.beforeAfter.changedFields).size, Object.keys(run.encompassFields).length);
});

test('approved mapper includes every calculated certification income category', () => {
  const run = runEncompassCertification('INTEGRATED_POST_PARSE_PROJECTION');
  assert.equal(run.financialResult.mapperMonthly.w2Variable, 1600);
  assert.equal(run.financialResult.mapperMonthly.asset, 1000);
  assert.equal(run.encompassFields['CX.FREEFLOW.W2.VARIABLE'], '1600.00');
  assert.equal(run.encompassFields['CX.FREEFLOW.ASSET.INCOME'], '1000.00');
});

test('borrower assignment remains fail-closed before either workflow can calculate', () => {
  const fixture = certificationFixtureManifest();
  const records = fixture.documents.map((document, index) => ({
    extractionId: `00000000-0000-4000-8000-${String(900 + index).padStart(12, '0')}`,
    normalizedInput: document.normalizedInput,
  }));
  assert.throws(
    () => mergeAuthoritativeExtractionInputs(records, {
      borrowerRoster: fixture.loan.borrowers.map((borrower) => borrower.borrowerKey),
    }),
    (error: unknown) => error instanceof ExtractionMetadataRequiredError
      && error.requirements.some((requirement) => requirement.field === 'borrowerAssignment'),
  );
});
