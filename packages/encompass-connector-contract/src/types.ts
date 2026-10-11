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

/**
 * Versioned provider-boundary projection used by integrated import. It is not
 * the core calculation model and deliberately excludes SSNs and credentials.
 */
export type EncompassLoanSnapshot = Readonly<{
  schemaVersion: 'encompass-loan-snapshot-v1';
  sourceSystem: 'ENCOMPASS';
  simulated: boolean;
  loanGuid: string;
  loan: Readonly<{
    loanProgram: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA' | 'OTHER';
    loanPurpose: 'PURCHASE' | 'REFINANCE' | 'OTHER';
    requestedAmount?: number;
  }>;
  borrowers: ReadonlyArray<Readonly<{
    providerBorrowerId: string;
    role: 'BORROWER' | 'COBORROWER';
    givenName: string;
    familyName: string;
    employment: ReadonlyArray<Readonly<{
      providerEmploymentId: string;
      employerName: string;
      status: 'CURRENT' | 'PREVIOUS';
      baseMonthlyIncome?: number;
      variableMonthlyIncome?: number;
    }>>;
  }>>;
}>;

export type DownloadedEncompassAttachment = Readonly<{
  bytes: Uint8Array;
  sha256: string;
}>;

export type EncompassFieldWrite = Readonly<{ fieldName: string; value: string }>;

export type EncompassApprovedIncomeUpdate = Readonly<{
  approvalEventId: string;
  fields: ReadonlyArray<EncompassFieldWrite>;
}>;

export type EncompassProviderFieldDisposition = Readonly<{
  fieldName: string;
  status: 'APPLIED' | 'REJECTED' | 'UNAVAILABLE';
}>;

export type EncompassWriteResult = Readonly<{
  providerRevision?: string;
  fieldResults?: ReadonlyArray<EncompassProviderFieldDisposition>;
}>;

export type EncompassFieldReadbackStatus = 'SUCCESS' | 'REJECTED' | 'UNAVAILABLE' | 'CONFLICT';
export type EncompassFieldReadbackReason =
  | 'VALUE_CONFIRMED'
  | 'PROVIDER_REJECTED'
  | 'FIELD_UNAVAILABLE'
  | 'VALUE_CONFLICT';

export type EncompassFieldReadback = Readonly<{
  fieldName: string;
  status: EncompassFieldReadbackStatus;
  reasonCode: EncompassFieldReadbackReason;
}>;

export type EncompassFieldReadbackReport = Readonly<{
  schemaVersion: 'encompass-field-readback-v1';
  allSucceeded: boolean;
  fields: ReadonlyArray<EncompassFieldReadback>;
}>;

export type EncompassWritePreview = Readonly<{
  schemaVersion: 'encompass-write-preview-v1';
  approvalEventId: string;
  previewHash: string;
  fields: ReadonlyArray<EncompassFieldWrite>;
}>;

/** Service-to-service auth for the connector ECS process. Never LOS credentials. */
export type BearerConnectorServiceAuth = Readonly<{
  authorizationHeader: string;
}>;

/** Production private-service authentication. This secret is distinct from
 * Encompass credentials and is never added to request JSON. */
export type SignedConnectorServiceAuth = Readonly<{
  kind: 'signed-hmac';
  serviceId: string;
  signingKey: string;
}>;

export type ConnectorServiceAuth = BearerConnectorServiceAuth | SignedConnectorServiceAuth;

/**
 * Port implemented by the existing portal `EncompassApiClient`.
 * The adapter wraps this client; it does not take secrets itself.
 */
export type DeveloperConnectClient = {
  retrieveLoanSnapshot?(loanGuid: string): Promise<EncompassLoanSnapshot>;
  listActiveAttachments(loanGuid: string): Promise<ReadonlyArray<EncompassAttachmentRef>>;
  downloadOriginalAttachment(
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment>;
  applyApprovedIncomeUpdate?(
    loanGuid: string,
    update: EncompassApprovedIncomeUpdate,
  ): Promise<EncompassWriteResult>;
  readFields?(loanGuid: string, fieldNames: ReadonlyArray<string>): Promise<Readonly<Record<string, string>>>;
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
