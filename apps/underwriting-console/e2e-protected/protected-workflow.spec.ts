import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const LOAN = '00000000-0000-4000-8000-000000000200';
const EXTRACTION = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000400';
const APPROVAL = '00000000-0000-4000-8000-000000000500';
const WRITE = '00000000-0000-4000-8000-000000000600';

test('protected product cards expose only explicitly enabled synthetic demos', async ({ page }) => {
  const productCalls: string[] = [];
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: {
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' },
    syntheticProductDemos: { enabled: true },
  } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/intake/') || path.startsWith('/api/appraisal/')) productCalls.push(path);
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true } });
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: context('bound') });
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/');
  await page.getByTestId('service-1003').click();
  await expect(page.getByTestId('ai-1003-workspace')).toBeVisible();
  await expect(page.getByTestId('ai-1003-synthetic-banner')).toContainText('no lead or LOS delivery');
  expect(productCalls).toEqual([]);

  await page.getByRole('button', { name: 'Back to products' }).click();
  await page.getByTestId('service-appraisal').click();
  await expect(page.getByTestId('appraisal-workspace')).toBeVisible();
  await expect(page.getByTestId('appraisal-synthetic-banner')).toContainText('upload, parser, and LOS sync disabled');
  await expect(page.getByText('Upload PDF')).toHaveCount(0);
  expect(productCalls).toEqual([]);
});

test('protected product cards fail closed when synthetic demos are disabled', async ({ page }) => {
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: {
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' },
    syntheticProductDemos: { enabled: false },
  } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true } });
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: context('bound') });
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/');
  await page.getByTestId('service-1003').click();
  await expect(page.getByTestId('protected-product-unavailable')).toBeVisible();
  await expect(page.getByTestId('protected-workflow')).toHaveCount(0);
});

test('Income demo is isolated from protected APIs and can return to the product landing page', async ({ page }) => {
  const protectedApiCalls: string[] = [];
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    protectedApiCalls.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 500, json: { error: { code: 'DEMO_MUST_NOT_CALL_PROTECTED_API' } } });
  });

  await page.goto('/?demo=income');
  await expect(page.getByTestId('protected-income-demo')).toBeVisible();
  await expect(page.getByText('Income Intelligence · original synthetic demonstration')).toBeVisible();
  await expect(page.getByText(/Loading the Earnings statement source document failed/)).toHaveCount(0);
  await page.locator('[data-qa-field="ps-hourly-rate"]').first().click();
  await expect(page.getByTestId('pdf-highlight')).toBeVisible();
  await page.getByRole('button', { name: 'Reconcile' }).click();
  await expect(page.getByRole('button', { name: 'Sync' })).toBeVisible();
  expect(protectedApiCalls).toEqual([]);
  await page.getByTestId('demo-back-to-products').click();
  await expect(page.getByTestId('b2b-landing')).toBeVisible();
  await expect(page.getByTestId('enter-income-demo')).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('enter-income-demo').click();
  const demoPage = await popupPromise;
  await expect(demoPage.getByTestId('protected-income-demo')).toBeVisible();
  expect(new URL(demoPage.url()).searchParams.get('demo')).toBe('income');
  await demoPage.close();
});

