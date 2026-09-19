import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import type { BindingStore, TenantLenderBinding } from './types';

export type ClaimedBinding = Readonly<{
  tenantId: string;
  lenderId: string;
  deploymentId: string;
}>;

/**
 * Resolve the tenant→lender binding from the server store, then compare the
 * caller claim. The store is authoritative; claimed lender/deployment are
 * never used as the source of truth.
 */
export function enforceTenantLenderBinding(
  claimed: ClaimedBinding,
  principalTenantId: string,
  store: BindingStore,
): TenantLenderBinding {
  if (!principalTenantId || claimed.tenantId !== principalTenantId) {
    throw new EncompassConnectorError(
      'CONNECTOR_BINDING_MISMATCH',
      'Tenant binding mismatch.',
      false,
    );
  }

  const resolved = store.resolveByTenantId(principalTenantId);
  if (!resolved) {
    throw new EncompassConnectorError(
      'CONNECTOR_BINDING_NOT_FOUND',
      'Tenant binding was not found.',
      false,
    );
  }

  if (
    resolved.tenantId !== claimed.tenantId
    || resolved.lenderId !== claimed.lenderId
    || resolved.deploymentId !== claimed.deploymentId
  ) {
    throw new EncompassConnectorError(
      'CONNECTOR_BINDING_MISMATCH',
      'Tenant binding mismatch.',
      false,
    );
  }

  return resolved;
}
