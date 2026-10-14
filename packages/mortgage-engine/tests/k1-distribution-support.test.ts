import { calculateUnifiedIncome, UnifiedIncomeCalculationPayload } from '../src/calculateForm1084Income';

// A recorded distribution history is evidence only up to what the K-1 says was
// distributed. Taking the flag at face value let a business whose distributions
// fell well short of its income qualify on the full share with nothing said.
describe('distribution history checked against the income it is meant to support', () => {
  const partnership = (
    overrides: Partial<NonNullable<UnifiedIncomeCalculationPayload['form1065']>[number]> = {},
  ): UnifiedIncomeCalculationPayload => ({
    loanProgram: 'CONVENTIONAL',
    form1065: [
      {
        year: 2025,
        ownershipPercentage: 50,
        k1OrdinaryIncome: 120000,
        depreciation: 20000,
        hasStableDistributions: true,
        ...overrides,
      },
    ],
  });

  // K-1 120,000 + depreciation 20,000 × 50% = 130,000 of business income.
  const BUSINESS_INCOME = 130000;

  test('distributions short of the income are capped when no Schedule L was filed', () => {
    const result = calculateUnifiedIncome(partnership({ k1Distributions: 30000 }));

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(30000);
    expect(result.form1065Breakdown?.[0].distributionShortfall).toBe(true);
    expect(result.form1065Breakdown?.[0].distributionsReported).toBe(30000);
    const warning = result.warnings.find((w) => w.code === 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME');
    expect(warning?.message).toContain('no Schedule L');
    expect(warning?.message).toContain('$30000.00');
  });

  test('a passing Schedule L carries the shortfall, and says so', () => {
    const result = calculateUnifiedIncome(
      partnership({
        k1Distributions: 30000,
        scheduleL: { cash: 200000, accountsPayable: 50000 },
      }),
    );

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(BUSINESS_INCOME);
    expect(result.form1065Breakdown?.[0].distributionShortfall).toBe(true);
    const warning = result.warnings.find((w) => w.code === 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME');
    expect(warning?.message).toContain('quick ratio of 4.00');
    expect(warning?.message).toContain('$100000.00 shortfall');
  });

  test('distributions that cover the income raise nothing', () => {
    const result = calculateUnifiedIncome(partnership({ k1Distributions: 150000 }));

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(BUSINESS_INCOME);
    expect(result.form1065Breakdown?.[0].distributionShortfall).toBe(false);
    expect(result.warnings.some((w) => w.code === 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME')).toBe(false);
  });

  test('an unread distributions box contradicts nothing and is not treated as zero', () => {
    const result = calculateUnifiedIncome(partnership());

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(BUSINESS_INCOME);
    expect(result.form1065Breakdown?.[0].distributionsReported).toBeNull();
    expect(result.form1065Breakdown?.[0].distributionShortfall).toBe(false);
  });

  test('a failing Schedule L still locks the business out before distributions are weighed', () => {
    const result = calculateUnifiedIncome(
      partnership({
        k1Distributions: 30000,
        scheduleL: { cash: 1000, accountsPayable: 90000 },
      }),
    );

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(0);
    expect(result.warnings.some((w) => w.code === 'PARTNERSHIP_LIQUIDITY_FAILED')).toBe(true);
  });

  test('under 25% there is no liquidity route, so the cap stands', () => {
    const result = calculateUnifiedIncome(
      partnership({
        ownershipPercentage: 10,
        k1OrdinaryIncome: 40000,
        k1Distributions: 6000,
        scheduleL: { cash: 200000, accountsPayable: 50000 },
      }),
    );

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(6000);
    expect(result.warnings.some((w) => w.code === 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME')).toBe(true);
  });

  test('the under-25% notice no longer claims a cap it did not apply', () => {
    const result = calculateUnifiedIncome(
      partnership({ ownershipPercentage: 10, k1OrdinaryIncome: 40000, k1Distributions: 90000 }),
    );

    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(40000);
    const warning = result.warnings.find((w) => w.code === 'PARTNERSHIP_MINORITY_K1_INCOME');
    expect(warning?.message).not.toContain('capped at distributions');
  });

  test('an S-Corporation is held to the same test', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      form1120S: [
        {
          year: 2025,
          ownershipPercentage: 40,
          w2WagesFromBusiness: 48000,
          k1OrdinaryIncome: 100000,
          depreciation: 20000,
          k1Distributions: 25000,
          hasStableDistributions: true,
        },
      ],
    });

    // K-1 100,000 + depreciation 20,000 × 40% = 108,000, capped at the 25,000 distributed.
    expect(result.form1120SBreakdown?.[0].k1EligibleIncome).toBe(25000);
    expect(result.form1120SBreakdown?.[0].distributionShortfall).toBe(true);
    const warning = result.warnings.find((w) => w.code === 'SCORP_DISTRIBUTIONS_BELOW_INCOME');
    expect(warning?.message).toContain('Box 16D');
  });
});
