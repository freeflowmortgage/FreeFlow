export type ProtectedWorkflowState =
  | 'NO_LOAN_CONTEXT'
  | 'BOUND'
  | 'DOCUMENT_UPLOADED'
  | 'EXTRACTED'
  | 'REVIEW_REQUIRED'
  | 'READY_TO_CALCULATE'
  | 'CALCULATED'
  | 'APPROVED'
  | 'READY_TO_WRITE'
  | 'WRITTEN';

export type MetadataRequirement = Readonly<{
  extractionId: string;
  entityId: string;
  field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation' | 'borrowerAssignment' | 'assetElection' | 'elapsedMonths' | 'payFrequency' | 'baseIncomeMethod' | 'iraAccountBalance' | 'iraContinuance' | 'wvoeVariableMethod';
  form: string;
}>;

export type ProtectedBorrower = Readonly<{ borrowerKey: string; ordinal: number; role: 'PRIMARY' | 'CO_BORROWER' }>;
export type BorrowerIncomeLine = Readonly<{ borrowerKey: string; ordinal: number; role: 'PRIMARY' | 'CO_BORROWER'; qualifyingMonthlyIncome: string }>;

export type EvidenceField = Readonly<{
  collection: string;
  index?: number;
  entityId?: string;
  field: string;
  pageIndex: number;
  box: [number, number, number, number];
}>;

/**
 * One cell of the column an aggregate was read from, and whether the aggregate
 * counts it. Stored apart from the coordinate list so the aggregate still has
 * exactly one box of its own.
 */
export type EvidenceCell = EvidenceField & Readonly<{ included: boolean }>;

export type ConsoleContext = Readonly<{
  loan: Readonly<{ id: string; version: number; status: string; program: string; borrowerName: string | null }>;
  borrowers?: readonly ProtectedBorrower[];
  attachments: readonly Readonly<{ attachmentId: string; category: string; version: number; pageCount: number | null; parserVersion: string | null }>[];
  extractions: readonly Readonly<{
    id: string; attachmentId: string; sourceDocumentVersion: number; parserVersion: string; schemaVersion: string;
    status: string; warnings: readonly string[]; confidence: string | number | null; normalizedInput: unknown; evidence: unknown;
    metadataReview: Readonly<{ id: string; metadataVersion: number; assignments: unknown; current: boolean }> | null;
  }>[];
  calculation: Readonly<{ id: string; calculatedLoanVersion: number; qualifyingMonthlyIncome: string | number; trendingResult: string; yearsAnalyzed: readonly number[]; current: boolean; borrowerIncome?: readonly BorrowerIncomeLine[] }> | null;
  approval: Readonly<{ id: string; entityId: string; expectedLoanVersion: number; current: boolean }> | null;
  hostWrite: Readonly<{ id: string; status: 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED'; approvalEventId: string; expectedLoanVersion: number; fieldMapHash: string; safeErrorCode: string | null; certified: boolean; readbackCertification: 'NOT_SERVER_VERIFIED'; current: boolean }> | null;
}>;

export function deriveProtectedWorkflowState(
  context: ConsoleContext | null,
  requirements: readonly MetadataRequirement[] | null,
  hostReady: boolean,
): ProtectedWorkflowState {
  if (!context) return 'NO_LOAN_CONTEXT';
  if (context.hostWrite?.certified && context.hostWrite.current && context.hostWrite.status === 'SUCCEEDED') return 'WRITTEN';
  if (context.approval?.current) return hostReady ? 'READY_TO_WRITE' : 'APPROVED';
  if (context.calculation?.current) return 'CALCULATED';
  if (!context.attachments.length) return 'BOUND';
  const activeExtractions = context.extractions.filter((item) => item.status === 'ACTIVE');
  if (!activeExtractions.length) return 'DOCUMENT_UPLOADED';
  if (requirements === null) return 'EXTRACTED';
  if (requirements.length) return 'REVIEW_REQUIRED';
  return 'READY_TO_CALCULATE';
}

export function readEvidenceFields(value: unknown): EvidenceField[] {
  return readEvidenceList(isRecord(value) ? value.fields : undefined);
}

/** The column cells of each aggregate, absent on an extraction stored before them. */
export function readEvidenceCells(value: unknown): EvidenceCell[] {
  if (!isRecord(value) || !Array.isArray(value.cells)) return [];
  return value.cells.flatMap((item): EvidenceCell[] => {
    const [field] = readEvidenceList([item]);
    if (!field || !isRecord(item) || typeof item.included !== 'boolean') return [];
    return [{ ...field, included: item.included }];
  });
}

function readEvidenceList(value: unknown): EvidenceField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): EvidenceField[] => {
    if (!isRecord(item) || typeof item.collection !== 'string' || typeof item.field !== 'string'
      || !Number.isInteger(item.pageIndex) || !isRecord(item.box)) return [];
    const box = [item.box.x, item.box.y, item.box.w, item.box.h];
    if (box.some((coordinate) => typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1)) return [];
    return [{
      collection: item.collection,
      ...(typeof item.index === 'number' ? { index: item.index } : {}),
      ...(typeof item.entityId === 'string' ? { entityId: item.entityId } : {}),
      field: item.field,
      pageIndex: item.pageIndex as number,
      box: [box[0] as number, box[1] as number, box[2] as number, box[3] as number],
    }];
  });
}

