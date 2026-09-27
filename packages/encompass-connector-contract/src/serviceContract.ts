/**
 * Authenticated HTTP contract for the separate Encompass connector ECS service.
 * The portal/orchestrator calls this service; the service holds LOS secrets.
 */
export const CONNECTOR_SERVICE_CONTRACT = {
  version: 'encompass-connector-service-v1',
  healthPath: '/health',
  listPath: '/v1/attachments/list',
  downloadPath: '/v1/attachments/download',
  applyUpdatePath: '/v1/approved-income/apply',
  readFieldsPath: '/v1/approved-income/fields',
} as const;

export type ConnectorServiceListRequest = Readonly<{
  contractVersion: typeof CONNECTOR_SERVICE_CONTRACT.version;
  deploymentId: string;
  lenderId: string;
  tenantId: string;
  loanId: string;
  loanGuid: string;
  correlationId: string;
}>;

export type ConnectorServiceDownloadRequest = ConnectorServiceListRequest & Readonly<{
  attachmentId: string;
}>;

export type ConnectorServiceApplyUpdateRequest = ConnectorServiceListRequest & Readonly<{
  approvalEventId: string;
  fields: ReadonlyArray<Readonly<{ fieldName: string; value: string }>>;
}>;

export type ConnectorServiceReadFieldsRequest = ConnectorServiceListRequest & Readonly<{
  fieldNames: ReadonlyArray<string>;
}>;
