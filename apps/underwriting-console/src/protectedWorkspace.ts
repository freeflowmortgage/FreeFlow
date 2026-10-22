import type { LoanBorrower } from './borrowers';
import { INCOME_FIELD_DEFS, type IncomeFieldDef } from './incomeFieldMap';
import type {
  FormFieldExtract,
  LiveDocument,
  OverlayBox,
  ParsePage,
  ParseResponse,
  ScheduleEPropertyExtract,
  W2BoxExtract,
} from './parseTypes';
import { readEvidenceCells, readEvidenceFields, type ConsoleContext } from './protectedWorkflow';

export type ProtectedLocalDocument = Readonly<{
  file: File;
  attachmentId: string | null;
}>;

export type ProtectedWorkspaceContext = Readonly<{
  loanId: string;
  loanProgram: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
  borrowers: LoanBorrower[];
  borrowerAssignments: Record<string, string>;
  authoritativeMonthlyIncome: number | null;
}>;

type JsonObject = Record<string, unknown>;

/**
 * Rehydrates Nate's existing review workspace from the bounded extraction
 * projection that the protected workflow persists. Raw OCR text is neither
 * required nor reconstructed. A document is included only while its original
 * PDF remains in this browser session, preserving the ZDR boundary.
 */
export function protectedWorkspaceDocuments(
  context: ConsoleContext | null,
  localDocuments: readonly ProtectedLocalDocument[],
): LiveDocument[] {
  if (!context) return [];
  return localDocuments.flatMap((local): LiveDocument[] => {
    if (!local.attachmentId) return [];
    const extraction = context.extractions.find(
      (item) => item.status === 'ACTIVE' && item.attachmentId === local.attachmentId,
    );
    const attachment = context.attachments.find((item) => item.attachmentId === local.attachmentId);
    if (!extraction || !attachment) return [];
    return [{
      id: local.attachmentId,
      sha256: local.attachmentId,
      file: local.file,
      fileName: local.file.name,
      result: rehydrateProtectedParseResponse(extraction, attachment.pageCount ?? 1),
    }];
  });
}

export function protectedWorkspaceContext(context: ConsoleContext | null): ProtectedWorkspaceContext | null {
  if (!context) return null;
  const borrowerName = context.loan.borrowerName?.trim();
  const borrowers = (context.borrowers ?? []).map((borrower): LoanBorrower => ({
    id: borrower.borrowerKey,
    name: borrower.role === 'PRIMARY' && borrowerName
      ? borrowerName
      : `${borrower.role === 'PRIMARY' ? 'Primary borrower' : 'Co-borrower'} (${borrower.borrowerKey})`,
    role: borrower.role === 'PRIMARY' ? 'Borrower' : 'CoBorrower',
  }));
  return {
    loanId: context.loan.id,
    loanProgram: loanProgram(context.loan.program),
    borrowers,
    borrowerAssignments: reviewedBorrowerAssignments(context),
    authoritativeMonthlyIncome: context.calculation?.current
      ? finiteNumber(context.calculation.qualifyingMonthlyIncome)
      : null,
  };
}

export function rehydrateProtectedParseResponse(
  extraction: ConsoleContext['extractions'][number],
  pageCount: number,
): ParseResponse {
  const input = record(extraction.normalizedInput) ?? {};
  const evidence = readEvidenceFields(extraction.evidence);
  const w2Extracts = readW2Extracts(input.w2Records, evidence);
  const scheduleEProperties = readScheduleEProperties(input.scheduleEProperties, evidence);
  const formExtracts = readFormExtracts(input.formRecords, evidence, readEvidenceCells(extraction.evidence));
  const pageForms = new Map<number, Set<string>>();
  for (const item of w2Extracts) addPageForm(pageForms, item.pageIndex, 'W-2');
  for (const item of scheduleEProperties) addPageForm(pageForms, item.pageIndex, 'Schedule E');
  for (const item of formExtracts) {
    addPageForm(pageForms, item.pageIndex, item.form);
    const label = classifierLabel(item.sourceFieldId);
    if (label) addPageForm(pageForms, item.pageIndex, label);
  }
  const safePageCount = Math.max(1, Math.min(150, Number.isInteger(pageCount) ? pageCount : 1));
  const pages: ParsePage[] = Array.from({ length: safePageCount }, (_, index) => ({
    index,
    formIds: [...(pageForms.get(index) ?? [])],
    isNativeText: false,
    meanConfidence: finiteNumber(extraction.confidence) ?? 0,
    skewDegrees: 0,
    words: [],
    flags: [],
  }));
  const extractedPageIndices = [...pageForms.keys()].sort((left, right) => left - right);
  const classifications = Object.fromEntries(
    pages.filter((page) => page.formIds.length).map((page) => [String(page.index), page.formIds]),
  );
  return {
    transaction_id: extraction.id,
    document_id: extraction.attachmentId,
    total_pages_scanned: safePageCount,
    pages_extracted_count: extractedPageIndices.length,
    extracted_page_indices: extractedPageIndices,
    ocr_page_count: 0,
    has_business_returns: formExtracts.some((item) => /Schedule [CF]|Form 1120|Form 1065/.test(item.form)),
    flags: [...extraction.warnings],
    classifications,
    unresolved_statements: [],
    pages,
    w2Extracts,
    scheduleEProperties,
    formExtracts,
    parser_engine: 'python-ocr',
  };
}

