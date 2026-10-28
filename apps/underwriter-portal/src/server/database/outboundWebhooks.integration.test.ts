import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../auth/requestContext';
import { permissionsForRole } from '../auth/permissions';
import { createIncomeApprovalHandler } from '../audit/incomeApprovalsRoute';
import { createApprovedIncomeExportHandler } from '../http/approvedIncomeExportsRoute';
import { createExtractionMetadataReviewHandler } from '../income/extractionMetadataReviewRoute';
import { createStandaloneLoanHandler } from '../income/standaloneLoanRoute';
import { parseWithIncomeService } from '../integrations/encompass/encompassApi';
import { persistParsedExtraction } from '../integrations/encompass/documentPullWorkerRuntime';
import { createUploadIncomeDocumentHandler } from '../integrations/encompass/uploadIncomeDocumentRoute';
import {
  createWebhookDeliveriesHandler,
  createWebhookEndpointHandler,
  createWebhookRedeliveryHandler,
  createWebhookSecretRotationHandler,
} from '../integrations/webhooks/adminRoutes';
import { runDeliveryBatch } from '../integrations/webhooks/deliveryWorker';
import { createWebhookWorkerDependencies } from '../integrations/webhooks/deliveryWorkerRuntime';
import { enqueueApprovedIncomeWebhook } from '../integrations/webhooks/enqueue';
import { createWebhookSecretStore } from '../integrations/webhooks/secretStore';
import { sendWebhookRequest } from '../integrations/webhooks/sender';
import { verifyWebhookSignature } from '../integrations/webhooks/signing';
import { startTestHttpsReceiver } from '../integrations/webhooks/testHttpsReceiver';
import type { WebhookEgressPolicy } from '../integrations/webhooks/urlPolicy';
import { createIncomeCalculationHandler } from '../../pages/api/income/calculate';
import { prisma, withTenantTransaction } from './client';

const TENANT = '00000000-0000-4000-8000-000000000200';
const ADMIN = '00000000-0000-4000-8000-000000000201';
const EMPLOYER = 'FreeFlow Synthetic Webhook Payroll LLC';
const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL;
const workerDatabaseUrl = process.env.WORKER_DATABASE_URL;
assert.ok(adminDatabaseUrl, 'ADMIN_DATABASE_URL is required for the outbound webhook database fixture.');
assert.ok(workerDatabaseUrl, 'WORKER_DATABASE_URL is required to deliver through the restricted worker role.');
const fixtureAdmin = new PrismaClient({ datasources: { db: { url: adminDatabaseUrl } } });
const workerClient = new PrismaClient({ datasources: { db: { url: workerDatabaseUrl } } });
const secretStore = createWebhookSecretStore({
  FREEFLOW_RUNTIME_ENV: 'test',
  OUTBOUND_WEBHOOK_LOCAL_SIGNING_SEED: 'integration-test-seed-that-is-long-enough',
} as unknown as NodeJS.ProcessEnv);
const policy: WebhookEgressPolicy = { protectedRuntime: false, allowedHosts: ['localhost'], allowPrivateTargets: true };
const adminRouteDependencies = {
  withTenantTransaction,
  secretStore: () => secretStore,
  egressPolicy: () => policy,
  assertRecentAuthentication: () => undefined,
};
const originalParserUrl = process.env.DOC_PARSER_SERVICE_URL;
process.env.DOC_PARSER_SERVICE_URL = 'http://synthetic-parser.invalid/parse';
let receiver: Awaited<ReturnType<typeof startTestHttpsReceiver>>;
let clockOffsetMs = 0;
const currentTime = () => Date.now() + clockOffsetMs;

before(async () => {
  receiver = await startTestHttpsReceiver();
  await fixtureAdmin.tenant.create({
    data: {
      id: TENANT,
      companyName: 'FreeFlow Synthetic Webhook Tenant',
      primaryContactEmail: 'webhook-tenant@example.invalid',
      users: {
        create: {
          id: ADMIN,
          email: 'webhook-owner@example.invalid',
          oidcSubject: 'webhook-synthetic-owner',
          firstName: 'Synthetic',
          lastName: 'Owner',
          role: 'BROKER_OWNER',
        },
      },
    },
  });
});

