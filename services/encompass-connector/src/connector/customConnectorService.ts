import {
  EncompassConnectorError,
  type DownloadedEncompassAttachment,
  type EncompassAttachmentRef,
  type EncompassConnector,
  type EncompassConnectorContext,
} from '@mortgage-pos/encompass-connector-contract';

/**
 * Service-side EncompassConnector shell (Custom path).
 *
 * STUBBED: list/download do not call Encompass. They fail closed with
 * non-retryable safe codes until a later live-wiring change.
 *
 * FORBIDDEN:
 * - LOS credentials in this process image / logs / git
 * - PDF persistence (disk, S3, /tmp). Any future download must stay in memory
 *   and zero the buffer after the response (ZDR).
 * - Portal document-pull / worker enablement (not this package)
 */
export class CustomConnectorService implements EncompassConnector {
  readonly kind = 'custom' as const;

  async listActiveAttachments(
    _context: EncompassConnectorContext,
    _loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    throw new EncompassConnectorError(
      'CONNECTOR_NOT_IMPLEMENTED',
      'Attachment listing is not implemented in this service skeleton.',
      false,
    );
  }

  async downloadOriginalAttachment(
    _context: EncompassConnectorContext,
    _loanGuid: string,
    _attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    // ZDR: this stub does not download, buffer, or persist PDF bytes.
    // FORBIDDEN: local files, object storage, or scratch directories for PDFs.
    // When implemented, keep bytes in memory only and zero them after send.
    throw new EncompassConnectorError(
      'CONNECTOR_NOT_IMPLEMENTED',
      'Attachment download is not implemented in this service skeleton.',
      false,
    );
  }
}
