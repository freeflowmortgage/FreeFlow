/**
 * Encompass Field Mapping Utility (FreeFlow STANDALONE v4 Upgrade) [cite: 28, 38, 102].
 *
 * This utility maps standard Fannie Mae Form 1084 cash flow calculations directly to 
 * standard Encompass loan schema fields and custom field tracking IDs [cite: 28, 102].
 */

export interface Form1084CalculationPayload {
  qualifyingMonthlyIncome: number;
  trendingAnalysis: string;
  yearsAnalyzed: number[];
  scheduleC_MonthlyTotal?: number;
  form1120S_MonthlyTotal?: number;
  form1065_MonthlyTotal?: number;
  form1120_MonthlyTotal?: number;
  auditUrl: string;
}

export const ENCOMPASS_FIELD_MAP = {
  // Standard 1003 Mortgage Form Fields in Encompass [cite: 28, 102]
  BASE_MONTHLY_INCOME: '101',                // Borrower Base Monthly Income
  OTHER_INCOME_TYPE_1: '102',                // Other Income Type 1 (Self-Employed / Business)
  OTHER_INCOME_AMOUNT_1: '103',              // Other Income Amount 1
  
  // Custom FreeFlow Fields inside Encompass eFolder Database [cite: 28, 102]
  FREEFLOW_QUALIFYING_INCOME: 'CX.FREEFLOW.INCOME',
  FREEFLOW_TRENDING_ANALYSIS: 'CX.FREEFLOW.TRENDING',
  FREEFLOW_AUDIT_URL: 'CX.FREEFLOW.AUDIT.URL',
  FREEFLOW_YEARS_ANALYZED: 'CX.FREEFLOW.YEARS',
  FREEFLOW_SCHEDULE_C_TOTAL: 'CX.FREEFLOW.SCH.C',
  FREEFLOW_FORM_1120S_TOTAL: 'CX.FREEFLOW.FORM.1120S',
  FREEFLOW_FORM_1065_TOTAL: 'CX.FREEFLOW.FORM.1065',
  FREEFLOW_FORM_1120_TOTAL: 'CX.FREEFLOW.FORM.1120',
  FREEFLOW_SYNCED_TIMESTAMP: 'CX.FREEFLOW.SYNCED.AT',
};

/**
 * Transforms standard 1084 mathematical output JSON into an Encompass REST PATCH Payload [cite: 28, 102].
 * Uses standard Encompass customFields payload structure [cite: 102].
 */
export function buildEncompassFieldUpdatePayload(
  loanId: string, 
  payload: Form1084CalculationPayload
) {
  const customFields: Record<string, string> = {
    [ENCOMPASS_FIELD_MAP.FREEFLOW_QUALIFYING_INCOME]: payload.qualifyingMonthlyIncome.toFixed(2),
    [ENCOMPASS_FIELD_MAP.FREEFLOW_TRENDING_ANALYSIS]: payload.trendingAnalysis,
    [ENCOMPASS_FIELD_MAP.FREEFLOW_AUDIT_URL]: payload.auditUrl,
    [ENCOMPASS_FIELD_MAP.FREEFLOW_YEARS_ANALYZED]: payload.yearsAnalyzed.join(', '),
    [ENCOMPASS_FIELD_MAP.FREEFLOW_SYNCED_TIMESTAMP]: new Date().toISOString()
  };

  if (payload.scheduleC_MonthlyTotal !== undefined) {
    customFields[ENCOMPASS_FIELD_MAP.FREEFLOW_SCHEDULE_C_TOTAL] = payload.scheduleC_MonthlyTotal.toFixed(2);
  }
  if (payload.form1120S_MonthlyTotal !== undefined) {
    customFields[ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1120S_TOTAL] = payload.form1120S_MonthlyTotal.toFixed(2);
  }
  if (payload.form1065_MonthlyTotal !== undefined) {
    customFields[ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1065_TOTAL] = payload.form1065_MonthlyTotal.toFixed(2);
  }
  if (payload.form1120_MonthlyTotal !== undefined) {
    customFields[ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1120_TOTAL] = payload.form1120_MonthlyTotal.toFixed(2);
  }

  // Generate complete Encompass API Loan Patch body [cite: 28, 102]
  return {
    customFields,
    // Add calculated monthly self-employed income directly to standard 1003 other income slot [cite: 28, 102]
    otherIncome: [
      {
        incomeType: 'SelfEmployment',
        amount: payload.qualifyingMonthlyIncome
      }
    ]
  };
}
