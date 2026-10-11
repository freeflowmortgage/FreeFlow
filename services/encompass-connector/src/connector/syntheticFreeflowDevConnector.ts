import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  EncompassConnectorError,
  type DownloadedEncompassAttachment,
  type EncompassAttachmentRef,
  type EncompassConnector,
  type EncompassConnectorContext,
  type EncompassApprovedIncomeUpdate,
  type EncompassLoanSnapshot,
  type EncompassProviderFieldDisposition,
  type EncompassWriteResult,
} from '@mortgage-pos/encompass-connector-contract';

export const SYNTHETIC_FREEFLOW_DEV_MODE = 'synthetic-freeflow-dev' as const;
export const SYNTHETIC_FREEFLOW_DEV_TENANT_ID = '00000000-0000-4000-8000-000000000100';
export const SYNTHETIC_FREEFLOW_DEV_LOAN_GUID = '00000000-0000-4000-8000-000000000200';
export const SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID = 'synthetic-income-document-1';
export const SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID = 'synthetic-pack-form-1065-2025';
export const SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-k1-1065-2025';
export const SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID = 'synthetic-pack-paystub-usb-nates';
export const SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID = 'synthetic-pack-w2-2021-nates';
export const SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID = 'synthetic-pack-w2-2021-coborrower';
export const SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-e-2025';
export const SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-b-2025';
export const SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-c-2025';
export const SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-f-2025';
export const SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-d-2025';
export const SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID = 'synthetic-pack-form-1120s-2025';
export const SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID = 'synthetic-pack-schedule-k1-1120s-2025';
export const SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID = 'synthetic-pack-form-1120-2025';

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
    // Distinct SELECTABLE id for TB-03. Bytes match the 2021 pack W-2; borrower assignment is in the review UI.
    id: SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
    filename: 'w2-2021-coborrower.pdf',
    sha256: '0678ea430c4716a478e5367f1df565223dc3a64d15f0e4c3f0c6a03e0862b18e',
  },
  {
    id: SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
    filename: 'schedule-e-2025.pdf',
    sha256: 'ff14337f558406d5c5a8c533c4693be380de5d611d53d825fc4b5ccdbf5029f1',
  },
  {
    // DEMO_GATE asset. Live parser keeps this page as Schedule B and reads schedule-b-interest from "Total interest" 12000.00.
    id: SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID,
    filename: 'schedule-b-2025.pdf',
    sha256: 'cd1af5599d84c66ea13adf2f6227811acfd83164391d0673274e5cb98c249dd7',
  },
  {
    // Live parser keeps this page as Schedule C and reads ent1-name, ent1-net 96000.00, and ent1-dep 8500.00.
    id: SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID,
    filename: 'schedule-c-2025.pdf',
    sha256: '2fdb9af27e95e41b2ad283bb62c1940abe95a2118aba0d1c06e23bd17bcf72a7',
  },
  {
    // Live parser keeps this page as Schedule F and reads schedule-f-name, schedule-f-net 48000.00, and schedule-f-depreciation 3200.00.
    id: SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID,
    filename: 'schedule-f-2025.pdf',
    sha256: '18b25453cef9d37c54e653fa2fd344f1d9b82194f396a80b57b1c863816047d9',
  },
  {
    // Live parser keeps this page as Schedule D and reads schedule-d-capital-gain-loss from "Combine lines 7 and 15" 12000.00.
    id: SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID,
    filename: 'schedule-d-2025.pdf',
    sha256: '5a642705c53137707c5b098caec4a67a111544f031380da5336c7a85935c4194',
  },
  {
    // Return face. Live parser reads scorp-return-name, scorp-return-ein, scorp-return-ord 142000.00, and scorp-return-dep 18000.00.
    id: SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID,
    filename: 'form-1120s-2025.pdf',
    sha256: '59fbd49915f2a5ea455e0a3b3bf284ba31ed422303a45e09ae36b72084b71be2',
  },
  {
    // K-1. Live parser reads scorp-name, scorp-ord 100000.00, scorp-own-pct 100%, and scorp-dist 100000.00.
    id: SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID,
    filename: 'schedule-k1-1120s-2025.pdf',
    sha256: 'b4ef854471dcdba0d2cab631b9f0f5ee80db6965d924735d0d79e4058b2c79b6',
  },
  {
    // Live parser keeps this page as Form 1120 and reads c1120-name, c1120-ein, c1120-taxable 120000.00, and c1120-dep 15000.00.
    id: SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
    filename: 'form-1120-2025.pdf',
    sha256: 'e9999553c366ae583a0c239df80cdd1eb841e065fe3d214d7db460e48e8863aa',
  },
] as const;

export const SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_IDS: readonly [
  typeof SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID,
  typeof SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
] = [
  SYNTHETIC_FREEFLOW_DEV_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_K1_1065_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_PAYSTUB_USB_NATES_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_NATES_ATTACHMENT_ID,
  SYNTHETIC_PACK_W2_2021_COBORROWER_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_E_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_B_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_C_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_F_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_D_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1120S_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_SCHEDULE_K1_1120S_2025_ATTACHMENT_ID,
  SYNTHETIC_PACK_FORM_1120_2025_ATTACHMENT_ID,
];

export type SyntheticFieldBehavior = 'REJECTED' | 'UNAVAILABLE' | 'CONFLICT';
export type SyntheticFreeflowDevConnectorOptions = Readonly<{
  fieldBehaviors?: Readonly<Record<string, SyntheticFieldBehavior>>;
  readFailuresBeforeSuccess?: number;
  unknownWriteOutcomeOnce?: boolean;
}>;

