/**
 * Server-side tenant → lender deployment binding.
 *
 * Callers may send tenant / lender / deployment ids; those values are NEVER
 * trusted alone. The service resolves the binding from its own store and
 * rejects mismatches.
 *
 * This store holds opaque identity only. It is not a LOS credential store.
 */

export type TenantLenderBinding = Readonly<{
  tenantId: string;
  lenderId: string;
  deploymentId: string;
}>;

export interface BindingStore {
  /** Resolves only enabled bindings. Missing and disabled bindings both fail closed. */
  resolveByTenantId(tenantId: string): Promise<TenantLenderBinding | undefined>;
}
