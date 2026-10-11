import { expect, test } from '@playwright/test';

const LOAN = '00000000-0000-4000-8000-000000000200';
const CALCULATION = '00000000-0000-4000-8000-000000000400';
const APPROVAL = '00000000-0000-4000-8000-000000000500';

test.describe('UI contract only - intercepted portal boundary', () => {
  test('manual no-LOS creation sends the v1 contract and exposes all approved downloads', async ({ page }) => {
    const calls = await interceptApprovedStandalone(page);

    await page.goto('/workspace?product=split');
    await expect(page.getByTestId('standalone-loan-intake')).toBeVisible();
    await expect(page.getByText('No Encompass, ICE, or external LOS connection is required.')).toBeVisible();
    await page.getByTestId('standalone-program').selectOption('FHA');
    await page.getByTestId('standalone-borrower-count').selectOption('2');
    await page.getByTestId('create-standalone-loan').click();

    await expect(page.getByTestId('protected-workflow')).toBeVisible();
    expect(calls.createBody).toEqual({
      schemaVersion: 'freeflow-standalone-loan-v1',
      loanProgram: 'FHA',
      borrowers: [
        { borrowerKey: 'borrower-1', role: 'PRIMARY' },
        { borrowerKey: 'borrower-2', role: 'CO_BORROWER' },
      ],
    });
    expect(calls.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls.paths.some((path) => path.includes('encompass'))).toBe(false);

    await page.getByTestId('authoritative-workflow-tab').click();
    await assertApprovedDownloads(page);
  });

  test('supported JSON import uses the same standalone API contract', async ({ page }) => {
    const calls = await interceptApprovedStandalone(page);
    const imported = {
      schemaVersion: 'freeflow-standalone-loan-v1',
      loanProgram: 'VA',
      borrowers: [
        { borrowerKey: 'borrower-1', role: 'PRIMARY' },
        { borrowerKey: 'borrower-2', role: 'CO_BORROWER' },
        { borrowerKey: 'borrower-3', role: 'CO_BORROWER' },
      ],
    } as const;

    await page.goto('/workspace?product=split');
    await page.getByTestId('import-standalone-loan').setInputFiles({
      name: 'synthetic-standalone-loan.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });

    await expect(page.getByTestId('protected-workflow')).toBeVisible();
    expect(calls.createBody).toEqual(imported);
    expect(calls.paths.some((path) => path.includes('encompass'))).toBe(false);
    await page.getByTestId('authoritative-workflow-tab').click();
    await assertApprovedDownloads(page);
  });

  test('an uncertain create retry reuses its idempotency key', async ({ page }) => {
    const idempotencyKeys: string[] = [];
    let createAttempts = 0;
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/loans' && request.method() === 'POST') {
        createAttempts += 1;
        idempotencyKeys.push(request.headers()['idempotency-key'] ?? '');
        if (createAttempts === 1) return route.abort('connectionreset');
        return route.fulfill({ status: 201, json: { loanId: LOAN, loanVersion: 1, integrationMode: 'NONE' } });
      }
      if (path === `/api/v1/loans/${LOAN}/console-context`) {
        return route.fulfill({ json: approvedContext() });
      }
      return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_UI_CONTRACT_ROUTE' } } });
    });

    await page.goto('/workspace?product=split');
    await page.getByTestId('create-standalone-loan').click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByTestId('create-standalone-loan').click();

    await expect(page.getByTestId('protected-workflow')).toBeVisible();
    expect(createAttempts).toBe(2);
    expect(idempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });
});

async function interceptApprovedStandalone(page: import('@playwright/test').Page) {
  const calls: { paths: string[]; createBody?: unknown; idempotencyKey?: string } = { paths: [] };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.paths.push(path);
    if (path === '/api/v1/loans' && request.method() === 'POST') {
      calls.createBody = request.postDataJSON();
      calls.idempotencyKey = request.headers()['idempotency-key'];
      return route.fulfill({ status: 201, json: { loanId: LOAN, loanVersion: 1, integrationMode: 'NONE' } });
    }
    if (path === `/api/v1/loans/${LOAN}/console-context`) {
      return route.fulfill({ json: approvedContext() });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_UI_CONTRACT_ROUTE' } } });
  });
  return calls;
}

async function assertApprovedDownloads(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('approved-income-exports')).toBeVisible();
  await expect(page.getByTestId('download-approved-json')).toHaveAttribute('href', `/api/v1/loans/${LOAN}/approved-income-exports/json`);
  await expect(page.getByTestId('download-approved-mismo')).toHaveAttribute('href', `/api/v1/loans/${LOAN}/approved-income-exports/mismo`);
  await expect(page.getByTestId('download-approved-summary')).toHaveAttribute('href', `/api/v1/loans/${LOAN}/approved-income-exports/summary`);
  await expect(page.getByTestId('approved-income-exports')).toContainText('official MISMO XSD validation is not performed');
}

function approvedContext() {
  return {
    loan: { id: LOAN, version: 4, status: 'DRAFT', program: 'CONVENTIONAL', borrowerName: null },
    borrowers: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY' }],
    attachments: [],
    providerAttachmentListing: { available: false },
    extractions: [],
    calculation: {
      id: CALCULATION,
      calculatedLoanVersion: 3,
      qualifyingMonthlyIncome: '8000.00',
      trendingResult: 'SINGLE_YEAR',
      yearsAnalyzed: [2025],
      current: false,
      borrowerIncome: [{ borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '8000.00' }],
    },
    approval: { id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 3, current: true },
    hostWrite: null,
  };
}
