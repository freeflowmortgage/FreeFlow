import { calculateUnifiedIncome } from '../src/calculateForm1084Income';

// K-1 boxes are already the owner's share, so they count at 100%. Ownership
// applies only to the entity-level lines taken from the return itself.
describe('K-1 figures at 100%, return adjustments by ownership', () => {
  test('Partnership: 4797 gain, other income and meals removed, depreciation added, all × ownership', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      form1065: [
        {
          year: 2025,
          ownershipPercentage: 40,
          k1OrdinaryIncome: 91200,
          k1NetRentalRealEstate: 4800,
          k1GuaranteedPayments: 30000,
          gain4797: 6500,
          otherIncome: 3200,
          depreciation: 21750,
          mealsExclusion: 1850,
          hasStableDistributions: true,
        },
      ],
    });
    // K-1 96,000 + (21,750 - 1,850 - 6,500 - 3,200) × 40% = 96,000 + 4,080 = 100,080
    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(100080);
    // plus guaranteed payments at 100%
    expect(result.form1065Breakdown?.[0].totalCombinedQualifying).toBe(130080);
  });

  test('S-Corp: K-1 box 1 is not reduced by ownership', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      form1120S: [
        {
          year: 2025,
          ownershipPercentage: 50,
          w2WagesFromBusiness: 48000,
          k1OrdinaryIncome: 100000,
          depreciation: 20000,
          gain4797: 4000,
          hasStableDistributions: true,
        },
      ],
    });
    // 100,000 + (20,000 - 4,000) × 50% = 108,000
    expect(result.form1120SBreakdown?.[0].k1EligibleIncome).toBe(108000);
    expect(result.form1120SBreakdown?.[0].totalCombinedQualifying).toBe(156000);
  });

  test('Minority: K-1 as reported, no return adjustments, capped at distributions', () => {
    const result = calculateUnifiedIncome({
      loanProgram: 'CONVENTIONAL',
      form1065: [
        {
          year: 2025,
          ownershipPercentage: 10,
          k1OrdinaryIncome: 30000,
          depreciation: 50000,
          gain4797: 9000,
          k1Distributions: 45000,
          hasStableDistributions: false,
        },
      ],
    });
    expect(result.form1065Breakdown?.[0].k1EligibleIncome).toBe(30000);
  });
});
