import {
  CONNECTOR_SERVICE_CONTRACT,
  assertNoLosCredentials,
} from '@mortgage-pos/encompass-connector-contract';
import type { EncompassConnector } from '@mortgage-pos/encompass-connector-contract';
import type { ServiceAuthVerifier } from '../auth';
import { createHash } from 'node:crypto';
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
    && path !== CONNECTOR_SERVICE_CONTRACT.retrieveLoanPath
    && path !== CONNECTOR_SERVICE_CONTRACT.downloadPath
    && path !== CONNECTOR_SERVICE_CONTRACT.applyUpdatePath
    && path !== CONNECTOR_SERVICE_CONTRACT.readFieldsPath
  ) {
    return safeErrorResponse(404, 'CONNECTOR_PATH_NOT_FOUND');
  }

  const bodySha256 = createHash('sha256').update(Buffer.from(await request.clone().arrayBuffer())).digest('hex');
  const auth = await deps.authVerifier.verify({
    authorizationHeader: request.headers.get('authorization') ?? undefined,
    serviceIdHeader: request.headers.get('x-freeflow-service-id') ?? undefined,
    timestampHeader: request.headers.get('x-freeflow-timestamp') ?? undefined,
    nonceHeader: request.headers.get('x-freeflow-nonce') ?? undefined,
    signatureHeader: request.headers.get('x-freeflow-signature') ?? undefined,
    requestMethod: request.method,
    requestPath: path,
    bodySha256,
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
    if (path === CONNECTOR_SERVICE_CONTRACT.retrieveLoanPath) {
      return Response.json(await deps.connector.retrieveLoanSnapshot(context, loanGuid));
    }

    if (path === CONNECTOR_SERVICE_CONTRACT.listPath) {
      const attachments = await deps.connector.listActiveAttachments(context, loanGuid);
      return Response.json({ attachments });
    }


    if (path === CONNECTOR_SERVICE_CONTRACT.applyUpdatePath) {
      const approvalEventId = readString(body.approvalEventId);
      const fields = readFields(body.fields);
      if (!UUID.test(approvalEventId) || !fields) return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
      const result = await deps.connector.applyApprovedIncomeUpdate(context, loanGuid, { approvalEventId, fields });
      return Response.json({
        applied: true,
        ...(result.providerRevision ? { providerRevision: result.providerRevision } : {}),
        ...(result.fieldResults ? { fieldResults: result.fieldResults } : {}),
      });
    }

    if (path === CONNECTOR_SERVICE_CONTRACT.readFieldsPath) {
      const fieldNames = readFieldNames(body.fieldNames);
      if (!fieldNames) return safeErrorResponse(400, 'CONNECTOR_REQUEST_INVALID');
      return Response.json({ fields: await deps.connector.readFields(context, loanGuid, fieldNames) });
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
    try {
      return new Response(Buffer.from(downloaded.bytes), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'x-content-sha256': downloaded.sha256,
        },
      });
    } finally {
      downloaded.bytes.fill(0);
    }
  } catch (error) {
    return responseFromUnknown(error);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_NAME = /^(?:CX\.[A-Z0-9][A-Z0-9._-]{0,99}|10[1-7])$/;

function readFieldNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return null;
  const names = value.filter((item): item is string => typeof item === 'string' && FIELD_NAME.test(item));
  return names.length === value.length && new Set(names).size === names.length ? names : null;
}

function readFields(value: unknown): Array<{ fieldName: string; value: string }> | null {
  if (!Array.isArray(value)) return null;
  const result: Array<{ fieldName: string; value: string }> = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.fieldName !== 'string' || !FIELD_NAME.test(item.fieldName)
      || typeof item.value !== 'string' || item.value.length > 500) return null;
    result.push({ fieldName: item.fieldName, value: item.value });
  }
  return result.length > 0 && result.length <= 32 && new Set(result.map((field) => field.fieldName)).size === result.length
    ? result
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
