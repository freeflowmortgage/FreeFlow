import type { NextApiRequest, NextApiResponse } from 'next';
import type { RequestContext } from '../../auth/requestContext';
import { withTenantTransaction } from '../../database/client';
import { ApiError, sendApiError } from '../../http/apiError';
import { isIdempotencyKey, isUuid } from '../../http/identifiers';
import {
  assertRecentAuthentication,
  DELIVERY_PAGE_LIMIT,
  listWebhookDeliveries,
  readWebhookEndpoint,
  requestWebhookRedelivery,
  rotateWebhookSigningSecret,
  upsertWebhookEndpoint,
} from './endpointAdmin';
import { createWebhookSecretStore, WebhookSecretStoreError, type WebhookSecretStore } from './secretStore';
import { readWebhookEgressPolicy, WebhookPolicyError, type WebhookEgressPolicy } from './urlPolicy';

type Dependencies = Readonly<{
  withTenantTransaction: typeof withTenantTransaction;
  secretStore: () => WebhookSecretStore;
  egressPolicy: () => WebhookEgressPolicy;
  assertRecentAuthentication: (context: RequestContext) => void;
}>;

const defaultDependencies: Dependencies = {
  withTenantTransaction,
  secretStore: () => createWebhookSecretStore(),
  egressPolicy: () => readWebhookEgressPolicy(),
  assertRecentAuthentication: (context) => assertRecentAuthentication(context),
};

export function createWebhookEndpointHandler(dependencies: Dependencies = defaultDependencies) {
  return route(['GET', 'PUT'], async (req, res, context) => {
    const tenant = { tenantId: context.tenantId, principalId: context.membershipId };
    if (req.method === 'GET') {
      const endpoint = await dependencies.withTenantTransaction(tenant, (transaction) => readWebhookEndpoint(transaction, context));
      return res.status(200).json({ endpoint, requestId: context.requestId });
    }
    dependencies.assertRecentAuthentication(context);
    const idempotencyKey = readIdempotencyKey(req);
    const body = readBody(req);
    const policy = configuration(dependencies.egressPolicy);
    const secretStore = configuration(dependencies.secretStore);
    const result = await dependencies.withTenantTransaction(tenant, (transaction) => upsertWebhookEndpoint(transaction, context, {
      url: body.url,
      isEnabled: body.isEnabled,
      expectedVersion: body.expectedVersion,
      idempotencyKey,
    }, { policy, secretStore }));
    return res.status(result.created ? 201 : 200).json({
      endpoint: result.endpoint,
      signingSecret: result.signingSecret,
      replayed: result.replayed,
      requestId: context.requestId,
    });
  });
}

export function createWebhookSecretRotationHandler(dependencies: Dependencies = defaultDependencies) {
  return route(['POST'], async (req, res, context) => {
    dependencies.assertRecentAuthentication(context);
    const idempotencyKey = readIdempotencyKey(req);
    const body = readBody(req);
    const secretStore = configuration(dependencies.secretStore);
    const result = await dependencies.withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      (transaction) => rotateWebhookSigningSecret(transaction, context, {
        expectedVersion: body.expectedVersion,
        idempotencyKey,
      }, { secretStore }),
    );
    return res.status(200).json({
      endpoint: result.endpoint,
      signingSecret: result.signingSecret,
      replayed: result.replayed,
      requestId: context.requestId,
    });
  });
}

export function createWebhookDeliveriesHandler(dependencies: Pick<Dependencies, 'withTenantTransaction'> = defaultDependencies) {
  return route(['GET'], async (req, res, context) => {
    const cursor = optionalUuidQuery(req.query.cursor, 'cursor');
    const loanId = optionalUuidQuery(req.query.loanId, 'loanId');
    const limit = readLimit(req.query.limit);
    const page = await dependencies.withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      (transaction) => listWebhookDeliveries(transaction, context, { cursor, loanId, limit }),
    );
    return res.status(200).json({ ...page, requestId: context.requestId });
  });
}

export function createWebhookRedeliveryHandler(dependencies: Pick<Dependencies, 'withTenantTransaction' | 'assertRecentAuthentication'> = defaultDependencies) {
  return route(['POST'], async (req, res, context) => {
    dependencies.assertRecentAuthentication(context);
    const deliveryId = req.query.deliveryId;
    if (typeof deliveryId !== 'string' || !isUuid(deliveryId)) {
      throw new ApiError(400, 'INVALID_IDENTIFIER', 'deliveryId is invalid.');
    }
    const idempotencyKey = readIdempotencyKey(req);
    const result = await dependencies.withTenantTransaction(
      { tenantId: context.tenantId, principalId: context.membershipId },
      (transaction) => requestWebhookRedelivery(transaction, context, { deliveryId, idempotencyKey }),
    );
    return res.status(202).json({ ...result, requestId: context.requestId });
  });
}

function route(
  methods: readonly string[],
  handler: (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => Promise<unknown>,
) {
  return async (req: NextApiRequest, res: NextApiResponse, context: RequestContext) => {
    if (!methods.includes(req.method ?? '')) {
      res.setHeader('Allow', [...methods]);
      return res.status(405).json({
        error: { code: 'METHOD_NOT_ALLOWED', message: `Only ${methods.join(', ')} is supported.`, requestId: context.requestId },
      });
    }
    try {
      return await handler(req, res, context);
    } catch (error) {
      if (error instanceof ApiError) return sendApiError(res, context.requestId, error);
      if (error instanceof WebhookSecretStoreError) {
        return sendApiError(res, context.requestId, new ApiError(
          503,
          'WEBHOOK_SECRET_UNAVAILABLE',
          'The signing secret service is temporarily unavailable. No changes were saved; it is safe to retry.',
        ));
      }
      throw error;
    }
  };
}

function configuration<T>(factory: () => T): T {
  try {
    return factory();
  } catch (error) {
    if (error instanceof WebhookSecretStoreError || error instanceof WebhookPolicyError) {
      throw new ApiError(503, 'WEBHOOKS_UNAVAILABLE', 'Webhook delivery is not configured for this deployment.');
    }
    throw error;
  }
}

function readIdempotencyKey(req: NextApiRequest): string {
  const header = req.headers['idempotency-key'];
  if (Array.isArray(header) || typeof header !== 'string' || !isIdempotencyKey(header)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  return header;
}

function readBody(req: NextApiRequest): Record<string, unknown> {
  const body = req.body as unknown;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_REQUEST_BODY', 'A JSON object body is required.');
  }
  return body as Record<string, unknown>;
}

function optionalUuidQuery(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !isUuid(value)) throw new ApiError(400, 'INVALID_IDENTIFIER', `${field} is invalid.`);
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined) return DELIVERY_PAGE_LIMIT;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > DELIVERY_PAGE_LIMIT) {
    throw new ApiError(400, 'INVALID_LIMIT', `limit must be between 1 and ${DELIVERY_PAGE_LIMIT}.`);
  }
  return Number(value);
}
