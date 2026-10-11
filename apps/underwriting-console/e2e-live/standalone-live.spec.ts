import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';

const PHASE = process.env.LIVE_PHASE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const SYNTHETIC_PAYSTUB_SHA256 = '0c32930fafb11d3ad5ddeb205518974209468552314497eae3190ea09342dccf';

// These expectations are independently derived from the sanctioned fixture,
// not imported from the production calculator.
const FIXTURE_EXPECTATION = Object.freeze({
  baseYtd: 29_380,
  variableYtd: 1_950 + 3_000,
  elapsedMonths: 6,
});
const EXPECTED_BASE_MONTHLY = money(FIXTURE_EXPECTATION.baseYtd / FIXTURE_EXPECTATION.elapsedMonths);
const EXPECTED_VARIABLE_MONTHLY = money(FIXTURE_EXPECTATION.variableYtd / FIXTURE_EXPECTATION.elapsedMonths);
const EXPECTED_QUALIFYING_MONTHLY = money(
  Number(EXPECTED_BASE_MONTHLY) + Number(EXPECTED_VARIABLE_MONTHLY),
);
const EXPECTED_ANNUAL = money(Number(EXPECTED_QUALIFYING_MONTHLY) * 12);

test.describe('live standalone lifecycle - no business API mocks', () => {
  test.beforeAll(async () => {
    await verifyEvidenceBoundary();
  });

  test('creates, processes, approves, exports, reloads, and deduplicates one synthetic loan', async ({ page }) => {
    test.skip(PHASE !== 'main', 'Run with LIVE_PHASE=main.');

    const sourcePdf = buildSyntheticScannedPaystub();
    const buffersToErase: Buffer[] = [sourcePdf];
    const apiAudit = observeApiTraffic(page);

    try {
      // Deliberately no page.route() or request interception: every business
      // request below reaches the configured live application boundary.
      await page.goto('/workspace?product=split');
      await expect(page.getByTestId('standalone-loan-intake')).toBeVisible();
      await expect(page.getByText('No Encompass, ICE, or external LOS connection is required.')).toBeVisible();

      await page.getByTestId('standalone-program').selectOption('CONVENTIONAL');
      await page.getByTestId('standalone-borrower-count').selectOption('1');
      await page.getByTestId('create-standalone-loan').click();
      await expect(page.getByTestId('protected-workflow')).toBeVisible();

      const loanId = new URL(page.url()).searchParams.get('loanId');
      expect(loanId).toMatch(UUID);
      if (!loanId) throw new Error('The created standalone loan URL did not contain loanId.');

      await page.getByTestId('authoritative-workflow-tab').click();
      await expect(page.getByTestId('pull-documents')).toHaveCount(0);
      await expect(page.getByTestId('write-host')).toHaveCount(0);

      await page.getByTestId('protected-pdf-input').setInputFiles({
        name: 'freeflow-synthetic-scanned-paystub.pdf',
        mimeType: 'application/pdf',
        buffer: sourcePdf,
      });
      const firstUpload = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/loans/${loanId}/income-documents`
      ), { timeout: 240_000 });
      await page.getByTestId('upload-pdf').click();
      expect((await firstUpload).status()).toBe(201);

      const review = page.getByRole('heading', { name: '3. Metadata review' }).locator('..');
      const confirmReview = page.getByRole('button', { name: 'Confirm reviewed metadata' });
      await expect(confirmReview).toBeVisible();
      await expect(review.locator('label')).toHaveCount(3);
      await reviewedField(review, 'employmentRole', 'select').selectOption('CURRENT');
      await reviewedField(review, 'taxYear', 'input').fill('2023');
      await reviewedField(review, 'elapsedMonths', 'input').fill(String(FIXTURE_EXPECTATION.elapsedMonths));
      await confirmReview.click();
      await expect(page.getByText('No outstanding metadata review.')).toBeVisible();

      await page.getByTestId('calculate-income').click();
      await expect(page.getByTestId('combined-income')).toContainText(`$${withThousands(EXPECTED_QUALIFYING_MONTHLY)}`);
      await expect(page.getByTestId('approve-income')).toBeEnabled();
      await page.getByTestId('approve-income').click();
      await expect(page.getByTestId('approved-income-exports')).toBeVisible();
      await expect(page.getByTestId('approve-income')).toHaveText('Approved');

      const first = await downloadAllExports(page);
      buffersToErase.push(first.json, first.mismo, first.summary);
      const approved = await validateExports(page, first, loanId);
      const firstContext = await loadConsoleContext(page, loanId);
      assertFinalContext(firstContext, loanId);

      await page.reload();
      await expect(page.getByTestId('protected-workflow')).toBeVisible();
      await page.getByTestId('authoritative-workflow-tab').click();
      await expect(page.getByTestId('approved-income-exports')).toBeVisible();
      await expect(page.getByTestId('combined-income')).toContainText(`$${withThousands(EXPECTED_QUALIFYING_MONTHLY)}`);

      await page.getByTestId('protected-pdf-input').setInputFiles({
        name: 'freeflow-synthetic-scanned-paystub.pdf',
        mimeType: 'application/pdf',
        buffer: sourcePdf,
      });
      const duplicateUpload = page.waitForResponse((response) => (
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/loans/${loanId}/income-documents`
      ), { timeout: 240_000 });
      await page.getByTestId('upload-pdf').click();
      expect((await duplicateUpload).status()).toBe(201);
      await expect(page.getByTestId('upload-pdf')).toHaveText('Upload and extract');
      await expect(page.getByTestId('upload-pdf')).toBeDisabled();
      await expect(page.getByTestId('approved-income-exports')).toBeVisible();

      const second = await downloadAllExports(page);
      buffersToErase.push(second.json, second.mismo, second.summary);
      expect(second.json.equals(first.json)).toBe(true);
      expect(second.mismo.equals(first.mismo)).toBe(true);
      expect(second.summary.equals(first.summary)).toBe(true);

      const secondContext = await loadConsoleContext(page, loanId);
      assertFinalContext(secondContext, loanId);
      expect(contextIdentity(secondContext)).toEqual(contextIdentity(firstContext));

      expect(apiAudit.failures).toEqual([]);
      expect(apiAudit.responses.filter((response) => response.status >= 400)).toEqual([]);
      expect(apiAudit.responses.some((response) => response.path.toLowerCase().includes('encompass'))).toBe(false);

      const result = {
        status: 'PASS',
        scope: 'STANDALONE_LIVE_APPLICATION_BOUNDARY',
        loanId,
        loanIdentifierClassification: 'SYNTHETIC_TEST_ONLY',
        loanVersion: 4,
        snapshotHash: approved.snapshotHash,
        exports: {
          jsonSha256: digest(first.json),
          mismoSha256: digest(first.mismo),
          summarySha256: digest(first.summary),
        },
        officialMismoXsdValidation: 'NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED',
        businessApiMocked: false,
      } as const;
      await writeMainEvidence(first, firstContext, apiAudit, result);
      console.log(`LIVE_ACCEPTANCE_RESULT=${JSON.stringify(result)}`);
    } finally {
      for (const buffer of buffersToErase) buffer.fill(0);
    }
  });

  test('a separately authenticated tenant cannot export the synthetic loan', async ({ page }) => {
    test.skip(PHASE !== 'cross-tenant', 'Run with LIVE_PHASE=cross-tenant.');
    const loanId = requiredEnvironment('LIVE_LOAN_ID');
    expect(loanId).toMatch(UUID);

    const response = await page.goto(`/api/v1/loans/${encodeURIComponent(loanId)}/approved-income-exports/json`);
    if (!response) throw new Error('Cross-tenant export request did not return an HTTP response.');
    expect(response.status()).toBe(404);
    const payload = await response.json() as { error?: { code?: string } };
    expect(payload.error?.code).toBe('LOAN_NOT_FOUND');

    const result = {
      status: 'PASS',
      loanId,
      loanIdentifierClassification: 'SYNTHETIC_TEST_ONLY',
      httpStatus: 404,
      errorCode: 'LOAN_NOT_FOUND',
    } as const;
    await writeCrossTenantEvidence(result);
    console.log(`LIVE_ACCEPTANCE_CROSS_TENANT=${JSON.stringify(result)}`);
  });
});

