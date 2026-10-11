import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  MISMO_APPROVED_INCOME_PROFILE,
  MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  MISMO_REFERENCE_MODEL_IDENTIFIER,
  renderApprovedIncomeSummaryPdf,
  serializeApprovedIncomeJson,
  serializeApprovedIncomeMismo,
  validateApprovedIncomeMismoProfile,
} from '../src/server/exports/approvedIncomeExports';
import {
  APPROVED_INCOME_SNAPSHOT_VERSION,
  type ApprovedIncomeSnapshot,
} from '../src/server/exports/approvedIncomeSnapshot';
import { hashCanonical } from '../src/server/http/canonical';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputDirectory = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repositoryRoot, 'docs', 'deployment-readiness', 'evidence', 'standalone-approved-income-exports-2026-10-11');

const core = {
  schemaVersion: APPROVED_INCOME_SNAPSHOT_VERSION,
  normalizedLoan: {
    schemaVersion: 'freeflow-normalized-loan-v1',
    loanProgram: 'CONVENTIONAL',
    borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }],
  },
  loan: {
    id: '00000000-0000-4000-8000-000000000200',
    version: 4,
    program: 'CONVENTIONAL',
    integrationMode: 'NONE',
  },
  approval: {
    eventId: '00000000-0000-4000-8000-000000000400',
    calculationId: '00000000-0000-4000-8000-000000000300',
    action: 'INCOME_APPROVED',
    approvedAt: '2026-10-11T08:30:00.000Z',
    approvedLoanVersion: 3,
  },
  calculation: {
    schemaVersion: 'authoritative-extractions-v1',
    source: 'persisted-parser-extractions',
    mortgageRuleVersion: 'form-1084-v9',
    canonicalInputHash: 'a'.repeat(64),
    sourceDocumentHashes: ['b'.repeat(64)],
    qualifyingMonthlyIncome: '8000.00',
    totalAnnualCashFlow: '96000.00',
    trendingResult: 'SINGLE_YEAR',
    yearsAnalyzed: [2025],
    components: {
      w2BaseMonthly: '8000.00',
      w2VariableMonthly: null,
      scheduleCMonthly: null,
      scheduleFMonthly: null,
      form1120SMonthly: null,
      form1065Monthly: null,
      form1120Monthly: null,
      assetIncomeMonthly: null,
      rentalMonthly: null,
      rentalLiabilityMonthly: null,
      housingExpenseAdjustment: null,
    },
    borrowers: [{
      borrowerKey: 'borrower-1',
      ordinal: 0,
      role: 'PRIMARY',
      qualifyingMonthlyIncome: '8000.00',
    }],
  },
  provenance: {
    extractions: [{
      extractionId: '00000000-0000-4000-8000-000000000500',
      extractionHash: 'c'.repeat(64),
      sourceDocumentId: '00000000-0000-4000-8000-000000000600',
      sourceDocumentVersion: 1,
      sourceContentHash: 'b'.repeat(64),
      metadataReviewId: null,
      metadataReviewVersion: null,
      metadataReviewHash: null,
    }],
  },
} satisfies Omit<ApprovedIncomeSnapshot, 'snapshotHash'>;
const snapshot: ApprovedIncomeSnapshot = Object.freeze({ ...core, snapshotHash: hashCanonical(core) });
void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : 'Standalone evidence generation failed.'}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const artifacts = await generateArtifactSet(snapshot);
  const repeatedArtifacts = await generateArtifactSet(snapshot);
  const reproducibility = assertByteIdentical(artifacts, repeatedArtifacts);

  assertSanitized(artifacts);
  const allowedNames = new Set([...artifacts.keys(), 'artifact-manifest.json']);
  mkdirSync(outputDirectory, { recursive: true });
  assertNoUnexpectedEntries(outputDirectory, allowedNames);
  const manifest = {
    schemaVersion: 'freeflow-standalone-export-artifact-manifest-v1',
    classification: 'SANITIZED_SYNTHETIC_COMPONENT_EXECUTION',
    snapshotHash: snapshot.snapshotHash,
    reproducibility: {
      generations: 2,
      byteIdentical: true,
      artifacts: reproducibility,
    },
    sourceInputs: [
      sourceFingerprint('apps/underwriter-portal/scripts/standalone-export-evidence.ts'),
      sourceFingerprint('apps/underwriter-portal/src/server/exports/approvedIncomeSnapshot.ts'),
      sourceFingerprint('apps/underwriter-portal/src/server/exports/approvedIncomeExports.ts'),
    ],
    artifacts: [...artifacts].map(([name, bytes]) => ({
      name,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })),
  };
  for (const [name, bytes] of artifacts) writeFileSync(path.join(outputDirectory, name), bytes);
  writeFileSync(path.join(outputDirectory, 'artifact-manifest.json'), json(manifest), 'utf8');
  assertNoUnexpectedEntries(outputDirectory, allowedNames);
  artifacts.get('approved-income-summary.pdf')?.fill(0);
  repeatedArtifacts.get('approved-income-summary.pdf')?.fill(0);
  process.stdout.write(`STANDALONE_EXPORT_EVIDENCE=${outputDirectory}\n`);
}

