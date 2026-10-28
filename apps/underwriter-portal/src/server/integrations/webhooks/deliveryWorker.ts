import { emitOperationalEvent } from '../../observability/operationalEvents';
import type { WebhookSendResult } from './sender';

export const MAX_DELIVERY_ATTEMPTS = 8;
export const RETRY_SCHEDULE_MS = Object.freeze([
  30_000, 60_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
]);
export const RETRY_JITTER_RATIO = 0.2;

export type DueDelivery = Readonly<{ id: string; tenantId: string }>;

export type ClaimedDelivery = Readonly<{
  deliveryId: string;
  tenantId: string;
  claimToken: string;
  attemptCount: number;
}>;

export type ClaimOutcome =
  | Readonly<{ kind: 'claimed'; delivery: ClaimedDelivery }>
  | Readonly<{ kind: 'finished'; status: 'FAILED' | 'SUPERSEDED'; safeErrorCode: string }>
  | Readonly<{ kind: 'skipped' }>;

export type DeliveryCompletion =
  | Readonly<{ status: 'SUCCEEDED'; responseStatus: number }>
  | Readonly<{ status: 'FAILED'; safeErrorCode: string; responseStatus: number | null }>
  | Readonly<{ status: 'RETRYABLE_FAILURE'; safeErrorCode: string; responseStatus: number | null; nextAttemptAt: Date }>;

export type DeliveryWorkerDependencies = Readonly<{
  findDue(limit: number): Promise<readonly DueDelivery[]>;
  claim(due: DueDelivery): Promise<ClaimOutcome>;
  send(delivery: ClaimedDelivery): Promise<WebhookSendResult>;
  complete(delivery: ClaimedDelivery, completion: DeliveryCompletion): Promise<boolean>;
  now(): Date;
  random(): number;
}>;

export type BatchSummary = Readonly<{
  scanned: number;
  succeeded: number;
  retried: number;
  failed: number;
  superseded: number;
  skipped: number;
}>;

export function retryDelayMs(attemptCount: number, random: number): number {
  const index = Math.max(0, Math.min(RETRY_SCHEDULE_MS.length - 1, Math.floor(attemptCount) - 1));
  const base = RETRY_SCHEDULE_MS[index]!;
  const bounded = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
  return Math.round(base * (1 - RETRY_JITTER_RATIO + 2 * RETRY_JITTER_RATIO * bounded));
}

export function completionFor(
  result: WebhookSendResult,
  attemptCount: number,
  now: Date,
  random: number,
): DeliveryCompletion {
  if (result.kind === 'delivered') return { status: 'SUCCEEDED', responseStatus: result.responseStatus };
  if (result.kind === 'rejected' || attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return { status: 'FAILED', safeErrorCode: result.safeErrorCode, responseStatus: result.responseStatus };
  }
  return {
    status: 'RETRYABLE_FAILURE',
    safeErrorCode: result.safeErrorCode,
    responseStatus: result.responseStatus,
    nextAttemptAt: new Date(now.getTime() + retryDelayMs(attemptCount, random)),
  };
}

export async function runDeliveryBatch(
  dependencies: DeliveryWorkerDependencies,
  batchSize: number,
): Promise<BatchSummary> {
  const counts = { scanned: 0, succeeded: 0, retried: 0, failed: 0, superseded: 0, skipped: 0 };
  const due = await dependencies.findDue(batchSize);
  counts.scanned = due.length;
  for (const item of due) {
    const outcome = await deliverOne(dependencies, item);
    counts[outcome] += 1;
  }
  return counts;
}

async function deliverOne(
  dependencies: DeliveryWorkerDependencies,
  due: DueDelivery,
): Promise<'succeeded' | 'retried' | 'failed' | 'superseded' | 'skipped'> {
  const claim = await dependencies.claim(due);
  if (claim.kind === 'skipped') return 'skipped';
  if (claim.kind === 'finished') {
    emitOperationalEvent('webhook_delivery_failure', claim.safeErrorCode);
    return claim.status === 'SUPERSEDED' ? 'superseded' : 'failed';
  }

  let result: WebhookSendResult;
  try {
    result = await dependencies.send(claim.delivery);
  } catch {
    result = { kind: 'retryable', safeErrorCode: 'WEBHOOK_SEND_FAILED', responseStatus: null };
  }
  const completion = completionFor(result, claim.delivery.attemptCount, dependencies.now(), dependencies.random());
  const recorded = await dependencies.complete(claim.delivery, completion);
  if (!recorded) return 'skipped';

  if (completion.status === 'SUCCEEDED') {
    emitOperationalEvent('webhook_delivery_success', undefined, completion.responseStatus);
    return 'succeeded';
  }
  if (completion.status === 'RETRYABLE_FAILURE') {
    emitOperationalEvent('webhook_delivery_retry', completion.safeErrorCode, completion.responseStatus ?? undefined);
    return 'retried';
  }
  emitOperationalEvent('webhook_delivery_failure', completion.safeErrorCode, completion.responseStatus ?? undefined);
  return 'failed';
}
