import type { LiveDocument, ParsePage, ParseResponse, ScheduleEPropertyExtract } from './parseTypes';

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
  | 'unknown';

export type WorkspaceTab =
  | 'PAYSTUB_RECONCILIATION'
  | 'SCHEDULE_C'
  | 'SCORP'
  | 'CCORP'
  | 'PARTNERSHIP'
  | 'SCHEDULE_F'
  | 'ASSET_INCOME'
  | 'SCHEDULE_E'
  | 'ENCOMPASS_SYNC';

export type DuplicateMatch = {
  existingName: string;
  reason: string;
};

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
  if (/schedule\s*c/.test(name)) kinds.push('schedule-c');
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
  if (/1120-?S|S-Corporation/i.test(labels)) kinds.push('scorp');
  if (/Form 1065|K-1 \(1065\)/i.test(labels)) kinds.push('partnership');
  if (/1120 \(C-Corporation|C-Corporation Return/i.test(labels) && !/1120-?S/i.test(labels)) kinds.push('ccorp');
  if (/Schedule F/i.test(labels)) kinds.push('schedule-f');
  if (/Schedule B|Schedule D/i.test(labels)) kinds.push('asset');
  for (const hint of fileNameHints(fileName)) {
    if (!kinds.includes(hint)) kinds.push(hint);
  }
  return kinds.length ? kinds : ['unknown'];
}

export function kindsOf(doc: Pick<LiveDocument, 'fileName' | 'result'>): DocKind[] {
  return classifyDocument(doc.result, doc.fileName);
}

function scheduleEKeys(result: ParseResponse): string[] {
  return [
    ...new Set(
      (result.scheduleEProperties ?? [])
        .map((prop) => {
          const address = normalizeAddress(prop.address);
          if (prop.year == null && !address) return '';
          return `${prop.year ?? ''}:${address}`;
        })
        .filter(Boolean),
    ),
  ];
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
  const incomingKeys = scheduleEKeys(incoming.result);
  if (incomingKeys.length) {
    const overlapping = existing.find((doc) => scheduleEKeys(doc.result).some((key) => incomingKeys.includes(key)));
    if (overlapping) {
      return {
        existingName: overlapping.fileName,
        reason: `Duplicate tax return — same Schedule E year/address as ${overlapping.fileName}`,
      };
    }
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
  if (kind === 'ccorp') return /1120 \(C-Corporation|C-Corporation Return/i.test(ids);
  if (kind === 'partnership') return /Form 1065|K-1 \(1065\)/i.test(ids);
  if (kind === 'schedule-f') return /Schedule F/i.test(ids);
  if (kind === 'asset') return /Schedule B|Schedule D/i.test(ids);
  return false;
}

export function firstPageForKind(result: ParseResponse, kind: DocKind): number {
  return result.pages.find((page) => pageMatchesKind(page, kind))?.index ?? 0;
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
  if (kinds.includes('w2')) return { tab: 'PAYSTUB_RECONCILIATION', wageDocKind: 'w2' };
  if (kinds.includes('paystub')) return { tab: 'PAYSTUB_RECONCILIATION', wageDocKind: 'paystub' };
  return { tab: 'PAYSTUB_RECONCILIATION' };
}

export function allScheduleEExtracts(documents: LiveDocument[]): Array<ScheduleEPropertyExtract & { documentId: string }> {
  return documents.flatMap((doc) =>
    (doc.result.scheduleEProperties ?? []).map((prop) => ({ ...prop, documentId: doc.id })),
  );
}
