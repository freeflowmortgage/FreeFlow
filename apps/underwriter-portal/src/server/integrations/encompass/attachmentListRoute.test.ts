import assert from 'node:assert/strict';
import test from 'node:test';
import { createAttachmentListHandler } from './attachmentListRoute';

const context = { requestId: 'request-1', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', membershipId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as any;
const loanId = '00000000-0000-4000-8000-000000000201';
function response() { const value: any = { statusCode: 200, body: null, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } }; return value; }
function request(id = loanId) { return { method: 'GET', query: { loanId: id } } as any; }

test('lists only allowlisted attachment selector metadata for an authorized tenant loan', async () => {
  const handler = createAttachmentListHandler({ withTenantTransaction: async (_: any, run: any) => run({ loanApplication: { findFirst: async (query: any) => { assert.equal(query.where.tenantId, context.tenantId); return { id: loanId, encompassGuid: 'provider-loan', tenant: { encompassConnectorBinding: { lenderId: 'lender', deploymentId: 'deployment', isEnabled: true } } }; } } }), list: async () => [{ id: 'document-1', ignored: 'provider-body' } as any] } as any);
  const res = response(); await handler(request(), res, context);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.attachments, [{ id: 'document-1', status: 'SELECTABLE' }]);
});

test('does not disclose cross-tenant or missing loans', async () => {
  const handler = createAttachmentListHandler({ withTenantTransaction: async (_: any, run: any) => run({ loanApplication: { findFirst: async () => null } }), list: async () => [] } as any);
  const res = response(); await handler(request(), res, context);
  assert.equal(res.statusCode, 404); assert.equal(res.body.error.code, 'LOAN_NOT_FOUND');
});

test('rejects malformed loan identifiers before data access', async () => {
  let queried = false;
  const handler = createAttachmentListHandler({ withTenantTransaction: async () => { queried = true; }, list: async () => [] } as any);
  const res = response(); await handler(request('bad'), res, context);
  assert.equal(res.statusCode, 400); assert.equal(queried, false);
});