test('Income comparison accepts a private PDF preview and highlights its parser box', async ({ page }) => {
  const previewCalls: Array<{ path: string; contentType: string | undefined }> = [];
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/income-document-preview') {
      previewCalls.push({ path, contentType: request.headers()['content-type'] });
      return route.fulfill({ json: {
        transaction_id: 'preview-w2', total_pages_scanned: 1, pages_extracted_count: 1,
        extracted_page_indices: [0], ocr_page_count: 1, has_business_returns: false,
        flags: [], classifications: { '0': ['W-2'] }, unresolved_statements: [],
        pages: [{ index: 0, formIds: ['W-2'], isNativeText: false, meanConfidence: 99, skewDegrees: 0, words: [], flags: [] }],
        w2Extracts: [{
          pageIndex: 0, year: 2025, employerName: 'Synthetic Preview Employer', ein: '00-0000000',
          box1: 95000, box2: 0, box3: 95000, box4: 0, box5: 96000, box6: 0,
          boxes: { box5: { x: 0.11, y: 0.22, w: 0.33, h: 0.044 } },
        }],
      } });
    }
    return route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/?demo=income');
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  await page.getByTestId('live-pdf-input').setInputFiles({
    name: 'my-w2.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.getByTitle('my-w2.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Wages', exact: true }).click();
  await page.locator('[data-qa-field="w2-box5"]').first().click();
  // W-2 grid boxes are narrowed to the right-aligned amount cell before display.
  await expect(page.getByTestId('pdf-highlight')).toHaveAttribute('data-box', '0.36,0.22,0.08,0.018');
  expect(previewCalls).toEqual([{ path: '/api/v1/income-document-preview', contentType: 'application/pdf' }]);
});

test('protected Income appends multiple uploaded PDFs to Nate\'s document workspace', async ({ page }) => {
  const attachmentIds: string[] = [];
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: { testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001' } } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true } });
    if (path === `/api/v1/loans/${LOAN}/income-documents`) {
      const attachmentId = `upload-${attachmentIds.length + 1}`;
      attachmentIds.push(attachmentId);
      return route.fulfill({ status: 201, json: { source: 'UPLOAD', attachmentId, status: 'PROCESSED' } });
    }
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: multiUploadContext(attachmentIds) });
    if (path.endsWith('/metadata-requirements')) return route.fulfill({ json: { extractionId: path.includes('extraction-2') ? 'extraction-2' : 'extraction-1', status: 'ACTIVE', review: null, requirements: [] } });
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  const first = await PDFDocument.create(); first.addPage([612, 792]);
  const second = await PDFDocument.create(); second.addPage([612, 792]);
  await page.getByTestId('protected-pdf-input').setInputFiles([
    { name: 'w2.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await first.save()) },
    { name: 'schedule-c.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await second.save()) },
  ]);
  await page.getByTestId('upload-pdf').click();
  await expect(page.getByTestId('authenticated-income-workspace')).toBeVisible();
  await expect.poll(() => attachmentIds.length).toBe(2);
  await page.getByRole('button', { name: 'Wages', exact: true }).click();
  await expect(page.getByTitle('w2.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Sch C', exact: true }).click();
  await expect(page.getByTitle('schedule-c.pdf')).toBeVisible();
});

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
  await expect(page.getByTestId('authenticated-income-workspace')).toBeVisible();
  await expect(page.getByTestId('protected-workspace-banner')).toContainText('persisted authoritative calculation');
  await page.getByTestId('authoritative-workflow-tab').click();
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
  await page.getByTestId('back-to-products').click();
  await expect(page.getByTestId('b2b-landing')).toBeVisible();
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
  await page.getByTestId('authoritative-workflow-tab').click();
  await expect(page.getByTestId('calculate-income')).toBeDisabled();
  await expect(page.getByTestId('approve-income')).toBeDisabled();
  await expect(page.getByTestId('write-host')).toBeDisabled();
});

