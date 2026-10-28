import { randomUUID } from 'node:crypto';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { isProtectedRuntime } from '../runtimeMode';
import { setTenantContext, withIdentityTransaction } from '../database/client';
import { verifyAlbOidcToken, type VerifiedAlbIdentity } from './albOidc';
import {
  permissionsForRole,
  type ApplicationRole,
  type Permission,
} from './permissions';
import { emitOperationalEvent } from '../observability/operationalEvents';

export type RequestContext = Readonly<{
  requestId: string;
  subject: string;
  tenantId: string;
  membershipId: string;
  permissions: readonly Permission[];
  authTime: Date;
  authTimeAsserted?: boolean;
}>;

export type ActiveMembership = {
  id: string;
  tenantId: string;
  role: ApplicationRole;
};

type ContextHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  context: RequestContext,
) => unknown | Promise<unknown>;

type RequestContextDependencies = {
  verifyToken: (token: string) => Promise<VerifiedAlbIdentity>;
  resolveMembership: (subject: string) => Promise<ActiveMembership | null>;
};

class RequestAuthenticationError extends Error {
  constructor(
    readonly status: 401 | 403 | 503,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'RequestAuthenticationError';
  }
}

export function withRequestContext(
  requiredPermission: Permission,
  handler: ContextHandler,
  dependencies?: RequestContextDependencies,
): NextApiHandler {
  return async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    try {
      enforceTrustedOrigin(req);
    } catch (error) {
      const originError = normalizeAuthenticationError(error);
      emitOperationalEvent('auth_denied', originError.code, originError.status);
      return res.status(originError.status).json({
        error: {
          code: originError.code,
          message: originError.publicMessage,
          requestId,
        },
      });
    }

    let context: RequestContext;
    try {
      context = await createRequestContext(req, requestId, requiredPermission, dependencies);
    } catch (error) {
      const authError = normalizeAuthenticationError(error);
      emitOperationalEvent('auth_denied', authError.code, authError.status);
      return res.status(authError.status).json({
        error: {
          code: authError.code,
          message: authError.publicMessage,
          requestId,
        },
      });
    }

    try {
      await handler(req, res, context);
    } catch (error) {
      console.error('[portal-api] route failed', {
        requestId,
        method: req.method ?? 'UNKNOWN',
        path: requestPath(req.url),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: scrubErrorMessage(error),
      });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'The request could not be completed.',
          requestId,
        },
      });
    }
  };
}

function requestPath(rawUrl: string | undefined): string {
  if (!rawUrl) return '/';
  try { return new URL(rawUrl, 'http://portal.internal').pathname || '/'; }
  catch { return '/'; }
}

function scrubErrorMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : 'Unknown failure';
  return message
    .replace(/\b\d{10}\b/g, '[redacted-number]')
    .replace(/\b[^\s"'?&/\\]+\.(?:pdf|tiff?|png|jpe?g)\b/gi, '[redacted-file]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

/**
 * ALB authentication protects the session, but browsers attach that session to
 * cross-site requests as well. Every unsafe portal API operation therefore
 * requires an exact Origin match in protected runtimes. This intentionally
 * fails closed when a browser, proxy, or future endpoint omits the header.
 */
const FREEFLOW_DEV_SALES_ORIGIN = 'https://dev.freeflowmortgage.com';
const FREEFLOW_DEV_APP_ORIGIN = 'https://app.dev.freeflowmortgage.com';

function parseConfiguredOrigin(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.origin === 'null' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('TRUSTED_ORIGIN must be an origin.');
  }
  return parsed.origin;
}

function allowedOrigins(): ReadonlySet<string> {
  const primary = parseConfiguredOrigin(requiredEnvironment('TRUSTED_ORIGIN'));
  const allowed = new Set<string>([primary]);
  // freeflow-dev serves the signed-in product on a second hostname. Mutations from
  // that host stay exact-origin checks; every other configured origin is unchanged.
  if (primary === FREEFLOW_DEV_SALES_ORIGIN) allowed.add(FREEFLOW_DEV_APP_ORIGIN);
  const extras = process.env.TRUSTED_ORIGINS?.trim();
  if (extras) {
    for (const entry of extras.split(/\s+/)) allowed.add(parseConfiguredOrigin(entry));
  }
  return allowed;
}

function enforceTrustedOrigin(req: NextApiRequest): void {
  if (!isProtectedRuntime() || !isUnsafeMethod(req.method)) return;

  let allowed: ReadonlySet<string>;
  try {
    allowed = allowedOrigins();
  } catch (error) {
    if (error instanceof RequestAuthenticationError) throw error;
    throw new RequestAuthenticationError(503, 'ORIGIN_VALIDATION_UNAVAILABLE', 'Request validation is temporarily unavailable.');
  }

  const origin = singleHeader(req, 'origin');
  if (!origin) {
    throw new RequestAuthenticationError(403, 'ORIGIN_REQUIRED', 'The request origin could not be verified.');
  }

  if (!allowed.has(origin)) {
    throw new RequestAuthenticationError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not permitted.');
  }
}

function isUnsafeMethod(method: string | undefined): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

export async function createRequestContext(
  req: NextApiRequest,
  requestId: string,
  requiredPermission: Permission,
  dependencies?: RequestContextDependencies,
): Promise<RequestContext> {
  if (!isProtectedRuntime() && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    return createDevelopmentContext(requestId, requiredPermission);
  }

  const activeDependencies = dependencies ?? defaultDependencies();

  const token = singleHeader(req, 'x-amzn-oidc-data');
  if (!token) {
    throw new RequestAuthenticationError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }

  let identity: VerifiedAlbIdentity;
  try {
    identity = await activeDependencies.verifyToken(token);
  } catch {
    throw new RequestAuthenticationError(401, 'INVALID_IDENTITY_ASSERTION', 'Authentication is invalid or expired.');
  }

  let membership: ActiveMembership | null;
  try {
    membership = await activeDependencies.resolveMembership(identity.subject);
  } catch {
    throw new RequestAuthenticationError(503, 'AUTHORIZATION_UNAVAILABLE', 'Authorization is temporarily unavailable.');
  }
  if (!membership) {
    throw new RequestAuthenticationError(403, 'MEMBERSHIP_REQUIRED', 'An active tenant membership is required.');
  }

  return buildAuthorizedContext(
    requestId,
    identity.subject,
    identity.authTime,
    membership,
    requiredPermission,
    identity.authTimeAsserted === true,
  );
}

function defaultDependencies(): RequestContextDependencies {
  return {
    verifyToken: (token) =>
      verifyAlbOidcToken(token, {
        region: requiredEnvironment('AWS_REGION'),
        expectedSignerArn: requiredEnvironment('ALB_OIDC_SIGNER_ARN'),
        expectedIssuer: requiredEnvironment('OIDC_ISSUER'),
        expectedClientId: requiredEnvironment('OIDC_CLIENT_ID'),
        expectedAudience: requiredEnvironment('OIDC_AUDIENCE'),
      }),
    resolveMembership: resolveActiveMembership,
  };
}

async function resolveActiveMembership(subject: string): Promise<ActiveMembership | null> {
  return withIdentityTransaction(subject, async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { oidcSubject: subject },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
      },
    });
    if (!user?.isActive) return null;

    await setTenantContext(transaction, {
      tenantId: user.tenantId,
      principalId: user.id,
    });
    const tenant = await transaction.tenant.findFirst({
      where: { id: user.tenantId, isActive: true },
      select: { id: true },
    });
    if (!tenant) return null;

    return { id: user.id, tenantId: user.tenantId, role: user.role as ApplicationRole };
  });
}

function createDevelopmentContext(requestId: string, requiredPermission: Permission): RequestContext {
  const role = requiredEnvironment('DEV_AUTH_ROLE') as ApplicationRole;
  const membership: ActiveMembership = {
    id: requiredEnvironment('DEV_AUTH_USER_ID'),
    tenantId: requiredEnvironment('DEV_AUTH_TENANT_ID'),
    role,
  };
  return buildAuthorizedContext(
    requestId,
    requiredEnvironment('DEV_AUTH_SUBJECT'),
    new Date(),
    membership,
    requiredPermission,
  );
}

function buildAuthorizedContext(
  requestId: string,
  subject: string,
  authTime: Date,
  membership: ActiveMembership,
  requiredPermission: Permission,
  authTimeAsserted = false,
): RequestContext {
  const permissions = permissionsForRole(membership.role);
  if (!permissions.includes(requiredPermission)) {
    throw new RequestAuthenticationError(403, 'PERMISSION_DENIED', 'The requested operation is not permitted.');
  }
  return Object.freeze({
    requestId,
    subject,
    tenantId: membership.tenantId,
    membershipId: membership.id,
    permissions,
    authTime: new Date(authTime),
    authTimeAsserted,
  });
}

function singleHeader(req: NextApiRequest, name: string): string | undefined {
  const header = req.headers[name];
  if (Array.isArray(header)) {
    throw new RequestAuthenticationError(401, 'INVALID_IDENTITY_ASSERTION', 'Authentication is invalid or expired.');
  }
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new RequestAuthenticationError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  }
  return value;
}

function normalizeAuthenticationError(error: unknown): RequestAuthenticationError {
  if (error instanceof RequestAuthenticationError) return error;
  return new RequestAuthenticationError(503, 'AUTHENTICATION_UNAVAILABLE', 'Authentication is temporarily unavailable.');
}
