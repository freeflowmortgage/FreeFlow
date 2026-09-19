import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';

const STATUS_BY_CODE: Record<string, number> = {
  CONNECTOR_SERVICE_AUTH_MISSING: 401,
  CONNECTOR_SERVICE_AUTH_INVALID: 401,
  CONNECTOR_BINDING_MISMATCH: 403,
  CONNECTOR_BINDING_NOT_FOUND: 403,
  CONNECTOR_NOT_IMPLEMENTED: 501,
  LOS_CREDENTIALS_FORBIDDEN: 400,
  CONNECTOR_CONTRACT_VERSION_INVALID: 400,
  CONNECTOR_REQUEST_INVALID: 400,
  CONNECTOR_METHOD_NOT_ALLOWED: 405,
  CONNECTOR_PATH_NOT_FOUND: 404,
};

export function safeErrorResponse(status: number, safeCode: string): Response {
  return Response.json({ safeCode }, { status });
}

export function responseFromUnknown(error: unknown): Response {
  if (error instanceof EncompassConnectorError) {
    return safeErrorResponse(STATUS_BY_CODE[error.safeCode] ?? 400, error.safeCode);
  }
  return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
}
