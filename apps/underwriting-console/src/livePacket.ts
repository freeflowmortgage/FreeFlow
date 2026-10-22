import { inspectFamily } from './incomeInspect';
import { isUsableOverlayBox } from './overlayBox';
import type { LiveDocument, MappedIncomeField, ParsePage, ParseResponse, ScheduleEPropertyExtract } from './parseTypes';
import { RETIREMENT_SOURCE_FIELD_IDS } from './retirementIncome';

export type DocKind =
  | 'paystub'
  | 'w2'
  | 'schedule-e'
  | 'schedule-c'
  | 'scorp'
  | 'ccorp'
  | 'partnership'
  | 'schedule-f'
  | 'asset'
  | 'retirement'
  | 'unknown';

export type WorkspaceTab =
  | 'PAYSTUB_RECONCILIATION'
  | 'SCHEDULE_C'
  | 'SCORP'
  | 'CCORP'
  | 'PARTNERSHIP'
  | 'SCHEDULE_F'
  | 'ASSET_INCOME'
  | 'RETIREMENT'
  | 'SCHEDULE_E'
  | 'ENCOMPASS_SYNC';

export type DuplicateMatch = {
  existingName: string;
  reason: string;
};

/**
 * The parser labels a C-corporation page "Form 1120 (C-Corporation Return)";
 * a page rehydrated from a persisted extraction carries only the bare form
 * name. Both name the C-corp return, and neither may match Form 1120-S.
 */
const CCORP_LABEL = /1120 \(C-Corporation|C-Corporation Return|\bForm 1120(?![-\s]?S\b)/i;

function labelsOf(result: ParseResponse): string {
  return [
    ...(result.pages ?? []).flatMap((page) => page.formIds),
    ...Object.values(result.classifications ?? {}).flat(),
  ].join(' ');
}

function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|road|rd|court|ct|drive|dr|boulevard|blvd|lane|ln|terrace|ter|place|pl|circle|cir|highway|hwy|unit|apt|#)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fileNameHints(fileName: string): DocKind[] {
  const name = fileName.toLowerCase();
  const kinds: DocKind[] = [];
  if (/pay\s*stub|paystub|earnings|wvoe|payroll/.test(name)) kinds.push('paystub');
  if (/(^|[^a-z0-9])w-?2([^a-z0-9]|$)/i.test(name)) kinds.push('w2');
  if (/schedule\s*e|f1040se/.test(name)) kinds.push('schedule-e');
  if (/schedule\s*c|f1040sc/.test(name)) kinds.push('schedule-c');
  if (/schedule\s*f|f1040sf/.test(name)) kinds.push('schedule-f');
  if (/1120-?s|k-?1.*1120/.test(name)) kinds.push('scorp');
  if (/(form\s*)?1065|k-?1.*1065/.test(name)) kinds.push('partnership');
  if (/form\s*1120(?!-?s)|c-?corp/.test(name) && !kinds.includes('scorp')) kinds.push('ccorp');
  if (/schedule\s*b|schedule\s*d/.test(name)) kinds.push('asset');
  return kinds;
}

export function classifyDocument(result: ParseResponse, fileName = ''): DocKind[] {
  const labels = labelsOf(result);
  const kinds: DocKind[] = [];
  if (/Paystub|pay stub|Earnings statement|WVOE|Verification of Employment|payroll statement/i.test(labels)) {
    kinds.push('paystub');
  }
  if (/\bW-?2\b/i.test(labels)) kinds.push('w2');
  if (/Schedule E/i.test(labels) || (result.scheduleEProperties?.length ?? 0) > 0) kinds.push('schedule-e');
  if (/Schedule C/i.test(labels)) kinds.push('schedule-c');
  if (/1120-?S|S-Corporation|K-1 \(1120-?S\)/i.test(labels)) kinds.push('scorp');
  if (/Form 1065|K-1 \(1065\)|Schedule K-1 \(1065\)/i.test(labels)) kinds.push('partnership');
  if (CCORP_LABEL.test(labels) && !/1120-?S/i.test(labels)) kinds.push('ccorp');
  if (/Schedule F/i.test(labels)) kinds.push('schedule-f');
  if (/Schedule B|Schedule D/i.test(labels)) kinds.push('asset');
  if (reportsRetirementIncome(result)) kinds.push('retirement');
  for (const hint of fileNameHints(fileName)) {
    if (!kinds.includes(hint)) kinds.push(hint);
  }
  return kinds.length ? kinds : ['unknown'];
}

