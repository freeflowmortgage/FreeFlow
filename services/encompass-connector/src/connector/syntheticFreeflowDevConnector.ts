import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
export const SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID = 'synthetic-pack-form-1065-2025';
export const SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-k1-1065-2025';
export const SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID = 'synthetic-pack-paystub-usb-nates';
export const SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID = 'synthetic-pack-w2-2021-nates';
export const SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-e-2025';

const MORNING_PACK_DIRECTORY = 'morning-pack-2026-09-29';

/** Read-only freeflow-dev fixture catalog. sha256 is the expected content hash. */
export const SYNTHETIC_FREEFLOW_DEV_MORNING_PACK = [
  {
    id: SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
    filename: 'form-1065-2025.pdf',
    sha256: '4f7b1ea6d86cfc087de9c6657afefb774830cec93f2fc37b68866cbe927e32ee',
  },
  {
    id: SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID,
    filename: 'schedule-k1-1065-2025.pdf',
    sha256: 'c7a0cb7ac7aecd75fd262afbbc8bcd363790653bb8a6616fbddcdc230cadfe90',
  },
  {
    id: SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID,
    filename: 'paystub.pdf',
    sha256: 'cb1e8465f79cd24e4d323ceec58d51016d37f8dc79bbdd50483b866c6f5995fd',
  },
  {
    id: SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
    filename: 'w2-2021.pdf',
    sha256: '0678ea430c4716a478e5367f1df565223dc3a64d15f0e4c3f0c6a03e0862b18e',
  },
  {
    id: SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
    filename: 'schedule-e-2025.pdf',
    sha256: 'ff14337f558406d5c5a8c533c4693be380de5d611d53d825fc4b5ccdbf5029f1',
  },
] as const;

export const SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS: readonly [
  typeof SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
] = [
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
];

/**
 * Non-production-only deterministic LOS stand-in. The HP-01 W-2 is created in
 * memory for each request. Morning-pack attachments are read from baked
 * fixtures and never written back. This connector never receives LOS credentials.
 */
export class SyntheticFreeflowDevConnector implements EncompassConnector {
  readonly kind = 'custom' as const;

  async listActiveAttachments(
    context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<ReadonlyArray<EncompassAttachmentRef>> {
    assertSyntheticRequest(context, loanGuid);
    return SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS.map((id) => ({ id }));
  }

  async downloadOriginalAttachment(
    context: EncompassConnectorContext,
    loanGuid: string,
    attachmentId: string,
  ): Promise<DownloadedEncompassAttachment> {
    assertSyntheticRequest(context, loanGuid);
    if (attachmentId === SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID) {
      const bytes = createSyntheticPdf();
      return { bytes, sha256: sha256Hex(bytes) };
    }

    const pack = SYNTHETIC_FREEFLOW_DEV_MORNING_PACK.find((attachment) => attachment.id === attachmentId);
    if (!pack) {
      throw new EncompassConnectorError(
        'SYNTHETIC_ATTACHMENT_NOT_FOUND',
        'Synthetic attachment was not found.',
        false,
      );
    }

    const bytes = readMorningPackFixture(pack.filename);
    return { bytes, sha256: sha256Hex(bytes) };
  }

  async applyApprovedIncomeUpdate(): Promise<Readonly<{ providerRevision?: string }>> {
    throw new EncompassConnectorError('SYNTHETIC_WRITE_DISABLED', 'Synthetic connector writes are disabled.', false);
  }

  async readFields(): Promise<Readonly<Record<string, string>>> {
    return {};
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function resolveMorningPackDirectory(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'fixtures', MORNING_PACK_DIRECTORY),
    path.resolve(__dirname, '..', 'fixtures', MORNING_PACK_DIRECTORY),
    path.resolve(process.cwd(), 'fixtures', MORNING_PACK_DIRECTORY),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new EncompassConnectorError(
      'SYNTHETIC_FIXTURE_UNAVAILABLE',
      'Synthetic pack fixture is unavailable.',
      false,
    );
  }
  return found;
}

function readMorningPackFixture(filename: string): Uint8Array {
  const root = resolveMorningPackDirectory();
  const filePath = path.resolve(root, filename);
  const relative = path.relative(root, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new EncompassConnectorError(
      'SYNTHETIC_FIXTURE_UNAVAILABLE',
      'Synthetic pack fixture is unavailable.',
      false,
    );
  }
  try {
    return new Uint8Array(readFileSync(filePath));
  } catch {
    throw new EncompassConnectorError(
      'SYNTHETIC_FIXTURE_UNAVAILABLE',
      'Synthetic pack fixture is unavailable.',
      false,
    );
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