function readW2Extracts(value: unknown, evidence: ReturnType<typeof readEvidenceFields>): W2BoxExtract[] {
  return array(value).flatMap((item, index): W2BoxExtract[] => {
    const row = record(item);
    const employerName = text(row?.employerName);
    const year = integer(row?.year);
    const annualWages = finiteNumber(row?.annualWages);
    if (!row || !employerName || year === null || annualWages === null) return [];
    const pageIndex = integer(row.pageIndex)
      ?? evidence.find((field) => field.collection === 'w2Extracts' && field.index === index)?.pageIndex
      ?? pageFromEntity(text(row.entityId))
      ?? 0;
    const box1 = finiteNumber(row.box1Wages) ?? annualWages;
    const box5 = finiteNumber(row.box5Wages) ?? annualWages;
    const boxes: W2BoxExtract['boxes'] = {};
    for (const field of evidence.filter((candidate) => candidate.collection === 'w2Extracts' && candidate.index === index)) {
      if (isW2BoxKey(field.field)) boxes[field.field] = tupleBox(field.box);
    }
    return [{
      pageIndex,
      year,
      employerName,
      ein: text(row.ein) ?? '',
      box1,
      box2: 0,
      box3: box1,
      box4: 0,
      box5,
      box6: 0,
      boxes,
    }];
  });
}

function readScheduleEProperties(
  value: unknown,
  evidence: ReturnType<typeof readEvidenceFields>,
): ScheduleEPropertyExtract[] {
  return array(value).flatMap((item, index): ScheduleEPropertyExtract[] => {
    const row = record(item);
    const year = integer(row?.year);
    const address = text(row?.propertyAddress);
    if (!row || year === null || !address) return [];
    const rowEvidence = evidence.filter((candidate) => candidate.collection === 'scheduleEProperties' && candidate.index === index);
    const pageIndex = integer(row.pageIndex) ?? rowEvidence[0]?.pageIndex ?? 0;
    const financials: Record<string, number> = {};
    copyFinancial(row, financials, 'rentsReceived', '3');
    copyFinancial(row, financials, 'royaltiesReceived', '4');
    copyFinancial(row, financials, 'insurance', '9');
    copyFinancial(row, financials, 'mortgageInterest', '12');
    copyFinancial(row, financials, 'taxes', '16');
    copyFinancial(row, financials, 'depreciation', '18');
    copyFinancial(row, financials, 'depletion', '18');
    copyFinancial(row, financials, 'hoaDues', '19');
    copyFinancial(row, financials, 'totalExpenses', '20');
    copyFinancial(row, financials, 'netIncomeLoss', '21');
    const boxes: ScheduleEPropertyExtract['boxes'] = {};
    for (const field of rowEvidence) {
      if (field.field === 'address') boxes.address = tupleBox(field.box);
      else if (field.field === 'type') boxes.type = tupleBox(field.box);
      else if (field.field === 'days') boxes.days = tupleBox(field.box);
      else if (field.field.startsWith('financials.')) {
        const line = field.field.slice('financials.'.length);
        boxes.financials = { ...(boxes.financials ?? {}), [line]: tupleBox(field.box) };
      }
    }
    return [{
      pageIndex,
      column: row.column === 'A' || row.column === 'B' || row.column === 'C'
        ? row.column
        : index % 3 === 0 ? 'A' : index % 3 === 1 ? 'B' : 'C',
      year,
      address,
      propertyType: text(row.propertyType) ?? 'RENTAL',
      fairRentalDays: integer(row.fairRentalDays) ?? 0,
      financials,
      boxes,
    }];
  });
}

function readFormExtracts(
  value: unknown,
  evidence: ReturnType<typeof readEvidenceFields>,
  cellEvidence: ReturnType<typeof readEvidenceCells>,
): FormFieldExtract[] {
  return array(value).flatMap((item): FormFieldExtract[] => {
    const row = record(item);
    const entityId = text(row?.entityId);
    const form = text(row?.form);
    const pageIndex = integer(row?.pageIndex);
    if (!row || !entityId || !isIncomeForm(form) || pageIndex === null) return [];
    return array(row.fields).flatMap((rawField): FormFieldExtract[] => {
      const field = record(rawField);
      const sourceFieldId = text(field?.sourceFieldId);
      if (!field || !sourceFieldId) return [];
      const definition = INCOME_FIELD_DEFS.find((candidate) => candidate.id === sourceFieldId && candidate.form === form);
      const box = evidence.find((candidate) =>
        candidate.collection === 'formExtracts'
        && candidate.entityId === entityId
        && candidate.field === sourceFieldId
      )?.box;
      const cells = cellEvidence
        .filter((candidate) =>
          candidate.collection === 'formExtracts'
          && candidate.entityId === entityId
          && candidate.field === sourceFieldId
        )
        .map((candidate) => ({ box: tupleBox(candidate.box), included: candidate.included }));
      const included = cells.filter((cell) => cell.included).map((cell) => cell.box);
      return [{
        pageIndex,
        form,
        sourceFieldId,
        boxLabel: definition?.boxLabel ?? sourceFieldId,
        fieldLabel: definition?.fieldLabel ?? sourceFieldId,
        lineNum: definition?.lineNum ?? '',
        category: definition?.category ?? 'income',
        value: text(field.value) ?? String(finiteNumber(field.numericValue) ?? ''),
        numericValue: finiteNumber(field.numericValue) ?? 0,
        box: box ? tupleBox(box) : emptyBox(),
        ...(included.length > 1 ? { componentBoxes: included } : {}),
        ...(cells.length > 1 ? { componentCells: cells } : {}),
        entityId,
      }];
    });
  });
}

