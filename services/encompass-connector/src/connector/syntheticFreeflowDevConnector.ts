import { createHash } from 'node:crypto';
import {
  EncompassConnectorError,
  type DownloadedEncompassAttachment,
  type EncompassAttachmentRef,
  type EncompassConnector,
  type EncompassConnectorContext,
} from '@mortgage-pos/encompass-connector-contract';

export const SYNTHETIC_FREEFLOW_DEV_MODE = 'synthetic-freeflow-dev' as const;
export const SYNTHETIC_FREEFLOW_DEV_TENANT_ID = '00000000-0000-4000-8000-000000000100';
export const SYNTHETIC_FREEFLOW_DEV_LOAN_GUID = '00000000-0000-4000-8000-000000000200';
export const SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID = 'synthetic-income-document-1';

/**
 * Non-production-only deterministic LOS stand-in. It creates the PDF bytes in
 * memory for each request and never receives LOS credentials or persists data.
 */
export class SyntheticFreeflowDevConnector implements EncompassConnector {
  readonly kind = 'custom' as const;

  async listActiveAttachments(
    context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    assertSyntheticRequest(context, loanGuid);
    return [{ id: SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID }];
  }

  async downloadOriginalAttachment(
    context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    assertSyntheticRequest(context, loanGuid);
    if (attachmentId !== SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID) {
      throw new EncompassConnectorError(
        'SYNTHETIC_ATTACHMENT_NOT_FOUND',
        'Synthetic attachment was not found.',
        false,
      );
    }

    const bytes = createSyntheticPdf();
    return {
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }
}

function assertSyntheticRequest(context: EncompassConnectorContext, loanGuid: string): void {
  if (
    context.tenantId !== SYNTHETIC_FREEFLOW_DEV_TENANT_ID
    || loanGuid !== SYNTHETIC_FREEFLOW_DEV_LOAN_GUID
  ) {
    throw new EncompassConnectorError(
      'SYNTHETIC_LOAN_NOT_FOUND',
      'Synthetic loan was not found.',
      false,
    );
  }
}

function createSyntheticPdf(): Uint8Array {
  const content = 'BT /F1 12 Tf 72 720 Td (FreeFlow synthetic connector document) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}
