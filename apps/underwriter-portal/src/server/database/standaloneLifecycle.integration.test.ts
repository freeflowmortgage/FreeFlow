import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test, { after } from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { createIncomeApprovalHandler } from '../audit/incomeApprovalsRoute';
import { createApprovedIncomeExportHandler } from '../http/approvedIncomeExportsRoute';
import { createConsoleContextHandler } from '../income/consoleContextRoute';
import { createExtractionMetadataReviewHandler } from '../income/extractionMetadataReviewRoute';
import { createMetadataRequirementsHandler } from '../income/metadataRequirementsRoute';
import { createStandaloneLoanHandler } from '../income/standaloneLoanRoute';
import { parseWithIncomeService } from '../integrations/encompass/encompassApi';
import { persistParsedExtraction } from '../integrations/encompass/documentPullWorkerRuntime';
import { createUploadIncomeDocumentHandler } from '../integrations/encompass/uploadIncomeDocumentRoute';
import { createIncomeCalculationHandler } from '../../pages/api/income/calculate';
import { prisma, withTenantTransaction } from './client';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const originalParserUrl = process.env.DOC_PARSER_SERVICE_URL;
process.env.DOC_PARSER_SERVICE_URL = 'http://synthetic-parser.invalid/parse';

after(async () => {
  if (originalParserUrl === undefined) delete process.env.DOC_PARSER_SERVICE_URL;
  else process.env.DOC_PARSER_SERVICE_URL = originalParserUrl;
  await prisma.$disconnect();
});

test('database-backed standalone lifecycle reopens one approval into all three exports (parser HTTP boundary simulated)', async () => {
  const created = response();
  await createStandaloneLoanHandler()(
    request('POST', {}, {
      schemaVersion: 'freeflow-standalone-loan-v1',
      loanProgram: 'CONVENTIONAL',
      borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }],
    }, { 'idempotency-key': 'standalone-lifecycle-create-01' }),
    created.res,
    context('standalone-lifecycle-create'),
  );
  assert.equal(created.state.status, 201);
  const loanId = String((created.state.body as { loanId: string }).loanId);
  assert.equal((created.state.body as { integrationMode: string }).integrationMode, 'NONE');

  const uploadHandler = createUploadIncomeDocumentHandler({
    withTenantTransaction,
    parse: (bytes, options) => parseWithIncomeService(bytes, {
      ...options,
      fetch: (async () => Response.json({
        total_pages_scanned: 1,
        classifications: { 0: ['W2_WAGE'] },
        pages: [{ meanConfidence: 99 }],
        flags: [],
        w2Extracts: [{
          pageIndex: 0,
          year: 2025,
          employerName: 'FreeFlow Synthetic Payroll LLC',
          ein: '00-0000000',
          box1: 96_000,
          box5: 96_000,
          boxes: { box5: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
        }],
      })) as typeof fetch,
    }),
    persist: persistParsedExtraction,
  });
  const firstUpload = response();
  await uploadHandler(pdfRequest(loanId), firstUpload.res, context('standalone-lifecycle-upload-1'));
  assert.equal(firstUpload.state.status, 201);
  const attachmentId = String((firstUpload.state.body as { attachmentId: string }).attachmentId);

  const afterUpload = await lifecycleState(loanId);
  assert.equal(afterUpload.loan?.version, 2);
  assert.equal(afterUpload.loan?.encompassIntegrationMode, 'NONE');
  assert.equal(afterUpload.documents, 1);
  assert.equal(afterUpload.extractions.length, 1);
  const extractionId = afterUpload.extractions[0]!.id;

  const repeatedUpload = response();
  await uploadHandler(pdfRequest(loanId), repeatedUpload.res, context('standalone-lifecycle-upload-2'));
  assert.equal(repeatedUpload.state.status, 201);
  assert.equal((repeatedUpload.state.body as { attachmentId: string }).attachmentId, attachmentId);
  const afterReplay = await lifecycleState(loanId);
  assert.equal(afterReplay.loan?.version, 2);
  assert.equal(afterReplay.documents, 1);
  assert.equal(afterReplay.extractions.length, 1);

  const requirements = response();
  await createMetadataRequirementsHandler()(
    request('GET', { loanId, extractionId }),
    requirements.res,
    context('standalone-lifecycle-requirements'),
  );
  assert.equal(requirements.state.status, 200);
  assert.deepEqual((requirements.state.body as { requirements: unknown[] }).requirements, [{
    extractionId,
    entityId: 'w2-p0-0',
    field: 'employmentRole',
    form: 'W-2',
  }]);

  const reviewed = response();
  await createExtractionMetadataReviewHandler()(
    request('POST', { loanId, extractionId }, {
      expectedLoanVersion: 2,
      expectedMetadataVersion: 0,
      source: 'DOCUMENT_VISUAL_REVIEW',
      reasonCode: 'DOCUMENT_METADATA_CONFIRMED',
      reasonNarrative: null,
      assignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }],
    }, { 'idempotency-key': 'standalone-lifecycle-review-01' }),
    reviewed.res,
    context('standalone-lifecycle-review'),
  );
  assert.equal(reviewed.state.status, 201);
  assert.equal((reviewed.state.body as { loanVersion: number }).loanVersion, 3);

  const calculated = response();
  await createIncomeCalculationHandler()(
    request('POST', {}, { loanId, extractionIds: [extractionId] }),
    calculated.res,
    context('standalone-lifecycle-calculate'),
  );
  assert.equal(calculated.state.status, 200);
  assert.equal((calculated.state.body as { calculatedMonthlyIncome: number }).calculatedMonthlyIncome, 8000);
  const calculationId = String((calculated.state.body as { calculationId: string }).calculationId);

  const approved = response();
  await createIncomeApprovalHandler()(
    request('POST', { loanId }, {
      calculationId,
      expectedLoanVersion: 3,
      action: 'INCOME_APPROVED',
      reasonCode: 'UNDERWRITER_CONFIRMED',
      reasonNarrative: null,
      overrideQualifyingMonthlyIncome: null,
    }, { 'idempotency-key': 'standalone-lifecycle-approval-01' }),
    approved.res,
    context('standalone-lifecycle-approve'),
  );
  assert.equal(approved.state.status, 201);
  assert.equal((approved.state.body as { loanVersion: number }).loanVersion, 4);

  // Re-open through the real persisted console context, not an in-memory fixture.
  const reopened = response();
  await createConsoleContextHandler()(
    request('GET', { loanId }),
    reopened.res,
    context('standalone-lifecycle-reopen'),
  );
  assert.equal(reopened.state.status, 200);
  assert.equal((reopened.state.body as { approval: { current: boolean } }).approval.current, true);
  assert.equal((reopened.state.body as { loan: { version: number } }).loan.version, 4);

  const exportHandler = createApprovedIncomeExportHandler();
  const jsonExport = response();
  await exportHandler(request('GET', { loanId, format: 'json' }), jsonExport.res, context('standalone-lifecycle-export-json'));
  const mismoExport = response();
  await exportHandler(request('GET', { loanId, format: 'mismo' }), mismoExport.res, context('standalone-lifecycle-export-mismo'));
  const summaryExport = response();
  await exportHandler(request('GET', { loanId, format: 'summary' }), summaryExport.res, context('standalone-lifecycle-export-summary'));

  assert.deepEqual([jsonExport.state.status, mismoExport.state.status, summaryExport.state.status], [200, 200, 200]);
  const snapshotHash = String(jsonExport.state.headers['X-FreeFlow-Snapshot-Hash']);
  assert.match(snapshotHash, /^[0-9a-f]{64}$/);
  assert.equal(mismoExport.state.headers['X-FreeFlow-Snapshot-Hash'], snapshotHash);
  assert.equal(summaryExport.state.headers['X-FreeFlow-Snapshot-Hash'], snapshotHash);
  assert.equal(JSON.parse(String(jsonExport.state.body)).calculation.qualifyingMonthlyIncome, '8000.00');
  assert.match(String(mismoExport.state.body), /<FREEFLOW:QualifyingMonthlyIncomeAmount>8000\.00<\/FREEFLOW:QualifyingMonthlyIncomeAmount>/);
  assert.equal(mismoExport.state.headers['X-MISMO-Official-XSD-Validation'], 'NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED');
  assert.equal((summaryExport.state.body as Buffer).subarray(0, 5).toString('ascii'), '%PDF-');

  const repeatedJson = response();
  await exportHandler(request('GET', { loanId, format: 'json' }), repeatedJson.res, context('standalone-lifecycle-export-json-repeat'));
  assert.equal(repeatedJson.state.body, jsonExport.state.body);
  const finalState = await lifecycleState(loanId);
  assert.equal(finalState.loan?.version, 4);
  assert.equal(finalState.documents, 1);
  assert.equal(finalState.extractions.length, 1);
  assert.equal(finalState.calculations, 1);
  assert.equal(finalState.approvals, 1);
});

