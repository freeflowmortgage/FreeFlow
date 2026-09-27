import type {
  ConnectorKind,
  DownloadedEncompassAttachment,
  EncompassAttachmentRef,
  EncompassConnectorContext,
  EncompassApprovedIncomeUpdate,
  EncompassWriteResult,
} from './types';

/**
 * Orchestrator-facing Encompass port.
 * Implementations must not accept or return LOS credentials.
 */
export interface EncompassConnector {
  readonly kind: ConnectorKind;
  listActiveAttachments(
    context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>>;
  downloadOriginalAttachment(
    context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment>;
  applyApprovedIncomeUpdate(
    context: EncompassConnectorContext,
    loanGuid: string,
    update: EncompassApprovedIncomeUpdate,
  ): Promise<EncompassWriteResult>;
  readFields(
    context: EncompassConnectorContext,
    loanGuid: string,
    fieldNames: ReadonlyArray<string>,
  ): Promise<Readonly<Record<string, string>>>;
}
