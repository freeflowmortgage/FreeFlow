import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completionFor,
  MAX_DELIVERY_ATTEMPTS,
  retryDelayMs,
  RETRY_SCHEDULE_MS,
  runDeliveryBatch,
  type ClaimedDelivery,
  type ClaimOutcome,
  type DeliveryCompletion,
  type DeliveryWorkerDependencies,
} from './deliveryWorker';
import type { WebhookSendResult } from './sender';

const NOW = new Date('2026-10-28T17:00:00.000Z');

test('retry delays follow the bounded schedule with plus or minus twenty percent jitter', () => {
  assert.equal(retryDelayMs(1, 0.5), 30_000);
  assert.equal(retryDelayMs(1, 0), 24_000);
  assert.equal(retryDelayMs(1, 1), 36_000);
  assert.equal(retryDelayMs(4, 0.5), 300_000);
  assert.equal(retryDelayMs(8, 0.5), 7_200_000);
  assert.equal(retryDelayMs(50, 0.5), 7_200_000);
  assert.equal(retryDelayMs(0, 0.5), 30_000);
  assert.equal(retryDelayMs(1, Number.NaN), 30_000);
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    const base = RETRY_SCHEDULE_MS[attempt - 1]!;
    for (const random of [0, 0.25, 0.75, 1]) {
      const delay = retryDelayMs(attempt, random);
      assert.ok(delay >= base * 0.8 && delay <= base * 1.2, `attempt ${attempt}`);
    }
  }
});

test('completion maps receiver outcomes to success, retry, or dead letter', () => {
  assert.deepEqual(completionFor({ kind: 'delivered', responseStatus: 200 }, 1, NOW, 0.5), { status: 'SUCCEEDED', responseStatus: 200 });
  assert.deepEqual(
    completionFor({ kind: 'rejected', safeErrorCode: 'RECEIVER_REJECTED', responseStatus: 410 }, 1, NOW, 0.5),
    { status: 'FAILED', safeErrorCode: 'RECEIVER_REJECTED', responseStatus: 410 },
  );
  assert.deepEqual(
    completionFor({ kind: 'retryable', safeErrorCode: 'RECEIVER_RETRYABLE_STATUS', responseStatus: 503 }, 2, NOW, 0.5),
    {
      status: 'RETRYABLE_FAILURE',
      safeErrorCode: 'RECEIVER_RETRYABLE_STATUS',
      responseStatus: 503,
      nextAttemptAt: new Date(NOW.getTime() + 60_000),
    },
  );
  assert.deepEqual(
    completionFor({ kind: 'retryable', safeErrorCode: 'RECEIVER_TIMEOUT', responseStatus: null }, MAX_DELIVERY_ATTEMPTS, NOW, 0.5),
    { status: 'FAILED', safeErrorCode: 'RECEIVER_TIMEOUT', responseStatus: null },
  );
});

function harness(
  claims: ClaimOutcome[],
  results: (WebhookSendResult | Error)[],
  completeResult = true,
) {
  const completions: { delivery: ClaimedDelivery; completion: DeliveryCompletion }[] = [];
  const sent: ClaimedDelivery[] = [];
  const dependencies: DeliveryWorkerDependencies = {
    findDue: async (limit) => claims.slice(0, limit).map((_, index) => ({ id: `delivery-${index}`, tenantId: 'tenant' })),
    claim: async () => claims.shift()!,
    send: async (delivery) => {
      sent.push(delivery);
      const next = results.shift()!;
      if (next instanceof Error) throw next;
      return next;
    },
    complete: async (delivery, completion) => { completions.push({ delivery, completion }); return completeResult; },
    now: () => NOW,
    random: () => 0.5,
  };
  return { dependencies, completions, sent };
}

function claimed(attemptCount: number): ClaimOutcome {
  return { kind: 'claimed', delivery: { deliveryId: `d-${attemptCount}`, tenantId: 'tenant', claimToken: 'token', attemptCount } };
}

test('a batch delivers, retries, dead-letters, and records claim-time terminal outcomes', async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (line: string) => { lines.push(line); };
  try {
    const { dependencies, completions, sent } = harness(
      [
        claimed(1),
        claimed(3),
        claimed(MAX_DELIVERY_ATTEMPTS),
        { kind: 'finished', status: 'SUPERSEDED', safeErrorCode: 'APPROVAL_SUPERSEDED' },
        { kind: 'skipped' },
        claimed(1),
      ],
      [
        { kind: 'delivered', responseStatus: 202 },
        { kind: 'retryable', safeErrorCode: 'RECEIVER_RETRYABLE_STATUS', responseStatus: 502 },
        { kind: 'retryable', safeErrorCode: 'RECEIVER_TIMEOUT', responseStatus: null },
        new Error('socket exploded with borrower text'),
      ],
    );
    const summary = await runDeliveryBatch(dependencies, 10);
    assert.deepEqual(summary, { scanned: 6, succeeded: 1, retried: 2, failed: 1, superseded: 1, skipped: 1 });
    assert.equal(sent.length, 4);
    assert.deepEqual(completions.map(({ completion }) => completion.status), [
      'SUCCEEDED', 'RETRYABLE_FAILURE', 'FAILED', 'RETRYABLE_FAILURE',
    ]);
    assert.equal((completions[3]!.completion as { safeErrorCode: string }).safeErrorCode, 'WEBHOOK_SEND_FAILED');
  } finally {
    console.info = original;
  }
  for (const line of lines) {
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).filter((key) => !['source', 'event', 'code', 'status'].includes(key)), []);
    assert.doesNotMatch(line, /borrower|d-\d|tenant|token/);
  }
  assert.ok(lines.some((line) => line.includes('webhook_delivery_success')));
  assert.ok(lines.some((line) => line.includes('webhook_delivery_retry')));
  assert.ok(lines.some((line) => line.includes('webhook_delivery_failure')));
});

test('a completion lost to a concurrent claim is counted as skipped and not reported', async () => {
  const { dependencies } = harness([claimed(1)], [{ kind: 'delivered', responseStatus: 200 }], false);
  assert.deepEqual(await runDeliveryBatch(dependencies, 10), {
    scanned: 1, succeeded: 0, retried: 0, failed: 0, superseded: 0, skipped: 1,
  });
});
