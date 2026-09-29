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
 * The PDF is a one-page synthetic W-2 so the income parser can return a
 * persistable w2Extracts row.
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

  async applyApprovedIncomeUpdate(): Promise<Readonly<{ providerRevision?: string }>> {
    throw new EncompassConnectorError('SYNTHETIC_WRITE_DISABLED', 'Synthetic connector writes are disabled.', false);
  }

  async readFields(): Promise<Readonly<Record<string, string>>> {
    return {};
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

/**
 * IRS Copy B boxes from services/doc-parser/templates/w2_map.json (612×792,
 * top-left origin). Content-stream text uses a bottom-left origin, so
 * pdfY = 792 - baseline. Box 6 is 1.45% of Box 5 so the W-2 medicare check
 * passes, and Box 1 is filled because persistence prefers Box 1 when present.
 */
const SYNTHETIC_W2_LINES: ReadonlyArray<readonly [number, number, string]> = [
  [72, 756, 'Form W-2 Wage and Tax Statement 2025'],
  [42, 710, '00-0000000'],
  [42, 680, 'FreeFlow Synthetic Payroll LLC'],
  [340, 710, '120000.00'],
  [340, 664, '120000.00'],
  [462, 664, '1740.00'],
];

function pdfLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createSyntheticPdf(): Uint8Array {
  const content = [
    'BT /F1 9 Tf',
    ...SYNTHETIC_W2_LINES.map(([x, y, text]) => `1 0 0 1 ${x} ${y} Tm (${pdfLiteral(text)}) Tj`),
    'ET',
    '',
  ].join('\n');
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
