import { test, expect } from '@playwright/test';

test.describe('Appraisal coordinate canvas', () => {
  test('layout highlights and viewport page-switching operate smoothly', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('b2b-landing')).toBeVisible();
    await page.getByTestId('service-appraisal').click();
    await expect(page.getByTestId('appraisal-workspace')).toBeVisible();
    await expect(page.getByTestId('pdf-coordinate-canvas')).toBeVisible();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 1 of 3/);

    await page.getByTestId('inspect-URAR_SUBJECT_CONTRACT').click();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 1 of 3/);
    const pageOneHighlight = page.getByTestId('pdf-highlight');
    await expect(pageOneHighlight).toBeVisible();
    await expect(pageOneHighlight).toHaveAttribute('data-page-index', '0');
    await expect(pageOneHighlight).toHaveAttribute('data-box', '12,18,76,5');

    await page.getByTestId('inspect-URAR_PHYSICAL_REPAIRS').click();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 2 of 3/);
    await expect(page.getByTestId('pdf-highlight')).toBeVisible();
    await expect(page.getByTestId('pdf-highlight')).toHaveAttribute('data-page-index', '1');

    await page.getByTestId('inspect-URAR_CRAWLSPACE_ACC_VIOLATION').click();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 3 of 3/);
    await expect(page.getByTestId('pdf-highlight')).toBeVisible();
    await expect(page.getByTestId('pdf-highlight')).toHaveAttribute('data-page-index', '2');

    await page.getByTestId('pdf-prev-page').click();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 2 of 3/);
    await expect(page.getByTestId('pdf-highlight')).toHaveCount(0);

    await page.getByTestId('pdf-next-page').click();
    await expect(page.getByTestId('pdf-page-label')).toHaveText(/Page 3 of 3/);
    await expect(page.getByTestId('pdf-highlight')).toBeVisible();

    await page.getByTestId('clear-highlight').click();
    await expect(page.getByTestId('pdf-highlight')).toHaveCount(0);
  });
});