function reviewedField(review: ReturnType<Page['locator']>, field: string, control: 'input' | 'select') {
  return review.locator('label').filter({ hasText: `/ ${field}` }).locator(control);
}

function buildSyntheticScannedPaystub(): Buffer {
  const image = requiredEnvironment('LIVE_FIXTURE_IMAGE');
  const defaultFixtures = fileURLToPath(new URL('../../../services/doc-parser/tests/', import.meta.url));
  const fixtures = resolve(process.env.LIVE_FIXTURE_TESTS_DIR?.trim() || defaultFixtures);
  const fixtureModule = resolve(fixtures, 'paystub_fixtures.py');
  if (!existsSync(fixtureModule)) {
    throw new Error(`Synthetic fixture module was not found: ${fixtureModule}`);
  }

  const python = [
    'import sys',
    'import re',
    "sys.path.insert(0, '/fixtures')",
    'from paystub_fixtures import build_scanned_paystub_pdf',
    "pdf, timestamp_count = re.subn(rb'D:[0-9]{14}Z', b'D:20000101000000Z', build_scanned_paystub_pdf())",
    "assert timestamp_count == 2, 'unexpected synthetic PDF metadata'",
    'sys.stdout.buffer.write(pdf)',
  ].join('\n');
  const result = spawnSync('docker', [
    'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--entrypoint', 'python3.11',
    '--volume', `${fixtures}:/fixtures:ro`,
    image, '-c', python,
  ], {
    encoding: 'buffer',
    maxBuffer: MAX_DOCUMENT_BYTES + 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) {
    const code = 'code' in result.error && result.error.code ? String(result.error.code) : 'SPAWN_FAILED';
    throw new Error(`Unable to run the local parser fixture image (${code}).`);
  }
  if (result.status !== 0) {
    const detail = Buffer.from(result.stderr ?? []).toString('utf8').trim().slice(0, 1_000);
    throw new Error(`Synthetic fixture generation failed with exit ${result.status}${detail ? `: ${detail}` : '.'}`);
  }
  const pdf = Buffer.from(result.stdout ?? []);
  if (pdf.length === 0 || pdf.length > MAX_DOCUMENT_BYTES || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    pdf.fill(0);
    throw new Error('Synthetic fixture generator did not return a supported in-memory PDF.');
  }
  const actualDigest = digest(pdf);
  if (actualDigest !== SYNTHETIC_PAYSTUB_SHA256) {
    pdf.fill(0);
    throw new Error(`Synthetic fixture digest mismatch: expected ${SYNTHETIC_PAYSTUB_SHA256}, received ${actualDigest}.`);
  }
  return pdf;
}

function observeApiTraffic(page: Page): {
  responses: Array<{ method: string; path: string; status: number }>;
  failures: Array<{ method: string; path: string; error: string }>;
} {
  const audit = {
    responses: [] as Array<{ method: string; path: string; status: number }>,
    failures: [] as Array<{ method: string; path: string; error: string }>,
  };
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/')) {
      audit.responses.push({ method: response.request().method(), path, status: response.status() });
    }
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) {
      audit.failures.push({ method: request.method(), path, error: request.failure()?.errorText ?? 'UNKNOWN' });
    }
  });
  return audit;
}

