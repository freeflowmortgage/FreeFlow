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
  /** Variable wage income (overtime, bonus, commission, and tips). */
  w2VariableMonthly?: number;
  /** Qualifying income derived from eligible assets. */
  assetIncomeMonthly?: number;
  /** Qualifying Social Security from Form 1040 line 6a/6b, non-taxable portion grossed up. */
  socialSecurityMonthly?: number;
  /** Qualifying pension/annuity (line 5a/5b) plus continuance-confirmed IRA distributions (line 4a/4b). */
  retirementIncomeMonthly?: number;
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
  FREEFLOW_W2_VARIABLE: 'CX.FREEFLOW.W2.VARIABLE',
  FREEFLOW_ASSET_INCOME: 'CX.FREEFLOW.ASSET.INCOME',
  FREEFLOW_SOCIAL_SECURITY: 'CX.FREEFLOW.SOCIAL.SECURITY',
  FREEFLOW_RETIREMENT_INCOME: 'CX.FREEFLOW.RETIREMENT',
  FREEFLOW_RENTAL_TOTAL: 'CX.FREEFLOW.RENTAL',
  FREEFLOW_SYNCED_TIMESTAMP: 'CX.FREEFLOW.SYNCED.AT',
} as const;

export type EncompassIncomeFieldMap = Readonly<Record<keyof typeof ENCOMPASS_FIELD_MAP, string>>;
export type EncompassIncomeFieldMapOverrides = Partial<EncompassIncomeFieldMap>;
const RESERVED_ORCHESTRATOR_FIELD_IDS = new Set([
  'CX.FREEFLOW.APPROVAL.ID',
  'CX.FREEFLOW.BORROWER.1.INCOME',
  'CX.FREEFLOW.BORROWER.2.INCOME',
  'CX.FREEFLOW.BORROWER.3.INCOME',
  'CX.FREEFLOW.BORROWER.4.INCOME',
]);

export class EncompassFieldMappingError extends Error {
  readonly code = 'ENCOMPASS_FIELD_MAPPING_INVALID';

  constructor() {
    super('The configured Encompass income field mapping is invalid.');
    this.name = 'EncompassFieldMappingError';
  }
}

/**
 * Applies an explicitly supplied lender mapping while preserving a closed set
 * of FreeFlow logical fields. Parsed configuration is accepted as `unknown`
 * so misspelled keys, unsafe IDs, and collisions fail before a provider call.
 */
export function resolveEncompassIncomeFieldMap(overrides?: unknown): EncompassIncomeFieldMap {
  if (overrides === undefined) return ENCOMPASS_FIELD_MAP;
  if (!isRecord(overrides)) throw new EncompassFieldMappingError();

  const allowedKeys = new Set(Object.keys(ENCOMPASS_FIELD_MAP));
  for (const [key, value] of Object.entries(overrides)) {
    if (!allowedKeys.has(key) || typeof value !== 'string' || !ENCOMPASS_FIELD_ID.test(value)) {
      throw new EncompassFieldMappingError();
    }
  }

  const resolved = { ...ENCOMPASS_FIELD_MAP, ...overrides } as EncompassIncomeFieldMap;
  if (new Set(Object.values(resolved)).size !== Object.keys(resolved).length
    || Object.values(resolved).some((fieldName) => RESERVED_ORCHESTRATOR_FIELD_IDS.has(fieldName))) {
    throw new EncompassFieldMappingError();
  }
  return Object.freeze(resolved);
}

/**
 * Transforms standard 1084 mathematical output JSON into an Encompass REST PATCH Payload [cite: 28, 102].
 * Uses standard Encompass customFields payload structure [cite: 102].
 */
export function buildEncompassFieldUpdatePayload(
  loanId: string, 
  payload: Form1084CalculationPayload,
  options: Readonly<{ fieldMapOverrides?: unknown; includeSyncedAt?: boolean }> = {},
) {
  // Encompass takes custom fields as a { fieldName, value } array, the same
  // shape buildEncompassLoanUpdate emits. This helper used to return an object
  // map and an otherIncome block that booked every dollar as self-employment
  // income, which is wrong for a wage earner.
  const customFields: EncompassCustomFieldWrite[] = [];
  const fieldMap = resolveEncompassIncomeFieldMap(options.fieldMapOverrides);
  const push = (fieldName: string, value?: string) => {
    if (value == null || value === '') return;
    customFields.push({ fieldName, value });
  };
  const money = (value?: number) => (value === undefined ? undefined : value.toFixed(2));

  push(fieldMap.FREEFLOW_QUALIFYING_INCOME, money(payload.qualifyingMonthlyIncome));
  push(fieldMap.FREEFLOW_TRENDING_ANALYSIS, payload.trendingAnalysis);
  push(fieldMap.FREEFLOW_AUDIT_URL, payload.auditUrl);
  push(fieldMap.FREEFLOW_YEARS_ANALYZED, payload.yearsAnalyzed.join(', '));
  push(fieldMap.FREEFLOW_SCHEDULE_C_TOTAL, money(payload.scheduleC_MonthlyTotal));
  push(fieldMap.FREEFLOW_FORM_1120S_TOTAL, money(payload.form1120S_MonthlyTotal));
  push(fieldMap.FREEFLOW_FORM_1065_TOTAL, money(payload.form1065_MonthlyTotal));
  push(fieldMap.FREEFLOW_FORM_1120_TOTAL, money(payload.form1120_MonthlyTotal));
  push(fieldMap.FREEFLOW_W2_BASE, money(payload.w2BaseMonthly));
  push(fieldMap.FREEFLOW_W2_VARIABLE, money(payload.w2VariableMonthly));
  push(fieldMap.FREEFLOW_ASSET_INCOME, money(payload.assetIncomeMonthly));
  push(fieldMap.FREEFLOW_SOCIAL_SECURITY, money(payload.socialSecurityMonthly));
  push(fieldMap.FREEFLOW_RETIREMENT_INCOME, money(payload.retirementIncomeMonthly));
  push(fieldMap.FREEFLOW_RENTAL_TOTAL, money(payload.rentalMonthly));
  for (const borrower of payload.borrowerMonthlyIncome ?? []) {
    if (borrower.ordinal >= 0 && borrower.ordinal < 4) push(`CX.FREEFLOW.BORROWER.${borrower.ordinal + 1}.INCOME`, money(borrower.qualifyingMonthlyIncome));
  }
  if (options.includeSyncedAt !== false) {
    push(fieldMap.FREEFLOW_SYNCED_TIMESTAMP, new Date().toISOString());
  }

  return { loanId, customFields };
}

const ENCOMPASS_FIELD_ID = /^(?:CX\.[A-Z0-9][A-Z0-9._-]{0,99}|10[1-7])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
