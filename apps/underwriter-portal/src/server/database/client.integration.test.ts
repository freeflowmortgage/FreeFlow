import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  prisma,
  setTenantContext,
  withIdentityTransaction,
  withTenantTransaction,
} from './client';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

after(async () => {
  await prisma.$disconnect();
});

test('direct application-role queries fail closed without tenant context', async () => {
  assert.equal(await prisma.loanApplication.count(), 0);
});

test('transaction-local context isolates both tenants through Prisma', async () => {
  const tenantALoans = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    (transaction) => transaction.loanApplication.findMany({ select: { tenantId: true } }),
  );
  const tenantBLoans = await withTenantTransaction(
    { tenantId: TENANT_B, principalId: USER_B },
    (transaction) => transaction.loanApplication.findMany({ select: { tenantId: true } }),
  );

  assert.deepEqual(tenantALoans, [{ tenantId: TENANT_A }]);
  assert.deepEqual(tenantBLoans, [{ tenantId: TENANT_B }]);
});

test('transaction advisory locks execute without deserializing PostgreSQL void', async () => {
  const affected = await withTenantTransaction(
    { tenantId: TENANT_A, principalId: USER_A },
    (transaction) => transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${'synthetic-upload-lock'}, 0))
    `,
  );
  assert.equal(affected, 1);
});

test('verified identity lookup is narrow before activating tenant context', async () => {
  const result = await withIdentityTransaction('verified-subject-a', async (transaction) => {
    const users = await transaction.user.findMany({ select: { id: true, tenantId: true } });
    assert.deepEqual(users, [{ id: USER_A, tenantId: TENANT_A }]);
    assert.equal(await transaction.tenant.count(), 0);

    await setTenantContext(transaction, { tenantId: TENANT_A, principalId: USER_A });
    return transaction.tenant.findMany({ select: { id: true } });
  });

  assert.deepEqual(result, [{ id: TENANT_A }]);
});

test('context helper rejects malformed identifiers before querying PostgreSQL', () => {
  assert.throws(
    () => withTenantTransaction(
      { tenantId: TENANT_A, principalId: 'caller-controlled-value' },
      async () => null,
    ),
    /Invalid principalId/,
  );
});
