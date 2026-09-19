/**
 * Mortgage QA EncompassConnector contract cases (ECC-01..21).
 *
 * Mapped onto the landed interface: listActiveAttachments + downloadOriginalAttachment.
 * Tenant isolation is enforced by the separate connector service (this suite uses an
 * in-memory fake). Custom is primary. Developer Connect stays OFF. No LIVE ECS / ICE calls.
 *
 * Deferred — methods not on EncompassConnector yet:
 *   ECC-07 getAttachmentMetadata
 *   ECC-09 / ECC-10 getStatus
 *   ECC-15 / ECC-16 writebackApproval
 *
 * Deferred — orchestration / LIVE only:
 *   ECC-14 FreeFlow job idempotency key replay (orchestrator concern; connector download is read-only)
 *   LIVE ECS / mTLS variants of ECC-01..10, 17..19
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CONNECTOR_SERVICE_CONTRACT,
  CustomConnectorAdapter,
  EncompassConnectorError,
  FREEFLOW_DEV_CONNECTOR_BINDING,
  MAX_CONNECTOR_PDF_BYTES,
  assertNoLosCredentials,
  createEncompassConnector,
  createLenderConnectorBinding,
  type ConnectorServiceDownloadRequest,
  type EncompassConnector,
  type EncompassConnectorContext,
} from '../src/index';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const LOAN_REF_A = 'loan-ref-a';
const LOAN_REF_B = 'loan-ref-b';
const ATT_1 = 'att-1';
const ATT_BAD = 'att-bad';
const ATT_OVERSIZE = 'att-oversize';
const ATT_UNKNOWN = 'att-unknown';
const BORROWER_NAME = 'Jane Borrower';
const PROVIDER_SECRET = 'ice-provider-secret-must-not-leak';

const BINDING_A = createLenderConnectorBinding({
  lenderId: 'lender-a',
  deploymentId: 'binding-a',
  serviceBaseUrl: 'https://connector-a.example.test',
});
const BINDING_B = createLenderConnectorBinding({
  lenderId: 'lender-b',
  deploymentId: 'binding-b',
  serviceBaseUrl: 'https://connector-b.example.test',
});

const AUTH_A = 'Bearer tenant-a-service';
const AUTH_B = 'Bearer tenant-b-service';

const CONTEXT_A: EncompassConnectorContext = {
  tenantId: TENANT_A,
  loanId: 'loan-a',
  correlationId: 'corr-a',
};
const CONTEXT_B: EncompassConnectorContext = {
  tenantId: TENANT_B,
  loanId: 'loan-b',
  correlationId: 'corr-b',
};

const PDF_ATT_1 = new TextEncoder().encode('%PDF-1.7 synthetic-att-1');
const PDF_ATT_1_SHA256 = createHash('sha256').update(PDF_ATT_1).digest('hex');
const NON_PDF = new TextEncoder().encode('PK\x03\x04-not-a-pdf');

const LEAK_TOKENS = [
  BORROWER_NAME,
  PROVIDER_SECRET,
  'clientSecret',
  'clientId',
  'instanceId',
  'accessToken',
  AUTH_A,
  AUTH_B,
  '%PDF-',
];

function leakyProviderBody(): string {
  return JSON.stringify({
    message: 'ICE provider dump',
    borrowerName: BORROWER_NAME,
    clientSecret: PROVIDER_SECRET,
    instanceId: 'not-a-real-ice-instance',
    attachments: [{ id: ATT_1, title: `W-2 ${BORROWER_NAME}` }],
  });
}

function header(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || headers instanceof Headers) {
    return '';
  }
  return String((headers as Record<string, string>)[name] ?? '');
}

type FakeAttachment =
  | { kind: 'pdf'; bytes: Uint8Array; sha256: string }
  | { kind: 'not-pdf'; bytes: Uint8Array }
  | { kind: 'oversize' };

type FakeTenant = {
  tenantId: string;
  auth: string;
  lenderId: string;
  deploymentId: string;
  origin: string;
  loans: Record<string, Record<string, FakeAttachment>>;
};

function createFakeConnectorFetch(): typeof fetch {
  const tenants: FakeTenant[] = [
    {
      tenantId: TENANT_A,
      auth: AUTH_A,
      lenderId: BINDING_A.lenderId,
      deploymentId: BINDING_A.deploymentId,
      origin: new URL(BINDING_A.serviceBaseUrl!).origin,
      loans: {
        [LOAN_REF_A]: {
          [ATT_1]: { kind: 'pdf', bytes: PDF_ATT_1, sha256: PDF_ATT_1_SHA256 },
          [ATT_BAD]: { kind: 'not-pdf', bytes: NON_PDF },
          [ATT_OVERSIZE]: { kind: 'oversize' },
        },
      },
    },
    {
      tenantId: TENANT_B,
      auth: AUTH_B,
      lenderId: BINDING_B.lenderId,
      deploymentId: BINDING_B.deploymentId,
      origin: new URL(BINDING_B.serviceBaseUrl!).origin,
      loans: {
        [LOAN_REF_B]: {
          [ATT_1]: { kind: 'pdf', bytes: PDF_ATT_1, sha256: PDF_ATT_1_SHA256 },
        },
      },
    },
  ];

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as ConnectorServiceDownloadRequest;
    const auth = header(init, 'authorization');
    const tenant = tenants.find((item) => item.auth === auth);

    if (!auth || !tenant) {
      return new Response(leakyProviderBody(), { status: 401 });
    }
    if (
      body.tenantId !== tenant.tenantId
      || body.lenderId !== tenant.lenderId
      || body.deploymentId !== tenant.deploymentId
      || url.origin !== tenant.origin
    ) {
      return new Response(leakyProviderBody(), { status: 403 });
    }

    const loan = tenant.loans[body.loanGuid];
    if (!loan) {
      return new Response(leakyProviderBody(), { status: 404 });
    }

    if (url.pathname === CONNECTOR_SERVICE_CONTRACT.listPath) {
      return Response.json({
        attachments: Object.entries(loan)
          .filter(([, attachment]) => attachment.kind === 'pdf')
          .map(([id]) => ({
            id,
            title: `W-2 ${BORROWER_NAME}`,
            borrowerName: BORROWER_NAME,
            clientSecret: PROVIDER_SECRET,
          })),
      });
    }

    if (url.pathname === CONNECTOR_SERVICE_CONTRACT.downloadPath) {
      const attachment = loan[body.attachmentId];
      if (!attachment) {
        return new Response(leakyProviderBody(), { status: 404 });
      }
      if (attachment.kind === 'oversize') {
        return new Response(null, {
          status: 200,
          headers: { 'content-length': String(MAX_CONNECTOR_PDF_BYTES + 1) },
        });
      }
      if (attachment.kind === 'not-pdf') {
        return new Response(attachment.bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response(attachment.bytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'x-content-sha256': attachment.sha256,
        },
      });
    }

    return new Response(leakyProviderBody(), { status: 404 });
  }) as typeof fetch;
}

function connectorFor(
  binding: ReturnType<typeof createLenderConnectorBinding>,
  authorizationHeader: string,
  fetchImpl: typeof fetch = createFakeConnectorFetch(),
): EncompassConnector {
  return createEncompassConnector({
    binding,
    connectorServiceAuth: { authorizationHeader },
    fetch: fetchImpl,
  });
}

function assertSafeError(
  error: unknown,
  expected: { safeCode: string; retryable: boolean },
  extraLeaks: string[] = [],
): void {
  assert.ok(error instanceof EncompassConnectorError, `expected EncompassConnectorError, got ${String(error)}`);
  assert.equal(error.safeCode, expected.safeCode);
  assert.equal(error.retryable, expected.retryable);
  const blob = `${error.name}\n${error.safeCode}\n${error.message}\n${error.stack ?? ''}`;
  for (const leak of [...LEAK_TOKENS, ...extraLeaks]) {
    assert.equal(blob.includes(leak), false, `error leaked ${JSON.stringify(leak)}`);
  }
}

async function assertRejectsSafe(
  run: () => Promise<unknown>,
  expected: { safeCode: string; retryable: boolean },
  extraLeaks: string[] = [],
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assertSafeError(error, expected, extraLeaks);
    return true;
  });
}

test('ECC-01: Tenant A + LoanRef-A lists attachment ids only (no borrower titles/names)', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  const listed = await connector.listActiveAttachments(CONTEXT_A, LOAN_REF_A);
  assert.deepEqual(listed, [{ id: ATT_1 }]);
  assert.deepEqual(listed.map((item) => Object.keys(item)), [['id']]);
  assert.equal(JSON.stringify(listed).includes(BORROWER_NAME), false);
  assert.equal(JSON.stringify(listed).includes(PROVIDER_SECRET), false);
  assert.equal(JSON.stringify(listed).includes('W-2'), false);
});

test('ECC-02: Tenant B context + LoanRef-A is denied with no Tenant A disclosure', async () => {
  const connector = connectorFor(BINDING_B, AUTH_B);
  await assertRejectsSafe(
    () => connector.listActiveAttachments(CONTEXT_B, LOAN_REF_A),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_404', retryable: false },
    [ATT_1, LOAN_REF_A, TENANT_A],
  );
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_B, LOAN_REF_A, ATT_1),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_404', retryable: false },
    [ATT_1, TENANT_A, BORROWER_NAME],
  );
});

test('ECC-03: Binding A cannot be used under Tenant B context', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  await assertRejectsSafe(
    () => connector.listActiveAttachments(CONTEXT_B, LOAN_REF_A),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_403', retryable: false },
    [ATT_1, BORROWER_NAME],
  );
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_B, LOAN_REF_A, ATT_1),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_403', retryable: false },
    [ATT_1, BORROWER_NAME],
  );
});

test('ECC-04: download of Att-1 returns PDF bytes and sha256', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  const downloaded = await connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_1);
  assert.equal(new TextDecoder().decode(downloaded.bytes.subarray(0, 5)), '%PDF-');
  assert.equal(downloaded.sha256, PDF_ATT_1_SHA256);
  assert.equal(downloaded.bytes.length, PDF_ATT_1.length);
});

test('ECC-05 / ECC-12: non-PDF pull is a non-retryable safe code with no provider leak', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_BAD),
    { safeCode: 'CONNECTOR_ATTACHMENT_NOT_PDF', retryable: false },
    ['PK\x03\x04', 'application/octet-stream'],
  );
});

test('ECC-06 / ECC-12: oversized pull is a non-retryable size reject', async () => {
  assert.equal(MAX_CONNECTOR_PDF_BYTES, 40 * 1024 * 1024);
  const connector = connectorFor(BINDING_A, AUTH_A);
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_OVERSIZE),
    { safeCode: 'CONNECTOR_ATTACHMENT_TOO_LARGE', retryable: false },
  );
});

test('ECC-08: unknown attachmentId is a safe not-found (no leak)', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_UNKNOWN),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_404', retryable: false },
    [ATT_1, ATT_UNKNOWN],
  );
});

test('ECC-11: transient 5xx / 429 / 408 map to retryable safe codes', async () => {
  for (const status of [500, 503, 429, 408]) {
    const connector = connectorFor(BINDING_A, AUTH_A, (async () => (
      new Response(leakyProviderBody(), { status })
    )) as typeof fetch);
    await assertRejectsSafe(
      () => connector.listActiveAttachments(CONTEXT_A, LOAN_REF_A),
      { safeCode: `CONNECTOR_SERVICE_FAILED_${status}`, retryable: true },
    );
  }
});

test('ECC-12: permanent 4xx validation failures are non-retryable', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A, (async () => (
    new Response(leakyProviderBody(), { status: 400 })
  )) as typeof fetch);
  await assertRejectsSafe(
    () => connector.listActiveAttachments(CONTEXT_A, LOAN_REF_A),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_400', retryable: false },
  );
});

test('ECC-13: repeat download of Att-1 is digest-idempotent', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  const first = await connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_1);
  const second = await connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_1);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.sha256, PDF_ATT_1_SHA256);
  assert.deepEqual(first.bytes, second.bytes);
  // ECC-14 deferred: job idempotency keys are an orchestrator concern. Download is read-only
  // against the fake service (no LOS write / side-effect duplication).
});

test('ECC-17: missing service auth and non-HTTPS base URL fail closed', () => {
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
    }),
    (error: unknown) => {
      assertSafeError(error, { safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING', retryable: false });
      return true;
    },
  );
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
      serviceAuth: { authorizationHeader: '   ' },
    }),
    (error: unknown) => {
      assertSafeError(error, { safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING', retryable: false });
      return true;
    },
  );
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'http://connector.example.test' },
      serviceAuth: { authorizationHeader: AUTH_A },
    }),
    (error: unknown) => {
      assertSafeError(error, { safeCode: 'CONNECTOR_SERVICE_URL_INVALID', retryable: false });
      return true;
    },
  );
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: FREEFLOW_DEV_CONNECTOR_BINDING,
      serviceAuth: { authorizationHeader: AUTH_A },
    }),
    (error: unknown) => {
      assertSafeError(error, { safeCode: 'CONNECTOR_SERVICE_URL_MISSING', retryable: false });
      return true;
    },
  );
});

test('ECC-18: wrong tenant claim in the service token is denied', async () => {
  const connector = connectorFor(BINDING_A, AUTH_B);
  await assertRejectsSafe(
    () => connector.listActiveAttachments(CONTEXT_A, LOAN_REF_A),
    { safeCode: 'CONNECTOR_SERVICE_FAILED_403', retryable: false },
    [ATT_1],
  );
});

test('ECC-19: service request bodies never include LOS credentials or tokens', async () => {
  const seen: unknown[] = [];
  const connector = connectorFor(BINDING_A, AUTH_A, (async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    seen.push(body);
    assertNoLosCredentials(body);
    if (String(input).endsWith(CONNECTOR_SERVICE_CONTRACT.listPath)) {
      return Response.json({ attachments: [{ id: ATT_1 }] });
    }
    return new Response(PDF_ATT_1, {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'x-content-sha256': PDF_ATT_1_SHA256 },
    });
  }) as typeof fetch);

  await connector.listActiveAttachments(CONTEXT_A, LOAN_REF_A);
  await connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_1);

  assert.equal(seen.length, 2);
  for (const body of seen) {
    assert.ok(body && typeof body === 'object');
    const record = body as Record<string, unknown>;
    for (const key of ['clientSecret', 'clientId', 'instanceId', 'accessToken', 'refreshToken', 'authorization', 'password']) {
      assert.equal(key in record, false);
    }
    assert.equal(JSON.stringify(record).includes(AUTH_A), false);
    assert.equal(JSON.stringify(record).includes(PROVIDER_SECRET), false);
  }
  assert.equal('attachmentId' in (seen[1] as object), true);
  assert.equal((seen[1] as { attachmentId: string }).attachmentId, ATT_1);
});

test('ECC-05/ECC-19: digest mismatch is non-retryable and does not leak provider bytes', async () => {
  const connector = connectorFor(BINDING_A, AUTH_A, (async () => new Response(PDF_ATT_1, {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'x-content-sha256': '0'.repeat(64) },
  })) as typeof fetch);
  await assertRejectsSafe(
    () => connector.downloadOriginalAttachment(CONTEXT_A, LOAN_REF_A, ATT_1),
    { safeCode: 'CONNECTOR_ATTACHMENT_HASH_MISMATCH', retryable: false },
    [PDF_ATT_1_SHA256],
  );
});

test('ECC-20: factory developer-connect OFF makes no live ICE calls and needs no ICE credentials', () => {
  let called = false;
  assert.throws(
    () => createEncompassConnector({
      binding: { kind: 'developer-connect', deploymentId: 'unused', lenderId: 'unused' },
      developerConnectClient: {
        listActiveAttachments: async () => {
          called = true;
          throw new Error('live ICE list must not run');
        },
        downloadOriginalAttachment: async () => {
          called = true;
          throw new Error('live ICE download must not run');
        },
      },
    }),
    (error: unknown) => {
      assertSafeError(error, { safeCode: 'DEVELOPER_CONNECT_DISABLED', retryable: false });
      return true;
    },
  );
  assert.equal(called, false);
});

test('ECC-21: custom factory path does not require DC client/secret/instance', () => {
  const connector = createEncompassConnector({
    binding: BINDING_A,
    connectorServiceAuth: { authorizationHeader: AUTH_A },
    fetch: createFakeConnectorFetch(),
  });
  assert.equal(connector.kind, 'custom');
});

test('ECC-07/ECC-09/ECC-10/ECC-15 deferred: interface has only list + download', () => {
  const connector = connectorFor(BINDING_A, AUTH_A);
  assert.equal(typeof connector.listActiveAttachments, 'function');
  assert.equal(typeof connector.downloadOriginalAttachment, 'function');
  assert.equal('getAttachmentMetadata' in connector, false);
  assert.equal('getStatus' in connector, false);
  assert.equal('writebackApproval' in connector, false);
  // ECC-16 deferred until writebackApproval exists on EncompassConnector.
});