test('TB-01 through TB-12 two-borrower hosted path assigns both documents and writes once', async ({ page }) => {
  let stage: 'bound' | 'pulled' | 'reviewed' | 'calculated' | 'approved' | 'written' = 'bound';
  let fieldMapRequests = 0;
  const bodies: Array<{ path: string; body: unknown }> = [];
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: {
    testHost: {
      enabled: true,
      loanGuid: '00000000-0000-4000-8000-00000000d001',
      borrowers: [
        { borrowerKey: 'borrower-1', role: 'PRIMARY' },
        { borrowerKey: 'borrower-2', role: 'CO_BORROWER' },
      ],
    },
  } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if ((request.headers()['content-type'] ?? '').includes('application/json')) bodies.push({ path, body: request.postDataJSON() });
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true, borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }, { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' }] } });
    if (path === `/api/v1/loans/${LOAN}/encompass-attachments`) return route.fulfill({ json: { source: 'ENCOMPASS', attachments: [{ id: 'w2-b1', status: 'SELECTABLE' }, { id: 'w2-b2', status: 'SELECTABLE' }] } });
    if (path === `/api/v1/loans/${LOAN}/encompass-document-pulls`) { stage = 'pulled'; return route.fulfill({ status: 202, json: { jobId: 'pull-1', status: 'QUEUED' } }); }
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: twoBorrowerContext(stage) });
    if (path.endsWith('/metadata-requirements')) return route.fulfill({ json: { extractionId: EXTRACTION, status: 'ACTIVE', review: null, requirements: stage === 'pulled' ? twoBorrowerRequirements() : [] } });
    if (path.endsWith('/metadata-reviews')) { stage = 'reviewed'; return route.fulfill({ status: 201, json: { reviewId: 'review-1', extractionId: EXTRACTION, metadataVersion: 1, loanVersion: 3 } }); }
    if (path === '/api/income/calculate') { stage = 'calculated'; return route.fulfill({ json: { success: true, loanId: LOAN, calculationId: CALCULATION, calculatedMonthlyIncome: 14000, trendingResult: 'SINGLE_YEAR', borrowers: [{ borrowerKey: 'borrower-1', qualifyingMonthlyIncome: '8000.00' }, { borrowerKey: 'borrower-2', qualifyingMonthlyIncome: '6000.00' }], extractionWarnings: [] } }); }
    if (path.endsWith('/income-approvals')) { stage = 'approved'; return route.fulfill({ status: 201, json: { auditEventId: APPROVAL, loanVersion: 4, calculationId: CALCULATION, action: 'INCOME_APPROVED' } }); }
    if (path.endsWith('/encompass-host-approval-field-map')) { fieldMapRequests += 1; return route.fulfill({ status: 201, json: { writeId: WRITE, encompassLoanGuid: '00000000-0000-4000-8000-00000000d001', fieldMapHash: 'a'.repeat(64), fields: { 'CX.FREEFLOW.INCOME': '14000.00', 'CX.FREEFLOW.BORROWER.1.INCOME': '8000.00', 'CX.FREEFLOW.BORROWER.2.INCOME': '6000.00', 'CX.FREEFLOW.APPROVAL.ID': APPROVAL }, status: 'AUTHORIZED' } }); }
    if (path === `/api/v1/encompass-host-writes/${WRITE}/complete`) { stage = 'written'; return route.fulfill({ json: { writeId: WRITE, status: 'SUCCEEDED' } }); }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.getByTestId('workflow-state')).toHaveText('BOUND');
  await page.getByTestId('authoritative-workflow-tab').click();
  await expect(page.getByTestId('borrower-roster')).toContainText('Primary borrower-1');
  await expect(page.getByTestId('borrower-roster')).toContainText('Co-borrower borrower-2');
  await expect(page.getByTestId('calculate-income')).toBeDisabled();
  await page.getByTestId('pull-documents').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('REVIEW REQUIRED');
  await expect(page.getByTestId('calculate-income')).toBeDisabled();
  const selects = page.locator('select');
  await selects.nth(0).selectOption('borrower-1');
  await selects.nth(1).selectOption('CURRENT');
  await selects.nth(2).selectOption('borrower-2');
  await selects.nth(3).selectOption('CURRENT');
  await page.getByRole('button', { name: 'Confirm reviewed metadata' }).click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO CALCULATE');
  await page.getByTestId('calculate-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('CALCULATED');
  await expect(page.getByTestId('borrower-income-borrower-1')).toContainText('8,000.00');
  await expect(page.getByTestId('borrower-income-borrower-2')).toContainText('6,000.00');
  await expect(page.getByTestId('combined-income')).toContainText('14,000.00');
  await expect(page.getByText('PAYSTUB_W2_RECONCILED')).toHaveCount(0);
  await page.getByTestId('approve-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO WRITE');
  await page.getByTestId('write-host').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('WRITTEN');
  await expect(page.getByTestId('write-host')).toBeDisabled();
  expect(fieldMapRequests).toBe(1);
  expect(bodies.find((item) => item.path === '/api/v1/encompass-host/launch')?.body).toEqual({
    encompassLoanGuid: '00000000-0000-4000-8000-00000000d001',
    borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }, { borrowerKey: 'borrower-2', role: 'CO_BORROWER' }],
  });
  expect(bodies.find((item) => item.path.endsWith('/encompass-document-pulls'))?.body).toEqual({ expectedLoanVersion: 1, attachmentIds: ['w2-b1', 'w2-b2'] });
  expect(JSON.stringify(bodies).includes('ssn')).toBe(false);
});

