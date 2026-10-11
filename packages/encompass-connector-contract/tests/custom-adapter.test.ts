import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CONNECTOR_SERVICE_CONTRACT,
  CustomConnectorAdapter,
  EncompassConnectorError,
  FREEFLOW_DEV_CONNECTOR_BINDING,
  createLenderConnectorBinding,
} from '../src/index';

const context = { tenantId: 'tenant-1', loanId: 'loan-1', correlationId: 'corr-1' };

// ECC-01 / ECC-19: list returns ids only; service body is identity + contract fields (no LOS secrets).
test('ECC-01/ECC-19: custom adapter lists attachments through the authenticated service contract', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return Response.json({ attachments: [{ id: 'Attachment-1.pdf', title: 'must-not-propagate' }] });
  }) as typeof fetch;

  const adapter = new CustomConnectorAdapter({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
    serviceAuth: { authorizationHeader: 'Bearer service-token' },
    fetch: fetchImpl,
  });

  const listed = await adapter.listActiveAttachments(context, 'loan/guid');
  assert.deepEqual(listed, [{ id: 'Attachment-1.pdf' }]);
  assert.equal(calls[0].url, `https://connector.example.test${CONNECTOR_SERVICE_CONTRACT.listPath}`);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer service-token');
  const body = JSON.parse(String(calls[0].init?.body));
  assert.equal(body.contractVersion, CONNECTOR_SERVICE_CONTRACT.version);
  assert.equal(body.deploymentId, 'freeflow-dev');
  assert.equal(body.loanGuid, 'loan/guid');
  assert.deepEqual(Object.keys(listed[0]), ['id']);
  assert.equal(JSON.stringify(listed).includes('must-not-propagate'), false);
  assert.equal(JSON.stringify(body).includes('must-not-propagate'), false);
  assert.equal(JSON.stringify(body).includes('service-token'), false);
  assert.equal('clientSecret' in body, false);
  assert.equal('clientId' in body, false);
  assert.equal('instanceId' in body, false);
  assert.deepEqual(Object.keys(body).sort(), [
    'contractVersion',
    'correlationId',
    'deploymentId',
    'lenderId',
    'loanGuid',
    'loanId',
    'tenantId',
  ]);
});

// ECC-04: pull returns bytes + sha256 and the payload is a PDF.
test('ECC-04: custom adapter downloads PDF bytes and verifies the service digest', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 synthetic');
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const adapter = new CustomConnectorAdapter({
    binding: createLenderConnectorBinding({
      lenderId: 'lender-a',
      deploymentId: 'lender-a-prod',
      serviceBaseUrl: 'https://lender-a.connector.example.test',
    }),
    serviceAuth: { authorizationHeader: 'Bearer svc' },
    fetch: (async () => new Response(pdf, {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'x-content-sha256': sha256 },
    })) as typeof fetch,
  });
  const downloaded = await adapter.downloadOriginalAttachment(context, 'guid', 'att-1');
  assert.equal(new TextDecoder().decode(downloaded.bytes.subarray(0, 5)), '%PDF-');
  assert.equal(new TextDecoder().decode(downloaded.bytes), '%PDF-1.7 synthetic');
  assert.equal(downloaded.sha256, sha256);
  assert.deepEqual(Object.keys(downloaded).sort(), ['bytes', 'sha256']);
});

// ECC-17: missing service auth and non-HTTPS origins fail closed.
test('ECC-17: custom adapter fails closed without service auth or a TLS origin', () => {
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
    }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_SERVICE_AUTH_MISSING',
  );
  assert.throws(
    () => new CustomConnectorAdapter({
      binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'http://connector.example.test' },
      serviceAuth: { authorizationHeader: 'Bearer svc' },
    }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_SERVICE_URL_INVALID',
  );
});

test('signed service authentication keeps its key out of request JSON', async () => {
  const signingKey = 'test-signing-key';
  const adapter = new CustomConnectorAdapter({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
    serviceAuth: { kind: 'signed-hmac', serviceId: 'portal', signingKey },
    fetch: (async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('x-freeflow-service-id'), 'portal');
      assert.match(headers.get('x-freeflow-signature') ?? '', /^[a-f0-9]{64}$/);
      assert.equal(String(init?.body).includes(signingKey), false);
      return Response.json({ attachments: [] });
    }) as typeof fetch,
  });
  assert.deepEqual(await adapter.listActiveAttachments(context, 'loan-guid'), []);
});

test('signed service authentication permits only private Cloud Map HTTP origins', async () => {
  const adapter = new CustomConnectorAdapter({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'http://encompass-connector.freeflow.local:8080' },
    serviceAuth: { kind: 'signed-hmac', serviceId: 'smoke', signingKey: 'test-key' },
    fetch: (async () => Response.json({ attachments: [] })) as typeof fetch,
  });
  assert.deepEqual(await adapter.listActiveAttachments(context, 'loan-guid'), []);
  assert.throws(() => new CustomConnectorAdapter({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'http://connector.example.test' },
    serviceAuth: { kind: 'signed-hmac', serviceId: 'smoke', signingKey: 'test-key' },
  }), (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_SERVICE_URL_INVALID');
});

test('loan snapshot parser rejects negative money and control characters from the provider boundary', async () => {
  const base = {
    schemaVersion: 'encompass-loan-snapshot-v1',
    sourceSystem: 'ENCOMPASS',
    simulated: true,
    loanGuid: 'loan-guid',
    loan: { loanProgram: 'CONVENTIONAL', loanPurpose: 'PURCHASE', requestedAmount: 0 },
    borrowers: [{
      providerBorrowerId: 'borrower-1', role: 'BORROWER', givenName: 'Synthetic', familyName: 'Borrower',
      employment: [{
        providerEmploymentId: 'employment-1', employerName: 'Synthetic Employer', status: 'CURRENT',
        baseMonthlyIncome: 0, variableMonthlyIncome: 0,
      }],
    }],
  };
  const adapterFor = (body: unknown) => new CustomConnectorAdapter({
    binding: { ...FREEFLOW_DEV_CONNECTOR_BINDING, serviceBaseUrl: 'https://connector.example.test' },
    serviceAuth: { authorizationHeader: 'Bearer service-token' },
    fetch: (async () => Response.json(body)) as typeof fetch,
  });
  assert.equal((await adapterFor(base).retrieveLoanSnapshot(context, 'loan-guid')).loan.requestedAmount, 0);
  for (const invalid of [
    { ...base, loan: { ...base.loan, requestedAmount: -1 } },
    { ...base, borrowers: [{ ...base.borrowers[0], givenName: 'Synthetic\nInjected' }] },
    { ...base, borrowers: [{
      ...base.borrowers[0],
      employment: [{ ...base.borrowers[0].employment[0], variableMonthlyIncome: -0.01 }],
    }] },
  ]) {
    await assert.rejects(
      () => adapterFor(invalid).retrieveLoanSnapshot(context, 'loan-guid'),
      (error: unknown) => error instanceof EncompassConnectorError
        && error.safeCode === 'CONNECTOR_LOAN_INVALID',
    );
  }
});
