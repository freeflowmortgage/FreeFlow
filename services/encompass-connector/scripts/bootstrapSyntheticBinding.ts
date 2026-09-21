import { Prisma, PrismaClient } from '@prisma/client';
import { SYNTHETIC_FREEFLOW_DEV_TENANT_ID } from '../src/connector/syntheticFreeflowDevConnector';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'development' || process.env.FREEFLOW_RUNTIME_ENV !== 'development') {
    throw new Error('Synthetic connector binding bootstrap is restricted to development.');
  }

  const tenantId = required('CONNECTOR_BOUND_TENANT_ID');
  const lenderId = required('CONNECTOR_BOUND_LENDER_ID');
  const deploymentId = required('CONNECTOR_BOUND_DEPLOYMENT_ID');
  if (tenantId !== SYNTHETIC_FREEFLOW_DEV_TENANT_ID) {
    throw new Error('Synthetic connector binding bootstrap tenant is invalid.');
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`
      SELECT set_config('app.tenant_id', ${tenantId}, true)
    `);
    await transaction.tenant.upsert({
      where: { id: tenantId },
      create: {
        id: tenantId,
        companyName: 'FreeFlow Synthetic Test Tenant',
        primaryContactEmail: 'synthetic-connector@example.test',
        isActive: true,
        isBillingActive: false,
      },
      update: {},
    });
    await transaction.encompassConnectorBinding.upsert({
      where: { tenantId },
      create: { tenantId, lenderId, deploymentId, isEnabled: true },
      update: { lenderId, deploymentId, isEnabled: true },
    });
  });

  console.log(`SYNTHETIC_CONNECTOR_BINDING_BOOTSTRAP=complete TENANT_ID=${tenantId}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required synthetic bootstrap configuration is missing: ${name}`);
  return value;
}

main()
  .catch(() => {
    console.error('Synthetic connector binding bootstrap failed.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