/**
 * Non-production-only deterministic LOS stand-in. The HP-01 W-2 is created in
 * memory for each request. Morning-pack attachments are read from baked
 * fixtures and never written back. This connector never receives LOS credentials.
 */
export class SyntheticFreeflowDevConnector implements EncompassConnector {
  readonly kind = 'custom' as const;
  private readonly fields = new Map<string, string>();
  private readonly completedApprovals = new Map<string, Readonly<{
    fingerprint: string;
    result: EncompassWriteResult;
  }>>();
  private remainingReadFailures: number;
  private unknownWriteOutcomePending: boolean;
  private mutationCountValue = 0;
  private writeAttemptCountValue = 0;

  constructor(private readonly options: SyntheticFreeflowDevConnectorOptions = {}) {
    this.remainingReadFailures = Math.max(0, Math.floor(options.readFailuresBeforeSuccess ?? 0));
    this.unknownWriteOutcomePending = options.unknownWriteOutcomeOnce === true;
  }

  get mutationCount(): number { return this.mutationCountValue; }
  get writeAttemptCount(): number { return this.writeAttemptCountValue; }

  async retrieveLoanSnapshot(
    context: EncompassConnectorContext,
    loanGuid: string,
  ): Promise<EncompassLoanSnapshot> {
    assertSyntheticRequest(context, loanGuid);
    return {
      schemaVersion: 'encompass-loan-snapshot-v1',
      sourceSystem: 'ENCOMPASS',
      simulated: true,
      loanGuid,
      loan: {
        loanProgram: 'CONVENTIONAL',
        loanPurpose: 'PURCHASE',
        requestedAmount: 320_000,
      },
      borrowers: [
        {
          providerBorrowerId: 'synthetic-borrower-1',
          role: 'BORROWER',
          givenName: 'Synthetic Primary',
          familyName: 'Borrower',
          employment: [{
            providerEmploymentId: 'synthetic-employment-1',
            employerName: 'Synthetic Payroll LLC',
            status: 'CURRENT',
            baseMonthlyIncome: 4_000,
            variableMonthlyIncome: 1_600,
          }],
        },
        {
          providerBorrowerId: 'synthetic-borrower-2',
          role: 'COBORROWER',
          givenName: 'Synthetic Co',
          familyName: 'Borrower',
          employment: [],
        },
      ],
    };
  }

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

  async applyApprovedIncomeUpdate(
    context: EncompassConnectorContext,
    loanGuid: string,
    update: EncompassApprovedIncomeUpdate,
  ): Promise<EncompassWriteResult> {
    assertSyntheticRequest(context, loanGuid);
    this.writeAttemptCountValue += 1;
    const marker = update.fields.find((field) => field.fieldName === 'CX.FREEFLOW.APPROVAL.ID');
    if (!marker || marker.value !== update.approvalEventId) {
      throw new EncompassConnectorError(
        'SYNTHETIC_APPROVAL_MISMATCH',
        'Synthetic write approval does not match its marker.',
        false,
      );
    }
    const fingerprint = sha256Text(JSON.stringify([...update.fields]
      .map((field) => ({ fieldName: field.fieldName, value: field.value }))
      .sort((left, right) => left.fieldName.localeCompare(right.fieldName))));
    const completed = this.completedApprovals.get(update.approvalEventId);
    if (completed) {
      if (completed.fingerprint !== fingerprint) {
        throw new EncompassConnectorError(
          'SYNTHETIC_IDEMPOTENCY_CONFLICT',
          'Synthetic approval was already used for a different update.',
          false,
        );
      }
      return completed.result;
    }

    const fieldResults: EncompassProviderFieldDisposition[] = [];
    for (const field of update.fields) {
      const behavior = this.options.fieldBehaviors?.[field.fieldName];
      if (behavior === 'REJECTED' || behavior === 'UNAVAILABLE') {
        fieldResults.push({ fieldName: field.fieldName, status: behavior });
        continue;
      }
      this.fields.set(
        field.fieldName,
        behavior === 'CONFLICT' ? `SIMULATED_CONFLICT_${sha256Text(field.value).slice(0, 12)}` : field.value,
      );
      fieldResults.push({ fieldName: field.fieldName, status: 'APPLIED' });
    }
    const result = Object.freeze({
      providerRevision: `synthetic-${sha256Text(`${update.approvalEventId}:${fingerprint}`).slice(0, 16)}`,
      fieldResults: Object.freeze(fieldResults),
    });
    this.completedApprovals.set(update.approvalEventId, { fingerprint, result });
    this.mutationCountValue += 1;

    if (this.unknownWriteOutcomePending) {
      this.unknownWriteOutcomePending = false;
      throw new EncompassConnectorError(
        'ENCOMPASS_WRITE_OUTCOME_UNKNOWN',
        'Synthetic write outcome is unknown and requires reconciliation.',
        false,
      );
    }
    return result;
  }

  async readFields(
    context: EncompassConnectorContext,
    loanGuid: string,
    fieldNames: ReadonlyArray<string>,
  ): Promise<Readonly<Record<string, string>>> {
    assertSyntheticRequest(context, loanGuid);
    if (this.remainingReadFailures > 0) {
      this.remainingReadFailures -= 1;
      throw new EncompassConnectorError(
        'SYNTHETIC_READ_TIMEOUT',
        'Synthetic field read timed out.',
        true,
      );
    }
    return Object.fromEntries(fieldNames.flatMap((fieldName) => {
      if (this.options.fieldBehaviors?.[fieldName] === 'UNAVAILABLE') return [];
      const value = this.fields.get(fieldName);
      return value === undefined ? [] : [[fieldName, value]];
    }));
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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