/** Form 1040 Line 4, 5, or 6 carries a non-zero amount. Every return has the lines, so a bare 1040 label is not enough. */
function reportsRetirementIncome(result: ParseResponse): boolean {
  const wanted = new Set<string>(RETIREMENT_SOURCE_FIELD_IDS);
  return [...(result.incomeFields ?? []), ...(result.formExtracts ?? [])].some(
    (field) => field.form === 'Form 1040'
      && wanted.has(field.sourceFieldId ?? ('id' in field ? field.id : ''))
      && field.numericValue > 0,
  );
}

export function kindsOf(doc: Pick<LiveDocument, 'fileName' | 'result'>): DocKind[] {
  return classifyDocument(doc.result, doc.fileName);
}

function scheduleEKey(prop: ScheduleEPropertyExtract): string {
  const address = normalizeAddress(prop.address);
  if (prop.year == null && !address) return '';
  return `${prop.year ?? ''}:${address}`;
}

/**
 * The same return read twice reports the same amounts. Only lines both reads
 * carry are compared, since a scan or a different PDF can miss a line the other
 * caught; a co-borrower's separate return for a shared property differs on them.
 */
function sameScheduleEFigures(left: ScheduleEPropertyExtract, right: ScheduleEPropertyExtract): boolean {
  const a = left.financials ?? {};
  const b = right.financials ?? {};
  const shared = Object.keys(a).filter((line) => Boolean(a[line]) && Boolean(b[line]));
  return shared.every((line) => Math.abs((a[line] ?? 0) - (b[line] ?? 0)) < 1);
}

function sameScheduleEReturn(existing: ParseResponse, incoming: ParseResponse): boolean {
  const rows = (existing.scheduleEProperties ?? []).filter((prop) => scheduleEKey(prop));
  return (incoming.scheduleEProperties ?? []).some((prop) => {
    const key = scheduleEKey(prop);
    return Boolean(key) && rows.some((row) => scheduleEKey(row) === key && sameScheduleEFigures(row, prop));
  });
}

export function taxReturnFingerprint(result: ParseResponse): string | null {
  const props = result.scheduleEProperties ?? [];
  const labels = labelsOf(result);
  const isReturn = props.length > 0 || /Form 1040|Schedule E|U\.S\.\s+Individual Income Tax Return/i.test(labels);
  if (!isReturn) return null;
  const years = [...new Set(props.map((prop) => prop.year).filter((year): year is number => year != null))].sort(
    (a, b) => a - b,
  );
  const addresses = [...new Set(props.map((prop) => normalizeAddress(prop.address)).filter(Boolean))].sort();
  if (years.length || addresses.length) return `e:${years.join(',')}:${addresses.join('|')}`;
  return `1040:${result.total_pages_scanned}:${result.pages_extracted_count}`;
}

export function findDuplicate(
  existing: Array<Pick<LiveDocument, 'fileName' | 'sha256' | 'result'>>,
  incoming: { sha256: string; fileName: string; result: ParseResponse },
): DuplicateMatch | null {
  const sameBytes = existing.find((doc) => doc.sha256 === incoming.sha256);
  if (sameBytes) {
    return {
      existingName: sameBytes.fileName,
      reason: `Duplicate file — already loaded as ${sameBytes.fileName}`,
    };
  }
  if ((incoming.result.scheduleEProperties ?? []).some((prop) => scheduleEKey(prop))) {
    // Two borrowers filing separately can each report the same property for
    // the same year, so year and address alone do not make a duplicate.
    const overlapping = existing.find((doc) => sameScheduleEReturn(doc.result, incoming.result));
    return overlapping
      ? {
          existingName: overlapping.fileName,
          reason: `Duplicate tax return — same Schedule E year, address and amounts as ${overlapping.fileName}`,
        }
      : null;
  }
  const incomingPrint = taxReturnFingerprint(incoming.result);
  if (!incomingPrint) return null;
  const sameReturn = existing.find((doc) => taxReturnFingerprint(doc.result) === incomingPrint);
  if (sameReturn) {
    return {
      existingName: sameReturn.fileName,
      reason: `Duplicate tax return — ${incomingPrint.startsWith('e:') ? 'same Schedule E year/address as' : 'same 1040 package as'} ${sameReturn.fileName}`,
    };
  }
  return null;
}

