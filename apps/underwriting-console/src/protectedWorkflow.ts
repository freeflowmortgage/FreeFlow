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
  field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation' | 'borrowerAssignment' | 'assetElection' | 'elapsedMonths' | 'payFrequency' | 'baseIncomeMethod';
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
  hostWrite: Readonly<{ id: string; status: 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED'; approvalEventId: string; fieldMapHash: string; safeErrorCode: string | null }> | null;
}>;

export function deriveProtectedWorkflowState(
  context: ConsoleContext | null,
  requirements: readonly MetadataRequirement[] | null,
  hostReady: boolean,
): ProtectedWorkflowState {
  if (!context) return 'NO_LOAN_CONTEXT';
  if (context.hostWrite?.status === 'SUCCEEDED') return 'WRITTEN';
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
  if (!isRecord(value) || !Array.isArray(value.fields)) return [];
  return value.fields.flatMap((item): EvidenceField[] => {
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
  else if (field === 'employmentRole' || field === 'payFrequency' || field === 'baseIncomeMethod') assignment[field] = raw;
  else assignment[field] = Number(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
