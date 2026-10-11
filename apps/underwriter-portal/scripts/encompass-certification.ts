import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CERTIFICATION_BOUNDARY,
  certificationFixtureManifest,
  runEncompassCertification,
} from '../src/server/integrations/encompass/encompassCertificationHarness';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const defaultOutput = path.join(
  repositoryRoot,
  'docs',
  'deployment-readiness',
  'evidence',
  'encompass-certification-2026-10-11',
);
const outputDirectory = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultOutput;

const integrated = runEncompassCertification('INTEGRATED_POST_PARSE_PROJECTION');
const standalone = runEncompassCertification('STANDALONE_POST_PARSE_PROJECTION');
const fixture = certificationFixtureManifest();
const executableValidation = validateExecutableClaims(integrated, standalone, fixture);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const sourceRevision = {
  baseCommit: commit,
  executionSource: 'CURRENT_WORKTREE',
  workingTreeInputs: [
    sourceFingerprint('apps/underwriter-portal/scripts/encompass-certification.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/encompassCertificationHarness.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/encompassCertification.test.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/fixtures/encompass-certification-v1.json'),
  ],
};
mkdirSync(outputDirectory, { recursive: true });

const artifacts = new Map<string, string>([
  ['synthetic-fixture-manifest.json', json(fixture)],
  ['integrated-post-parse-projection-normalized-loan.json', json(integrated.normalizedLoan)],
  ['standalone-post-parse-projection-normalized-loan.json', json(standalone.normalizedLoan)],
  ['normalized-income-result.json', integrated.jsonExport],
  ['underwriting-summary.txt', integrated.summary],
  ['encompass-intended-fields.json', json({
    boundary: CERTIFICATION_BOUNDARY,
    artifactClass: 'CURRENT_APPROVED_MAPPER_OUTPUT',
    fields: integrated.encompassFields,
  })],
  ['encompass-in-memory-field-projection.json', json(integrated.beforeAfter)],
  ['mismo-validation.json', json({
    boundary: CERTIFICATION_BOUNDARY,
    status: 'NOT_IMPLEMENTED',
    capability: 'Approved income-analysis MISMO export',
    officialSchemaValidation: 'BLOCKED',
    selectedSchema: null,
    selectedImplementationRequirements: null,
    explanation: 'Existing MISMO generators are disconnected from the protected approved-calculation workflow and use inconsistent 3.4 identifiers. No official XSD validation is wired into the repository.',
    xmlArtifactProduced: false,
  })],
  ['processing-validation-report.json', json({
    schemaVersion: 'freeflow-encompass-certification-report-v1',
    boundary: CERTIFICATION_BOUNDARY,
    fixtureVersion: integrated.fixtureVersion,
    sourceRevision,
    results: {
      ...executableValidation.results,
      realEncompassRetrieval: 'BLOCKED',
      realEncompassWriteReadBack: 'BLOCKED',
      approvedCalculationMismoExport: 'NOT_IMPLEMENTED',
      protectedApprovedSummaryExport: 'NOT_IMPLEMENTED',
      customerStandaloneLoanCreation: 'NOT_IMPLEMENTED',
      providerErrorLogRedaction: 'FAIL',
    },
    mappingGaps: executableValidation.mappingGaps,
    warnings: [
      'PASS results in this artifact are simulator or in-process component results only.',
      'The harness starts with deterministic post-parse, persisted-extraction-shaped data. It links no PDF bytes and does not execute pull, upload, parsing, persistence, or review boundaries.',
      'The in-memory field projection is not connector writeback, readback, or an Encompass installation.',
      'Executed worker tests showed that arbitrary provider error text can reach operational logs; log redaction is not certified.',
    ],
  })],
]);

assertEvidenceSanitized(artifacts);
const allowedOutputNames = new Set([...artifacts.keys(), 'artifact-manifest.json']);
assertNoUnexpectedOutputEntries(outputDirectory, allowedOutputNames);
for (const [name, contents] of artifacts) writeFileSync(path.join(outputDirectory, name), contents, 'utf8');

