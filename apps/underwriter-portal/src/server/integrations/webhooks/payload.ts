import type { ApprovedIncomeSnapshot } from '../../exports/approvedIncomeSnapshot';
import { serializeApprovedIncomeJson } from '../../exports/approvedIncomeJson';

export const WEBHOOK_API_VERSION = 'freeflow-webhook-v1' as const;
export const INCOME_APPROVED_EVENT = 'income.approved' as const;

export type WebhookEventType = typeof INCOME_APPROVED_EVENT;

/**
 * Builds the request body in memory at send time. `data` is byte-for-byte the
 * same document as the approved-income JSON export; it is never persisted.
 */
export function buildIncomeApprovedPayload(input: Readonly<{
  deliveryId: string;
  createdAt: Date;
  snapshot: ApprovedIncomeSnapshot;
}>): string {
  return JSON.stringify({
    id: input.deliveryId,
    type: INCOME_APPROVED_EVENT,
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: input.createdAt.toISOString(),
    data: JSON.parse(serializeApprovedIncomeJson(input.snapshot)) as unknown,
  });
}
