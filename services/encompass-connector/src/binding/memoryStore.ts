import type { BindingStore, TenantLenderBinding } from './types';

type MemoryBinding = TenantLenderBinding & Readonly<{ isEnabled?: boolean }>;

/** Test-only binding table. Production uses PrismaBindingStore. */
export class MemoryBindingStore implements BindingStore {
  private readonly byTenant = new Map<string, TenantLenderBinding>();

  constructor(bindings: ReadonlyArray<MemoryBinding> = []) {
    for (const binding of bindings) {
      if (binding.isEnabled !== false) {
        this.byTenant.set(binding.tenantId, {
          tenantId: binding.tenantId,
          lenderId: binding.lenderId,
          deploymentId: binding.deploymentId,
        });
      }
    }
  }

  async resolveByTenantId(tenantId: string): Promise<TenantLenderBinding | undefined> {
    return this.byTenant.get(tenantId);
  }
}
