import {
  createEncompassConnector,
  FREEFLOW_DEV_CONNECTOR_BINDING,
  type EncompassConnector,
} from '@mortgage-pos/encompass-connector-contract';

/**
 * Optional portal factory. Document-pull routes and the worker do not import this.
 * The portal process must not host LOS connectors; Custom/ECS is the only allowed kind.
 */
export function createPortalEncompassConnector(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): EncompassConnector {
  const serviceToken = environment.ENCOMPASS_CONNECTOR_SERVICE_TOKEN?.trim();
  return createEncompassConnector({
    binding: {
      ...FREEFLOW_DEV_CONNECTOR_BINDING,
      serviceBaseUrl: environment.ENCOMPASS_CONNECTOR_SERVICE_URL,
    },
    connectorServiceAuth: serviceToken ? { authorizationHeader: `Bearer ${serviceToken}` } : undefined,
    fetch: fetchImpl,
  });
}