async function generateArtifactSet(value: ApprovedIncomeSnapshot): Promise<Map<string, Buffer>> {
  const jsonExport = serializeApprovedIncomeJson(value);
  const mismoExport = serializeApprovedIncomeMismo(value);
  const profileValidation = validateApprovedIncomeMismoProfile(mismoExport, value);
  const pdfExport = await renderApprovedIncomeSummaryPdf(value);
  const executionReport = {
    schemaVersion: 'freeflow-standalone-export-evidence-report-v1',
    classification: 'SANITIZED_SYNTHETIC_COMPONENT_EXECUTION',
    snapshotHash: value.snapshotHash,
    results: {
      approvedSnapshotToJson: 'PASS',
      approvedSnapshotToMismoProfileXml: 'PASS',
      approvedSnapshotToHumanReadablePdf: 'PASS',
      freeFlowMismoImplementationProfileValidation: profileValidation.status,
      doubleGenerationByteIdentity: 'PASS',
      officialMismoXsdValidation: 'BLOCKED',
      databaseBackedLifecycle: 'NOT_EXECUTED',
      browserToBackendLifecycle: 'NOT_EXECUTED',
      realEncompassInteroperability: 'NOT_EXECUTED',
    },
    boundaries: {
      sourceDocumentBytesIncluded: false,
      customerDataIncluded: false,
      officialSchemaBundlePresent: false,
      officialXsdValidationStatus: MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
      statement: 'A PASS here proves deterministic component generation and the declared FreeFlow MISMO profile only.',
    },
  };
  return new Map<string, Buffer>([
    ['approved-income-snapshot.json', utf8(json(value))],
    ['approved-income.json', utf8(jsonExport)],
    ['approved-income.mismo.xml', utf8(mismoExport)],
    ['approved-income-summary.pdf', pdfExport],
    ['mismo-profile-validation.json', utf8(json({
      ...profileValidation,
      declaredReferenceModel: MISMO_REFERENCE_MODEL_IDENTIFIER,
      declaredImplementationProfile: MISMO_APPROVED_INCOME_PROFILE,
      officialSchemaValidation: 'BLOCKED',
      explanation: 'The official MISMO XSD and implementation-requirement bundle is not included in this repository.',
    }))],
    ['processing-validation-report.json', utf8(json(executionReport))],
  ]);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function utf8(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertByteIdentical(first: ReadonlyMap<string, Buffer>, second: ReadonlyMap<string, Buffer>) {
  assert.deepEqual([...first.keys()], [...second.keys()]);
  return [...first].map(([name, firstBytes]) => {
    const secondBytes = second.get(name);
    assert.ok(secondBytes, `Repeated generation omitted ${name}`);
    const firstSha256 = sha256(firstBytes);
    const secondSha256 = sha256(secondBytes);
    assert.equal(firstSha256, secondSha256, `${name} changed across identical generations`);
    assert.equal(Buffer.compare(firstBytes, secondBytes), 0, `${name} is not byte-identical across identical generations`);
    return { name, firstSha256, secondSha256, byteIdentical: true };
  });
}

function sourceFingerprint(relativePath: string) {
  const bytes = readFileSync(path.join(repositoryRoot, relativePath));
  return { path: relativePath, sha256: sha256(bytes) };
}

function assertSanitized(files: ReadonlyMap<string, Buffer>): void {
  const forbidden = ['clientSecret', 'access_token', 'socialSecurityNumber', 'ssnLast4', 'taxIdentificationIdentifier'];
  for (const [name, bytes] of files) {
    const text = bytes.toString('latin1');
    const marker = forbidden.find((value) => text.includes(value));
    assert.equal(marker, undefined, `${name} contains forbidden marker ${marker}`);
  }
}

function assertNoUnexpectedEntries(directory: string, allowedNames: ReadonlySet<string>): void {
  const unexpected = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.isFile() || !allowedNames.has(entry.name))
    .map((entry) => entry.name);
  assert.deepEqual(unexpected, [], `Evidence directory contains unexpected entries: ${unexpected.join(', ')}`);
}
