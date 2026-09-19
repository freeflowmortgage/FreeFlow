import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { PrismaBindingStore } from '../src/binding';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

type BindingRow = Readonly<{
  tenantId: string;
  lenderId: string;
  deploymentId: string;
  isEnabled: boolean;
}>;

function fakePrisma(row: BindingRow | null) {
  let tenantContext: string | undefined;
  const tenantContexts: string[] = [];
  const transaction = {
    $queryRaw: async (query: Prisma.Sql) => {
      assert.match(query.sql, /set_config\('app\.tenant_id', \?, true\)/);
      assert.equal(query.values.length, 1);
      assert.equal(typeof query.values[0], 'string');
      tenantContext = query.values[0] as string;
      tenantContexts.push(tenantContext);
      return [{ set_config: tenantContext }];
    },
    encompassConnectorBinding: {
      findUnique: async ({ where }: { where: { tenantId: string } }) => {
        assert.equal(tenantContext, where.tenantId);
        return row;
      },
    },
  };
  return {
    client: {
      $transaction: async <T>(operation: (tx: typeof transaction) => Promise<T>) => operation(transaction),
    } as unknown as PrismaClient,
    tenantContexts,
  };
}

test('PrismaBindingStore resolves an enabled durable binding through tenant-scoped access', async () => {
  const row = {
    tenantId: TENANT_ID,
    lenderId: 'lender-a',
    deploymentId: 'deploy-a',
    isEnabled: true,
  };
  const firstProcessPrisma = fakePrisma(row);
  const restartedProcessPrisma = fakePrisma(row);
  const firstProcessStore = new PrismaBindingStore(firstProcessPrisma.client);
  const restartedProcessStore = new PrismaBindingStore(restartedProcessPrisma.client);

  assert.deepEqual(await firstProcessStore.resolveByTenantId(TENANT_ID), {
    tenantId: TENANT_ID,
    lenderId: 'lender-a',
    deploymentId: 'deploy-a',
  });
  assert.deepEqual(await restartedProcessStore.resolveByTenantId(TENANT_ID), {
    tenantId: TENANT_ID,
    lenderId: 'lender-a',
    deploymentId: 'deploy-a',
  });
  assert.deepEqual(firstProcessPrisma.tenantContexts, [TENANT_ID]);
  assert.deepEqual(restartedProcessPrisma.tenantContexts, [TENANT_ID]);
});

test('PrismaBindingStore fails closed for disabled or malformed tenant bindings', async () => {
  const disabledPrisma = fakePrisma({
    tenantId: TENANT_ID,
    lenderId: 'lender-a',
    deploymentId: 'deploy-a',
    isEnabled: false,
  });
  const disabledStore = new PrismaBindingStore(disabledPrisma.client);

  assert.equal(await disabledStore.resolveByTenantId(TENANT_ID), undefined);
  assert.equal(await disabledStore.resolveByTenantId('tenant-not-a-uuid'), undefined);
  assert.deepEqual(disabledPrisma.tenantContexts, [TENANT_ID]);
});
