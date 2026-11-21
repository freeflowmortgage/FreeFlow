import type { ApprovedIncomeSnapshot } from './approvedIncomeSnapshot';

export const APPROVED_INCOME_JSON_PROFILE = 'freeflow-approved-income-json-v1' as const;

export function serializeApprovedIncomeJson(snapshot: ApprovedIncomeSnapshot): string {
  return `${JSON.stringify({ exportProfile: APPROVED_INCOME_JSON_PROFILE, ...snapshot }, null, 2)}\n`;
}
