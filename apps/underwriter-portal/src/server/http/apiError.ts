import { emitOperationalEvent } from '../observability/operationalEvents';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function sendApiError(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  requestId: string,
  error: ApiError,
) {
  if (error.code.startsWith('STALE_')) {
    emitOperationalEvent('stale_provenance_rejected', error.code, error.status);
  } else if (error.code.endsWith('_NOT_FOUND')) {
    // Tenant-scoped lookups intentionally fail closed as not found. The event
    // is deliberately identifier-free so an intentional cross-tenant canary
    // can be observed without leaking which object was requested.
    emitOperationalEvent('scoped_object_denied', error.code, error.status);
  }
  return res.status(error.status).json({
    error: {
      code: error.code,
      message: error.publicMessage,
      requestId,
    },
  });
}