export function applyRequirementValue(
  assignment: Record<string, string | number | boolean>,
  field: MetadataRequirement['field'],
  raw: string,
): void {
  if (field === 'requiredParserField' || field === 'unsupportedCalculation') return;
  if (field === 'borrowerAssignment') assignment.borrowerKey = raw;
  else if (field === 'assetElection') assignment.includeInQualifyingIncome = raw === 'INCLUDE';
  else if (field === 'iraContinuance') {
    assignment.hasThreeYearIraContinuance = raw === 'CONFIRMED_GROSS_UP' || raw === 'CONFIRMED';
    assignment.grossUpIraNonTaxable = raw === 'CONFIRMED_GROSS_UP';
  }
  else if (field === 'employmentRole' || field === 'payFrequency' || field === 'baseIncomeMethod' || field === 'wvoeVariableMethod') assignment[field] = raw;
  else assignment[field] = Number(raw);
}

const REVIEW_FIELD_LABELS: Record<MetadataRequirement['field'], string> = {
  taxYear: 'Tax year',
  employmentRole: 'Employment status',
  ownershipPercentage: 'Ownership percentage',
  requiredParserField: 'Required document data',
  unsupportedCalculation: 'Calculation availability',
  borrowerAssignment: 'Borrower assignment',
  assetElection: 'Use this asset income?',
  elapsedMonths: 'Months elapsed year to date',
  payFrequency: 'Pay frequency',
  baseIncomeMethod: 'Base income method',
  iraAccountBalance: 'IRA account balance from the most recent statement',
  iraContinuance: 'Underwriter: IRA 36-month continuance',
  wvoeVariableMethod: 'Underwriter: verification variable pay method',
};

/** Program gross-up for the non-taxable portion of benefit and retirement income. */
export function programGrossUpMultiplier(program: string | null | undefined): number {
  return program?.toUpperCase() === 'FHA' ? 1.15 : 1.25;
}

export type IraReturnAmounts = Readonly<{ totalDistributions: number; taxableDistributions: number }>;

/** Form 1040 Line 4a/4b on a persisted record. A fully taxable distribution may appear on Line 4b alone. */
export function readIraReturnAmounts(context: ConsoleContext | null, requirement: MetadataRequirement): IraReturnAmounts | null {
  const extraction = context?.extractions.find((item) => item.id === requirement.extractionId);
  const input = isRecord(extraction?.normalizedInput) ? extraction.normalizedInput : null;
  const row = Array.isArray(input?.formRecords)
    ? input.formRecords.find((item) => isRecord(item) && item.entityId === requirement.entityId && item.form === 'Form 1040')
    : null;
  const fields: unknown[] | null = isRecord(row) && Array.isArray(row.fields) ? row.fields : null;
  if (!fields) return null;
  const amount = (id: string) => {
    const field = fields.find((item) => isRecord(item) && item.sourceFieldId === id);
    return isRecord(field) && typeof field.numericValue === 'number' ? field.numericValue : 0;
  };
  const taxable = Math.max(0, amount('f1040-ira-taxable'));
  const total = Math.max(amount('f1040-ira-total'), taxable);
  return total > 0 ? { totalDistributions: total, taxableDistributions: taxable } : null;
}

