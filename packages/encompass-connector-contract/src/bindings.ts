import type { ConnectorDeploymentBinding } from './types';

/** Single synthetic binding for the shared freeflow-dev environment. */
export const FREEFLOW_DEV_CONNECTOR_BINDING: ConnectorDeploymentBinding = {
  kind: 'custom',
  deploymentId: 'freeflow-dev',
  lenderId: 'freeflow-dev',
};

export function createLenderConnectorBinding(input: Readonly<{
  lenderId: string;
  deploymentId: string;
  serviceBaseUrl: string;
}>): ConnectorDeploymentBinding {
  return {
    kind: 'custom',
    lenderId: input.lenderId,
    deploymentId: input.deploymentId,
    serviceBaseUrl: input.serviceBaseUrl,
  };
}