async function downloadAllExports(page: Page): Promise<{ json: Buffer; mismo: Buffer; summary: Buffer }> {
  return {
    json: await downloadViaUi(page, 'download-approved-json'),
    mismo: await downloadViaUi(page, 'download-approved-mismo'),
    summary: await downloadViaUi(page, 'download-approved-summary'),
  };
}

async function downloadViaUi(page: Page, testId: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(testId).click(),
  ]);
  const failure = await download.failure();
  if (failure) throw new Error(`Export download failed: ${failure}`);
  return readDownload(download);
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Export download did not provide a readable stream.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function validateExports(
  page: Page,
  exported: { json: Buffer; mismo: Buffer; summary: Buffer },
  loanId: string,
): Promise<{ snapshotHash: string }> {
  const json = JSON.parse(exported.json.toString('utf8')) as ApprovedIncomeJson;
  expect(json.exportProfile).toBe('freeflow-approved-income-json-v1');
  expect(json.schemaVersion).toBe('freeflow-approved-income-snapshot-v1');
  expect(json.snapshotHash).toMatch(SHA256);
  expect(json.normalizedLoan).toEqual({
    schemaVersion: 'freeflow-normalized-loan-v1',
    loanProgram: 'CONVENTIONAL',
    borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }],
  });
  expect(json.loan).toMatchObject({ id: loanId, version: 4, program: 'CONVENTIONAL', integrationMode: 'NONE' });
  expect(json.calculation.qualifyingMonthlyIncome).toBe(EXPECTED_QUALIFYING_MONTHLY);
  expect(json.calculation.totalAnnualCashFlow).toBe(EXPECTED_ANNUAL);
  expect(json.calculation.components.w2BaseMonthly).toBe(EXPECTED_BASE_MONTHLY);
  expect(json.calculation.components.w2VariableMonthly).toBe(EXPECTED_VARIABLE_MONTHLY);
  expect(json.calculation.borrowers).toEqual([
    { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: EXPECTED_QUALIFYING_MONTHLY },
  ]);
  expect(json.provenance.extractions).toHaveLength(1);

  const mismo = exported.mismo.toString('utf8');
  const xmlValidation = await page.evaluate((xml) => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    return {
      parserErrors: parsed.getElementsByTagName('parsererror').length,
      root: parsed.documentElement.localName,
      namespace: parsed.documentElement.namespaceURI,
      referenceModel: parsed.documentElement.getAttribute('MISMOReferenceModelIdentifier'),
    };
  }, mismo);
  expect(xmlValidation).toEqual({
    parserErrors: 0,
    root: 'MESSAGE',
    namespace: 'http://www.mismo.org/residential/2009/schemas',
    referenceModel: '3.4.0',
  });
  expect(mismo).toContain('MISMOReferenceModelIdentifier="3.4.0"');
  expect(mismo).toContain('freeflow-approved-income-mismo-3.4-profile-v1');
  expect(mismo).toContain('NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED');
  expect(mismo).toContain(`<FREEFLOW:SnapshotHash>${json.snapshotHash}</FREEFLOW:SnapshotHash>`);
  expect(mismo).toContain(`<FREEFLOW:LoanIdentifier>${loanId}</FREEFLOW:LoanIdentifier>`);
  expect(mismo).toContain(`<FREEFLOW:QualifyingMonthlyIncomeAmount>${EXPECTED_QUALIFYING_MONTHLY}</FREEFLOW:QualifyingMonthlyIncomeAmount>`);
  expect(mismo).toContain(`<FREEFLOW:TotalAnnualCashFlowAmount>${EXPECTED_ANNUAL}</FREEFLOW:TotalAnnualCashFlowAmount>`);

  expect(exported.summary.subarray(0, 5).equals(Buffer.from('%PDF-'))).toBe(true);
  const summaryText = await extractPdfText(exported.summary);
  expect(summaryText).toContain('FreeFlow Approved Income');
  expect(summaryText).toContain(`Snapshot: ${json.snapshotHash}`);
  expect(summaryText).toContain(`Loan: ${loanId} / version 4`);
  expect(summaryText).toContain(`Qualifying monthly income: $${EXPECTED_QUALIFYING_MONTHLY}`);
  expect(summaryText).toContain(`Total annual cash flow: $${EXPECTED_ANNUAL}`);

  for (const output of [exported.json.toString('utf8'), mismo, summaryText]) {
    expect(output).not.toContain('Dana Rivera');
    expect(output).not.toContain('Contoso Freight');
    expect(output).not.toContain('991244');
  }
  return { snapshotHash: json.snapshotHash };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: Uint8Array.from(buffer) });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const pdfPage = await document.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      pdfPage.cleanup();
    }
    return pages.join('\n');
  } finally {
    await document.destroy();
  }
}

