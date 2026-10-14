import { calculateUnifiedIncome, LoanProgram } from '../src/calculateForm1084Income';
import {
  calculateRetirementIncome,
  IraContinuanceDecision,
  RetirementReturnLines,
} from '../../../apps/underwriting-console/src/retirementIncome';

const lines: RetirementReturnLines = {
  year: 2025,
  iraTotal: 24000,
  iraTaxable: 18000,
  pensionTotal: 30000,
  pensionTaxable: 27000,
  ssTotal: 26400,
  ssTaxable: 22440,
};

describe('Retirement tab matches the Form 1084 engine', () => {
  test.each([
    ['CONVENTIONAL', 'CONFIRMED_GROSS_UP'],
    ['FHA', 'CONFIRMED_GROSS_UP'],
    ['VA', 'CONFIRMED'],
    ['USDA', 'NOT_CONFIRMED'],
    ['FHA', null],
  ] as const)('%s with IRA decision %s', (program, decision: IraContinuanceDecision | null) => {
    const tab = calculateRetirementIncome(lines, { iraAccountBalance: 400000, iraContinuance: decision }, program);
    const engine = calculateUnifiedIncome({
      loanProgram: program as LoanProgram,
      benefits: [{
        year: 2025,
        totalSocialSecurity: lines.ssTotal,
        taxableSocialSecurity: lines.ssTaxable,
        totalPensionsAndAnnuities: lines.pensionTotal,
        taxablePensionsAndAnnuities: lines.pensionTaxable,
      }],
      iraDistributions: [{
        year: 2025,
        totalDistributions: lines.iraTotal,
        taxableDistributions: lines.iraTaxable,
        accountBalance: 400000,
        hasThreeYearContinuance: decision === 'CONFIRMED' || decision === 'CONFIRMED_GROSS_UP',
        grossUpNonTaxable: decision === 'CONFIRMED_GROSS_UP',
      }],
    });
    const benefit = engine.benefitsBreakdown[0];
    expect(tab.socialSecurityMonthly).toBeCloseTo(benefit.qualifyingSocialSecurity / 12, 2);
    expect(tab.pensionMonthly).toBeCloseTo(benefit.qualifyingPensionsAndAnnuities / 12, 2);
    expect(tab.ira?.qualifyingMonthly).toBe(engine.iraDistributionBreakdown?.qualifyingMonthlyIncome);
    expect(tab.ira?.monthsOfContinuance).toBe(engine.iraDistributionBreakdown?.monthsOfContinuance);
    expect(tab.socialSecurityMonthly + tab.retirementIncomeMonthly).toBeCloseTo(engine.summary.qualifyingMonthlyIncome, 2);
  });
});
