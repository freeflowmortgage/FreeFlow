import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import { buildEncompassWritePreview } from '@mortgage-pos/encompass-connector-contract';
import type { RequestContext } from '../../auth/requestContext';
import { parseLenderFieldMappingConfiguration } from './lenderFieldMapping';
import { createEncompassSyncPreviewHandler } from './syncPreviewRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const LOAN = '00000000-0000-4000-8000-000000000200';
const APPROVAL = '00000000-0000-4000-8000-000000000300';
const CALCULATION = '00000000-0000-4000-8000-000000000301';
const context: RequestContext = Object.freeze({
  requestId: 'preview-request-1', subject: 'subject', tenantId: TENANT, membershipId: USER,
  permissions: ['encompass:sync'] as const, authTime: new Date(),
});
const decimal = (value: number) => ({ toNumber: () => value });
const extractionBindings = [{
  extractionId: '00000000-0000-4000-8000-000000000302', extractionHash: 'c'.repeat(64),
  sourceDocumentId: '00000000-0000-4000-8000-000000000303', sourceDocumentVersion: 1,
  sourceContentHash: 'd'.repeat(64), metadataReviewId: null, metadataReviewVersion: null,
  metadataReviewHash: null,
  extraction: {
    status: 'ACTIVE', canonicalHash: 'c'.repeat(64), sourceDocumentVersion: 1,
    sourceContentHash: 'd'.repeat(64), sourceDocument: { version: 1, sourceContentHash: 'd'.repeat(64) },
    metadataReviews: [],
  },
}];

test('preview route returns the exact tenant-bound full field set without caching', async () => {
  let loanTenantScope: string | undefined;
  const transaction = {
    loanApplication: { findFirst: async ({ where }: any) => {
      loanTenantScope = where.tenantId;
      return { id: LOAN, version: 2, encompassGuid: 'synthetic-guid' };
    } },
    tenantConfiguration: { findFirst: async () => ({ enableEncompassSync: true }) },
    encompassConnectorBinding: { findFirst: async () => ({ lenderId: 'lender-a', deploymentId: 'deployment-a' }) },
    auditEvent: { findFirst: async () => ({ id: APPROVAL, entityId: CALCULATION, expectedLoanVersion: 1 }) },
    form1084Audit: { findFirst: async () => ({
      qualifyingMonthlyIncome: decimal(9000), trendingResult: 'STABLE', yearsAnalyzed: [2025, 2024],
      scheduleCMonthlyTotal: null, form1120SMonthlyTotal: null, form1065MonthlyTotal: null,
      form1120MonthlyTotal: null, w2BaseMonthly: decimal(8500), w2VariableMonthly: decimal(500),
      assetIncomeMonthly: null, rentalMonthly: null,
      borrowerIncome: [
        { borrowerKey: 'borrower-1', ordinal: 0, role: 'PRIMARY', qualifyingMonthlyIncome: '6000.00' },
        { borrowerKey: 'borrower-2', ordinal: 1, role: 'CO_BORROWER', qualifyingMonthlyIncome: '3000.00' },
      ],
      extractionBindings,
    }) },
  };
  const lenderFieldMappings = parseLenderFieldMappingConfiguration(JSON.stringify({
    schemaVersion: 'encompass-lender-field-mappings-v1',
    mappings: [{
      lenderId: 'lender-a', deploymentId: 'deployment-a',
      fields: { FREEFLOW_QUALIFYING_INCOME: 'CX.LENDER.A.QUALIFYING' },
    }],
  }));
  const handler = createEncompassSyncPreviewHandler({
    withTenantTransaction: (async (_scope, operation) => operation(transaction as never)) as never,
    previewConfiguration: () => ({ appOrigin: 'https://freeflow.example', lenderFieldMappings }),
  });
  const request = {
    method: 'POST', query: { loanId: LOAN },
    body: { approvalEventId: APPROVAL, expectedLoanVersion: 2 },
  } as unknown as NextApiRequest;
  const { response, state } = responseRecorder();
  await handler(request, response, context);

  assert.equal(state.status, 200);
  assert.equal(state.headers['Cache-Control'], 'no-store');
  assert.equal(loanTenantScope, TENANT);
  const body = state.body as any;
  assert.equal(body.approvalEventId, APPROVAL);
  assert.match(body.previewHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(body, {
    ...buildEncompassWritePreview({ approvalEventId: APPROVAL, fields: body.fields }),
    requestId: context.requestId,
  });
  const fields = Object.fromEntries(body.fields.map((field: any) => [field.fieldName, field.value]));
  assert.equal(fields['CX.LENDER.A.QUALIFYING'], '9000.00');
  assert.equal(fields['CX.FREEFLOW.INCOME'], undefined);
  assert.equal(fields['CX.FREEFLOW.BORROWER.1.INCOME'], '6000.00');
  assert.equal(fields['CX.FREEFLOW.BORROWER.2.INCOME'], '3000.00');
  assert.equal(fields['CX.FREEFLOW.APPROVAL.ID'], APPROVAL);
});

function responseRecorder() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const response = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; return response; },
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { response, state };
}