function pageMatchesKind(page: ParsePage, kind: DocKind): boolean {
  const ids = page.formIds.join(' ');
  if (kind === 'paystub') return /Paystub|pay stub|Earnings|WVOE|payroll/i.test(ids);
  if (kind === 'w2') return /\bW-?2\b/i.test(ids);
  if (kind === 'schedule-e') return /Schedule E/i.test(ids);
  if (kind === 'schedule-c') return /Schedule C/i.test(ids);
  if (kind === 'scorp') return /1120-?S|S-Corporation/i.test(ids);
  if (kind === 'ccorp') return CCORP_LABEL.test(ids);
  if (kind === 'partnership') return /Form 1065|K-1 \(1065\)/i.test(ids);
  if (kind === 'schedule-f') return /Schedule F/i.test(ids);
  if (kind === 'asset') return /Schedule B|Schedule D/i.test(ids);
  if (kind === 'retirement') return /Form 1040 \(Individual Return\)/i.test(ids);
  return false;
}

export function firstPageForKind(result: ParseResponse, kind: DocKind): number {
  return result.pages.find((page) => pageMatchesKind(page, kind))?.index ?? 0;
}

/** Last matching page — multi-stub PDFs keep the most recent check on the final page. */
export function latestPageForKind(result: ParseResponse, kind: DocKind): number {
  const pages = result.pages.filter((page) => pageMatchesKind(page, kind));
  return pages.length ? pages[pages.length - 1].index : 0;
}

export function pageForKind(result: ParseResponse, kind: DocKind): number {
  return kind === 'paystub' ? latestPageForKind(result, kind) : firstPageForKind(result, kind);
}

/** Demo worksheet ids that do not match parser sourceFieldId values. */
export const INSPECT_FIELD_ALIASES: Record<string, string> = {
  'ps-emp-name': 'ps-employer-name',
  'ps-frequency': 'ps-pay-frequency',
};

export function canonicalInspectFieldId(fieldId: string): string {
  return INSPECT_FIELD_ALIASES[fieldId] ?? fieldId;
}

export type InspectOverlay = {
  pageIndex: number;
  box: { x: number; y: number; w: number; h: number };
};

/** Direct field → canvas contract: the mapped token box, not a facsimile cell. */
export function inspectOverlayFromField(field: MappedIncomeField | undefined): InspectOverlay | null {
  if (!field?.box || !isUsableOverlayBox(field.box)) return null;
  return { pageIndex: field.pageIndex, box: field.box };
}

export function inspectFieldIds(fieldId: string | null | undefined): string[] {
  if (!fieldId) return [];
  const canonical = canonicalInspectFieldId(fieldId);
  // Worksheet ids and parser ids differ across several form families
  // (schc-l31/ent1-net, k1-oi/pt-return-other, ccorp-ti/c1120-taxable, ...).
  // Apply the existing family mapping consistently so every supported tab can
  // land on its parser-provided source box. Exact wage/rental ids remain in
  // the set and retain their document-scoping rules in fieldForInspection.
  return [...new Set([
    fieldId,
    canonical,
    ...inspectFamily(fieldId),
    ...(canonical === fieldId ? [] : inspectFamily(canonical)),
  ])];
}

export function fieldMatchesInspectId(
  field: Pick<MappedIncomeField, 'id' | 'sourceFieldId'>,
  fieldId: string | null | undefined,
): boolean {
  const ids = inspectFieldIds(fieldId);
  return ids.includes(field.id) || (field.sourceFieldId != null && ids.includes(field.sourceFieldId));
}

function pickInspectField(
  candidates: MappedIncomeField[],
  fieldId?: string,
  preferPageIndex?: number,
): MappedIncomeField | undefined {
  if (!candidates.length) return undefined;
  // Schedule E ids name their column: the first property's is the bare source
  // id ("ent2-tax") and the rest carry "--entity". Only the suffixed form was
  // honoured, so clicking property 1 fell through to the last candidate on the
  // page and highlighted column C.
  if (fieldId && (fieldId.includes('--') || fieldId.startsWith('ent2-'))) {
    const exact = candidates.find((field) => field.id === fieldId);
    if (exact) return exact;
  }
  if (preferPageIndex != null) {
    const onPreferred = candidates.filter((field) => field.pageIndex === preferPageIndex);
    if (onPreferred.length) return onPreferred[onPreferred.length - 1];
  }
  return candidates.reduce((latest, field) => (field.pageIndex >= latest.pageIndex ? field : latest));
}

