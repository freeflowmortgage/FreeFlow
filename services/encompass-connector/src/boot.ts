import { PrismaClient } from '@prisma/client';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { HmacSignedReplayServiceAuthVerifier, NonProdBearerServiceAuthVerifier } from './auth';
import { PrismaBindingStore } from './binding';
import { CustomConnectorService } from './connector/customConnectorService';
import { readEncompassRuntimeCredentials } from './connector/encompassApiClient';
import {
  SYNTHETIC_FREEFLOW_DEV_MODE,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from './connector/syntheticFreeflowDevConnector';
import type { ConnectorServiceDependencies } from './http/handleRequest';
import { startConnectorHttpServer } from './http/nodeServer';

/** Skeleton S2S selection. Production must not boot with this kind. */
export const SKELETON_SERVICE_AUTH_KIND = 'bearer-stub-non-prod' as const;
export const SIGNED_REPLAY_SERVICE_AUTH_KIND = 'signed-replay' as const;

export type ConnectorRuntime = Readonly<{
  port: number;
  deps: ConnectorServiceDependencies;
}>;

/**
 * Fail closed before listen / before loading S2S token material.
 * Safe message only — never interpolates env or token values.
 */
export function assertProductionAllowsAuth(
  nodeEnv: string | undefined,
  authKind: string,
): void {
  if (nodeEnv === 'production' && authKind === SKELETON_SERVICE_AUTH_KIND) {
    throw new EncompassConnectorError(
      'CONNECTOR_BEARER_STUB_FORBIDDEN_IN_PRODUCTION',
      'The non-prod Bearer S2S stub cannot run when NODE_ENV=production.',
      false,
    );
  }
}

export function createConnectorRuntime(env: NodeJS.ProcessEnv): ConnectorRuntime {
  const authKind = env.CONNECTOR_SERVICE_AUTH_KIND?.trim() || SKELETON_SERVICE_AUTH_KIND;
  assertProductionAllowsAuth(env.NODE_ENV, authKind);

  const port = Number.parseInt(env.PORT ?? '8080', 10);
  const serviceToken = env.CONNECTOR_SERVICE_TOKEN?.trim();
  const tenantId = env.CONNECTOR_BOUND_TENANT_ID?.trim();

  return {
    port: Number.isFinite(port) ? port : 8080,
    deps: {
      authVerifier: selectAuthVerifier(env, authKind, serviceToken, tenantId),
      bindingStore: new PrismaBindingStore(new PrismaClient()),
      connector: selectConnector(env),
    },
  };
}

function selectAuthVerifier(env: NodeJS.ProcessEnv, authKind: string, serviceToken: string | undefined, tenantId: string | undefined) {
  if (authKind === SIGNED_REPLAY_SERVICE_AUTH_KIND) {
    const serviceId = env.CONNECTOR_SIGNED_SERVICE_ID?.trim();
    const signingKey = env.CONNECTOR_SIGNING_KEY?.trim();
    if (!serviceId || !signingKey || !tenantId) {
      throw new EncompassConnectorError('CONNECTOR_SIGNED_AUTH_CONFIGURATION_MISSING', 'Signed S2S authentication is not configured.', false);
    }
    return new HmacSignedReplayServiceAuthVerifier([{ serviceId, tenantId, signingKey }]);
  }
  if (authKind !== SKELETON_SERVICE_AUTH_KIND) {
    throw new EncompassConnectorError('CONNECTOR_SERVICE_AUTH_KIND_INVALID', 'Connector service authentication mode is invalid.', false);
  }
  return new NonProdBearerServiceAuthVerifier(serviceToken && tenantId ? [{ token: serviceToken, serviceId: 'portal', tenantId }] : []);
}

function selectConnector(env: NodeJS.ProcessEnv) {
  if (env.CONNECTOR_MODE?.trim() !== SYNTHETIC_FREEFLOW_DEV_MODE) {
    return new CustomConnectorService(readEncompassRuntimeCredentials(env));
  }
  if (
    env.NODE_ENV !== 'development'
    || env.FREEFLOW_RUNTIME_ENV !== 'development'
    || env.CONNECTOR_BOUND_TENANT_ID?.trim() !== SYNTHETIC_FREEFLOW_DEV_TENANT_ID
  ) {
    throw new EncompassConnectorError(
      'CONNECTOR_SYNTHETIC_MODE_FORBIDDEN',
      'Synthetic connector mode is restricted to development.',
      false,
    );
  }
  return new SyntheticFreeflowDevConnector();
}

export function bootConnectorService(env: NodeJS.ProcessEnv = process.env) {
  const runtime = createConnectorRuntime(env);
  return startConnectorHttpServer(runtime);
}