test('demo gate harness renders paystub and matching W-2 reconciliation, then approves and writes once', async ({ page }) => {
  // Playwright mocks the portal. Qualifying figures are the unit-harness result
  // (paystubProtectedRules / protectedIncomeSources demo gate), not a live parser
  // or Encompass run. Morning-pack PDF bytes are not opened here.
  let stage: 'bound' | 'pulled' | 'reviewed' | 'calculated' | 'approved' | 'written' = 'bound';
  let fieldMapRequests = 0;
  await page.route('**/runtime-config.json', (route) => route.fulfill({ json: {
    testHost: { enabled: true, loanGuid: '00000000-0000-4000-8000-00000000d001', borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }, { borrowerKey: 'borrower-2', role: 'CO_BORROWER' }] },
  } }));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/encompass-host/launch') return route.fulfill({ json: { loanId: LOAN, loanVersion: 1, integrationMode: 'ENCOMPASS_HOSTED', created: true, borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }, { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' }] } });
    if (path === `/api/v1/loans/${LOAN}/encompass-attachments`) return route.fulfill({ json: { source: 'ENCOMPASS', attachments: [{ id: 'paystub-b1', status: 'SELECTABLE' }, { id: 'w2-b1', status: 'SELECTABLE' }] } });
    if (path === `/api/v1/loans/${LOAN}/encompass-document-pulls`) { stage = 'pulled'; return route.fulfill({ status: 202, json: { jobId: 'pull-1', status: 'QUEUED' } }); }
    if (path === `/api/v1/loans/${LOAN}/console-context`) return route.fulfill({ json: twoBorrowerContext(stage, { combined: '21600.00', first: '5600.00', second: '16000.00' }) });
    if (path.endsWith('/metadata-requirements')) return route.fulfill({ json: { extractionId: EXTRACTION, status: 'ACTIVE', review: null, requirements: stage === 'pulled' ? demoGateRequirements() : [] } });
    if (path.endsWith('/metadata-reviews')) { stage = 'reviewed'; return route.fulfill({ status: 201, json: { reviewId: 'review-1', extractionId: EXTRACTION, metadataVersion: 1, loanVersion: 3 } }); }
    if (path === '/api/income/calculate') { stage = 'calculated'; return route.fulfill({ json: { success: true, loanId: LOAN, calculationId: CALCULATION, calculatedMonthlyIncome: 21600, trendingResult: 'SINGLE_YEAR', borrowers: [{ borrowerKey: 'borrower-1', qualifyingMonthlyIncome: '5600.00' }, { borrowerKey: 'borrower-2', qualifyingMonthlyIncome: '16000.00' }], extractionWarnings: ['PAYSTUB_W2_RECONCILED'] } }); }
    if (path.endsWith('/income-approvals')) { stage = 'approved'; return route.fulfill({ status: 201, json: { auditEventId: APPROVAL, loanVersion: 4, calculationId: CALCULATION, action: 'INCOME_APPROVED' } }); }
    if (path.endsWith('/encompass-host-approval-field-map')) { fieldMapRequests += 1; return route.fulfill({ status: 201, json: { writeId: WRITE, encompassLoanGuid: '00000000-0000-4000-8000-00000000d001', fieldMapHash: 'a'.repeat(64), fields: { 'CX.FREEFLOW.INCOME': '21600.00', 'CX.FREEFLOW.BORROWER.1.INCOME': '5600.00', 'CX.FREEFLOW.BORROWER.2.INCOME': '16000.00', 'CX.FREEFLOW.APPROVAL.ID': APPROVAL }, status: 'AUTHORIZED' } }); }
    if (path === `/api/v1/encompass-host-writes/${WRITE}/complete`) { stage = 'written'; return route.fulfill({ json: { writeId: WRITE, status: 'SUCCEEDED' } }); }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_TEST_ROUTE' } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.getByTestId('authoritative-workflow-tab').click();
  await page.getByTestId('pull-documents').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('REVIEW REQUIRED');
  const labels = page.locator('label');
  for (let index = 0; index < await labels.count(); index += 1) {
    const label = labels.nth(index);
    const text = await label.innerText();
    const select = label.locator('select');
    const input = label.locator('input');
    if (await select.count()) {
      if (text.includes('borrowerAssignment')) await select.selectOption(text.includes('Schedule') || text.includes('Form 1065') ? 'borrower-2' : 'borrower-1');
      else if (text.includes('employmentRole')) await select.selectOption('CURRENT');
      else if (text.includes('assetElection')) await select.selectOption('INCLUDE');
    } else if (await input.count()) {
      await input.fill(text.includes('elapsedMonths') ? '7.5' : '2025');
    }
  }
  await page.getByRole('button', { name: 'Confirm reviewed metadata' }).click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO CALCULATE');
  await page.getByTestId('calculate-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('CALCULATED');
  await expect(page.getByText('PAYSTUB_W2_RECONCILED')).toBeVisible();
  await expect(page.getByTestId('borrower-income-borrower-1')).toContainText('5,600.00');
  await expect(page.getByTestId('borrower-income-borrower-2')).toContainText('16,000.00');
  await expect(page.getByTestId('combined-income')).toContainText('21,600.00');
  await page.getByTestId('approve-income').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('READY TO WRITE');
  await page.getByTestId('write-host').click();
  await expect(page.getByTestId('workflow-state')).toHaveText('WRITTEN');
  await expect(page.getByTestId('write-host')).toBeDisabled();
  expect(fieldMapRequests).toBe(1);
});

