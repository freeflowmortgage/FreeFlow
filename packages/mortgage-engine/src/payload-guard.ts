import { LoanProgram, WarningMessage, GeneratedCondition } from './calculateForm1084Income';

export interface FhaCalculationSummary {
  qualifyingMonthlyIncome: number;
  trendingResult: 'FHA_DECLINE_STABLE' | 'FHA_CRITICAL_DECLINE' | 'FHA_STABLE_OR_INCREASING' | 'SINGLE_YEAR' | 'INSUFFICIENT_DATA';
  yearsAnalyzed: number[];
  programUsed: 'FHA';
  appliedGrossUpMultiplier: 1.15;
  appliedGrossUpPercentText: '15%';
}

export interface FhaCalculationResult {
  summary: FhaCalculationSummary;
  warnings: WarningMessage[];
  conditions: GeneratedCondition[];
  scheduleCBreakdown: any[];
  form1120SBreakdown: any[];
  form1065Breakdown: any[];
  form1120Breakdown: any[];
  scheduleEPropertiesBreakdown: any[];
  militaryBreakdown: any | null;
}

export interface UsdaCalculationSummary {
  qualifyingMonthlyIncome: number;
  trendingResult: 'USDA_STABLE_OR_INCREASING' | 'USDA_DECLINING' | 'SINGLE_YEAR' | 'INSUFFICIENT_DATA';
  yearsAnalyzed: number[];
  programUsed: 'USDA';
  appliedGrossUpMultiplier: 1.25;
  appliedGrossUpPercentText: '25%';
}

export interface UsdaCalculationResult {
  summary: UsdaCalculationSummary;
  warnings: WarningMessage[];
  conditions: GeneratedCondition[];
  scheduleCBreakdown: any[];
  form1120SBreakdown: any[];
  form1065Breakdown: any[];
  form1120Breakdown: any[];
  scheduleEPropertiesBreakdown: any[];
  militaryBreakdown: any | null;
}

/**
 * Type Guard: Asserts that a calculation result conforms strictly to FHA-specific guidelines.
 * Filters out and prevents leaking any USDA or Conventional metrics.
 */
export function isFhaCalculationResult(result: any): result is FhaCalculationResult {
  if (!result || typeof result !== 'object') return false;
  if (!result.summary) return false;
  
  const summary = result.summary;
  
  // Strict FHA assertions
  const isFhaProgram = summary.programUsed === 'FHA';
  const isCorrectMultiplier = summary.appliedGrossUpMultiplier === 1.15;
  const isCorrectPercentText = summary.appliedGrossUpPercentText === '15%';
  
  // Verify that no USDA-specific codes or warnings leaked
  const hasUsdaWarnings = result.warnings?.some((w: any) => 
    w.code?.startsWith('USDA_') || w.code?.startsWith('FHLMC_')
  );

  return isFhaProgram && isCorrectMultiplier && isCorrectPercentText && !hasUsdaWarnings;
}

/**
 * Type Guard: Asserts that a calculation result conforms strictly to USDA-specific guidelines.
 * Filters out and prevents leaking any FHA-specific parameters or metrics.
 */
export function isUsdaCalculationResult(result: any): result is UsdaCalculationResult {
  if (!result || typeof result !== 'object') return false;
  if (!result.summary) return false;
  
  const summary = result.summary;
  
  // Strict USDA assertions
  const isUsdaProgram = summary.programUsed === 'USDA';
  const isCorrectMultiplier = summary.appliedGrossUpMultiplier === 1.25;
  const isCorrectPercentText = summary.appliedGrossUpPercentText === '25%';
  
  // Verify that no FHA-specific warning codes leaked
  const hasFhaWarnings = result.warnings?.some((w: any) => 
    w.code?.startsWith('FHA_')
  );

  return isUsdaProgram && isCorrectMultiplier && isCorrectPercentText && !hasFhaWarnings;
}

/**
 * Runtime Enforcement Wrapper:
 * Sanitizes and guarantees that an FHA output payload strictly strips out non-FHA metadata 
 * before returning it to the underwriter's web console.
 */
export function sanitizeFhaOutput(rawResult: any): FhaCalculationResult {
  if (!isFhaCalculationResult(rawResult)) {
    // Perform safety pruning and transformations
    const prunedSummary: FhaCalculationSummary = {
      qualifyingMonthlyIncome: Number(rawResult.summary?.qualifyingMonthlyIncome || 0),
      trendingResult: rawResult.summary?.trendingResult?.startsWith('FHA_') 
        ? rawResult.summary.trendingResult 
        : 'INSUFFICIENT_DATA',
      yearsAnalyzed: rawResult.summary?.yearsAnalyzed || [],
      programUsed: 'FHA',
      appliedGrossUpMultiplier: 1.15,
      appliedGrossUpPercentText: '15%'
    };

    const prunedWarnings = (rawResult.warnings || []).filter((w: any) => 
      !w.code?.startsWith('USDA_') && !w.code?.startsWith('FHLMC_')
    );

    return {
      summary: prunedSummary,
      warnings: prunedWarnings,
      conditions: rawResult.conditions || [],
      scheduleCBreakdown: rawResult.scheduleCBreakdown || [],
      form1120SBreakdown: rawResult.form1120SBreakdown || [],
      form1065Breakdown: rawResult.form1065Breakdown || [],
      form1120Breakdown: rawResult.form1120Breakdown || [],
      scheduleEPropertiesBreakdown: rawResult.scheduleEPropertiesBreakdown || [],
      militaryBreakdown: rawResult.militaryBreakdown || null
    };
  }

  return rawResult;
}
