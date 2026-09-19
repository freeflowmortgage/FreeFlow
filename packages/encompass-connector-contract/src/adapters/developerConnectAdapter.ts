import type { EncompassConnector } from '../connector';
import type {
  DeveloperConnectClient,
  DownloadedEncompassAttachment,
  EncompassAttachmentRef,
  EncompassConnectorContext,
} from '../types';

/**
 * Thin wrap of the existing Developer Connect client.
 * Construction does not read secrets; the caller supplies an already-built client.
 * Factory default keeps this adapter OFF.
 */
export class DeveloperConnectAdapter implements EncompassConnector {
  readonly kind = 'developer-connect' as const;

  constructor(private readonly client: DeveloperConnectClient) {}

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
}
