import assert from 'node:assert/strict';
import test from 'node:test';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import {
  MemoryBindingStore,
  enforceTenantLenderBinding,
} from '../src/binding';

const BINDING_A = {
  tenantId: 'tenant-a',
  lenderId: 'lender-a',
  deploymentId: 'deploy-a',
};

const BINDING_B = {
  tenantId: 'tenant-b',
  lenderId: 'lender-b',
  deploymentId: 'deploy-b',
};

function store() {
  return new MemoryBindingStore([BINDING_A, BINDING_B]);
}

test('binding enforcement accepts a claim that matches the server-resolved row', () => {
  const resolved = enforceTenantLenderBinding(BINDING_A, BINDING_A.tenantId, store());
  assert.deepEqual(resolved, BINDING_A);
});

test('binding enforcement rejects a caller tenant that does not match the authenticated principal', () => {
  assert.throws(
    () => enforceTenantLenderBinding(BINDING_A, BINDING_B.tenantId, store()),
    (error: unknown) => (
      error instanceof EncompassConnectorError
      && error.safeCode === 'CONNECTOR_BINDING_MISMATCH'
      && error.retryable === false
    ),
  );
});

test('binding enforcement rejects a claimed lender that does not match the server store', () => {
  assert.throws(
    () => enforceTenantLenderBinding(
      { ...BINDING_A, lenderId: BINDING_B.lenderId },
      BINDING_A.tenantId,
      store(),
    ),
    (error: unknown) => (
      error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_BINDING_MISMATCH'
    ),
  );
});

test('binding enforcement rejects a claimed deployment that does not match the server store', () => {
  assert.throws(
    () => enforceTenantLenderBinding(
      { ...BINDING_A, deploymentId: BINDING_B.deploymentId },
      BINDING_A.tenantId,
      store(),
    ),
    (error: unknown) => (
      error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_BINDING_MISMATCH'
    ),
  );
});

test('binding enforcement does not trust a caller-only tenant with no server row', () => {
  assert.throws(
    () => enforceTenantLenderBinding(
      { tenantId: 'tenant-z', lenderId: 'lender-z', deploymentId: 'deploy-z' },
      'tenant-z',
      store(),
    ),
    (error: unknown) => (
      error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_BINDING_NOT_FOUND'
    ),
  );
});

test('empty binding store is fail-closed', () => {
  assert.throws(
    () => enforceTenantLenderBinding(BINDING_A, BINDING_A.tenantId, new MemoryBindingStore()),
    (error: unknown) => (
      error instanceof EncompassConnectorError && error.safeCode === 'CONNECTOR_BINDING_NOT_FOUND'
    ),
  );
});
