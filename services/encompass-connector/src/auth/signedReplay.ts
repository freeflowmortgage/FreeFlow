import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReplayStore, ServiceAuthMaterial, ServiceAuthResult, ServiceAuthVerifier, VerifiedServicePrincipal } from './types';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type SignedServiceRecord = Readonly<{
  serviceId: string;
  tenantId: string;
  signingKey: string;
}>;

/** Process-local replay store for a single hardened connector task. Production
 * multi-task deployments must replace this with a shared uniqueness store. */
export class MemoryReplayStore implements ReplayStore {
  private readonly claims = new Map<string, number>();
  async claim(serviceId: string, nonce: string, expiresAt: number): Promise<boolean> {
    const now = Date.now();
    for (const [key, expiry] of this.claims) if (expiry <= now) this.claims.delete(key);
    const key = `${serviceId}:${nonce}`;
    if (this.claims.has(key)) return false;
    this.claims.set(key, expiresAt);
    return true;
  }
}

export class HmacSignedReplayServiceAuthVerifier implements ServiceAuthVerifier {
  readonly kind = 'signed-replay' as const;
  private readonly principals = new Map<string, SignedServiceRecord>();
  constructor(records: ReadonlyArray<SignedServiceRecord>, private readonly replayStore: ReplayStore = new MemoryReplayStore()) {
    for (const record of records) if (record.serviceId && record.tenantId && record.signingKey) this.principals.set(record.serviceId, record);
  }

  async verify(material: ServiceAuthMaterial): Promise<ServiceAuthResult> {
    const serviceId = material.serviceIdHeader?.trim() ?? '';
    const timestamp = material.timestampHeader?.trim() ?? '';
    const nonce = material.nonceHeader?.trim() ?? '';
    const signature = material.signatureHeader?.trim() ?? '';
    if (!serviceId || !timestamp || !nonce || !signature) return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_MISSING' };
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(serviceId) || !/^[A-Za-z0-9_-]{16,200}$/.test(nonce) || !/^[0-9]{13}$/.test(timestamp)) {
      return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' };
    }
    const record = this.principals.get(serviceId);
    const issuedAt = Number(timestamp);
    if (!record || !Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > MAX_CLOCK_SKEW_MS || !material.requestMethod || !material.requestPath || !material.bodySha256) {
      return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' };
    }
    const expected = signCanonicalRequest(record.signingKey, material.requestMethod, material.requestPath, timestamp, nonce, material.bodySha256);
    if (!safeEqual(expected, signature)) return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' };
    if (!await this.replayStore.claim(serviceId, nonce, issuedAt + MAX_CLOCK_SKEW_MS)) return { ok: false, safeCode: 'CONNECTOR_SERVICE_AUTH_INVALID' };
    const principal: VerifiedServicePrincipal = { serviceId: record.serviceId, tenantId: record.tenantId };
    return { ok: true, principal };
  }
}

export function signCanonicalRequest(key: string, method: string, path: string, timestamp: string, nonce: string, bodySha256: string): string {
  return createHmac('sha256', key).update(`${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodySha256}`, 'utf8').digest('hex');
}

function safeEqual(expected: string, actual: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