/**
 * Resolve a clicked result field without silently changing the wage PDF under
 * review. Wage fields are document-scoped; other worksheets retain the legacy
 * packet-wide fallback used by tax/entity navigation.
 *
 * On a multi-page paystub, prefer the field on the page already in view, else
 * the latest page (most recent stub) — never the first/oldest extract.
 */
export function fieldForInspection(
  fields: MappedIncomeField[],
  fieldId: string,
  currentDocumentId?: string | null,
  explicitDocumentId?: string,
  preferPageIndex?: number,
): MappedIncomeField | undefined {
  const wanted = new Set(inspectFieldIds(fieldId));
  const matches = (field: MappedIncomeField) =>
    wanted.has(field.id) || (field.sourceFieldId != null && wanted.has(field.sourceFieldId));
  const documentId = explicitDocumentId ?? currentDocumentId ?? undefined;
  const isWageField = fieldId.startsWith('w2-') || fieldId.startsWith('ps-');
  if (documentId) {
    const scoped = fields.filter((field) => matches(field) && field.documentId === documentId);
    if (scoped.length) return pickInspectField(scoped, fieldId, preferPageIndex);
  }
  if (isWageField) return undefined;
  return pickInspectField(fields.filter(matches), fieldId, preferPageIndex);
}

/**
 * Find a field on any of `documentIds`, ignoring which document is open.
 *
 * `fieldForInspection` deliberately refuses to look past the open document for
 * a wage field, so a click can never land on a different employer's W-2 that
 * happens to carry the same field id. That rule also meant clicking a W-2
 * value while the pay stub was open resolved to nothing at all: no highlight,
 * no page change, and the underwriter had to switch documents by hand first.
 *
 * Passing the active employer's own uploads keeps the original protection and
 * still lets the click reach the document the value actually came from.
 */
export function fieldForInspectionWithin(
  fields: MappedIncomeField[],
  fieldId: string,
  documentIds: string[] | undefined,
  preferPageIndex?: number,
): MappedIncomeField | undefined {
  if (!documentIds?.length) return undefined;
  const wanted = new Set(inspectFieldIds(fieldId));
  const allowed = new Set(documentIds);
  const scoped = fields.filter(
    (field) =>
      (wanted.has(field.id) || (field.sourceFieldId != null && wanted.has(field.sourceFieldId))) &&
      field.documentId != null &&
      allowed.has(field.documentId),
  );
  return scoped.length ? pickInspectField(scoped, fieldId, preferPageIndex) : undefined;
}

/** Live inspect uses extract pageIndex only. Facsimile stub page is demo-only. */
export function inspectNavigation(opts: {
  isLive: boolean;
  livePageIndex?: number;
  entityPageIndex?: number;
  facsimilePage?: number;
}): { livePageIndex?: number; facsimilePage?: number } {
  const livePageIndex = opts.livePageIndex ?? opts.entityPageIndex;
  if (opts.isLive) return { livePageIndex };
  return { livePageIndex, facsimilePage: opts.facsimilePage };
}

function wageKindOrder(wageDocKind: 'paystub' | 'w2'): DocKind[] {
  return wageDocKind === 'w2' ? ['w2', 'paystub', 'unknown'] : ['paystub', 'w2', 'unknown'];
}

export function pickDocumentForTab(
  documents: LiveDocument[],
  tab: WorkspaceTab,
  wageDocKind: 'paystub' | 'w2' = 'paystub',
  preferId?: string | null,
): LiveDocument | null {
  if (!documents.length) return null;
  const wageTab = tab === 'PAYSTUB_RECONCILIATION' || tab === 'ENCOMPASS_SYNC';
  const wanted: DocKind[] = wageTab
    ? wageKindOrder(wageDocKind)
    : [
        tab === 'SCHEDULE_E'
          ? 'schedule-e'
          : tab === 'SCHEDULE_C'
            ? 'schedule-c'
            : tab === 'SCORP'
              ? 'scorp'
              : tab === 'CCORP'
                ? 'ccorp'
                : tab === 'PARTNERSHIP'
                  ? 'partnership'
                  : tab === 'SCHEDULE_F'
                    ? 'schedule-f'
                    : tab === 'ASSET_INCOME'
                      ? 'asset'
                      : tab === 'RETIREMENT'
                        ? 'retirement'
                        : 'unknown',
      ];

  for (const want of wanted) {
    const ranked = documents.filter((doc) => {
      const kinds = kindsOf(doc);
      if (want === 'unknown') {
        return kinds.length === 1 && kinds[0] === 'unknown';
      }
      return kinds.includes(want);
    });
    if (!ranked.length) continue;
    if (preferId) {
      const preferred = ranked.find((doc) => doc.id === preferId);
      if (preferred) return preferred;
    }
    return ranked[ranked.length - 1];
  }
  return null;
}

