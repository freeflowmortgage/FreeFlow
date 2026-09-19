/**
 * Orchestrator context for EncompassConnector calls.
 * LOS credentials are intentionally absent: the connector service resolves them.
 */
export type EncompassConnectorContext = Readonly<{
  tenantId: string;
  loanId: string;
  correlationId: string;
}>;

export type ConnectorKind = 'custom' | 'developer-connect';

/**
 * Prod: one ECS connector deployment per lender.
 * freeflow-dev: a single synthetic binding is allowed.
 */
export type ConnectorDeploymentBinding = Readonly<{
  kind: ConnectorKind;
  deploymentId: string;
  lenderId: string;
  /** HTTPS origin of the separate connector ECS service. Required for `custom`. */
  serviceBaseUrl?: string;
}>;

export type EncompassAttachmentRef = Readonly<{ id: string }>;

export type DownloadedEncompassAttachment = Readonly<{
  bytes: Uint8Array;
  sha256: string;
}>;

/** Service-to-service auth for the connector ECS process. Never LOS credentials. */
export type ConnectorServiceAuth = Readonly<{
  authorizationHeader: string;
}>;

/**
 * Port implemented by the existing portal `EncompassApiClient`.
 * The adapter wraps this client; it does not take secrets itself.
 */
export type DeveloperConnectClient = {
  listActiveAttachments(loanGuid: string): Promise<ReadonlyArray<EncompassAttachmentRef>>;
  downloadOriginalAttachment(
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment>;
};

export type CreateEncompassConnectorOptions = Readonly<{
  binding: ConnectorDeploymentBinding;
  connectorServiceAuth?: ConnectorServiceAuth;
  fetch?: typeof fetch;
  /**
   * Developer Connect stays opt-in and default OFF.
   * When false, a developer-connect binding fails closed without calling the wrapped client.
   */
  developerConnectEnabled?: boolean;
  developerConnectClient?: DeveloperConnectClient;
}>;

type ForbiddenLosCredentialKeys =
  | 'clientSecret'
  | 'clientId'
  | 'instanceId'
  | 'password'
  | 'accessToken'
  | 'refreshToken'
  | 'apiKey'
  | 'authorization';

type AssertNoLosKeys<T> = Extract<keyof T, ForbiddenLosCredentialKeys> extends never ? T : never;

export type _ConnectorContextHasNoLosKeys = AssertNoLosKeys<EncompassConnectorContext>;
