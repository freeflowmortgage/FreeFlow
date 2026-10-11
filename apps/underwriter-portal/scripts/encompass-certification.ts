import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildEncompassWritePreview,
  executeApprovedIncomeRoundTrip,
} from '@mortgage-pos/encompass-connector-contract';
import {
  SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
  SYNTHETIC_FREEFLOW_DEV_MORNING_PACK,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from '../../../services/encompass-connector/src/connector/syntheticFreeflowDevConnector';
import {
  CERTIFICATION_BOUNDARY,
  certificationFixtureManifest,
  runEncompassCertification,
} from '../src/server/integrations/encompass/encompassCertificationHarness';
import { normalizeEncompassLoanSnapshot } from '../src/server/integrations/encompass/normalizeImportedLoan';
import {
  MISMO_APPROVED_INCOME_PROFILE,
  MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  MISMO_REFERENCE_MODEL_IDENTIFIER,
} from '../src/server/exports/approvedIncomeExports';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const defaultOutput = path.join(
  repositoryRoot,
  'docs',
  'deployment-readiness',
  'evidence',
  'encompass-certification-2026-10-11',
);
const outputDirectory = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultOutput;

async function main(): Promise<void> {
const integrated = runEncompassCertification('INTEGRATED_POST_PARSE_PROJECTION');
const standalone = runEncompassCertification('STANDALONE_POST_PARSE_PROJECTION');
const fixture = certificationFixtureManifest();
const simulatedRoundTrip = await runSyntheticRoundTrip(integrated, fixture);
const executableValidation = validateExecutableClaims(integrated, standalone, fixture, simulatedRoundTrip);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
const sourceRevision = {
  baseCommit: commit,
  executionSource: 'CURRENT_WORKTREE',
  workingTreeInputs: [
    sourceFingerprint('apps/underwriter-portal/scripts/encompass-certification.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/encompassCertificationHarness.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/encompassCertification.test.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/fixtures/encompass-certification-v1.json'),
    sourceFingerprint('services/encompass-connector/src/connector/syntheticFreeflowDevConnector.ts'),
    sourceFingerprint('packages/encompass-connector-contract/src/roundTrip.ts'),
    sourceFingerprint('packages/mortgage-engine/src/normalizedLoan.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/normalizeImportedLoan.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/syncPreview.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/integrations/encompass/syncWorker.ts'),
    sourceFingerprint('apps/underwriter-portal/src/server/exports/approvedIncomeExports.ts'),
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
  ['simulated-encompass-round-trip.json', json(simulatedRoundTrip)],
  ['mismo-validation.json', json({
    boundary: CERTIFICATION_BOUNDARY,
    status: 'NOT_IMPLEMENTED',
    capability: 'MISMO export for the Encompass post-parse simulator fixture',
    selectedSchema: MISMO_REFERENCE_MODEL_IDENTIFIER,
    selectedImplementationRequirements: MISMO_APPROVED_INCOME_PROFILE,
    freeFlowProfileValidation: 'NOT_EXECUTED_FOR_THIS_FIXTURE',
    officialSchemaValidation: 'BLOCKED',
    officialXsdValidationStatus: MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
    explanation: 'This simulator does not create or validate a MISMO XML artifact for its two-borrower, $21,600 fixture. The separately generated standalone XML uses a different one-borrower fixture and is intentionally not cited as fixture-level evidence here. Official XSD validation is also blocked because the official schema and implementation-requirement bundle is not present.',
    xmlArtifactProducedInThisSimulatorBundle: false,
  })],
  ['processing-validation-report.json', json({
    schemaVersion: 'freeflow-encompass-certification-report-v2',
    boundary: CERTIFICATION_BOUNDARY,
    fixtureVersion: integrated.fixtureVersion,
    sourceRevision,
    results: {
      ...executableValidation.results,
      simulatedEncompassLoanRetrieval: 'PASS',
      simulatedEncompassDocumentRetrieval: 'PASS',
      simulatedEncompassApprovedWriteReadback: 'PASS',
      simulatedEncompassPerFieldStatuses: 'PASS',
    },
    mappingGaps: executableValidation.mappingGaps,
    capabilitiesOutsideHarness: [
      'real Encompass authentication, retrieval, document download, writeback, and readback',
      'production application import orchestration',
      'server-authoritative database-backed write preview and immutable sync persistence',
      'ambiguous provider-write reconciliation',
      'customer standalone loan creation and approved export routes',
      'MISMO XML generation or profile/XSD validation',
      'provider error-log redaction',
      'hosted full-field readback',
    ],
    warnings: [
      'PASS results in this artifact are operations asserted during this simulator execution only.',
      'The harness starts with deterministic post-parse, persisted-extraction-shaped data. It links no PDF bytes and does not execute pull, upload, parsing, persistence, or review boundaries.',
      'The in-memory field projection is not connector writeback, readback, or an Encompass installation.',
      'The simulated connector round trip is deterministic local evidence only and is not verified interoperability with a real Encompass installation.',
      'Capabilities listed outside the harness require their own test or inspection evidence and receive no PASS status from this generator.',
      'No MISMO XML artifact is produced for this fixture; a standalone XML generated from a different fixture cannot establish this fixture\'s XML consistency.',
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
}

void main().catch((error: unknown) => {
  void error;
  process.stderr.write('SIMULATOR_CERTIFICATION_FAILED=UNEXPECTED_ERROR\n');
  process.exitCode = 1;
});

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sourceFingerprint(relativePath: string) {
  const canonicalText = readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
    .replace(/\r\n?/g, '\n');
  return {
    path: relativePath,
    canonicalization: 'UTF8_LF',
    sha256: createHash('sha256').update(canonicalText, 'utf8').digest('hex'),
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
  simulatedRoundTrip: Awaited<ReturnType<typeof runSyntheticRoundTrip>>,
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
    'CX.FREEFLOW.W2.VARIABLE': '1600.00',
    'CX.FREEFLOW.ASSET.INCOME': '1000.00',
    'CX.FREEFLOW.RENTAL': '2000.00',
    'CX.FREEFLOW.BORROWER.1.INCOME': '5600.00',
    'CX.FREEFLOW.BORROWER.2.INCOME': '16000.00',
    'CX.FREEFLOW.APPROVAL.ID': '00000000-0000-4000-8000-000000000901',
  });
  assert.equal(integrated.beforeAfter.projectionMatched, true);
  assert.equal(integrated.beforeAfter.after['CX.CUSTOMER.UNRELATED'], 'preserved');
  assert.equal(simulatedRoundTrip.classification, 'SYNTHETIC_CONNECTOR_SIMULATOR_ONLY');
  assert.equal(simulatedRoundTrip.simulated, true);
  assert.equal(simulatedRoundTrip.loanProjection.schemaVersion, 'freeflow-normalized-loan-v1');
  assert.deepEqual(
    simulatedRoundTrip.loanProjection.borrowers.map((borrower) => borrower.borrowerKey),
    ['borrower-1', 'borrower-2'],
  );
  assert.equal(simulatedRoundTrip.documentRetrieval.attachments.length, 14);
  assert.equal(simulatedRoundTrip.documentRetrieval.buffersErased, true);
  assert.equal(simulatedRoundTrip.documentRetrieval.attachments.every((attachment) => /^[0-9a-f]{64}$/.test(attachment.sha256)), true);
  assert.equal(simulatedRoundTrip.writeReadback.allSucceeded, true);
  assert.equal(simulatedRoundTrip.writeReadback.fields.every((field) => field.status === 'SUCCESS'), true);
  assert.deepEqual(
    [...new Set(simulatedRoundTrip.fieldStatusCoverage.fields.map((field) => field.status))].sort(),
    ['CONFLICT', 'REJECTED', 'SUCCESS', 'UNAVAILABLE'],
  );

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

async function runSyntheticRoundTrip(
  integrated: ReturnType<typeof runEncompassCertification>,
  fixture: ReturnType<typeof certificationFixtureManifest>,
) {
  const connector = new SyntheticFreeflowDevConnector();
  const context = {
    tenantId: SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
    loanId: fixture.loan.loanId,
    correlationId: 'encompass-certification-simulator',
  };
  const snapshot = await connector.retrieveLoanSnapshot(context, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID);
  const normalizedLoan = normalizeEncompassLoanSnapshot(snapshot);
  const attachments = await connector.listActiveAttachments(context, SYNTHETIC_FREEFLOW_DEV_LOAN_GUID);
  const expectedPackHashes = new Map(SYNTHETIC_FREEFLOW_DEV_MORNING_PACK.map((attachment) => [
    attachment.id,
    attachment.sha256,
  ]));
  let buffersErased = true;
  const retrievedAttachments: Array<{ attachmentId: string; sha256: string; bytes: number }> = [];
  for (const attachment of attachments) {
    const downloaded = await connector.downloadOriginalAttachment(
      context,
      SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
      attachment.id,
    );
    try {
      assert.equal(new TextDecoder().decode(downloaded.bytes.subarray(0, 5)), '%PDF-');
      assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), downloaded.sha256);
      const expectedHash = expectedPackHashes.get(attachment.id as typeof SYNTHETIC_FREEFLOW_DEV_MORNING_PACK[number]['id']);
      if (expectedHash) assert.equal(downloaded.sha256, expectedHash);
      retrievedAttachments.push({
        attachmentId: attachment.id,
        sha256: downloaded.sha256,
        bytes: downloaded.bytes.byteLength,
      });
    } finally {
      downloaded.bytes.fill(0);
      buffersErased = buffersErased && downloaded.bytes.every((value) => value === 0);
    }
  }
  const fields = Object.entries(integrated.encompassFields).map(([fieldName, value]) => ({ fieldName, value }));
  const preview = buildEncompassWritePreview({
    approvalEventId: fixture.expected.approvalId,
    fields,
  });
  const result = await executeApprovedIncomeRoundTrip({
    connector,
    context,
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview,
    reviewerApproval: {
      approvalEventId: fixture.expected.approvalId,
      previewHash: preview.previewHash,
    },
  });
  const statusConnector = new SyntheticFreeflowDevConnector({
    fieldBehaviors: {
      'CX.FREEFLOW.W2.BASE': 'REJECTED',
      'CX.FREEFLOW.W2.VARIABLE': 'CONFLICT',
      'CX.FREEFLOW.ASSET.INCOME': 'UNAVAILABLE',
    },
  });
  const statusResult = await executeApprovedIncomeRoundTrip({
    connector: statusConnector,
    context,
    loanGuid: SYNTHETIC_FREEFLOW_DEV_LOAN_GUID,
    preview,
    reviewerApproval: {
      approvalEventId: fixture.expected.approvalId,
      previewHash: preview.previewHash,
    },
  });
  return {
    schemaVersion: 'freeflow-simulated-encompass-round-trip-v1',
    classification: 'SYNTHETIC_CONNECTOR_SIMULATOR_ONLY',
    realEncompassInteroperability: 'NOT_CLAIMED',
    sourceSnapshotSchemaVersion: snapshot.schemaVersion,
    simulated: snapshot.simulated,
    loanProjection: normalizedLoan,
    documentRetrieval: {
      rawDocumentBytesPersisted: false,
      buffersErased,
      attachments: retrievedAttachments,
    },
    approvedPreview: {
      schemaVersion: preview.schemaVersion,
      approvalEventId: preview.approvalEventId,
      previewHash: preview.previewHash,
      fieldNames: preview.fields.map((field) => field.fieldName),
    },
    providerRevision: result.providerRevision,
    writeReadback: result.readback,
    fieldStatusCoverage: statusResult.readback,
    mutationCount: connector.mutationCount,
  } as const;
}

function money(value: number): string {
  return value.toFixed(2);
}