function multiUploadContext(attachmentIds: readonly string[]) {
  const attachments = attachmentIds.map((attachmentId) => ({ attachmentId, category: attachmentId === 'upload-1' ? 'W2_WAGE' : 'Schedule C', version: 1, pageCount: 1, parserVersion: 'income-parser-v5' }));
  const extractions = attachmentIds.map((attachmentId, index) => index === 0 ? {
    id: 'extraction-1', attachmentId, sourceDocumentVersion: 1, parserVersion: 'income-parser-v5', schemaVersion: 'income-extraction-v2', status: 'ACTIVE', warnings: [], confidence: 99,
    normalizedInput: { w2Records: [{ entityId: 'w2-p0-0', employerName: 'Synthetic Employer', year: 2025, annualWages: 96000 }] },
    evidence: { fields: [{ collection: 'w2Extracts', index: 0, field: 'box1', pageIndex: 0, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } }] }, metadataReview: null,
  } : {
    id: 'extraction-2', attachmentId, sourceDocumentVersion: 1, parserVersion: 'income-parser-v5', schemaVersion: 'income-extraction-v2', status: 'ACTIVE', warnings: [], confidence: 99,
    normalizedInput: { formRecords: [{ entityId: 'Schedule C:business-1', form: 'Schedule C', pageIndex: 0, fields: [{ sourceFieldId: 'ent1-name', value: 'Synthetic Consulting' }, { sourceFieldId: 'ent1-net', value: '120000.00', numericValue: 120000 }] }] },
    evidence: { fields: [{ collection: 'formExtracts', entityId: 'Schedule C:business-1', field: 'ent1-net', pageIndex: 0, box: { x: 0.2, y: 0.3, w: 0.2, h: 0.03 } }] }, metadataReview: null,
  });
  return {
    loan: { id: LOAN, version: 1 + attachmentIds.length, status: attachmentIds.length ? 'DOCS_UPLOADED' : 'DRAFT', program: 'CONVENTIONAL', borrowerName: 'Synthetic Borrower' },
    borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }],
    attachments,
    extractions,
    calculation: null,
    approval: null,
    hostWrite: null,
  };
}