after(async () => {
  if (originalParserUrl === undefined) delete process.env.DOC_PARSER_SERVICE_URL;
  else process.env.DOC_PARSER_SERVICE_URL = originalParserUrl;
  await receiver.close();
  await Promise.all([prisma.$disconnect(), fixtureAdmin.$disconnect(), workerClient.$disconnect()]);
});

test('an approved standalone loan is signed and delivered by the worker role without retaining payload data', async () => {
  const configured = response();
  await createWebhookEndpointHandler(adminRouteDependencies)(
    request('PUT', {}, { url: receiver.url(), isEnabled: true, expectedVersion: null }, { 'idempotency-key': 'webhook-endpoint-create-01' }),
    configured.res,
    context('webhook-endpoint-create'),
  );
  assert.equal(configured.state.status, 201);
  const firstSecret = String((configured.state.body as { signingSecret: string }).signingSecret);
  assert.match(firstSecret, /^whsec_/);

  const replayed = response();
  await createWebhookEndpointHandler(adminRouteDependencies)(
    request('PUT', {}, { url: receiver.url(), isEnabled: true, expectedVersion: null }, { 'idempotency-key': 'webhook-endpoint-create-01' }),
    replayed.res,
    context('webhook-endpoint-create-replay'),
  );
  assert.equal(replayed.state.status, 200);
  assert.equal((replayed.state.body as { signingSecret: unknown }).signingSecret, null);
  assert.equal((replayed.state.body as { replayed: boolean }).replayed, true);

  const { loanId, approvalEventId } = await approveStandaloneLoan('webhook-a');
  const queued = await deliveriesFor(loanId);
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.status, 'PENDING');
  assert.equal(queued[0]!.approvalEventId, approvalEventId);
  assert.equal(queued[0]!.approvedLoanVersion, 3);
  assert.equal(await auditCount(loanId, 'OUTBOUND_WEBHOOK_QUEUED'), 1);

  const logs = await captureLogs(() => runWorker());
  assert.deepEqual(logs.result, { scanned: 1, succeeded: 1, retried: 0, failed: 0, superseded: 0, skipped: 0 });
  assert.equal(receiver.received.length, 1);
  const delivered = receiver.received[0]!;
  assert.equal(verifyWebhookSignature({
    secret: firstSecret,
    id: delivered.headers['freeflow-webhook-id'] as string,
    timestamp: delivered.headers['freeflow-webhook-timestamp'] as string,
    signature: delivered.headers['freeflow-webhook-signature'] as string,
    body: delivered.body,
  }), true);
  assert.equal(delivered.headers['freeflow-webhook-id'], queued[0]!.id);
  const payload = JSON.parse(delivered.body) as { id: string; type: string; apiVersion: string; data: Record<string, unknown> };
  assert.equal(payload.id, queued[0]!.id);
  assert.equal(payload.type, 'income.approved');
  assert.equal(payload.apiVersion, 'freeflow-webhook-v1');

  const jsonExport = response();
  await createApprovedIncomeExportHandler()(request('GET', { loanId, format: 'json' }), jsonExport.res, context('webhook-export'));
  assert.deepEqual(payload.data, JSON.parse(String(jsonExport.state.body)));
  const succeeded = (await deliveriesFor(loanId))[0]!;
  assert.equal(succeeded.status, 'SUCCEEDED');
  assert.equal(succeeded.attemptCount, 1);
  assert.equal(succeeded.lastResponseStatus, 204);
  assert.equal(succeeded.deliveredSnapshotHash, jsonExport.state.headers['X-FreeFlow-Snapshot-Hash']);
  assert.equal(await auditCount(loanId, 'OUTBOUND_WEBHOOK_DELIVERED'), 1);

  for (const line of logs.lines) {
    assert.doesNotMatch(line, new RegExp([loanId, queued[0]!.id, TENANT, firstSecret, 'localhost'].join('|')));
  }

  const rotated = response();
  await createWebhookSecretRotationHandler(adminRouteDependencies)(
    request('POST', {}, { expectedVersion: 1 }, { 'idempotency-key': 'webhook-secret-rotate-01' }),
    rotated.res,
    context('webhook-rotate'),
  );
  assert.equal(rotated.state.status, 200);
  const secondSecret = String((rotated.state.body as { signingSecret: string }).signingSecret);
  assert.notEqual(secondSecret, firstSecret);

  receiver.respondWith([503]);
  const redelivery = response();
  await createWebhookRedeliveryHandler(adminRouteDependencies)(
    request('POST', { deliveryId: queued[0]!.id }, undefined, { 'idempotency-key': 'webhook-redeliver-01' }),
    redelivery.res,
    context('webhook-redeliver'),
  );
  assert.equal(redelivery.state.status, 202);
  assert.equal(await auditCount(loanId, 'OUTBOUND_WEBHOOK_REDELIVERY_REQUESTED'), 1);

  const retry = await runWorker();
  assert.equal(retry.retried, 1);
  const retrying = (await deliveriesFor(loanId))[0]!;
  assert.equal(retrying.status, 'RETRYABLE_FAILURE');
  assert.equal(retrying.safeErrorCode, 'RECEIVER_RETRYABLE_STATUS');
  assert.equal(retrying.lastResponseStatus, 503);
  assert.ok(retrying.nextAttemptAt.getTime() >= currentTime() + 20_000);
  const rotatedHeaders = receiver.received[1]!.headers;
  assert.equal(String(rotatedHeaders['freeflow-webhook-signature']).split(' ').length, 2);
  for (const secret of [firstSecret, secondSecret]) {
    assert.equal(verifyWebhookSignature({
      secret,
      id: rotatedHeaders['freeflow-webhook-id'] as string,
      timestamp: rotatedHeaders['freeflow-webhook-timestamp'] as string,
      signature: rotatedHeaders['freeflow-webhook-signature'] as string,
      body: receiver.received[1]!.body,
    }), true);
  }

  assert.equal((await runWorker()).scanned, 0, 'a retry must wait for its backoff');
  receiver.respondWith([204]);
  clockOffsetMs += 10 * 60_000;
  const recovered = await runWorker();
  assert.equal(recovered.succeeded, 1);
  assert.equal((await deliveriesFor(loanId))[0]!.attemptCount, 2);

  const listed = response();
  await createWebhookDeliveriesHandler(adminRouteDependencies)(request('GET', { loanId }), listed.res, context('webhook-list'));
  assert.equal(listed.state.status, 200);
  assert.deepEqual(
    (listed.state.body as { deliveries: { id: string; status: string }[] }).deliveries.map((row) => [row.id, row.status]),
    [[queued[0]!.id, 'SUCCEEDED']],
  );

  const stored = await fixtureAdmin.$queryRaw<{ row: string }[]>`
    SELECT row_to_json(d)::text AS row FROM "outbound_webhook_deliveries" d WHERE d."tenantId" = ${TENANT}::uuid
    UNION ALL
    SELECT row_to_json(e)::text FROM "outbound_webhook_endpoints" e WHERE e."tenantId" = ${TENANT}::uuid
    UNION ALL
    SELECT row_to_json(a)::text FROM "outbound_webhook_endpoint_audit_events" a WHERE a."tenantId" = ${TENANT}::uuid
  `;
  assert.ok(stored.length >= 3);
  for (const { row } of stored) {
    for (const marker of ['8000.00', EMPLOYER, 'borrower-1', 'whsec_', firstSecret, secondSecret, 'receiver body', 'qualifyingMonthlyIncome']) {
      assert.equal(row.includes(marker), false, `webhook storage retained ${marker}`);
    }
  }
});

