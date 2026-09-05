import { createPublicKey, verify as verifySignature } from 'node:crypto';

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_PUBLIC_KEY_BYTES = 16 * 1024;
const KEY_CACHE_TTL_MS = 60 * 60 * 1000;
const KEY_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

type AlbJwtHeader = {
  alg?: unknown;
  kid?: unknown;
  signer?: unknown;
  iss?: unknown;
  client?: unknown;
  exp?: unknown;
};

type AlbClaims = {
  sub?: unknown;
  auth_time?: unknown;
};

export type AlbOidcConfig = {
  region: string;
  expectedSignerArn: string;
  expectedIssuer: string;
  expectedClientId: string;
  expectedAudience: string;
  clockToleranceSeconds?: number;
};

export type VerifiedAlbIdentity = {
  subject: string;
  authTime: Date;
  expiresAt: Date;
};

export type AlbPublicKeyProvider = (region: string, keyId: string) => Promise<string>;

export class AlbOidcVerificationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AlbOidcVerificationError';
  }
}

const publicKeyCache = new Map<string, { pem: string; expiresAt: number }>();

export async function verifyAlbOidcToken(
  token: string,
  config: AlbOidcConfig,
  keyProvider: AlbPublicKeyProvider = fetchAlbPublicKey,
  nowMs = Date.now(),
): Promise<VerifiedAlbIdentity> {
  if (!token || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    throw new AlbOidcVerificationError('INVALID_TOKEN');
  }

  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new AlbOidcVerificationError('INVALID_TOKEN');
  }

  const header = decodeJson<AlbJwtHeader>(segments[0]);
  if (header.alg !== 'ES256') throw new AlbOidcVerificationError('INVALID_ALGORITHM');
  if (typeof header.kid !== 'string' || !KEY_ID_PATTERN.test(header.kid)) {
    throw new AlbOidcVerificationError('INVALID_KEY_ID');
  }
  if (header.signer !== config.expectedSignerArn) {
    throw new AlbOidcVerificationError('WRONG_SIGNER');
  }
  if (header.iss !== config.expectedIssuer) {
    throw new AlbOidcVerificationError('WRONG_ISSUER');
  }
  if (header.client !== config.expectedClientId || header.client !== config.expectedAudience) {
    throw new AlbOidcVerificationError('WRONG_AUDIENCE');
  }

  const expiresAtSeconds = numericDate(header.exp);
  const toleranceMs = (config.clockToleranceSeconds ?? 5) * 1000;
  if (expiresAtSeconds * 1000 <= nowMs - toleranceMs) {
    throw new AlbOidcVerificationError('TOKEN_EXPIRED');
  }

  const signature = decodeBase64Url(segments[2]);
  if (signature.length !== 64) throw new AlbOidcVerificationError('INVALID_SIGNATURE');

  let verified = false;
  try {
    const publicKeyPem = await keyProvider(config.region, header.kid);
    const publicKey = createPublicKey(publicKeyPem);
    verified = verifySignature(
      'sha256',
      Buffer.from(`${segments[0]}.${segments[1]}`, 'ascii'),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch (error) {
    if (error instanceof AlbOidcVerificationError) throw error;
    throw new AlbOidcVerificationError('KEY_VERIFICATION_FAILED');
  }
  if (!verified) throw new AlbOidcVerificationError('INVALID_SIGNATURE');

  const claims = decodeJson<AlbClaims>(segments[1]);
  if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0 || claims.sub.length > 255) {
    throw new AlbOidcVerificationError('INVALID_SUBJECT');
  }

  const authTimeSeconds = optionalNumericDate(claims.auth_time);
  return Object.freeze({
    subject: claims.sub,
    authTime: new Date(authTimeSeconds === undefined ? nowMs : authTimeSeconds * 1000),
    expiresAt: new Date(expiresAtSeconds * 1000),
  });
}

export async function fetchAlbPublicKey(region: string, keyId: string): Promise<string> {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region) || !KEY_ID_PATTERN.test(keyId)) {
    throw new AlbOidcVerificationError('INVALID_KEY_LOCATION');
  }

  const cacheKey = `${region}:${keyId}`;
  const cached = publicKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const endpoint = region.startsWith('us-gov-')
    ? `https://s3-${region}.amazonaws.com/aws-elb-public-keys-prod-${region}/${keyId}`
    : `https://public-keys.auth.elb.${region}.amazonaws.com/${keyId}`;
  const response = await fetch(endpoint, {
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new AlbOidcVerificationError('KEY_FETCH_FAILED');

  const pem = await response.text();
  if (Buffer.byteLength(pem, 'utf8') > MAX_PUBLIC_KEY_BYTES || !pem.includes('BEGIN PUBLIC KEY')) {
    throw new AlbOidcVerificationError('INVALID_PUBLIC_KEY');
  }
  publicKeyCache.set(cacheKey, { pem, expiresAt: Date.now() + KEY_CACHE_TTL_MS });
  if (publicKeyCache.size > 8) publicKeyCache.delete(publicKeyCache.keys().next().value as string);
  return pem;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(decodeBase64Url(segment).toString('utf8')) as T;
  } catch {
    throw new AlbOidcVerificationError('INVALID_TOKEN');
  }
}

function decodeBase64Url(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(segment)) {
    throw new AlbOidcVerificationError('INVALID_TOKEN');
  }
  try {
    return Buffer.from(segment, 'base64url');
  } catch {
    throw new AlbOidcVerificationError('INVALID_TOKEN');
  }
}

function numericDate(input: unknown): number {
  const parsed = typeof input === 'number' ? input : typeof input === 'string' ? Number(input) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AlbOidcVerificationError('INVALID_EXPIRATION');
  return parsed;
}

function optionalNumericDate(input: unknown): number | undefined {
  if (input === undefined) return undefined;
  return numericDate(input);
}