async function loadConsoleContext(page: Page, loanId: string): Promise<ConsoleContext> {
  const result = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/loans/${encodeURIComponent(id)}/console-context`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return { status: response.status, body: await response.json() };
  }, loanId);
  expect(result.status).toBe(200);
  return result.body as ConsoleContext;
}

function assertFinalContext(context: ConsoleContext, loanId: string): void {
  expect(context.loan).toMatchObject({ id: loanId, version: 4, program: 'CONVENTIONAL' });
  expect(context.borrowers).toEqual([{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }]);
  expect(context.attachments).toHaveLength(1);
  expect(context.extractions).toHaveLength(1);
  expect(context.extractions[0]?.status).toBe('ACTIVE');
  expect(context.calculation?.qualifyingMonthlyIncome).toBe(EXPECTED_QUALIFYING_MONTHLY);
  expect(context.approval?.current).toBe(true);
  expect(context.hostWrite).toBeNull();
}

function contextIdentity(context: ConsoleContext): unknown {
  return {
    version: context.loan.version,
    attachments: context.attachments.map((item) => ({
      attachmentId: item.attachmentId,
      category: item.category,
      version: item.version,
      pageCount: item.pageCount,
      parserVersion: item.parserVersion,
    })),
    extractions: context.extractions.map((item) => ({
      id: item.id,
      attachmentId: item.attachmentId,
      sourceDocumentVersion: item.sourceDocumentVersion,
      parserVersion: item.parserVersion,
      schemaVersion: item.schemaVersion,
      status: item.status,
      warnings: item.warnings,
      confidence: item.confidence,
      metadataReview: item.metadataReview ? {
        id: item.metadataReview.id,
        metadataVersion: item.metadataReview.metadataVersion,
        current: item.metadataReview.current,
      } : null,
    })),
    calculation: context.calculation?.id,
    approval: context.approval?.id,
  };
}

function money(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function withThousands(value: string): string {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function digest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writeMainEvidence(
  exported: { json: Buffer; mismo: Buffer; summary: Buffer },
  context: ConsoleContext,
  apiAudit: ReturnType<typeof observeApiTraffic>,
  result: Readonly<Record<string, unknown>>,
): Promise<void> {
  const evidenceDirectory = process.env.LIVE_EVIDENCE_DIR?.trim();
  if (!evidenceDirectory) return;
  const sourceRevision = evidenceSourceRevision();
  const runId = evidenceRunId();
  await mkdir(resolve(evidenceDirectory), { recursive: true });

  // The source document and raw OCR text are deliberately excluded. These
  // files are emitted only after validateExports() proves the approved exports
  // contain none of the fixture's synthetic borrower/employer identifiers.
  await writeEvidenceFile(evidenceDirectory, 'approved-income.json', exported.json);
  await writeEvidenceFile(evidenceDirectory, 'approved-income.mismo.xml', exported.mismo);
  await writeEvidenceFile(evidenceDirectory, 'approved-income-summary.pdf', exported.summary);
  await writeEvidenceJson(evidenceDirectory, 'processing-validation-report.json', {
    evidenceSchemaVersion: 'freeflow-live-acceptance-evidence-v1',
    runId,
    sourceRevision,
    loanIdentifierClassification: 'SYNTHETIC_TEST_ONLY',
    fixture: {
      kind: 'SYNTHETIC_SCANNED_PAYSTUB',
      sha256: SYNTHETIC_PAYSTUB_SHA256,
      rawDocumentPersisted: false,
      rawOcrPersisted: false,
    },
    expected: {
      baseMonthly: EXPECTED_BASE_MONTHLY,
      variableMonthly: EXPECTED_VARIABLE_MONTHLY,
      qualifyingMonthly: EXPECTED_QUALIFYING_MONTHLY,
      annual: EXPECTED_ANNUAL,
    },
    context: evidenceContext(context),
    apiAudit: evidenceApiAudit(apiAudit),
  });
  await writeEvidenceJson(evidenceDirectory, 'main-result.json', {
    evidenceSchemaVersion: 'freeflow-live-acceptance-result-v1',
    runId,
    sourceRevision,
    ...result,
  });
}

async function writeCrossTenantEvidence(result: Readonly<Record<string, unknown>>): Promise<void> {
  const evidenceDirectory = process.env.LIVE_EVIDENCE_DIR?.trim();
  if (!evidenceDirectory) return;
  await mkdir(resolve(evidenceDirectory), { recursive: true });
  await writeEvidenceJson(evidenceDirectory, 'cross-tenant-result.json', {
    evidenceSchemaVersion: 'freeflow-live-acceptance-result-v1',
    runId: evidenceRunId(),
    sourceRevision: evidenceSourceRevision(),
    ...result,
  });
  await writeEvidenceManifest(evidenceDirectory);
}

function evidenceContext(context: ConsoleContext): unknown {
  return {
    loan: { version: context.loan.version, program: context.loan.program },
    borrowers: {
      count: context.borrowers.length,
      roles: context.borrowers.map((borrower) => borrower.role),
    },
    attachments: {
      count: context.attachments.length,
      categories: context.attachments.map((attachment) => attachment.category),
      versions: context.attachments.map((attachment) => attachment.version),
      pageCounts: context.attachments.map((attachment) => attachment.pageCount),
      parserVersions: context.attachments.map((attachment) => attachment.parserVersion),
    },
    extractions: {
      count: context.extractions.length,
      statuses: context.extractions.map((extraction) => extraction.status),
      parserVersions: context.extractions.map((extraction) => extraction.parserVersion),
      schemaVersions: context.extractions.map((extraction) => extraction.schemaVersion),
      warningCounts: context.extractions.map((extraction) => extraction.warnings.length),
      metadataVersions: context.extractions.map((extraction) => extraction.metadataReview?.metadataVersion ?? null),
    },
    calculationPresent: context.calculation !== null,
    approvalCurrent: context.approval?.current ?? false,
    hostWritePresent: context.hostWrite !== null,
  };
}

function evidenceApiAudit(apiAudit: ReturnType<typeof observeApiTraffic>): unknown {
  const responsesByMethodAndStatus: Record<string, number> = {};
  for (const response of apiAudit.responses) {
    const key = `${response.method}:${response.status}`;
    responsesByMethodAndStatus[key] = (responsesByMethodAndStatus[key] ?? 0) + 1;
  }
  return {
    responseCount: apiAudit.responses.length,
    responsesByMethodAndStatus,
    failureCount: apiAudit.failures.length,
    encompassRequestCount: apiAudit.responses.filter((response) => response.path.toLowerCase().includes('encompass')).length,
  };
}

async function writeEvidenceManifest(directory: string): Promise<void> {
  const expectedArtifacts = [
    'approved-income.json',
    'approved-income.mismo.xml',
    'approved-income-summary.pdf',
    'cross-tenant-result.json',
    'main-result.json',
    'processing-validation-report.json',
  ] as const;
  const actualArtifacts = (await readdir(resolve(directory))).sort();
  expect(actualArtifacts).toEqual([...expectedArtifacts].sort());

  const artifacts = await Promise.all(expectedArtifacts.map(async (name) => {
    const bytes = await readFile(resolve(directory, name));
    try {
      return { name, bytes: bytes.length, sha256: digest(bytes) };
    } finally {
      bytes.fill(0);
    }
  }));
  const sourceFiles = [
    ['liveSpec', fileURLToPath(import.meta.url)],
    ['playwrightConfig', fileURLToPath(new URL('../playwright.live.config.ts', import.meta.url))],
    ['localGateway', fileURLToPath(new URL('./local-live-gateway.mjs', import.meta.url))],
    ['tenantBootstrap', fileURLToPath(new URL('./two-tenant-bootstrap.sql', import.meta.url))],
    ['fixtureGenerator', fileURLToPath(new URL('../../../services/doc-parser/tests/paystub_fixtures.py', import.meta.url))],
    ['dependencyLock', fileURLToPath(new URL('../../../pnpm-lock.yaml', import.meta.url))],
  ] as const;
  const sourceFingerprints = Object.fromEntries(await Promise.all(sourceFiles.map(async ([name, path]) => {
    const bytes = await readFile(path);
    return [name, { sha256: digest(bytes), bytes: bytes.length }];
  })));

  await writeEvidenceJson(directory, 'artifact-manifest.json', {
    evidenceSchemaVersion: 'freeflow-live-acceptance-manifest-v1',
    runId: evidenceRunId(),
    sourceRevision: evidenceSourceRevision(),
    fixtureSha256: SYNTHETIC_PAYSTUB_SHA256,
    loanIdentifierClassification: 'SYNTHETIC_TEST_ONLY',
    businessApiMocked: false,
    rawDocumentPersisted: false,
    rawOcrPersisted: false,
    artifacts,
    sourceFingerprints,
  });
}

async function verifyEvidenceBoundary(): Promise<void> {
  const evidenceDirectory = process.env.LIVE_EVIDENCE_DIR?.trim();
  if (!evidenceDirectory) return;

  const sourceRevision = evidenceSourceRevision();
  const head = gitOutput(['rev-parse', 'HEAD']);
  if (head !== sourceRevision) {
    throw new Error(`LIVE_SOURCE_REVISION does not match local HEAD (${head}).`);
  }
  const status = gitOutput(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status) throw new Error('Live evidence requires a clean Git worktree.');

  const directory = resolve(evidenceDirectory);
  await mkdir(directory, { recursive: true });
  const actual = (await readdir(directory)).sort();
  const expected = PHASE === 'cross-tenant'
    ? [
        'approved-income.json',
        'approved-income.mismo.xml',
        'approved-income-summary.pdf',
        'main-result.json',
        'processing-validation-report.json',
      ].sort()
    : [];
  expect(actual).toEqual(expected);
}

function gitOutput(arguments_: string[]): string {
  const result = spawnSync('git', arguments_, {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Unable to verify the Git source boundary for live evidence.');
  }
  return String(result.stdout).trim();
}

async function writeEvidenceJson(directory: string, name: string, value: unknown): Promise<void> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await writeEvidenceFile(directory, name, bytes);
  } finally {
    bytes.fill(0);
  }
}

async function writeEvidenceFile(directory: string, name: string, bytes: Buffer): Promise<void> {
  await writeFile(resolve(directory, name), bytes, { flag: 'wx', mode: 0o600 });
}

function evidenceSourceRevision(): string {
  const revision = requiredEnvironment('LIVE_SOURCE_REVISION');
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('LIVE_SOURCE_REVISION must be a lowercase 40-character Git commit SHA.');
  }
  return revision;
}

function evidenceRunId(): string {
  const runId = requiredEnvironment('LIVE_EVIDENCE_RUN_ID');
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(runId)) {
    throw new Error('LIVE_EVIDENCE_RUN_ID must contain only letters, numbers, dot, underscore, or hyphen.');
  }
  return runId;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for this live acceptance phase.`);
  return value;
}

