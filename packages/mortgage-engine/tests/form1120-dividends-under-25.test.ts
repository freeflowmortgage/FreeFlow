import { calculateUnifiedIncome, UnifiedIncomeCalculationPayload } from '../src/calculateForm1084Income';

describe('Form 1120 C-Corporation Dividend-Stacking Test Suite', () => {
  
  test('Minority Shareholder (< 25%): Should stack borrower dividends directly on top of W-2 wages', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1120: [
        {
          year: 2025,
          ownershipPercentage: 10, // Under 25% threshold
          w2WagesFromCorporate: 80000, // $6,666.67/mo base
          taxableIncome: 500000, // Large corporate income
          totalTaxPaid: 105000,
          cash: 10000,
          currentLiabilities: 50000, // Failed balance sheet liquidity
          monthsInBusiness: 12,
          borrowerDividendsReceived: 12000 // $1,000/mo in direct dividends
        },
        {
          year: 2024,
          ownershipPercentage: 10,
          w2WagesFromCorporate: 80000,
          taxableIncome: 450000,
          totalTaxPaid: 94500,
          cash: 10000,
          currentLiabilities: 50000,
          monthsInBusiness: 12,
          borrowerDividendsReceived: 12000
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);

    // Expected:
    // Annual total = W-2 ($80,000) + Dividends ($12,000) = $92,000 per year
    // Two years = $184,000 / 24 months = $7,666.67 monthly qualifying income
    // Corporate liquidity failure (Quick Ratio = 0.20) should be ignored because ownership < 25%
    expect(results.summary.qualifyingMonthlyIncome).toBe(7666.67);
    expect(results.warnings.length).toBe(0); // No liquidity lockout warnings for minority shares
    expect(results.form1120Breakdown?.[0].borrowerDividendsReceived).toBe(12000);
    expect(results.form1120Breakdown?.[0].quickRatio).toBeNull();
  });

  test('Self-Employed Owner (≥ 25%): Should stack dividends AND corporate adjustments (if liquidity passes)', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1120: [
        {
          year: 2025,
          ownershipPercentage: 30, // Self-employed boundary (>= 25%)
          w2WagesFromCorporate: 100000, // $8,333.33/mo base
          taxableIncome: 200000,
          totalTaxPaid: 40000,
          depreciation: 10000,
          cash: 150000, // High liquidity
          currentLiabilities: 50000, // Quick Ratio = 3.0 (Passes)
          monthsInBusiness: 12,
          borrowerDividendsReceived: 24000 // $2,000/mo dividends
        },
        {
          year: 2024,
          ownershipPercentage: 30,
          w2WagesFromCorporate: 100000,
          taxableIncome: 200000,
          totalTaxPaid: 40000,
          depreciation: 10000,
          cash: 150000,
          currentLiabilities: 50000,
          monthsInBusiness: 12,
          borrowerDividendsReceived: 24000
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);

    // Expected calculation per year:
    // W-2: $100,000
    // Dividends: $24,000
    // Corp Adjustments: (Taxable $200k - Tax $40k + Depr $10k) * 30% = $170k * 0.3 = $51,000
    // Total cash flow per year = $100,000 (W2) + $24,000 (Dividends) + $51,000 (Corp share) = $175,000
    // Monthly qualifying = $175,000 / 12 = $14,583.33
    expect(results.summary.qualifyingMonthlyIncome).toBe(14583.33);
    expect(results.warnings.length).toBe(0); // Liquidity passed, no warning
    expect(results.form1120Breakdown?.[0].passesLiquidity).toBe(true);
  });

  test('Self-Employed Owner (≥ 25%): Should stack dividends but LOCK OUT corporate adjustments if liquidity fails', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1120: [
        {
          year: 2025,
          ownershipPercentage: 30,
          w2WagesFromCorporate: 100000,
          taxableIncome: 200000,
          totalTaxPaid: 40000,
          depreciation: 10000,
          cash: 10000, // Low liquidity
          currentLiabilities: 50000, // Quick Ratio = 0.2 (Fails)
          monthsInBusiness: 12,
          borrowerDividendsReceived: 24000
        },
        {
          year: 2024,
          ownershipPercentage: 30,
          w2WagesFromCorporate: 100000,
          taxableIncome: 200000,
          totalTaxPaid: 40000,
          depreciation: 10000,
          cash: 10000,
          currentLiabilities: 50000,
          monthsInBusiness: 12,
          borrowerDividendsReceived: 24000
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);

    // Expected calculation per year:
    // Quick Ratio = 0.20 (< 1.0) -> PassesLiquidity = false
    // Corporate additions are locked out ($0.00)
    // Qualifying income stacks only: W-2 ($100k) + Dividends ($24k) = $124,000 per year
    // Monthly qualifying = $124,000 / 12 = $10,333.33
    expect(results.summary.qualifyingMonthlyIncome).toBe(10333.33);
    expect(results.warnings.some(w => w.code === 'CORPORATE_LIQUIDITY_FAILED')).toBe(true);
  });

});
