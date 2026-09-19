import {
  CONNECTOR_SERVICE_CONTRACT,
  assertNoLosCredentials,
} from '@mortgage-pos/encompass-connector-contract';
import type { EncompassConnector } from '@mortgage-pos/encompass-connector-contract';
import type { ServiceAuthVerifier } from '../auth';
import { enforceTenantLenderBinding, type BindingStore } from '../binding';
import { responseFromUnknown, safeErrorResponse } from './errors';

export type ConnectorServiceDependencies = Readonly<{
  authVerifier: ServiceAuthVerifier;
  bindingStore: BindingStore;
  connector: EncompassConnector;
}>;

/**
 * Fetch-API request handler for the connector service contract.
 * CustomConnectorAdapter can target this via an injected `fetch` in tests.
 */
export async function handleConnectorRequest(
  request: Request,
  deps: ConnectorServiceDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;

  if (request.method === 'GET' && path === CONNECTOR_SERVICE_CONTRACT.healthPath) {
    return Response.json({
      status: 'ok',
      stub: true,
      contractVersion: CONNECTOR_SERVICE_CONTRACT.version,
    });
  }

  if (request.method !== 'POST') {
    return safeErrorResponse(405, 'CONNECTOR_METHOD_NOT_ALLOWED');
  }

  if (
    path !== CONNECTOR_SERVICE_CONTRACT.listPath
    && path !== CONNECTOR_SERVICE_CONTRACT.downloadPath
  ) {
    return safeErrorResponse(404, 'CONNECTOR_PATH_NOT_FOUND');
  }

  const auth = await deps.authVerifier.verify({
    authorizationHeader: request.headers.get('authorization') ?? undefined,
  });
  if (!auth.ok) {
    return safeErrorResponse(401, auth.safeCode);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
  }

  try {
    assertNoLosCredentials(body);
  } catch (error) {
    return responseFromUnknown(error);
  }

  if (!isRecord(body) || body.contractVersion !== CONNECTOR_SERVICE_CONTRACT.version) {
    return safeErrorResponse(400, 'CONNECTOR_CONTRACT_VERSION_INVALID');
  }

  const claimed = {
    tenantId: readString(body.tenantId),
    lenderId: readString(body.lenderId),
    deploymentId: readString(body.deploymentId),
  };
  if (!claimed.tenantId || !claimed.lenderId || !claimed.deploymentId) {
    return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
  }

  try {
    await enforceTenantLenderBinding(claimed, auth.principal.tenantId, deps.bindingStore);
  } catch (error) {
    return responseFromUnknown(error);
  }

  const context = {
    tenantId: claimed.tenantId,
    loanId: readString(body.loanId),
    correlationId: readString(body.correlationId),
  };
  const loanGuid = readString(body.loanGuid);
  if (!context.loanId || !context.correlationId || !loanGuid) {
    return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
  }

  try {
    if (path === CONNECTOR_SERVICE_CONTRACT.listPath) {
      const attachments = await deps.connector.listActiveAttachments(context, loanGuid);
      return Response.json({ attachments });
    }

    const attachmentId = readString(body.attachmentId);
    if (!attachmentId) {
      return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
    }

    const downloaded = await deps.connector.downloadOriginalAttachment(
      context,
      loanGuid,
      attachmentId,
    );
    // In-memory response only. FORBIDDEN: persist `downloaded.bytes` to disk or S3 (ZDR).
    return new Response(Buffer.from(downloaded.bytes), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'x-content-sha256': downloaded.sha256,
      },
    });
  } catch (error) {
    return responseFromUnknown(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
