/**
 * Encompass Field Mapping Utility (FreeFlow STANDALONE v4 Upgrade) [cite: 28, 38, 102].
 *
 * This utility maps standard Fannie Mae Form 1084 cash flow calculations directly to 
 * standard Encompass loan schema fields and custom field tracking IDs [cite: 28, 102].
 */

import type { EncompassCustomFieldWrite } from './encompass-urla-map';

export interface Form1084CalculationPayload {
  qualifyingMonthlyIncome: number;
  trendingAnalysis: string;
  yearsAnalyzed: number[];
  scheduleC_MonthlyTotal?: number;
  form1120S_MonthlyTotal?: number;
  form1065_MonthlyTotal?: number;
  form1120_MonthlyTotal?: number;
  /** Wage income from the pay stub / W-2 path, kept separate from business income. */
  w2BaseMonthly?: number;
  /** Net rental income from Schedule E. */
  rentalMonthly?: number;
  borrowerMonthlyIncome?: ReadonlyArray<{ ordinal: number; qualifyingMonthlyIncome: number }>;
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
  FREEFLOW_W2_BASE: 'CX.FREEFLOW.W2.BASE',
  FREEFLOW_RENTAL_TOTAL: 'CX.FREEFLOW.RENTAL',
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
  // Encompass takes custom fields as a { fieldName, value } array, the same
  // shape buildEncompassLoanUpdate emits. This helper used to return an object
  // map and an otherIncome block that booked every dollar as self-employment
  // income, which is wrong for a wage earner.
  const customFields: EncompassCustomFieldWrite[] = [];
  const push = (fieldName: string, value?: string) => {
    if (value == null || value === '') return;
    customFields.push({ fieldName, value });
  };
  const money = (value?: number) => (value === undefined ? undefined : value.toFixed(2));

  push(ENCOMPASS_FIELD_MAP.FREEFLOW_QUALIFYING_INCOME, money(payload.qualifyingMonthlyIncome));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_TRENDING_ANALYSIS, payload.trendingAnalysis);
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_AUDIT_URL, payload.auditUrl);
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_YEARS_ANALYZED, payload.yearsAnalyzed.join(', '));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_SCHEDULE_C_TOTAL, money(payload.scheduleC_MonthlyTotal));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1120S_TOTAL, money(payload.form1120S_MonthlyTotal));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1065_TOTAL, money(payload.form1065_MonthlyTotal));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_FORM_1120_TOTAL, money(payload.form1120_MonthlyTotal));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_W2_BASE, money(payload.w2BaseMonthly));
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_RENTAL_TOTAL, money(payload.rentalMonthly));
  for (const borrower of payload.borrowerMonthlyIncome ?? []) {
    if (borrower.ordinal >= 0 && borrower.ordinal < 4) push(`CX.FREEFLOW.BORROWER.${borrower.ordinal + 1}.INCOME`, money(borrower.qualifyingMonthlyIncome));
  }
  push(ENCOMPASS_FIELD_MAP.FREEFLOW_SYNCED_TIMESTAMP, new Date().toISOString());

  return { loanId, customFields };
}