export function tabForKinds(kinds: DocKind[]): { tab: WorkspaceTab; wageDocKind?: 'paystub' | 'w2' } {
  if (kinds.includes('schedule-e')) return { tab: 'SCHEDULE_E' };
  if (kinds.includes('schedule-c')) return { tab: 'SCHEDULE_C' };
  if (kinds.includes('scorp')) return { tab: 'SCORP' };
  if (kinds.includes('partnership')) return { tab: 'PARTNERSHIP' };
  if (kinds.includes('ccorp')) return { tab: 'CCORP' };
  if (kinds.includes('schedule-f')) return { tab: 'SCHEDULE_F' };
  if (kinds.includes('asset')) return { tab: 'ASSET_INCOME' };
  if (kinds.includes('retirement')) return { tab: 'RETIREMENT' };
  if (kinds.includes('w2')) return { tab: 'PAYSTUB_RECONCILIATION', wageDocKind: 'w2' };
  if (kinds.includes('paystub')) return { tab: 'PAYSTUB_RECONCILIATION', wageDocKind: 'paystub' };
  return { tab: 'PAYSTUB_RECONCILIATION' };
}

export function allScheduleEExtracts(documents: LiveDocument[]): Array<ScheduleEPropertyExtract & { documentId: string }> {
  return documents.flatMap((doc) =>
    (doc.result.scheduleEProperties ?? []).map((prop) => ({ ...prop, documentId: doc.id })),
  );
}

/**
 * The tax year printed on each W-2 in the packet, by document and page.
 *
 * The year a W-2 covers is a property of the document, not of the calendar. A
 * 2024 W-2 handed in during 2026 is still a 2024 W-2, so anything that cites
 * the year has to read it off the form rather than counting back from today.
 */
export function w2TaxYearLookup(
  documents: LiveDocument[],
): (documentId: string | undefined, pageIndex: number) => number | undefined {
  const years = new Map<string, number>();
  for (const doc of documents) {
    for (const extract of doc.result.w2Extracts ?? []) {
      if (extract.year) years.set(`${doc.id}:${extract.pageIndex}`, extract.year);
    }
  }
  return (documentId, pageIndex) => years.get(`${documentId ?? ''}:${pageIndex}`);
}

export type ScheduleEFiling<T extends ScheduleEPropertyExtract> = { latest: T; prior?: T; ownerId?: string };

/**
 * One rental history per property and owner: the newest year and the year
 * before it. Two returns for the same address and year are two filings, not a
 * correction of one another; co-borrowers who file separately each report
 * their share of a jointly owned property, so the second one gets its own
 * history instead of replacing the first.
 */
export function scheduleEFilings<T extends ScheduleEPropertyExtract>(
  extracts: T[],
  ownerOf: (extract: T) => string | undefined = () => undefined,
): Array<ScheduleEFiling<T>> {
  const groups = new Map<string, { ownerId?: string; rows: T[] }>();
  for (const extract of extracts) {
    const address = extract.address.trim().toLowerCase().replace(/\s+/g, ' ');
    const ownerId = ownerOf(extract);
    const key = `${address || `column-${extract.column}-p${extract.pageIndex}`}|${ownerId ?? ''}`;
    const group = groups.get(key) ?? { ownerId, rows: [] };
    group.rows.push(extract);
    groups.set(key, group);
  }

  const filings: Array<ScheduleEFiling<T>> = [];
  for (const { ownerId, rows } of groups.values()) {
    const lanes: Array<Map<number, T>> = [];
    const newestFirst = [...rows].sort((left, right) => (right.year ?? 0) - (left.year ?? 0));
    for (const row of newestFirst) {
      const year = row.year ?? 0;
      const lane = lanes.find((candidate) => !candidate.has(year));
      if (lane) lane.set(year, row);
      else lanes.push(new Map([[year, row]]));
    }
    for (const lane of lanes) {
      const [latest, prior] = [...lane.values()];
      filings.push({ latest, prior, ownerId });
    }
  }
  return filings;
}
