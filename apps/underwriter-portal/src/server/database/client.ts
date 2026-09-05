import { Prisma, PrismaClient } from '@prisma/client';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const prismaGlobal = globalThis as typeof globalThis & {
  freeflowPrisma?: PrismaClient;
};

export const prisma = prismaGlobal.freeflowPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  prismaGlobal.freeflowPrisma = prisma;
}

export type TenantDatabaseContext = Readonly<{
  tenantId: string;
  principalId: string;
}>;

export function withTenantTransaction<T>(
  context: TenantDatabaseContext,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertUuid(context.tenantId, 'tenantId');
  assertUuid(context.principalId, 'principalId');

  return prisma.$transaction(async (transaction) => {
    await setTenantContext(transaction, context);
    return operation(transaction);
  });
}

export function withIdentityTransaction<T>(
  verifiedSubject: string,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const subject = verifiedSubject.trim();
  if (!subject || subject.length > 255) {
    throw new Error('Invalid verified identity subject.');
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT set_config('app.oidc_subject', ${subject}, true)
    `;
    return operation(transaction);
  });
}

export async function setTenantContext(
  transaction: Prisma.TransactionClient,
  context: TenantDatabaseContext,
): Promise<void> {
  assertUuid(context.tenantId, 'tenantId');
  assertUuid(context.principalId, 'principalId');

  await transaction.$queryRaw`
    SELECT
      set_config('app.tenant_id', ${context.tenantId}, true),
      set_config('app.principal_id', ${context.principalId}, true)
  `;
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${field}.`);
  }
}