const manifest = {
  schemaVersion: 'freeflow-certification-artifact-manifest-v1',
  boundary: CERTIFICATION_BOUNDARY,
  fixtureVersion: integrated.fixtureVersion,
  sourceRevision,
  containsRawDocumentBytes: false,
  artifacts: [...artifacts].map(([name, contents]) => ({
    name,
    sha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(contents),
  })),
};
writeFileSync(path.join(outputDirectory, 'artifact-manifest.json'), json(manifest), 'utf8');
assertNoUnexpectedOutputEntries(outputDirectory, allowedOutputNames);
process.stdout.write(`SIMULATOR_CERTIFICATION_ARTIFACTS=${outputDirectory}\n`);

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sourceFingerprint(relativePath: string) {
  const bytes = readFileSync(path.join(repositoryRoot, relativePath));
  return {
    path: relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertEvidenceSanitized(artifacts: ReadonlyMap<string, string>): void {
  const forbiddenMarkers = ['%PDF-', 'JVBERi0', 'clientSecret', 'access_token', 'socialSecurityNumber', 'ssnLast4'];
  for (const [name, contents] of artifacts) {
    const marker = forbiddenMarkers.find((candidate) => contents.includes(candidate));
    if (marker) throw new Error(`Evidence artifact ${name} contains forbidden marker ${marker}.`);
  }
}

function assertNoUnexpectedOutputEntries(directory: string, allowedNames: ReadonlySet<string>): void {
  const unexpected = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isFile() || !allowedNames.has(entry.name))
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(`Evidence output directory contains unexpected entries: ${unexpected.join(', ')}`);
  }
}

function validateExecutableClaims(
  integrated: ReturnType<typeof runEncompassCertification>,
  standalone: ReturnType<typeof runEncompassCertification>,
  fixture: ReturnType<typeof certificationFixtureManifest>,
) {
  assert.equal(integrated.boundary, CERTIFICATION_BOUNDARY);
  assert.equal(standalone.boundary, CERTIFICATION_BOUNDARY);
  assert.equal(fixture.classification, 'SYNTHETIC_POST_PARSE_SIMULATOR_ONLY');
  assert.equal(fixture.documentBytesIncluded, false);
  assert.deepEqual(integrated.financialResult, standalone.financialResult);
  assert.equal(integrated.financialResult.qualifyingMonthlyIncome, fixture.expected.qualifyingMonthlyIncome);
  assert.deepEqual(integrated.financialResult.borrowerIncome, fixture.expected.borrowerIncome);
  assert.equal(integrated.financialResult.trendingResult, fixture.expected.trendingResult);
  assert.deepEqual(integrated.financialResult.yearsAnalyzed, fixture.expected.yearsAnalyzed);
  assert.deepEqual(integrated.financialResult.mapperMonthly, fixture.expected.mapperMonthly);
  assert.equal(integrated.jsonExport, standalone.jsonExport);
  assert.doesNotThrow(() => JSON.parse(integrated.jsonExport));
  assert.equal(integrated.summary, standalone.summary);
  assert.deepEqual(integrated.encompassFields, standalone.encompassFields);
  assert.deepEqual(integrated.encompassFields, {
    'CX.FREEFLOW.INCOME': '21600.00',
    'CX.FREEFLOW.TRENDING': 'SINGLE_YEAR',
    'CX.FREEFLOW.AUDIT.URL': 'https://certification.invalid/audit/00000000-0000-4000-8000-000000000901',
    'CX.FREEFLOW.YEARS': '2025',
    'CX.FREEFLOW.SCH.C': '8000.00',
    'CX.FREEFLOW.FORM.1065': '5000.00',
    'CX.FREEFLOW.W2.BASE': '4000.00',
    'CX.FREEFLOW.RENTAL': '2000.00',
    'CX.FREEFLOW.BORROWER.1.INCOME': '5600.00',
    'CX.FREEFLOW.BORROWER.2.INCOME': '16000.00',
    'CX.FREEFLOW.APPROVAL.ID': '00000000-0000-4000-8000-000000000901',
  });
  assert.equal(integrated.beforeAfter.projectionMatched, true);
  assert.equal(integrated.beforeAfter.after['CX.CUSTOMER.UNRELATED'], 'preserved');

  const requiredIncomeFields = [
    { fieldName: 'CX.FREEFLOW.W2.VARIABLE', expectedValue: money(integrated.financialResult.mapperMonthly.w2Variable) },
    { fieldName: 'CX.FREEFLOW.ASSET.INCOME', expectedValue: money(integrated.financialResult.mapperMonthly.asset) },
  ];
  const mappingGaps = requiredIncomeFields.filter(
    ({ fieldName, expectedValue }) => integrated.encompassFields[fieldName] !== expectedValue,
  );

  return {
    results: {
      integratedPostParseProjectionCalculation: 'PASS',
      standalonePostParseProjectionCalculation: 'PASS',
      financialEquivalence: 'PASS',
      jsonHarnessArtifact: 'PASS',
      summaryHarnessArtifact: 'PASS',
      exactCurrentMapperOutput: 'PASS',
      approvedFieldContractCompleteness: mappingGaps.length === 0 ? 'PASS' : 'FAIL',
      inMemoryFieldProjectionComparison: 'PASS',
    } as const,
    mappingGaps,
  };
}

function money(value: number): string {
  return value.toFixed(2);
}
