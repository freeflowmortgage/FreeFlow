import type { EncompassConnector } from '../connector';
import { EncompassConnectorError } from '../errors';
import type {
  DeveloperConnectClient,
  DownloadedEncompassAttachment,
  EncompassAttachmentRef,
  EncompassConnectorContext,
  EncompassApprovedIncomeUpdate,
  EncompassWriteResult,
  EncompassLoanSnapshot,
} from '../types';

/**
 * Thin wrap of the existing Developer Connect client.
 * Construction does not read secrets; the caller supplies an already-built client.
 * Factory default keeps this adapter OFF.
 */
export class DeveloperConnectAdapter implements EncompassConnector {
  readonly kind = 'developer-connect' as const;

  constructor(private readonly client: DeveloperConnectClient) {}

  retrieveLoanSnapshot(
    _context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<EncompassLoanSnapshot> {
    if (!this.client.retrieveLoanSnapshot) {
      throw new EncompassConnectorError(
        'DEVELOPER_CONNECT_LOAN_RETRIEVAL_UNAVAILABLE',
        'Developer Connect loan retrieval is unavailable.',
        false,
      );
    }
    return this.client.retrieveLoanSnapshot(loanGuid);
  }

  listActiveAttachments(
    _context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    return this.client.listActiveAttachments(loanGuid);
  }

  downloadOriginalAttachment(
    _context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    return this.client.downloadOriginalAttachment(loanGuid, attachmentId);
  }

  applyApprovedIncomeUpdate(
    _context: EncompassConnectorContext,
    loanGuid: string,
    update: EncompassApprovedIncomeUpdate,
  ): Promise<EncompassWriteResult> {
    if (!this.client.applyApprovedIncomeUpdate) throw new Error('Developer Connect write capability is unavailable.');
    return this.client.applyApprovedIncomeUpdate(loanGuid, update);
  }

  readFields(
    _context: EncompassConnectorContext,
    loanGuid: string,
    fieldNames: ReadonlyArray<string>,
  ): Promise<Readonly<Record<string, string>>> {
    if (!this.client.readFields) throw new Error('Developer Connect reconciliation capability is unavailable.');
    return this.client.readFields(loanGuid, fieldNames);
  }
}
