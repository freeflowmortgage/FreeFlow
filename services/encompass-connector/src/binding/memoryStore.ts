import type { BindingStore, TenantLenderBinding } from './types';

/** In-memory binding table for the skeleton. Fail-closed when empty. */
export class MemoryBindingStore implements BindingStore {
  private readonly byTenant = new Map<string, TenantLenderBinding>();

  constructor(bindings: ReadonlyArray<TenantLenderBinding> = []) {
    for (const binding of bindings) {
      this.byTenant.set(binding.tenantId, binding);
    }
  }

  resolveByTenantId(tenantId: string): TenantLenderBinding | undefined {
    return this.byTenant.get(tenantId);
  }
}
