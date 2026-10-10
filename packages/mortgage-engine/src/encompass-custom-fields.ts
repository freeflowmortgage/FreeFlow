/**
 * Encompass Settings → Loan Custom Fields catalog.
 *
 * Create these CX.FREEFLOW.* fields in the lender instance before any write.
 * Standard 1003 / URLA values use native Encompass field IDs (see encompass-urla-map.ts)
 * and are not duplicated here.
 */

export type EncompassCustomFieldFormat = 'STRING' | 'DECIMAL_2' | 'DATE' | 'YN';

export interface EncompassCustomFieldDefinition {
  fieldName: string;
  description: string;
  format: EncompassCustomFieldFormat;
  maxLength: number;
  category: 'FreeFlow Income' | 'FreeFlow Audit' | 'FreeFlow URLA';
}

export const ENCOMPASS_CUSTOM_FIELD_SETUP: EncompassCustomFieldDefinition[] = [
  {
    fieldName: 'CX.FREEFLOW.INCOME',
    description: 'Form 1084 total qualifying monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.BORROWER.1.INCOME',
    description: 'Primary borrower qualifying monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.BORROWER.2.INCOME',
    description: 'Co-borrower qualifying monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.BORROWER.3.INCOME',
    description: 'Additional borrower 3 qualifying monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.BORROWER.4.INCOME',
    description: 'Additional borrower 4 qualifying monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.W2.BASE',
    description: 'Qualifying W-2 base monthly income',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.W2.VARIABLE',
    description: 'Qualifying W-2 variable monthly (OT / bonus / commission)',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.SCH.C',
    description: 'Form 1084 Schedule C monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.FORM.1120S',
    description: 'Form 1084 S-Corp (1120-S) monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.FORM.1065',
    description: 'Form 1084 partnership (1065) monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.FORM.1120',
    description: 'Form 1084 C-Corp (1120) monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.SCH.F',
    description: 'Form 1084 Schedule F monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.ASSET.INCOME',
    description: 'Qualifying asset-depletion / asset income monthly',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.RENTAL',
    description: 'Qualifying net rental income monthly (positive only)',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.RENTAL.LIABILITY',
    description: 'Rental loss redirected to 1003 liabilities',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.HOUSING.ADJ',
    description: 'Subject-property housing expense adjustment (primary 2–4 unit deficit)',
    format: 'DECIMAL_2',
    maxLength: 20,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.TRENDING',
    description: 'Form 1084 trending result',
    format: 'STRING',
    maxLength: 64,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.YEARS',
    description: 'Tax years analyzed',
    format: 'STRING',
    maxLength: 32,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.PROGRAM',
    description: 'Loan program used for the 1084 run',
    format: 'STRING',
    maxLength: 32,
    category: 'FreeFlow Income',
  },
  {
    fieldName: 'CX.FREEFLOW.AUDIT.URL',
    description: 'Secure FreeFlow audit URL (no document bytes)',
    format: 'STRING',
    maxLength: 255,
    category: 'FreeFlow Audit',
  },
  {
    fieldName: 'CX.FREEFLOW.SYNCED.AT',
    description: 'UTC timestamp of last FreeFlow Encompass write',
    format: 'DATE',
    maxLength: 32,
    category: 'FreeFlow Audit',
  },
  {
    fieldName: 'CX.FREEFLOW.APPROVAL.ID',
    description: 'Immutable FreeFlow approval event identifier used for reconciliation',
    format: 'STRING',
    maxLength: 36,
    category: 'FreeFlow Audit',
  },
  {
    fieldName: 'CX.FREEFLOW.SOURCE',
    description: 'Payload source: AI_1003, FORM_1084, or COMBINED',
    format: 'STRING',
    maxLength: 16,
    category: 'FreeFlow Audit',
  },
];

export const ENCOMPASS_CUSTOM_FIELD_NAMES = Object.fromEntries(
  ENCOMPASS_CUSTOM_FIELD_SETUP.map((field) => [field.fieldName, field.fieldName]),
) as Record<string, string>;

export function encompassCustomFieldNames(): string[] {
  return ENCOMPASS_CUSTOM_FIELD_SETUP.map((field) => field.fieldName);
}
