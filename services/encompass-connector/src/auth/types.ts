/**
 * Portal → connector service-to-service authentication.
 *
 * Service tokens are a distinct type/store from LOS credentials. This module
 * must not import, store, or type Encompass / ICE credentials.
 *
 * Production MUST replace Bearer with mTLS and/or signed+replay-protected
 * tokens (live-wiring gate: S2S > Bearer). The Bearer stub is NON-PROD and
 * replaceable — do not treat it as a production control.
 */

/** Opaque S2S material presented by the portal. Never a LOS credential. */
export type ServiceAuthMaterial = Readonly<{
  authorizationHeader?: string;
  serviceIdHeader?: string;
  timestampHeader?: string;
  nonceHeader?: string;
  signatureHeader?: string;
  requestMethod?: string;
  requestPath?: string;
  bodySha256?: string;
}>;

/** Authenticated portal/worker identity. Tenant is taken from the verifier, not the body. */
export type VerifiedServicePrincipal = Readonly<{
  serviceId: string;
  tenantId: string;
}>;

export type ServiceAuthSuccess = Readonly<{
  ok: true;
  principal: VerifiedServicePrincipal;
}>;

export type ServiceAuthFailure = Readonly<{
  ok: false;
  safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING' | 'CONNECTOR_SERVICE_AUTH_INVALID';
}>;

export type ServiceAuthResult = ServiceAuthSuccess | ServiceAuthFailure;

/**
 * Replaceable S2S verifier. Prod implementations: mTLS, signed+replay, or both.
 * Do not add LOS credential fields to this interface.
 */
export interface ServiceAuthVerifier {
  verify(material: ServiceAuthMaterial): Promise<ServiceAuthResult>;
}

/** Production verifier kinds. Bearer is intentionally not listed. */
export type ProductionServiceAuthKind = 'mtls' | 'signed-replay' | 'mtls-and-signed-replay';

export interface MutualTlsAuthVerifier extends ServiceAuthVerifier {
  readonly kind: 'mtls';
}

export interface SignedReplayAuthVerifier extends ServiceAuthVerifier {
  readonly kind: 'signed-replay';
}

export type ReplayStore = Readonly<{
  claim(serviceId: string, nonce: string, expiresAt: number): Promise<boolean>;
}>;

/**
 * S2S token record for the NON-PROD Bearer stub only.
 * Separate type from any future LOS credential store — do not merge the two.
 */
export type ServiceTokenRecord = Readonly<{
  token: string;
  serviceId: string;
  tenantId: string;
}>;

export type ServiceTokenStore = Readonly<{
  lookup(authorizationHeader: string): VerifiedServicePrincipal | undefined;
}>;
