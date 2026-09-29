import { CustomConnectorAdapter } from './adapters/customConnectorAdapter';
import type { EncompassConnector } from './connector';
import type { CreateEncompassConnectorOptions } from './types';

/**
 * Builds an EncompassConnector from a deployment binding.
 * The separately deployed custom connector is the only supported path.
 */
export function createEncompassConnector(options: CreateEncompassConnectorOptions): EncompassConnector {
  return new CustomConnectorAdapter({
    binding: options.binding,
    serviceAuth: options.connectorServiceAuth,
    fetch: options.fetch,
  });
}
