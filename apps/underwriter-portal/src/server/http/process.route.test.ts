import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireTenantLoanAccess,
  resolveParserUrl,
  TenantLoanAccessError,
} from '../../pages/api/underwrite/process';

const context = {
  requestId: 'request-1', subject: 'subject-1',
  tenantId: '00000000-0000-4000-8000-000000000100',
  membershipId: '00000000-0000-4000-8000-000000000101',
  permissions: ['income:process'] as const, authTime: new Date(),
};

test('document processor URL fails closed when protected runtime configuration is missing', () => {
  assert.throws(
    () => resolveParserUrl({ NODE_ENV: 'production', FREEFLOW_RUNTIME_ENV: 'production' }),
    /Parser configuration is unavailable/,
  );
});

test('document processor URL fails closed when the parser feature is disabled', () => {
  assert.throws(
    () => resolveParserUrl({
      NODE_ENV: 'production',
      FREEFLOW_RUNTIME_ENV: 'development',
      PARSER_ENABLED: 'false',
      DOC_PARSER_URL: 'http://income-parser.freeflow.local:8080/api/underwrite/process',
    }),
    /Parser configuration is unavailable/,
  );
});

test('document processor URL rejects loopback dependencies in protected runtimes', () => {
  assert.throws(
    () => resolveParserUrl({
      NODE_ENV: 'production',
      FREEFLOW_RUNTIME_ENV: 'production',
      DOC_PARSER_URL: 'http://127.0.0.1:8080/parse',
    }),
    /Parser configuration is unavailable/,
  );
});

test('document processor URL allows the local parser only for non-protected runtimes', () => {
  assert.equal(
    resolveParserUrl({ NODE_ENV: 'development', FREEFLOW_RUNTIME_ENV: 'development' }),
    'http://127.0.0.1:8080/api/underwrite/process',
  );
});

test('document processor URL accepts a private service endpoint in protected runtimes', () => {
  assert.equal(
    resolveParserUrl({
      NODE_ENV: 'production',
      FREEFLOW_RUNTIME_ENV: 'production',
      DOC_PARSER_URL: 'http://income-parser.freeflow.local:8080/api/underwrite/process',
    }),
    'http://income-parser.freeflow.local:8080/api/underwrite/process',
  );
});

test('tenant loan access rejects a loan not owned by the authenticated tenant', async () => {
  const previous = process.env.FREEFLOW_RUNTIME_ENV;
  process.env.FREEFLOW_RUNTIME_ENV = 'production';
  try {
    await assert.rejects(
      () => requireTenantLoanAccess('00000000-0000-4000-8000-000000000200', context, async () => false),
      (error: unknown) => error instanceof TenantLoanAccessError && error.status === 404 && error.code === 'LOAN_NOT_FOUND',
    );
  } finally {
    process.env.FREEFLOW_RUNTIME_ENV = previous;
  }
});