test('a delivery whose approval is no longer current is superseded instead of sent', async () => {
  const { loanId } = await approveStandaloneLoan('webhook-b');
  const [delivery] = await deliveriesFor(loanId);
  assert.equal(delivery!.status, 'PENDING');
  await fixtureAdmin.loanApplication.update({ where: { id: loanId }, data: { version: { increment: 1 } } });
  const sentBefore = receiver.received.length;
  const result = await runWorker();
  assert.equal(result.superseded, 1);
  assert.equal(receiver.received.length, sentBefore);
  const finished = (await deliveriesFor(loanId))[0]!;
  assert.equal(finished.status, 'SUPERSEDED');
  assert.equal(finished.safeErrorCode, 'APPROVAL_SUPERSEDED');
  assert.equal(await auditCount(loanId, 'OUTBOUND_WEBHOOK_SUPERSEDED'), 1);
});

test('Encompass-linked loans and disabled endpoints are never queued', async () => {
  const { loanId, approvalEventId } = await approveStandaloneLoan('webhook-c');
  await fixtureAdmin.loanApplication.update({ where: { id: loanId }, data: { encompassIntegrationMode: 'CUSTOM_CONNECTOR' } });
  const encompass = await withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, (transaction) => (
    enqueueApprovedIncomeWebhook(transaction, context('webhook-encompass'), { loanId, approvalEventId, approvedLoanVersion: 3 })
  ));
  assert.equal(encompass, null);
  assert.equal((await deliveriesFor(loanId)).length, 1);
  await fixtureAdmin.loanApplication.update({ where: { id: loanId }, data: { encompassIntegrationMode: 'NONE' } });

  const endpoint = await withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, (transaction) => (
    transaction.outboundWebhookEndpoint.findFirstOrThrow({ where: { tenantId: TENANT }, select: { version: true, url: true } })
  ));
  const disabled = response();
  await createWebhookEndpointHandler(adminRouteDependencies)(
    request('PUT', {}, { url: endpoint.url, isEnabled: false, expectedVersion: endpoint.version }, { 'idempotency-key': 'webhook-endpoint-disable-01' }),
    disabled.res,
    context('webhook-disable'),
  );
  assert.equal(disabled.state.status, 200);
  const whileDisabled = await withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, (transaction) => (
    enqueueApprovedIncomeWebhook(transaction, context('webhook-disabled'), { loanId, approvalEventId, approvedLoanVersion: 3 })
  ));
  assert.equal(whileDisabled, null);

  const result = await runWorker();
  assert.equal(result.failed, 1, 'a queued delivery for a since-disabled endpoint is dead-lettered');
  assert.equal((await deliveriesFor(loanId))[0]!.safeErrorCode, 'WEBHOOK_ENDPOINT_DISABLED');
});

