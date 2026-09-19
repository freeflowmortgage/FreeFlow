import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoLosCredentials, EncompassConnectorError } from '../src/index';
import type { ConnectorServiceListRequest, EncompassConnectorContext } from '../src/index';

test('connector context and service requests have no LOS credential fields', () => {
  const context: EncompassConnectorContext = {
    tenantId: 't',
    loanId: 'l',
    correlationId: 'c',
  };
  const request: ConnectorServiceListRequest = {
    contractVersion: 'encompass-connector-service-v1',
    deploymentId: 'freeflow-dev',
    lenderId: 'freeflow-dev',
    tenantId: context.tenantId,
    loanId: context.loanId,
    loanGuid: 'guid',
    correlationId: context.correlationId,
  };

  assert.deepEqual(Object.keys(context).sort(), ['correlationId', 'loanId', 'tenantId']);
  assert.equal('clientSecret' in request, false);
  assert.equal('clientId' in request, false);
  assert.equal('instanceId' in request, false);
  assert.equal('password' in request, false);
  assert.equal('accessToken' in request, false);
  assertNoLosCredentials(context);
  assertNoLosCredentials(request);
});

test('secret guard rejects LOS credential keys before they can leave the abstraction', () => {
  assert.throws(
    () => assertNoLosCredentials({ tenantId: 't', clientSecret: 'nope' }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'LOS_CREDENTIALS_FORBIDDEN',
  );
  assert.throws(
    () => assertNoLosCredentials({ nested: { instance_id: 'BE123' } }),
    (error: unknown) => error instanceof EncompassConnectorError && error.safeCode === 'LOS_CREDENTIALS_FORBIDDEN',
  );
});
