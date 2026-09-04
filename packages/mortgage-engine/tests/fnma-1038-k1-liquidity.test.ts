import { calculateUnifiedIncome, UnifiedIncomeCalculationPayload } from '../src/calculateForm1084Income';

describe('FNMA 1038 rental cash flow and K-1 Schedule L liquidity', () => {
  test('1038 uses Line 21 plus add-backs (9/12/16/18/19) and does not rebuild expenses', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      scheduleEProperties: [
        {
          year: 2025,
          propertyAddress: '742 Evergreen Terrace',
          propertyType: 'RENTAL',
          rentsReceived: 24000,
          totalExpenses: 14500,
          netIncomeLoss: 9500,
          insurance: 1200,
          mortgageInterest: 4800,
          taxes: 2900,
          depreciation: 3500,
          hoaDues: 0,
          extraordinaryAddBack: 600,
        },
      ],
    };

    // L21 9,500 + L9 1,200 + L12 4,800 + L16 2,900 + L18 3,500 + extra 600 = 22,500 / 12
    const result = calculateUnifiedIncome(payload);
    expect(result.summary.qualifyingMonthlyIncome).toBe(1875);
    expect(result.scheduleEPropertiesBreakdown?.[0].totalCashFlow).toBe(22500);
  });

  test('S-Corp ≥25% liquidity fail zeroes K-1 and keeps officer W-2', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      form1120S: [
        {
          year: 2025,
          ownershipPercentage: 35,
          w2WagesFromBusiness: 48000,
          k1OrdinaryIncome: 142000,
          depreciation: 18500,
          k1Distributions: 62000,
          hasStableDistributions: true,
          scheduleL: {
            cash: 1000,
            accountsReceivable: 0,
            accountsPayable: 80000,
            notesPayableLt1Yr: 20000,
          },
        },
      ],
    };

    const result = calculateUnifiedIncome(payload);
    expect(result.form1120SBreakdown?.[0].k1EligibleIncome).toBe(0);
    expect(result.form1120SBreakdown?.[0].w2WagesFromBusiness).toBe(48000);
    expect(result.summary.qualifyingMonthlyIncome).toBe(4000);
    expect(result.warnings.some((w) => w.code === 'SCORP_LIQUIDITY_FAILED')).toBe(true);
  });

  test('Partnership uses Freddie ending profit % when gseInvestor is FREDDIE', () => {
    const payload: UnifiedIncomeCalculationPayload = {
      loanProgram: 'CONVENTIONAL',
      gseInvestor: 'FREDDIE',
      form1065: [
        {
          year: 2025,
          ownershipPercentage: 50,
          profitPercentageEnd: 20,
          capitalPercentageEnd: 50,
          k1OrdinaryIncome: 40000,
          k1GuaranteedPayments: 24000,
          k1Distributions: 6000,
          hasStableDistributions: false,
        },
      ],
    };

    const result = calculateUnifiedIncome(payload);
    // 20% < 25% → minority: (40000 * 0.20) capped at 6000 distributions + 24000 GP
    expect(result.form1065Breakdown?.[0].ownershipPercentage).toBe(20);
    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(6000);
    expect(result.summary.qualifyingMonthlyIncome).toBe(2500);
    expect(result.warnings.some((w) => w.code === 'PARTNERSHIP_MINORITY_K1_INCOME')).toBe(true);
  });
});