async function runWorker() {
  return runDeliveryBatch(createWebhookWorkerDependencies({
    client: workerClient,
    secretStore,
    policy,
    transport: sendWebhookRequest,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    now: () => new Date(currentTime()),
    random: () => 0.5,
  }), 10);
}

async function captureLogs<T>(operation: () => Promise<T>) {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...values: unknown[]) => { lines.push(values.map(String).join(' ')); };
  try {
    return { result: await operation(), lines };
  } finally {
    console.info = original;
  }
}

async function approveStandaloneLoan(prefix: string) {
  const created = response();
  await createStandaloneLoanHandler()(
    request('POST', {}, {
      schemaVersion: 'freeflow-standalone-loan-v1',
      loanProgram: 'CONVENTIONAL',
      borrowers: [{ borrowerKey: 'borrower-1', role: 'PRIMARY' }],
    }, { 'idempotency-key': `${prefix}-create-0001` }),
    created.res,
    context(`${prefix}-create`),
  );
  assert.equal(created.state.status, 201);
  const loanId = String((created.state.body as { loanId: string }).loanId);

  const uploaded = response();
  await createUploadIncomeDocumentHandler({
    withTenantTransaction,
    parse: (bytes, options) => parseWithIncomeService(bytes, {
      ...options,
      fetch: (async () => Response.json({
        total_pages_scanned: 1,
        classifications: { 0: ['W2_WAGE'] },
        pages: [{ meanConfidence: 99 }],
        flags: [],
        w2Extracts: [{
          pageIndex: 0, year: 2025, employerName: EMPLOYER, ein: '00-0000000', box1: 96_000, box5: 96_000,
          boxes: { box5: { x: 0.1, y: 0.2, w: 0.3, h: 0.04 } },
        }],
      })) as typeof fetch,
    }),
    persist: persistParsedExtraction,
  })(pdfRequest(loanId, prefix), uploaded.res, context(`${prefix}-upload`));
  assert.equal(uploaded.state.status, 201);
  const extractionId = await withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, async (transaction) => (
    (await transaction.incomeExtraction.findFirstOrThrow({ where: { tenantId: TENANT, loanId }, select: { id: true } })).id
  ));

  const reviewed = response();
  await createExtractionMetadataReviewHandler()(
    request('POST', { loanId, extractionId }, {
      expectedLoanVersion: 2,
      expectedMetadataVersion: 0,
      source: 'DOCUMENT_VISUAL_REVIEW',
      reasonCode: 'DOCUMENT_METADATA_CONFIRMED',
      reasonNarrative: null,
      assignments: [{ entityId: 'w2-p0-0', employmentRole: 'CURRENT' }],
    }, { 'idempotency-key': `${prefix}-review-0001` }),
    reviewed.res,
    context(`${prefix}-review`),
  );
  assert.equal(reviewed.state.status, 201);

  const calculated = response();
  await createIncomeCalculationHandler()(
    request('POST', {}, { loanId, extractionIds: [extractionId] }),
    calculated.res,
    context(`${prefix}-calculate`),
  );
  assert.equal(calculated.state.status, 200);

  const approved = response();
  await createIncomeApprovalHandler()(
    request('POST', { loanId }, {
      calculationId: String((calculated.state.body as { calculationId: string }).calculationId),
      expectedLoanVersion: 3,
      action: 'INCOME_APPROVED',
      reasonCode: 'UNDERWRITER_CONFIRMED',
      reasonNarrative: null,
      overrideQualifyingMonthlyIncome: null,
    }, { 'idempotency-key': `${prefix}-approval-0001` }),
    approved.res,
    context(`${prefix}-approve`),
  );
  assert.equal(approved.state.status, 201);
  return { loanId, approvalEventId: String((approved.state.body as { auditEventId: string }).auditEventId) };
}

async function deliveriesFor(loanId: string) {
  return withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, (transaction) => (
    transaction.outboundWebhookDelivery.findMany({ where: { tenantId: TENANT, loanId }, orderBy: { createdAt: 'asc' } })
  ));
}

async function auditCount(loanId: string, action: string) {
  return withTenantTransaction({ tenantId: TENANT, principalId: ADMIN }, (transaction) => (
    transaction.auditEvent.count({ where: { tenantId: TENANT, loanId, action } })
  ));
}

function context(requestId: string): RequestContext {
  return {
    requestId,
    subject: 'webhook-synthetic-owner',
    tenantId: TENANT,
    membershipId: ADMIN,
    permissions: permissionsForRole('BROKER_OWNER'),
    authTime: new Date(),
    authTimeAsserted: true,
  };
}

function request(method: string, query: Record<string, string>, body?: unknown, headers: Record<string, string> = {}): NextApiRequest {
  return { method, query, body, headers } as unknown as NextApiRequest;
}

function pdfRequest(loanId: string, marker: string): NextApiRequest {
  const req = Readable.from([Buffer.from(`%PDF-synthetic-${marker}`)]) as NextApiRequest;
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
