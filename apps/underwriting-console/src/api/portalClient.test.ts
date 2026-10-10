import assert from 'node:assert/strict';
import test from 'node:test';
import { PortalApiError, portalClient } from './portalClient';
import { describeProtectedError } from '../protectedErrorMessage';

test('shows a retryable message when document processing is unavailable', () => {
  const message = describeProtectedError(
    new PortalApiError(503, 'DOCUMENT_PROCESSOR_UNAVAILABLE', 'The uploaded document could not be processed.'),
    'Upload failed.',
  );
  assert.equal(message, 'The document processor is busy or temporarily unavailable. Please retry.');
});

test('document-pull requests use the protected portal API with same-origin cookies only', async () => {
  const originalFetch = globalThis.fetch;
  let received: { path: string; init: RequestInit | undefined } | undefined;
  globalThis.fetch = async (input, init) => {
    received = { path: String(input), init };
    return new Response(JSON.stringify({ jobId: 'job-1', status: 'QUEUED' }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await portalClient.createDocumentPull('loan/1', { expectedLoanVersion: 2, attachmentIds: ['attachment-1'] }, 'console-test-1');
    assert.equal(received?.path, '/api/v1/loans/loan%2F1/encompass-document-pulls');
    assert.equal(received?.init?.credentials, 'same-origin');
    const headers = new Headers(received?.init?.headers);
    assert.equal(headers.get('idempotency-key'), 'console-test-1');
    assert.equal(headers.has('x-tenant-id'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authentication failures are surfaced safely without logging payloads', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  try {
    await assert.rejects(() => portalClient.getDocumentPull('job-1'), (error: unknown) => error instanceof PortalApiError && error.status === 401 && error.code === 'AUTH_REQUIRED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upload intake uses only the same-origin protected portal route', async () => {
  const originalFetch = globalThis.fetch;
  let received: { path: string; init: RequestInit | undefined } | undefined;
  globalThis.fetch = async (input, init) => { received = { path: String(input), init }; return new Response(JSON.stringify({ source: 'UPLOAD', attachmentId: 'upload-1', status: 'PROCESSED' }), { status: 201, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await portalClient.uploadIncomeDocument('loan/1', new File(['%PDF-'], 'income.pdf', { type: 'application/pdf' }));
    assert.equal(received?.path, '/api/v1/loans/loan%2F1/income-documents');
    assert.equal(received?.init?.credentials, 'same-origin');
    assert.equal(new Headers(received?.init?.headers).has('x-tenant-id'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('comparison preview uses the authenticated memory-only route', async () => {
  const originalFetch = globalThis.fetch;
  let received: { path: string; init: RequestInit | undefined } | undefined;
  globalThis.fetch = async (input, init) => {
    received = { path: String(input), init };
    return Response.json({ transaction_id: 'preview', total_pages_scanned: 1, pages: [] });
  };
  try {
    const file = new File(['%PDF-preview'], 'income.pdf', { type: 'application/pdf' });
    await portalClient.previewIncomeDocument(file);
    assert.equal(received?.path, '/api/v1/income-document-preview');
    assert.equal(received?.init?.credentials, 'same-origin');
    assert.equal(received?.init?.body, file);
    const headers = new Headers(received?.init?.headers);
    assert.equal(headers.get('content-type'), 'application/pdf');
    assert.equal(headers.has('x-tenant-id'), false);
  } finally { globalThis.fetch = originalFetch; }
});
