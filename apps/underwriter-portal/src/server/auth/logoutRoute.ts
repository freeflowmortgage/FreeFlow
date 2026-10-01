import { randomUUID } from 'node:crypto';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { isProtectedRuntime } from '../runtimeMode';
import { verifyAlbOidcToken, type VerifiedAlbIdentity } from './albOidc';

const MAX_DISCOVERY_BYTES = 32 * 1024;
const DEFAULT_SESSION_COOKIE = 'FreeFlowDevAuth';
const COOKIE_SHARD_COUNT = 4;

type LogoutDependencies = Readonly<{
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
  verifyToken: (token: string) => Promise<VerifiedAlbIdentity>;
}>;

class LogoutError extends Error {
  constructor(readonly status: 401 | 403 | 405 | 503, readonly code: string, readonly publicMessage: string) {
    super(code);
    this.name = 'LogoutError';
  }
}

export function createLogoutHandler(overrides: Partial<LogoutDependencies> = {}): NextApiHandler {
  const env = overrides.env ?? process.env;
  const fetchImpl = overrides.fetch ?? fetch;
  const verifyToken = overrides.verifyToken ?? ((token) => verifyAlbOidcToken(token, {
    region: required(env, 'AWS_REGION'),
    expectedSignerArn: required(env, 'ALB_OIDC_SIGNER_ARN'),
    expectedIssuer: required(env, 'OIDC_ISSUER'),
    expectedClientId: required(env, 'OIDC_CLIENT_ID'),
    expectedAudience: required(env, 'OIDC_AUDIENCE'),
  }));

  return async (req, res) => {
    const requestId = randomUUID();
    secureResponse(res, requestId);
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new LogoutError(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
      }
      enforceTrustedOrigin(req, env);
      if (isProtectedRuntime(env)) {
        const token = singleHeader(req, 'x-amzn-oidc-data');
        if (!token) throw new LogoutError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
        try {
          await verifyToken(token);
        } catch {
          throw new LogoutError(401, 'INVALID_IDENTITY_ASSERTION', 'Authentication is invalid or expired.');
        }
      }

      const logoutUrl = await discoverLogoutUrl(env, fetchImpl);
      res.setHeader('Set-Cookie', expiredSessionCookies(env.ALB_AUTH_SESSION_COOKIE_NAME));
      return res.status(200).json({ logoutUrl });
    } catch (error) {
      const normalized = error instanceof LogoutError
        ? error
        : new LogoutError(503, 'LOGOUT_UNAVAILABLE', 'Sign out is temporarily unavailable.');
      return res.status(normalized.status).json({
        error: { code: normalized.code, message: normalized.publicMessage, requestId },
      });
    }
  };
}

async function discoverLogoutUrl(env: NodeJS.ProcessEnv, fetchImpl: typeof globalThis.fetch): Promise<string> {
  const issuer = secureUrl(required(env, 'OIDC_ISSUER'), 'OIDC_ISSUER');
  const discoveryUrl = new URL(`${issuer.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`, issuer.origin);
  let response: Response;
  try {
    response = await fetchImpl(discoveryUrl, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  } catch {
    throw new LogoutError(503, 'LOGOUT_DISCOVERY_UNAVAILABLE', 'Sign out is temporarily unavailable.');
  }
  if (!response.ok) throw new LogoutError(503, 'LOGOUT_DISCOVERY_UNAVAILABLE', 'Sign out is temporarily unavailable.');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_DISCOVERY_BYTES) {
    throw new LogoutError(503, 'LOGOUT_DISCOVERY_INVALID', 'Sign out is temporarily unavailable.');
  }
  let endpointValue: unknown;
  try {
    endpointValue = (JSON.parse(body) as { end_session_endpoint?: unknown }).end_session_endpoint;
  } catch {
    throw new LogoutError(503, 'LOGOUT_DISCOVERY_INVALID', 'Sign out is temporarily unavailable.');
  }
  if (typeof endpointValue !== 'string') throw new LogoutError(503, 'LOGOUT_DISCOVERY_INVALID', 'Sign out is temporarily unavailable.');
  const endpoint = secureUrl(endpointValue, 'end_session_endpoint');
  if (!endpoint.hostname.endsWith('.amazoncognito.com') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new LogoutError(503, 'LOGOUT_DISCOVERY_INVALID', 'Sign out is temporarily unavailable.');
  }
  const appBaseUrl = secureUrl(required(env, 'APP_BASE_URL'), 'APP_BASE_URL');
  if (appBaseUrl.pathname !== '/' || appBaseUrl.search || appBaseUrl.hash) {
    throw new LogoutError(503, 'LOGOUT_CONFIGURATION_INVALID', 'Sign out is temporarily unavailable.');
  }
  endpoint.searchParams.set('client_id', required(env, 'OIDC_CLIENT_ID'));
  endpoint.searchParams.set('logout_uri', appBaseUrl.origin + '/');
  return endpoint.toString();
}

function enforceTrustedOrigin(req: NextApiRequest, env: NodeJS.ProcessEnv): void {
  if (!isProtectedRuntime(env)) return;
  const expected = secureUrl(required(env, 'TRUSTED_ORIGIN'), 'TRUSTED_ORIGIN');
  if (expected.pathname !== '/' || expected.search || expected.hash) {
    throw new LogoutError(503, 'ORIGIN_VALIDATION_UNAVAILABLE', 'Request validation is temporarily unavailable.');
  }
  const origin = singleHeader(req, 'origin');
  if (!origin) throw new LogoutError(403, 'ORIGIN_REQUIRED', 'The request origin could not be verified.');
  if (origin !== expected.origin) throw new LogoutError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not permitted.');
}

function expiredSessionCookies(configuredName: string | undefined): string[] {
  const requested = configuredName?.trim() || DEFAULT_SESSION_COOKIE;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(requested)) {
    throw new LogoutError(503, 'LOGOUT_CONFIGURATION_INVALID', 'Sign out is temporarily unavailable.');
  }
  const bases = new Set([requested, 'AWSELBAuthSessionCookie']);
  return Array.from(bases).flatMap((base) => [base, ...Array.from({ length: COOKIE_SHARD_COUNT }, (_, index) => `${base}-${index}`)])
    .map((name) => `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=None`);
}

function secureUrl(value: string, name: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new LogoutError(503, 'LOGOUT_CONFIGURATION_INVALID', 'Sign out is temporarily unavailable.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new LogoutError(503, 'LOGOUT_CONFIGURATION_INVALID', `${name} is invalid.`);
  }
  return parsed;
}

function singleHeader(req: NextApiRequest, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) throw new LogoutError(401, 'INVALID_IDENTITY_ASSERTION', 'Authentication is invalid or expired.');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new LogoutError(503, 'LOGOUT_CONFIGURATION_INVALID', 'Sign out is temporarily unavailable.');
  return value;
}

function secureResponse(res: NextApiResponse, requestId: string): void {
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}
