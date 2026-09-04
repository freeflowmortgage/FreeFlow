import {
  calculateUnifiedIncome,
  LoanProgram,
  UnifiedIncomeCalculationPayload
} from './calculateForm1084Income';
import {
  processUsdaStandaloneCalculationV2,
  UsdaEngineInput
} from './usda-projected-income-engine-v2';

type NonUsdaProgram = Exclude<LoanProgram, 'USDA'>;

export type IncomeCalculationDispatchRequest =
  | {
      loanProgram: 'USDA';
      usdaInput: UsdaEngineInput;
    }
  | {
      loanProgram: NonUsdaProgram;
      form1084Input: Omit<UnifiedIncomeCalculationPayload, 'loanProgram'>;
    };

type UsdaDispatchRequest = Extract<IncomeCalculationDispatchRequest, { loanProgram: 'USDA' }>;
type Form1084DispatchRequest = Exclude<IncomeCalculationDispatchRequest, { loanProgram: 'USDA' }>;
type UsdaDispatchResult = {
  engine: 'USDA_STANDALONE';
  result: ReturnType<typeof processUsdaStandaloneCalculationV2>;
};
type Form1084DispatchResult = {
  engine: 'FORM_1084';
  result: ReturnType<typeof calculateUnifiedIncome>;
};

/**
 * Program boundary for income calculations. USDA is deliberately routed to
 * its prospective repayment/household dual-track engine and can never fall
 * through to the retrospective Form 1084 trending calculation.
 */
export function dispatchIncomeCalculation(request: UsdaDispatchRequest): UsdaDispatchResult;
export function dispatchIncomeCalculation(request: Form1084DispatchRequest): Form1084DispatchResult;
export function dispatchIncomeCalculation(
  request: IncomeCalculationDispatchRequest
): UsdaDispatchResult | Form1084DispatchResult {
  if (request.loanProgram === 'USDA') {
    return {
      engine: 'USDA_STANDALONE' as const,
      result: processUsdaStandaloneCalculationV2(request.usdaInput)
    };
  }

  return {
    engine: 'FORM_1084' as const,
    result: calculateUnifiedIncome({
      ...request.form1084Input,
      loanProgram: request.loanProgram
    })
  };
}

export const calculateIncomeForProgram = dispatchIncomeCalculation;