function demoGateRequirements() {
  return [
    { extractionId: EXTRACTION, entityId: 'paystub-1', field: 'borrowerAssignment', form: 'Paystub' },
    { extractionId: EXTRACTION, entityId: 'paystub-1', field: 'employmentRole', form: 'Paystub' },
    { extractionId: EXTRACTION, entityId: 'paystub-1', field: 'elapsedMonths', form: 'Paystub' },
    { extractionId: EXTRACTION, entityId: 'w2-b1', field: 'borrowerAssignment', form: 'W-2' },
    { extractionId: EXTRACTION, entityId: 'w2-b1', field: 'employmentRole', form: 'W-2' },
    { extractionId: EXTRACTION, entityId: 'sch-c', field: 'taxYear', form: 'Schedule C' },
    { extractionId: EXTRACTION, entityId: 'pt-1', field: 'taxYear', form: 'Form 1065' },
    { extractionId: EXTRACTION, entityId: 'schedule-e-0', field: 'borrowerAssignment', form: 'Schedule E' },
    { extractionId: EXTRACTION, entityId: 'asset-1', field: 'assetElection', form: 'Schedule B' },
  ];
}

function twoBorrowerRequirements() {
  return [
    { extractionId: EXTRACTION, entityId: 'w2-b1', field: 'borrowerAssignment', form: 'W-2' },
    { extractionId: EXTRACTION, entityId: 'w2-b1', field: 'employmentRole', form: 'W-2' },
    { extractionId: EXTRACTION, entityId: 'w2-b2', field: 'borrowerAssignment', form: 'W-2' },
    { extractionId: EXTRACTION, entityId: 'w2-b2', field: 'employmentRole', form: 'W-2' },
  ];
}

function twoBorrowerContext(stage: string, income: { combined: string; first: string; second: string } = { combined: '14000.00', first: '8000.00', second: '6000.00' }) {
  const pulled = stage !== 'bound';
  const reviewed = !['bound', 'pulled'].includes(stage);
  const calculated = ['calculated', 'approved', 'written'].includes(stage);
  const approved = ['approved', 'written'].includes(stage);
  return {
    loan: { id: LOAN, version: approved ? 4 : reviewed ? 3 : pulled ? 2 : 1, status: pulled ? 'DOCS_UPLOADED' : 'DRAFT', program: 'CONVENTIONAL', borrowerName: null },
    borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }, { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER' }],
    attachments: pulled ? [{ attachmentId: 'w2-b1', category: 'W2_WAGE', version: 1, pageCount: 1, parserVersion: 'income-parser-v5' }, { attachmentId: 'w2-b2', category: 'W2_WAGE', version: 1, pageCount: 1, parserVersion: 'income-parser-v5' }] : [],
    extractions: pulled ? [{ id: EXTRACTION, attachmentId: 'w2-b1', sourceDocumentVersion: 1, parserVersion: 'income-parser-v5', schemaVersion: 'income-extraction-v2', status: 'ACTIVE', warnings: [], confidence: 99, normalizedInput: {}, evidence: { fields: [] }, metadataReview: reviewed ? { id: 'review-1', metadataVersion: 1, assignments: [], current: true } : null }] : [],
    calculation: calculated ? { id: CALCULATION, calculatedLoanVersion: 3, qualifyingMonthlyIncome: income.combined, trendingResult: 'SINGLE_YEAR', yearsAnalyzed: [2025], current: !approved, borrowerIncome: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: income.first }, { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER', qualifyingMonthlyIncome: income.second }] } : null,
    approval: approved ? { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 3, current: true } : null,
    hostWrite: stage === 'written' ? { id: WRITE, status: 'SUCCEEDED', approvalEventId: APPROVAL, expectedLoanVersion: 4, fieldMapHash: 'a'.repeat(64), safeErrorCode: null, current: true } : null,
  };
}

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
    hostWrite: stage === 'written' ? { id: WRITE, status: 'SUCCEEDED', approvalEventId: APPROVAL, expectedLoanVersion: 4, fieldMapHash: 'a'.repeat(64), safeErrorCode: null, current: true } : null,
  };
}
