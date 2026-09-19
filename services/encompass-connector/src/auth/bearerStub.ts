import type {
  ServiceAuthMaterial,
  ServiceAuthResult,
  ServiceAuthVerifier,
  ServiceTokenRecord,
  ServiceTokenStore,
  VerifiedServicePrincipal,
} from './types';

/**
 * NON-PROD / REPLACEABLE Bearer stub.
 *
 * Live-wiring gate: S2S > Bearer. Production must use mTLS and/or
 * signed+replay-protected tokens. This class exists so the skeleton can
 * accept/reject in unit tests. Do not ship it as the sole production verifier.
 *
 * Service token ≠ LOS credentials: this store holds only portal S2S tokens.
 */
export class NonProdBearerServiceAuthVerifier implements ServiceAuthVerifier {
  readonly kind = 'bearer-stub-non-prod' as const;
  private readonly store: ServiceTokenStore;

  constructor(accepted: ReadonlyArray<ServiceTokenRecord>) {
    const principals = new Map<string, VerifiedServicePrincipal>();
    for (const row of accepted) {
      const token = row.token.trim();
      if (!token) continue;
      principals.set(`Bearer ${token}`, {
        serviceId: row.serviceId,
        tenantId: row.tenantId,
      });
    }
    this.store = {
      lookup(authorizationHeader: string): VerifiedServicePrincipal | undefined {
        return principals.get(authorizationHeader);
      },
    };
  }

  async verify(material: ServiceAuthMaterial): Promise<ServiceAuthResult> {
    const header = material.authorizationHeader?.trim() ?? '';
    if (!header) {
      return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING' };
    }
    const principal = this.store.lookup(header);
    if (!principal) {
      return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' };
    }
    return { ok: true, principal };
  }
}
