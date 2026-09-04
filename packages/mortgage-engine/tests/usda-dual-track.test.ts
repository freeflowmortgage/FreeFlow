import {
  processUsdaStandaloneCalculationV2,
  UsdaEngineInput
} from '../src/usda-projected-income-engine-v2';
import { calculateUsdaEligibility } from '../src/usda-ssi-rules-engine';
import { dispatchIncomeCalculation } from '../src/income-calculation-dispatcher';

const usdaInput: UsdaEngineInput = {
  loanId: 'loan-usda-1',
  countyMedianIncomeLimit: 120000,
  householdMembers: [
    {
      name: 'Borrower',
      age: 40,
      isBorrower: true,
      isSpouse: false,
      isFullTimeStudent: false,
      earnedIncomeMonthly: 5000,
      unearnedIncomeMonthly: 0,
      selfEmploymentBusinesses: [
        {
          type: 'SCHEDULE_C',
          entityId: 'consulting',
          businessName: 'Borrower Consulting',
          netProfitLoss: 30000,
          depreciation: 10000,
          businessUseOfHome: 2000,
          mealsExclusion: 1000
        },
        {
          type: 'SCHEDULE_F',
          entityId: 'farm',
          businessName: 'Borrower Farm',
          netFarmProfitLoss: 20000,
          nonTaxPortionOngoingCoopAndCccPayments: 3000,
          nonrecurringOtherIncomeLoss: -2000,
          depreciation: 8000,
          amortizationCasualtyLossDepletion: 1000,
          businessUseOfHome: 1000
        }
      ]
    },
    {
      name: 'Adult household member',
      age: 30,
      isBorrower: false,
      isSpouse: false,
      isFullTimeStudent: false,
      earnedIncomeMonthly: 1000,
      unearnedIncomeMonthly: 0
    }
  ],
  bankTransactions: []
};

describe('canonical USDA dual-track engine', () => {
  test('sums multiple businesses and applies Schedule F add-backs only to repayment', () => {
    const result = processUsdaStandaloneCalculationV2(usdaInput);

    expect(result.repaymentIncomeMonthly).toBe(11000);
    expect(result.annualHouseholdIncome).toBe(123000);
    expect(result.adjustedAnnualIncome).toBe(123000);
    expect(result.isEligibleByIncome).toBe(false);
    expect(result.selfEmploymentBreakdowns).toEqual([
      expect.objectContaining({
        type: 'SCHEDULE_C',
        entityId: 'consulting',
        repaymentAnnualIncome: 41000,
        householdEligibilityAnnualIncome: 30000
      }),
      expect.objectContaining({
        type: 'SCHEDULE_F',
        entityId: 'farm',
        repaymentAnnualIncome: 31000,
        householdEligibilityAnnualIncome: 21000
      })
    ]);
  });

  test('dispatcher cannot route USDA through generic Form 1084 trending', () => {
    const dispatched = dispatchIncomeCalculation({
      loanProgram: 'USDA',
      usdaInput
    });

    expect(dispatched.engine).toBe('USDA_STANDALONE');
    expect(dispatched.result).toEqual(processUsdaStandaloneCalculationV2(usdaInput));
  });

  test('legacy USDA export delegates to canonical behavior', () => {
    const result = calculateUsdaEligibility({
      countyMedianIncomeLimit: 100000,
      householdMembers: [
        {
          name: 'Legacy borrower',
          age: 42,
          isBorrower: true,
          w2IncomeMonthly: 4000,
          selfEmployment: {
            netProfitLoss: 24000,
            depreciation: 6000,
            businessUseOfHome: 1200,
            mealsExclusion: 200
          }
        }
      ],
      bankTransactions: []
    });

    expect(result.repaymentIncomeMonthly).toBe(6583.333333333333);
    expect(result.annualHouseholdIncome).toBe(72000);
    expect(result.isEligibleByIncome).toBe(true);
  });
});
