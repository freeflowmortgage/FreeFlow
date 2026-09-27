import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIT_ACTIONS, appendAuditEvent, hashAuditResult } from './appendEvent';
import { parseIncomeApprovalBody } from './approveIncome';
import { ApiError } from '../http/apiError';
import type { RequestContext } from '../auth/requestContext';

const context: RequestContext = Object.freeze({
  requestId: '016cbe8e-43d5-4b84-b2a9-04ef3d5b0a37',
  subject: 'verified-subject',
  tenantId: '00000000-0000-4000-8000-000000000100',
  membershipId: '00000000-0000-4000-8000-000000000101',
  permissions: ['income:approve'] as const,
  authTime: new Date('2026-09-11T00:00:00.000Z'),
});

test('audit result hashes are stable across object key order', () => {
  const first = hashAuditResult({
    qualifyingMonthlyIncome: 8123.45,
    yearsAnalyzed: [2025, 2024],
    calculationEngine: 'FORM_1084',
  });
  const second = hashAuditResult({
    calculationEngine: 'FORM_1084',
    yearsAnalyzed: [2025, 2024],
    qualifyingMonthlyIncome: 8123.45,
  });

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('audit result hashing rejects non-JSON-safe values', () => {
  assert.throws(
    () => hashAuditResult({ qualifyingMonthlyIncome: Number.NaN }),
    /finite numbers/,
  );
  assert.throws(
    () => hashAuditResult({ omitted: undefined }),
    /JSON-compatible/,
  );
});

test('override events are rejected without a human narrative before insert', async () => {
  await assert.rejects(
    () => appendAuditEvent(unusedTransaction(), context, {
      loanId: '00000000-0000-4000-8000-000000000200',
      entityType: 'FORM_1084_AUDIT',
      entityId: '00000000-0000-4000-8000-000000000201',
      expectedLoanVersion: 1,
      action: AUDIT_ACTIONS.INCOME_OVERRIDE,
      reasonCode: 'INCOME_ADJUSTED',
      ruleVersion: 'form-1084-v9',
      schemaVersion: 'audit-event-v1',
      resultHash: 'a'.repeat(64),
    }),
    /require a reason narrative/,
  );
});

test('approval and override hashes include the persisted narrative and action', async () => {
  const created: Array<Record<string, unknown>> = [];
  const transaction = {
    $executeRaw: async () => 0,
    auditEvent: {
      findFirst: async () => ({ eventHash: 'b'.repeat(64) }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      },
    },
  };

  await appendAuditEvent(transaction as never, context, {
    loanId: '00000000-0000-4000-8000-000000000200',
    entityType: 'FORM_1084_AUDIT',
    entityId: '00000000-0000-4000-8000-000000000201',
    expectedLoanVersion: 1,
    action: AUDIT_ACTIONS.INCOME_OVERRIDE,
    reasonCode: 'INCOME_ADJUSTED',
    reasonNarrative: '  Used 12-month average after declining Schedule C.  ',
    ruleVersion: 'form-1084-v9',
    schemaVersion: 'audit-event-v1',
    resultHash: 'a'.repeat(64),
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].action, 'INCOME_OVERRIDE');
  assert.equal(created[0].reasonNarrative, 'Used 12-month average after declining Schedule C.');
  assert.equal(created[0].previousEventHash, 'b'.repeat(64));
  assert.match(String(created[0].eventHash), /^[0-9a-f]{64}$/);
});

test('parseIncomeApprovalBody requires a reviewed calculation and authoritative value for overrides', () => {
  const calculationId = '00000000-0000-4000-8000-000000000321';
  const approved = parseIncomeApprovalBody({ calculationId, expectedLoanVersion: 3 });
  assert.equal(approved.action, 'INCOME_APPROVED');
  assert.equal(approved.reasonCode, 'UNDERWRITER_CONFIRMED');
  assert.equal(approved.reasonNarrative, null);

  assert.throws(
    () => parseIncomeApprovalBody({
      calculationId,
      expectedLoanVersion: 3,
      action: 'INCOME_OVERRIDE',
      reasonCode: 'INCOME_ADJUSTED',
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'OVERRIDE_NARRATIVE_REQUIRED',
  );

  const overridden = parseIncomeApprovalBody({
    calculationId,
    expectedLoanVersion: 3,
    action: 'INCOME_OVERRIDE',
    reasonCode: 'INCOME_ADJUSTED',
    reasonNarrative: 'Locked to the most recent year after a documented decline.',
    overrideQualifyingMonthlyIncome: 7123.45,
  });
  assert.equal(overridden.reasonNarrative, 'Locked to the most recent year after a documented decline.');
  assert.equal(overridden.overrideQualifyingMonthlyIncome, 7123.45);
});

test('parseIncomeApprovalBody rejects non-integer versions and unknown actions', () => {
  assert.throws(
    () => parseIncomeApprovalBody({ expectedLoanVersion: 1.5 }),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_LOAN_VERSION',
  );
  assert.throws(
    () => parseIncomeApprovalBody({ calculationId: '00000000-0000-4000-8000-000000000321', expectedLoanVersion: 1, action: 'CLIENT_SUPPLIED_APPROVAL' }),
    (error: unknown) => error instanceof ApiError && error.code === 'INVALID_APPROVAL_ACTION',
  );
});

function unusedTransaction() {
  return {
    $executeRaw: async () => {
      throw new Error('database must not be reached');
    },
    auditEvent: {
      findFirst: async () => {
        throw new Error('database must not be reached');
      },
      create: async () => {
        throw new Error('database must not be reached');
      },
    },
  } as never;
}