/** Months the entered balance covers at the most recent return's monthly distribution. */
export function iraContinuanceMonths(amounts: IraReturnAmounts, balance: number): number {
  const monthly = amounts.totalDistributions / 12;
  return Math.floor((balance / monthly) * 10) / 10;
}

export function describeIraContinuance(amounts: IraReturnAmounts, balanceRaw: string | undefined, program: string | null | undefined): string[] {
  const multiplier = programGrossUpMultiplier(program);
  const nonTaxable = amounts.totalDistributions - amounts.taxableDistributions;
  const lines = [`Most recent return: ${formatCents(amounts.totalDistributions / 12)}/mo (Line 4a ÷ 12), ${formatWholeDollars(nonTaxable)} non-taxable.`];
  const balance = balanceRaw?.trim() ? Number(balanceRaw) : NaN;
  if (Number.isFinite(balance) && balance >= 0) {
    const months = iraContinuanceMonths(amounts, balance);
    lines.push(`Entered balance covers ${months} months, ${months >= 36 ? 'meeting' : 'short of'} the 36-month requirement.`);
  }
  const plain = amounts.totalDistributions / 12;
  const grossed = (amounts.taxableDistributions + nonTaxable * multiplier) / 12;
  lines.push(nonTaxable > 0
    ? `If confirmed: ${formatCents(plain)}/mo, or ${formatCents(grossed)}/mo with the ${Math.round((multiplier - 1) * 100)}% ${program ?? 'program'} gross-up.`
    : `If confirmed: ${formatCents(plain)}/mo. Fully taxable, so there is nothing to gross up.`);
  return lines;
}

export function reviewFieldLabel(field: MetadataRequirement['field']): string {
  return REVIEW_FIELD_LABELS[field];
}

/**
 * Returns a useful review-row identity without exposing internal entity keys.
 * Schedule E properties are distinguished by the extracted address so an
 * underwriter assigns the property they actually recognize.
 */
export function reviewEntityLabel(context: ConsoleContext | null, requirement: MetadataRequirement): string {
  const extraction = context?.extractions.find((item) => item.id === requirement.extractionId);
  const input = isRecord(extraction?.normalizedInput) ? extraction.normalizedInput : null;
  if (!input) return requirement.form;

  if (requirement.form === 'Schedule E') {
    const match = /^schedule-e-(\d+)$/.exec(requirement.entityId);
    const index = match ? Number(match[1]) : -1;
    const property = index >= 0 && Array.isArray(input.scheduleEProperties)
      ? input.scheduleEProperties[index]
      : null;
    const address = isRecord(property) && typeof property.propertyAddress === 'string'
      ? property.propertyAddress.trim()
      : '';
    return address ? `Schedule E rental · ${address}` : `Schedule E rental property ${index + 1}`;
  }

  if (requirement.form === 'W-2' && Array.isArray(input.w2Records)) {
    const row = input.w2Records.find((item) => isRecord(item) && item.entityId === requirement.entityId);
    const employer = isRecord(row) && typeof row.employerName === 'string' ? row.employerName.trim() : '';
    if (employer) return `W-2 · ${employer}`;
  }

  if (Array.isArray(input.formRecords)) {
    const row = input.formRecords.find((item) => isRecord(item) && item.entityId === requirement.entityId);
    if (isRecord(row) && row.form === 'Form 1040') {
      const ira = readIraReturnAmounts(context, requirement);
      if (ira) return `Form 1040 · IRA distributions ${formatWholeDollars(ira.totalDistributions)} (Line 4a), ${formatWholeDollars(ira.taxableDistributions)} taxable (Line 4b)`;
    }
    if (isRecord(row) && Array.isArray(row.fields)) {
      const employer = row.fields.find((item) => isRecord(item) && item.sourceFieldId === 'ps-employer-name');
      const value = isRecord(employer) && typeof employer.value === 'string' ? employer.value.trim() : '';
      if (value) return `${requirement.form} · ${value}`;
    }
  }

  return requirement.form;
}

function formatWholeDollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatCents(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
