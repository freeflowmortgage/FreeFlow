import { CustomConnectorAdapter } from './adapters/customConnectorAdapter';
import { DeveloperConnectAdapter } from './adapters/developerConnectAdapter';
import type { EncompassConnector } from './connector';
import { EncompassConnectorError } from './errors';
import type { CreateEncompassConnectorOptions } from './types';

/** Developer Connect remains optional and OFF unless a caller opts in. */
export const DEVELOPER_CONNECT_ENABLED_DEFAULT = false;

/**
 * Builds an EncompassConnector from a deployment binding.
 * Custom (separate ECS service) is the primary path. Developer Connect stays disabled by default.
 */
export function createEncompassConnector(options: CreateEncompassConnectorOptions): EncompassConnector {
  if (options.binding.kind === 'developer-connect') {
    if (options.developerConnectEnabled !== true) {
      throw new EncompassConnectorError(
        'DEVELOPER_CONNECT_DISABLED',
        'Developer Connect is disabled. The custom connector service is the primary path.',
        false,
      );
    }
    if (!options.developerConnectClient) {
      throw new EncompassConnectorError(
        'DEVELOPER_CONNECT_CLIENT_MISSING',
        'Developer Connect was enabled without a wrapped client.',
        false,
      );
    }
    return new DeveloperConnectAdapter(options.developerConnectClient);
  }

  return new CustomConnectorAdapter({
    binding: options.binding,
    serviceAuth: options.connectorServiceAuth,
    fetch: options.fetch,
  });
}
