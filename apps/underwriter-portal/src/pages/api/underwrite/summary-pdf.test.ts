import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSummaryData, SummaryDataError } from './summary-pdf';

const requestContext = {
  requestId: '016cbe8e-43d5-4b84-b2a9-04ef3d5b0a37',
  subject: 'synthetic-underwriter',
  tenantId: '00000000-0000-4000-8000-000000000100',
  membershipId: '00000000-0000-4000-8000-000000000101',
  permissions: ['loan:read'] as const,
  authTime: new Date('2026-09-09T00:00:00.000Z'),
};

test('protected summary export fails closed instead of rendering synthetic calculation data', async () => {
  await assert.rejects(
    () => loadSummaryData('00000000-0000-4000-8000-000000000200', requestContext, true),
    (error: unknown) => (
      error instanceof SummaryDataError &&
      error.status === 503 &&
      error.code === 'SUMMARY_DATA_UNAVAILABLE'
    ),
  );
});
