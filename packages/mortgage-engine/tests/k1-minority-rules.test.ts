import { calculateUnifiedIncome, UnifiedIncomeCalculationPayload } from '../src/calculateForm1084Income';

describe('Form 1120-S & Form 1065 K-1 Minority (<25%) vs Self-Employed (≥25%) Suite', () => {

  test('S-Corp K-1 Minority (<25%): Uses Box 1/2/3 ordinary income with NO business add-backs and no liquidity gate, capped at distributions', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1120S: [
        {
          year: 2025,
          ownershipPercentage: 15, // <25% minority
          w2WagesFromBusiness: 60000,
          k1OrdinaryIncome: 40000,
          k1NetRentalRealEstate: 5000,
          k1OtherNetRentalIncome: 5000, // Total K-1 boxes 1-3 = $50,000, already the shareholder's share
          depreciation: 30000, // Non-cash add-back (MUST BE EXCLUDED for <25%)
          k1Distributions: 5000, // Distribution cap ($5,000 < $50,000)
          hasStableDistributions: false
        },
        {
          year: 2024,
          ownershipPercentage: 15,
          w2WagesFromBusiness: 60000,
          k1OrdinaryIncome: 40000,
          k1NetRentalRealEstate: 5000,
          k1OtherNetRentalIncome: 5000,
          depreciation: 30000,
          k1Distributions: 5000,
          hasStableDistributions: false
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);
    // Annual total = W-2 ($60,000) + Capped K-1 ($5,000) = $65,000 / yr -> $5,416.67/mo
    expect(results.summary.qualifyingMonthlyIncome).toBe(5416.67);
    expect(results.warnings.some(w => w.code === 'SCORP_MINORITY_K1_INCOME')).toBe(true);
    expect(results.form1120SBreakdown?.[0].k1EligibleIncome).toBe(5000);
  });

  test('Partnership K-1 Minority (<25%): Uses Box 1/2/3 + Guaranteed Payments with NO business add-backs, capped at distributions', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1065: [
        {
          year: 2025,
          ownershipPercentage: 20, // <25% minority
          k1OrdinaryIncome: 30000,
          k1NetRentalRealEstate: 10000, // Total K-1 1-3 = $40,000, already the partner's share
          k1GuaranteedPayments: 24000, // Always counts directly
          depreciation: 25000, // Must be excluded for minority
          k1Distributions: 6000, // Distribution cap ($6,000 < $40,000)
          hasStableDistributions: false
        },
        {
          year: 2024,
          ownershipPercentage: 20,
          k1OrdinaryIncome: 30000,
          k1NetRentalRealEstate: 10000,
          k1GuaranteedPayments: 24000,
          depreciation: 25000,
          k1Distributions: 6000,
          hasStableDistributions: false
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);
    // Annual total = Guaranteed Payments ($24,000) + Capped K-1 ($6,000) = $30,000 / yr -> $2,500.00/mo
    expect(results.summary.qualifyingMonthlyIncome).toBe(2500.00);
    expect(results.warnings.some(w => w.code === 'PARTNERSHIP_MINORITY_K1_INCOME')).toBe(true);
    expect(results.form1065Breakdown?.[0].k1EligibleIncome).toBe(6000);
  });

  test('Partnership K-1 Self-Employed (≥25%): Includes depreciation add-backs into corporate share calculation', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1065: [
        {
          year: 2025,
          ownershipPercentage: 50, // >=25% self-employed
          k1OrdinaryIncome: 40000,
          depreciation: 20000, // K-1 at 100% plus depreciation by ownership: $40k + $20k * 50% = $50,000
          k1GuaranteedPayments: 10000,
          hasStableDistributions: true
        },
        {
          year: 2024,
          ownershipPercentage: 50,
          k1OrdinaryIncome: 40000,
          depreciation: 20000,
          k1GuaranteedPayments: 10000,
          hasStableDistributions: true
        }
      ]
    };

    const results = calculateUnifiedIncome(payload);
    // Annual total = $50,000 (K-1 with add-backs) + $10,000 (GP) = $60,000 / yr -> $5,000.00/mo
    expect(results.summary.qualifyingMonthlyIncome).toBe(5000);
    expect(results.form1065Breakdown?.[0].k1EligibleIncome).toBe(50000);
  });
});
