import { Prisma, type PrismaClient } from '@prisma/client';
import type { BindingStore, TenantLenderBinding } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Production binding repository. It establishes the authenticated tenant's
 * RLS context before looking up that tenant's single binding record.
 */
export class PrismaBindingStore implements BindingStore {
  constructor(private readonly prisma: PrismaClient) {}

  async resolveByTenantId(tenantId: string): Promise<TenantLenderBinding | undefined> {
    if (!UUID_PATTERN.test(tenantId)) return undefined;

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `);

      const binding = await transaction.encompassConnectorBinding.findUnique({
        where: { tenantId },
        select: {
          tenantId: true,
          lenderId: true,
          deploymentId: true,
          isEnabled: true,
        },
      });

      if (!binding || !binding.isEnabled) return undefined;
      return {
        tenantId: binding.tenantId,
        lenderId: binding.lenderId,
        deploymentId: binding.deploymentId,
      };
    });
  }
}
