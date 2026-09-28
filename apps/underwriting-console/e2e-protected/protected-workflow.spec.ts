import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const LOAN = '00000000-0000-4000-8000-000000000200';
const EXTRACTION = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000400';
const APPROVAL = '00000000-0000-4000-8000-000000000500';
const WRITE = '00000000-0000-4000-8000-000000000600';

test('protected white workflow binds, uploads, reviews, calculates, approves, and durably writes', async ({ page }) => {
  let stage: 'bound' | 'uploaded' | 'reviewed' | 'calculated' | 'approved' | 'written' = 'bound';
  let fieldMapRequests = 0;
  const unsafeHeaders: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`));

  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: { testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' } } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = request.headers();
    for (const name of ['x-tenant-id', 'x-underwriter-id', 'x-user-role']) if (headers[name]) unsafeHeaders.push(name);
    if ((headers['content-type'] ?? '').includes('application/json')) {
      bodies.push({ path, body: request.postDataJSON() });
    }
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true } });
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: context(stage) });
    if (path === `/api/v1/loans/${LOAN}/income-documents`) { stage = 'uploaded'; return route.fulfill({ status: 201, json: { source: 'UPLOAD', attachmentId: 'upload-1', status: 'PROCESSED' } }); }
    if (path.endsWith('/metadata-requirements')) return route.fulfill({ json: { extractionId: EXTRACTION, status: 'ACTIVE', review: null, requirements: stage === 'uploaded' ? [{ extractionId: EXTRACTION, entityId: 'w2-p0-0', field: 'employmentRole', form: 'W-2' }] : [] } });
    if (path.endsWith('/metadata-reviews')) { stage = 'reviewed'; return route.fulfill({ status: 201, json: { reviewId: 'review-1', extractionId: EXTRACTION, metadataVersion: 1, loanVersion: 3 } }); }
    if (path === '/api/income/calculate') { stage = 'calculated'; return route.fulfill({ json: { success: true, loanId: LOAN, calculationId: CALCULATION, calculatedMonthlyIncome: 8000, trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING' } }); }
    if (path.endsWith('/income-approvals')) { stage = 'approved'; return route.fulfill({ status: 201, json: { auditEventId: APPROVAL, loanVersion: 4, calculationId: CALCULATION, action: 'INCOME_APPROVED' } }); }
    if (path.endsWith('/encompass-host-approval-field-map')) { fieldMapRequests += 1; return route.fulfill({ status: 201, json: { writeId: WRITE, encompassLoanGuid: '00000000-0000-4000-8000-00000000d001', fieldMapHash: 'a'.repeat(64), fields: { 'CX.FREEFLOW.INCOME': '8000.00', 'CX.FREEFLOW.APPROVAL.ID': APPROVAL }, status: 'AUTHORIZED' } }); }
    if (path === `/api/v1/encompass-host-writes/${WRITE}/complete`) { stage = 'written'; return route.fulfill({ json: { writeId: WRITE, status: 'SUCCEEDED' } }); }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  const navigation = await page.goto('/');
  const renderedBody = await page.locator('body').innerText();
  await expect(page.getByTestId('b2b-landing'), `HTTP ${navigation?.status()}; body=${renderedBody}; render errors=${pageErrors.join('; ')}; failed requests=${failedRequests.join('; ')}`).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByTestId('workflow-state')).toHaveText('BOUND');

  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]);
  await page.getByTestId('protected-pdf-input').setInputFiles({ name: 'synthetic-income.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByTestId('upload-pdf').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('REVIEW REQUIRED');
  await page.getByRole('combobox').selectOption('CURRENT');
  await page.getByRole('button', { name: 'Confirm reviewed metadata' }).click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO CALCULATE');
  await page.getByTestId('calculate-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('CALCULATED');
  await expect(page.getByText('Qualifying monthly income:')).toBeVisible();
  await page.getByTestId('approve-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO WRITE');
  await page.getByTestId('write-host').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('WRITTEN');
  await expect(page.getByTestId('write-host')).toBeDisabled();

  expect(fieldMapRequests).toBe(1);
  expect(unsafeHeaders).toEqual([]);
  expect(bodies.find((item) => item.path === '/api/income/calculate')?.body).toEqual({ loanId: LOAN, extractionIds: [EXTRACTION] });
  expect(bodies.some((item) => item.path === '/parse' || item.path === '/api/underwrite/process')).toBe(false);
});

test('protected white workflow visibly preserves a backend launch failure', async ({ page }) => {
  await page.route('**/runtime-config.json', (route) => route.fulfill({
    json: { testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' } },
  }));
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => route.fulfill({
    status: 503,
    json: { error: { code: 'HOSTED_MODE_UNAVAILABLE', message: 'Hosted mode is temporarily unavailable.' } },
  }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByRole('alert')).toHaveText('Hosted mode is temporarily unavailable. (HOSTED_MODE_UNAVAILABLE)');
  await expect(page.getByTestId('workflow-state')).toHaveText('NO LOAN CONTEXT');
  await expect(page.getByTestId('calculate-income')).toBeDisabled();
  await expect(page.getByTestId('approve-income')).toBeDisabled();
  await expect(page.getByTestId('write-host')).toBeDisabled();
});

function context(stage: string) {
  const hasUpload = stage !== 'bound';
  const reviewed = !['bound', 'uploaded'].includes(stage);
  const calculated = ['calculated', 'approved', 'written'].includes(stage);
  const approved = ['approved', 'written'].includes(stage);
  return {
    loan: { id: LOAN, version: approved ? 4 : reviewed ? 3 : hasUpload ? 2 : 1, status: hasUpload ? 'DOCS_UPLOADED' : 'DRAFT', program: 'CONVENTIONAL', borrowerName: null },
    attachments: hasUpload ? [{ attachmentId: 'upload-1', category: 'W2_WAGE', version: 1, pageCount: 1, parserVersion: 'income-parser-v5' }] : [],
    providerAttachmentListing: { available: false },
    extractions: hasUpload ? [{ id: EXTRACTION, attachmentId: 'upload-1', sourceDocumentVersion: 1, parserVersion: 'income-parser-v5', schemaVersion: 'income-extraction-v2', status: 'ACTIVE', warnings: reviewed ? [] : ['W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED'], confidence: 99, normalizedInput: { w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 96000 }] }, evidence: { fields: [{ collection: 'w2Extracts', index: 0, field: 'box1', pageIndex: 0, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } }] }, metadataReview: reviewed ? { id: 'review-1', metadataVersion: 1, assignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }], current: true } : null }] : [],
    calculation: calculated ? { id: CALCULATION, calculatedLoanVersion: 3, qualifyingMonthlyIncome: '8000', trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING', yearsAnalyzed: [2025], current: !approved } : null,
    approval: approved ? { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 3, current: true } : null,
    hostWrite: stage === 'written' ? { id: WRITE, status: 'SUCCEEDED', approvalEventId: APPROVAL, expectedLoanVersion: 4, fieldMapHash: 'a'.repeat(64), safeErrorCode: null } : null,
  };
}
