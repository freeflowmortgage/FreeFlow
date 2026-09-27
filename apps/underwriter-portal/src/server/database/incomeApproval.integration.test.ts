import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { approveIncomeCalculation } from '../audit/approveIncome';
import { prisma, withTenantTransaction } from './client';
import type { RequestContext } from '../auth/requestContext';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createIncomeCalculationHandler } from '../../pages/api/income/calculate';
import { reviewExtractionMetadata } from '../income/reviewExtractionMetadata';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LOAN_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const LOAN_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EXTRACTION_A = '22222222-2222-4222-8222-222222222222';

after(async () => {
  await prisma.$disconnect();
});

const contextA: RequestContext = Object.freeze({
  requestId: '016cbe8e-43d5-4b84-b2a9-04ef3d5b0a37',
  subject: 'verified-subject-a',
  tenantId: TENANT_A,
  membershipId: USER_A,
  permissions: ['income:approve', 'income:metadata:review'] as const,
  authTime: new Date('2026-09-11T00:00:00.000Z'),
});

test('income approval appends an immutable event, bumps loan version, and stays tenant-scoped', async () => {
  const metadata = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    (transaction) => reviewExtractionMetadata(transaction, contextA, {
      loanId: LOAN_A, extractionId: EXTRACTION_A, expectedLoanVersion: 1, expectedMetadataVersion: 0,
      source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
      assignments: [{ entityId: 'synthetic-w2-a', employmentRole: 'CURRENT' }], idempotencyKey: 'metadata-review-integration-01',
    }),
  );
  assert.equal(metadata.loanVersion, 2);
  const calculationResponse = responseRecorder();
  await createIncomeCalculationHandler()(
    { method: 'POST', query: {}, headers: {}, body: { loanId: LOAN_A, extractionIds: [EXTRACTION_A] } } as NextApiRequest,
    calculationResponse.response,
    contextA,
  );
  assert.equal(calculationResponse.state.status, 200);
  const calculationId = (calculationResponse.state.body as { calculationId: string }).calculationId;

  const first = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    async (transaction) => {
      const approved = await approveIncomeCalculation(transaction, contextA, {
        loanId: LOAN_A,
        calculationId,
        expectedLoanVersion: 2,
        action: 'INCOME_APPROVED',
        reasonCode: 'UNDERWRITER_CONFIRMED',
        reasonNarrative: null,
        idempotencyKey: 'income-approval-replay-01',
        overrideQualifyingMonthlyIncome: null,
      });

      return { calculationId, approved };
    },
  );

  assert.equal(first.approved.action, 'INCOME_APPROVED');
  assert.equal(first.approved.loanVersion, 3);
  assert.equal(first.approved.replayed, false);
  assert.equal(first.approved.calculationId, first.calculationId);

  const replay = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    (transaction) => approveIncomeCalculation(transaction, contextA, {
      loanId: LOAN_A,
      calculationId: first.calculationId,
      expectedLoanVersion: 2,
      action: 'INCOME_APPROVED',
      reasonCode: 'UNDERWRITER_CONFIRMED',
      reasonNarrative: null,
      idempotencyKey: 'income-approval-replay-01',
      overrideQualifyingMonthlyIncome: null,
    }),
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.auditEventId, first.approved.auditEventId);
  assert.equal(replay.loanVersion, 3);

  await assert.rejects(
    () => withTenantTransaction(
      { tenantId: TENANT_A, principalId: USER_A },
      (transaction) => approveIncomeCalculation(transaction, contextA, {
        loanId: LOAN_A,
        calculationId: first.calculationId,
        expectedLoanVersion: 3,
        action: 'INCOME_APPROVED',
        reasonCode: 'UNDERWRITER_CONFIRMED',
        reasonNarrative: null,
        idempotencyKey: 'income-approval-replay-01',
        overrideQualifyingMonthlyIncome: null,
      }),
    ),
    (error: unknown) => error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT',
  );

  const tenantAState = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    async (transaction) => ({
      loan: await transaction.loanApplication.findFirst({
        where: { id: LOAN_A },
        select: { version: true, status: true },
      }),
      event: await transaction.auditEvent.findFirst({
        where: { id: first.approved.auditEventId },
        select: {
          action: true,
          reasonCode: true,
          reasonNarrative: true,
          loanId: true,
          actorUserId: true,
        },
      }),
      foreignLoan: await transaction.loanApplication.findFirst({
        where: { id: LOAN_B },
        select: { id: true },
      }),
    }),
  );

  assert.deepEqual(tenantAState.loan, { version: 3, status: 'VERIFIED' });
  assert.deepEqual(tenantAState.event, {
    action: 'INCOME_APPROVED',
    reasonCode: 'UNDERWRITER_CONFIRMED',
    reasonNarrative: null,
    loanId: LOAN_A,
    actorUserId: USER_A,
  });
  assert.equal(tenantAState.foreignLoan, null);

  const tenantBEvents = await withTenantTransaction(
    { tenantId: TENANT_B, principalId: USER_B },
    (transaction) => transaction.auditEvent.count(),
  );
  assert.equal(tenantBEvents, 0);
});

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    setHeader() { return response; },
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { state, response };
}