function context(requestId: string): RequestContext {
  return {
    requestId,
    subject: 'synthetic-underwriter',
    tenantId: TENANT,
    membershipId: USER,
    permissions: ['income:process', 'income:metadata:review', 'income:calculate', 'income:approve', 'loan:read'] as never,
    authTime: new Date('2026-10-11T08:00:00.000Z'),
  };
}

function request(
  method: string,
  query: Record<string, string>,
  body?: unknown,
  headers: Record<string, string> = {},
): NextApiRequest {
  return { method, query, body, headers } as unknown as NextApiRequest;
}

function pdfRequest(loanId: string): NextApiRequest {
  const req = Readable.from([Buffer.from('%PDF-synthetic-standalone-lifecycle')]) as NextApiRequest;
  req.method = 'POST';
  req.query = { loanId };
  req.headers = { 'content-type': 'application/pdf' };
  return req;
}

function response() {
  const state: { status?: number; body?: unknown; headers: Record<string, unknown> } = { headers: {} };
  const res = {
    setHeader(name: string, value: unknown) { state.headers[name] = value; return res; },
    status(code: number) { state.status = code; return res; },
    json(body: unknown) { state.body = body; return res; },
    send(body: unknown) { state.body = body; return res; },
  } as unknown as NextApiResponse;
  return { state, res };
}

async function lifecycleState(loanId: string) {
  return withTenantTransaction({ tenantId: TENANT, principalId: USER }, async (transaction) => ({
    loan: await transaction.loanApplication.findFirst({
      where: { tenantId: TENANT, id: loanId },
      select: { version: true, encompassIntegrationMode: true },
    }),
    documents: await transaction.loanDocument.count({ where: { tenantId: TENANT, loanId } }),
    extractions: await transaction.incomeExtraction.findMany({
      where: { tenantId: TENANT, loanId },
      select: { id: true },
    }),
    calculations: await transaction.form1084Audit.count({ where: { tenantId: TENANT, loanId } }),
    approvals: await transaction.auditEvent.count({
      where: { tenantId: TENANT, loanId, action: { in: ['INCOME_APPROVED', 'INCOME_OVERRIDE'] } },
    }),
  }));
}
