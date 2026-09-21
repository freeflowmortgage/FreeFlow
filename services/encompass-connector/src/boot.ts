import { PrismaClient } from '@prisma/client';
import { EncompassConnectorError } from '@mortgage-pos/encompass-connector-contract';
import { NonProdBearerServiceAuthVerifier } from './auth';
import { PrismaBindingStore } from './binding';
import { CustomConnectorService } from './connector/customConnectorService';
import {
  SYNTHETIC_FREEFLOW_DEV_MODE,
  SYNTHETIC_FREEFLOW_DEV_TENANT_ID,
  SyntheticFreeflowDevConnector,
} from './connector/syntheticFreeflowDevConnector';
import type { ConnectorServiceDependencies } from './http/handleRequest';
import { startConnectorHttpServer } from './http/nodeServer';

/** Skeleton S2S selection. Production must not boot with this kind. */
export const SKELETON_SERVICE_AUTH_KIND = 'bearer-stub-non-prod' as const;

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
  assertProductionAllowsAuth(env.NODE_ENV, SKELETON_SERVICE_AUTH_KIND);

  const port = Number.parseInt(env.PORT ?? '8080', 10);
  const serviceToken = env.CONNECTOR_SERVICE_TOKEN?.trim();
  const tenantId = env.CONNECTOR_BOUND_TENANT_ID?.trim();

  return {
    port: Number.isFinite(port) ? port : 8080,
    deps: {
      authVerifier: new NonProdBearerServiceAuthVerifier(
        serviceToken && tenantId
          ? [{ token: serviceToken, serviceId: 'portal', tenantId }]
          : [],
      ),
      bindingStore: new PrismaBindingStore(new PrismaClient()),
      connector: selectConnector(env),
    },
  };
}

function selectConnector(env: NodeJS.ProcessEnv) {
  if (env.CONNECTOR_MODE?.trim() !== SYNTHETIC_FREEFLOW_DEV_MODE) {
    return new CustomConnectorService();
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
