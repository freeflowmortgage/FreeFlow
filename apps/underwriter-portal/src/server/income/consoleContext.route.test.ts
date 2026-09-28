import assert from 'node:assert/strict';
import test from 'node:test';
import { createConsoleContextHandler } from './consoleContextRoute';

const context = { requestId: 'request-1', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as any;
const loan = { id: '00000000-0000-4000-8000-000000000201', version: 3, status: 'DOCS_UPLOADED', loanProgram: 'CONVENTIONAL', primaryBorrowerName: 'Synthetic Borrower', documents: [{ sourceAttachmentId: 'attachment-1', documentCategory: 'W2_WAGE', version: 1, sourcePageCount: 1, parserVersion: 'parser-v1' }], incomeExtractions: [{ id: '00000000-0000-4000-8000-000000000301', sourceAttachmentId: 'attachment-1', sourceDocumentVersion: 1, parserVersion: 'parser-v1', schemaVersion: 'income-extraction-v2', status: 'ACTIVE', warnings: [], confidence: { toString: () => '99.1' }, canonicalHash: 'a'.repeat(64), normalizedInput: { w2Records: [{ entityId: 'w2-1', employerName: 'Synthetic Employer', year: 2025, annualWages: 96000 }] }, evidence: { fields: [{ collection: 'w2Extracts', index: 0, field: 'box1', pageIndex: 0, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } }] }, metadataReviews: [{ id: '00000000-0000-4000-8000-000000000401', metadataVersion: 1, assignments: [], source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', createdAt: new Date(), extractionHash: 'a'.repeat(64) }] }], form1084Audits: [{ id: '00000000-0000-4000-8000-000000000501', calculatedLoanVersion: 3, qualifyingMonthlyIncome: { toString: () => '8123.45' }, trendingResult: 'CONVENTIONAL_STABLE_OR_INCREASING', yearsAnalyzed: [2025, 2024], calculationSchemaVersion: 'authoritative-extractions-v1', calculationSource: 'persisted-parser-extractions', createdAt: new Date() }], auditEvents: [{ id: '00000000-0000-4000-8000-000000000601', action: 'INCOME_APPROVED', entityId: '00000000-0000-4000-8000-000000000501', expectedLoanVersion: 3, occurredAt: new Date() }], encompassDocumentPullJobs: [], encompassSyncJobs: [], encompassHostWrites: [{ id: '00000000-0000-4000-8000-000000000701', status: 'SUCCEEDED', approvalEventId: '00000000-0000-4000-8000-000000000601', expectedLoanVersion: 3, fieldMapHash: 'b'.repeat(64), safeErrorCode: null, completedAt: new Date() }] };
function response() { const result: any = { statusCode: 200, body: undefined, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } }; return result; }
function request(loanId = loan.id) { return { method: 'GET', query: { loanId } } as any; }

test('returns only authoritative tenant-scoped context and marks current state', async () => {
  let where: any;
  const handler = createConsoleContextHandler({ withTenantTransaction: async (_: any, run: any) => run({ loanApplication: { findFirst: async (input: any) => { where = input.where; return loan; } } }) } as any);
  const res = response(); await handler(request(), res, context);
  assert.equal(res.statusCode, 200); assert.equal(where.tenantId, context.tenantId); assert.equal(res.body.calculation.current, true); assert.equal(res.body.approval.current, true); assert.equal(res.body.providerAttachmentListing.available, false);
  assert.deepEqual(res.body.extractions[0].normalizedInput, loan.incomeExtractions[0].normalizedInput);
  assert.deepEqual(res.body.extractions[0].evidence, loan.incomeExtractions[0].evidence);
  assert.equal(res.body.hostWrite.status, 'SUCCEEDED');
});

test('does not disclose a missing or cross-tenant loan', async () => {
  const handler = createConsoleContextHandler({ withTenantTransaction: async (_: any, run: any) => run({ loanApplication: { findFirst: async () => null } }) } as any);
  const res = response(); await handler(request(), res, context);
  assert.equal(res.statusCode, 404); assert.equal(res.body.error.code, 'LOAN_NOT_FOUND');
});

test('rejects malformed launch context before querying', async () => {
  let queried = false;
  const handler = createConsoleContextHandler({ withTenantTransaction: async () => { queried = true; return null; } } as any);
  const res = response(); await handler(request('not-a-uuid'), res, context);
  assert.equal(res.statusCode, 400); assert.equal(queried, false);
});