function reviewedBorrowerAssignments(context: ConsoleContext): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const extraction of context.extractions) {
    if (extraction.status !== 'ACTIVE' || !extraction.metadataReview?.current) continue;
    const locations = entityLocations(extraction.normalizedInput, extraction.evidence);
    for (const raw of array(extraction.metadataReview.assignments)) {
      const assignment = record(raw);
      const entityId = text(assignment?.entityId);
      const borrowerKey = text(assignment?.borrowerKey);
      const location = entityId ? locations.get(entityId) : undefined;
      if (!borrowerKey || !location) continue;
      assignments[`${extraction.attachmentId}:${location.pageIndex}:${location.form}`] = borrowerKey;
    }
  }
  return assignments;
}

function entityLocations(normalizedInput: unknown, rawEvidence: unknown): Map<string, { pageIndex: number; form: string }> {
  const input = record(normalizedInput) ?? {};
  const evidence = readEvidenceFields(rawEvidence);
  const locations = new Map<string, { pageIndex: number; form: string }>();
  for (const raw of array(input.formRecords)) {
    const row = record(raw);
    const entityId = text(row?.entityId);
    const form = text(row?.form);
    const pageIndex = integer(row?.pageIndex);
    if (entityId && form && pageIndex !== null) locations.set(entityId, { pageIndex, form });
  }
  for (const [index, raw] of array(input.w2Records).entries()) {
    const row = record(raw);
    const entityId = text(row?.entityId);
    const pageIndex = integer(row?.pageIndex)
      ?? evidence.find((field) => field.collection === 'w2Extracts' && field.index === index)?.pageIndex
      ?? pageFromEntity(entityId)
      ?? 0;
    if (entityId) locations.set(entityId, { pageIndex, form: 'W-2' });
  }
  return locations;
}

function addPageForm(target: Map<number, Set<string>>, pageIndex: number, form: string): void {
  const forms = target.get(pageIndex) ?? new Set<string>();
  forms.add(form);
  target.set(pageIndex, forms);
}

/**
 * The persisted projection keeps fields, not the classifier's page labels, yet
 * Schedule L is attributed to a business return by the return's masthead label
 * on an earlier page (see owningBusinessReturns). Restore the labels those
 * fields can only have come from.
 */
function classifierLabel(sourceFieldId: string | undefined): string | null {
  if (!sourceFieldId) return null;
  if (sourceFieldId.startsWith('sch-l-')) return 'Schedule L';
  if (sourceFieldId.startsWith('pt-return-')) return 'Form 1065 (Partnership Return)';
  if (sourceFieldId.startsWith('scorp-return-')) return 'Form 1120S (S-Corporation Return)';
  if (/^c1120-(name|ein|taxable|tax)$/.test(sourceFieldId)) return 'Form 1120 (C-Corporation Return)';
  return null;
}

function definitionForm(value: string): IncomeFieldDef['form'] | null {
  return INCOME_FIELD_DEFS.find((definition) => definition.form === value)?.form ?? null;
}

function isIncomeForm(value: string | null): value is FormFieldExtract['form'] {
  return value !== null && definitionForm(value) !== null;
}

function isW2BoxKey(value: string): value is keyof NonNullable<W2BoxExtract['boxes']> {
  return ['employer_ein', 'employer_name', 'box1', 'box2', 'box3', 'box4', 'box5', 'box6'].includes(value);
}

function tupleBox(value: readonly number[]): OverlayBox {
  return { x: value[0] ?? 0, y: value[1] ?? 0, w: value[2] ?? 0, h: value[3] ?? 0 };
}

function emptyBox(): OverlayBox { return { x: 0, y: 0, w: 0, h: 0 }; }

function copyFinancial(source: JsonObject, target: Record<string, number>, key: string, line: string): void {
  const value = finiteNumber(source[key]);
  if (value !== null) target[line] = value;
}

function loanProgram(value: string): ProtectedWorkspaceContext['loanProgram'] {
  return value === 'FHA' || value === 'VA' || value === 'USDA' ? value : 'CONVENTIONAL';
}

function pageFromEntity(value: string | null): number | null {
  const match = value?.match(/(?:^|-)p(\d+)(?:-|$)/);
  return match ? Number(match[1]) : null;
}

function record(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function integer(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null; }
function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