type ApprovedIncomeJson = Readonly<{
  exportProfile: string;
  schemaVersion: string;
  snapshotHash: string;
  normalizedLoan: unknown;
  loan: { id: string; version: number; program: string; integrationMode: string };
  calculation: {
    qualifyingMonthlyIncome: string;
    totalAnnualCashFlow: string;
    components: { w2BaseMonthly: string | null; w2VariableMonthly: string | null };
    borrowers: unknown[];
  };
  provenance: { extractions: unknown[] };
}>;

type ConsoleContext = Readonly<{
  loan: { id: string; version: number; program: string };
  borrowers: Array<{ borrowerKey: string; ordinal: number; role: string }>;
  attachments: Array<{
    attachmentId: string;
    category: string;
    version: number;
    pageCount: number | null;
    parserVersion: string | null;
  }>;
  extractions: Array<{
    id: string;
    attachmentId: string;
    sourceDocumentVersion: number;
    parserVersion: string;
    schemaVersion: string;
    status: string;
    warnings: string[];
    confidence: string | number | null;
    metadataReview: { id: string; metadataVersion: number; current: boolean } | null;
  }>;
  calculation: { id: string; qualifyingMonthlyIncome: string } | null;
  approval: { id: string; current: boolean } | null;
  hostWrite: unknown | null;
}>;
