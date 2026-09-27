import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { emitConnectorError } from '../observability/operationalEvents';

const STATUS_BY_CODE: Record<string, number> = {
  CONNECTOR_SERVICE_AUTH_MISSING: 401,
  CONNECTOR_SERVICE_AUTH_INVALID: 401,
  CONNECTOR_BINDING_MISMATCH: 403,
  CONNECTOR_BINDING_NOT_FOUND: 403,
  CONNECTOR_NOT_IMPLEMENTED: 501,
  SYNTHETIC_LOAN_NOT_FOUND: 404,
  SYNTHETIC_ATTACHMENT_NOT_FOUND: 404,
  LOS_CREDENTIALS_FORBIDDEN: 400,
  CONNECTOR_CONTRACT_VERSION_INVALID: 400,
  CONNECTOR_REQUEST_INVALID: 400,
  CONNECTOR_METHOD_NOT_ALLOWED: 405,
  CONNECTOR_PATH_NOT_FOUND: 404,
};

export function safeErrorResponse(status: number, safeCode: string): Response {
  emitConnectorError(safeCode, status);
  return Response.json({ safeCode }, { status });
}

export function responseFromUnknown(error: unknown): Response {
  if (error instanceof EncompassConnectorError) {
    const status = error.safeCode === 'ENCOMPASS_WRITE_OUTCOME_UNKNOWN'
      ? 504
      : STATUS_BY_CODE[error.safeCode] ?? (error.retryable ? 503 : 400);
    return safeErrorResponse(status, error.safeCode);
  }
  return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
}
