import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBindingStore } from '../src/binding';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISABLED_TENANT = '33333333-3333-4333-8333-333333333333';
const MISSING_TENANT = '44444444-4444-4444-8444-444444444444';

const prisma = new PrismaClient();
const store = new PrismaBindingStore(prisma);

after(async () => {
  await prisma.$disconnect();
});

async function readRawBindingAsTenant(contextTenantId: string, requestedTenantId: string) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`
      SELECT set_config('app.tenant_id', ${contextTenantId}, true)
    `);
    return transaction.encompassConnectorBinding.findUnique({
      where: { tenantId: requestedTenantId },
      select: {
        tenantId: true,
        lenderId: true,
        deploymentId: true,
        isEnabled: true,
      },
    });
  });
}

test('freeflow_worker-backed PrismaBindingStore reads only the enabled tenant binding', async () => {
  const role = await prisma.$queryRaw<Array<{ is_worker: boolean; can_bypass_rls: boolean }>>(Prisma.sql`
    SELECT
      pg_has_role(current_user, 'freeflow_worker', 'MEMBER') AS is_worker,
      rolbypassrls AS can_bypass_rls
    FROM pg_roles
    WHERE rolname = current_user
  `);
  assert.deepEqual(role, [{ is_worker: true, can_bypass_rls: false }]);

  assert.deepEqual(await store.resolveByTenantId(TENANT_A), {
    tenantId: TENANT_A,
    lenderId: 'lender-a',
    deploymentId: 'deployment-a',
  });
});

test('row-level security prevents either tenant from reading the other raw binding', async () => {
  assert.equal(await readRawBindingAsTenant(TENANT_A, TENANT_B), null);
  assert.equal(await readRawBindingAsTenant(TENANT_B, TENANT_A), null);

  const tenantAVisibleRows = await readRawBindingAsTenant(TENANT_A, TENANT_A);
  assert.deepEqual(tenantAVisibleRows, {
    tenantId: TENANT_A,
    lenderId: 'lender-a',
    deploymentId: 'deployment-a',
    isEnabled: true,
  });
  assert.doesNotMatch(JSON.stringify(tenantAVisibleRows), /lender-b-sensitive|deployment-b-sensitive/);
});

test('PrismaBindingStore fails closed for disabled and missing bindings', async () => {
  assert.equal(await store.resolveByTenantId(DISABLED_TENANT), undefined);
  assert.equal(await store.resolveByTenantId(MISSING_TENANT), undefined);
});
