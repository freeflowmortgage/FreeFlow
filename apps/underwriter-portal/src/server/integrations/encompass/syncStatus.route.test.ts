import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { createEncompassSyncStatusHandler } from './syncStatusRoute';

const TENANT = '00000000-0000-4000-8000-000000000100';
const USER = '00000000-0000-4000-8000-000000000101';
const JOB = '00000000-0000-4000-8000-000000000400';
const context = {
  requestId: 'request-1', tenantId: TENANT, membershipId: USER,
} as RequestContext;

test('sync status strips legacy value hashes from per-field readback', async () => {
  const fieldReadback = {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: true,
    fields: [{
      fieldName: 'CX.FREEFLOW.W2.VARIABLE',
      status: 'SUCCESS',
      reasonCode: 'VALUE_CONFIRMED',
      expectedValueSha256: 'a'.repeat(64),
      actualValueSha256: 'a'.repeat(64),
    }],
  };
  let query: unknown;
  const handler = createEncompassSyncStatusHandler({
    withTenantTransaction: (async (scope, operation) => {
      assert.deepEqual(scope, { tenantId: TENANT, principalId: USER });
      return operation({
        encompassSyncJob: {
          findFirst: async (input: unknown) => {
            query = input;
            return { id: JOB, status: 'SUCCEEDED', fieldReadback };
          },
        },
      } as never);
    }) as never,
  });
  const { response, state } = responseRecorder();
  await handler({ method: 'GET', query: { jobId: JOB } } as unknown as NextApiRequest, response, context);
  assert.equal(state.status, 200);
  assert.deepEqual((state.body as any).fieldReadback, {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: true,
    fields: [{
      fieldName: 'CX.FREEFLOW.W2.VARIABLE',
      status: 'SUCCESS',
      reasonCode: 'VALUE_CONFIRMED',
    }],
  });
  assert.equal((query as any).where.tenantId, TENANT);
  assert.equal((query as any).select.fieldReadback, true);
  assert.equal(JSON.stringify(state.body).includes('4000.00'), false);
  assert.doesNotMatch(JSON.stringify(state.body), /ValueSha256/);
});

test('sync status never echoes malformed or raw provider content persisted in readback JSON', async () => {
  const malicious = {
    schemaVersion: 'encompass-field-readback-v1',
    allSucceeded: false,
    fields: [{
      fieldName: 'CX.FREEFLOW.W2.VARIABLE',
      status: 'REJECTED',
      reasonCode: 'PROVIDER_REJECTED',
      expectedValueSha256: 'a'.repeat(64),
      rawValue: '1600.00',
      providerMessage: 'sensitive provider response',
    }],
  };
  const handler = createEncompassSyncStatusHandler({
    withTenantTransaction: (async (_scope, operation) => operation({
      encompassSyncJob: { findFirst: async () => ({ id: JOB, status: 'FAILED', fieldReadback: malicious }) },
    } as never)) as never,
  });
  const { response, state } = responseRecorder();
  await handler({ method: 'GET', query: { jobId: JOB } } as unknown as NextApiRequest, response, context);
  assert.equal(state.status, 503);
  assert.equal((state.body as any).error.code, 'ENCOMPASS_FIELD_READBACK_INVALID');
  assert.equal(JSON.stringify(state.body).includes('1600.00'), false);
  assert.equal(JSON.stringify(state.body).includes('sensitive provider response'), false);
});

function responseRecorder() {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    setHeader() { return response; },
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
  } as unknown as NextApiResponse;
  return { response, state };
}
