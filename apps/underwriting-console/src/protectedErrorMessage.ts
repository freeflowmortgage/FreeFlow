import { PortalApiError } from './api/portalClient';
import { EncompassHostError } from './encompass-host/bridge';

export function describeProtectedError(error: unknown, fallback: string): string {
  if (error instanceof PortalApiError && error.status === 503 && error.code === 'DOCUMENT_PROCESSOR_UNAVAILABLE') {
    return 'The document processor is busy or temporarily unavailable. Please retry.';
  }
  if (error instanceof PortalApiError || error instanceof EncompassHostError) return `${error.message} (${error.code})`;
  return error instanceof Error && error.message ? error.message : fallback;
}
