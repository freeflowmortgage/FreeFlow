import type { DocKind } from './livePacket';
import {
  liveCCorpPatch,
  liveFarmPatch,
  livePartnershipPatch,
  liveSchCPatch,
  liveSCorpPatch,
  liveWagePatch,
  type LiveCCorpPatch,
  type LiveCorpPatch,
  type LiveFarmPatch,
  type LivePrevW2Patch,
  type LiveSchCPatch,
  type LiveWagePatch,
} from './liveHydrate';
import { discoveredIdentityKey, type LocatedMatch, type LocateResult } from './locateIncomeEntities';
import { namesMatch, type UrlAListedEntity } from './urlaEmploymentRoster';
import type { MappedIncomeField } from './parseTypes';

export type HydratedW2Seed = {
  id: string;
  rosterId?: string;
  /** Source PDFs that contributed fields to this employer. */
  documentIds: string[];
  employerName: string;
  ein: string;
  role: 'PRIMARY' | 'SECONDARY';
  located: boolean;
  undisclosed?: boolean;
  /** The borrower this job's income belongs to. */
  borrowerId?: string;
  /** The employee printed on the W-2 or pay stub. */
  personName?: string;
  patch: LiveWagePatch | null;
};

export type HydratedBusinessSeed<TPatch> = {
  id: string;
  rosterId?: string;
  businessName: string;
  ein: string;
  located: boolean;
  undisclosed?: boolean;
  borrowerId?: string;
  personName?: string;
  years: [TPatch | null, TPatch | null];
};

function yearPatches<T>(matches: LocatedMatch[], patchFn: (fields: LocatedMatch['fields']) => T | null): [T | null, T | null] {
  const patches = matches.map((match) => patchFn(match.fields)).filter((patch): patch is T => Boolean(patch));
  return [patches[0] ?? null, patches[1] ?? null];
}

function kindMatches(result: LocateResult, kind: DocKind): Array<{ row?: LocateResult['roster'][number]; match: LocatedMatch }> {
  const fromRoster = result.roster.flatMap((row) =>
    row.matches.filter((match) => match.kind === kind).map((match) => ({ row, match })),
  );
  const fromDiscovered = result.discovered.filter((match) => match.kind === kind).map((match) => ({ match }));
  return [...fromRoster, ...fromDiscovered];
}

function uniqueByRosterThenEntity<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function unusedWageDocs(result: LocateResult, allFields: MappedIncomeField[]): MappedIncomeField[] {
  const used = new Set(
    // Held-out documents count as used so they cannot be folded back in by employer name.
    [...result.roster.flatMap((row) => row.matches), ...result.discovered, ...(result.unidentified ?? [])]
      .flatMap((match) => match.fields)
      .filter((field) => field.form === 'Paystub' || field.form === 'WVOE')
      .map((field) => `${field.documentId ?? ''}:${field.pageIndex}:${field.sourceFieldId ?? field.id}`),
  );
  return allFields.filter(
    (field) =>
      (field.form === 'Paystub' || field.form === 'WVOE') &&
      !used.has(`${field.documentId ?? ''}:${field.pageIndex}:${field.sourceFieldId ?? field.id}`),
  );
}

function wageDocsForEmployer(docs: MappedIncomeField[], employerName: string): MappedIncomeField[] {
  // Page indexes restart at zero for every uploaded PDF. Keep the document ID in
  // the key so page 1 of an unrelated paystub cannot be folded into this employer.
  const pages = new Set(
    docs
      .filter(
        (field) =>
          (field.sourceFieldId === 'ps-employer-name' || field.id === 'ps-employer-name') &&
          namesMatch(field.value, employerName),
      )
      .map((field) => `${field.documentId ?? ''}:${field.pageIndex}`),
  );
  if (pages.size) return docs.filter((field) => pages.has(`${field.documentId ?? ''}:${field.pageIndex}`));
  return [];
}

function sourceDocumentIds(fields: MappedIncomeField[]): string[] {
  return [...new Set(fields.map((field) => field.documentId).filter((id): id is string => Boolean(id)))];
}

export function seedW2FromLocation(
  result: LocateResult,
  allFields: Parameters<typeof liveWagePatch>[0],
): { current: HydratedW2Seed[]; previous: LivePrevW2Patch | null } {
  const leftoverWageDocs = unusedWageDocs(result, allFields);
  const current: HydratedW2Seed[] = [];
  let previous: LivePrevW2Patch | null = null;

  const primaryId = result.borrowers?.[0]?.id;
  for (const row of result.roster) {
    const w2Matches = row.matches.filter((match) => match.kind === 'w2');
    if (row.entity.classification === 'Previous') {
      // The wage tab holds one prior employer: the primary borrower's.
      if (row.entity.borrowerId && primaryId && row.entity.borrowerId !== primaryId) continue;
      const first = w2Matches[0];
      const patch = first ? liveWagePatch(first.fields) : null;
      previous = {
        employerName: patch?.employerName || row.entity.name,
        ein: patch?.ein || row.entity.ein || '',
        box5Wages: patch?.w2Year1Box5,
      };
      continue;
    }
    if (row.entity.kind !== 'wages' && !w2Matches.length) continue;
    if (row.entity.kind === 'self-employed' && !w2Matches.length) continue;

    const first = w2Matches[0];
    const extras = wageDocsForEmployer(leftoverWageDocs, row.entity.name);
    const patch = first
      ? liveWagePatch([...first.fields, ...extras])
      : extras.length
        ? liveWagePatch(extras)
        : null;

    current.push({
      id: row.entity.id,
      rosterId: row.entity.id,
      documentIds: sourceDocumentIds([...w2Matches.flatMap((match) => match.fields), ...extras]),
      employerName: patch?.employerName || row.entity.name,
      ein: patch?.ein || row.entity.ein || '',
      role: row.entity.classification === 'Secondary' ? 'SECONDARY' : 'PRIMARY',
      located: w2Matches.length > 0 || extras.length > 0,
      borrowerId: row.entity.borrowerId ?? first?.borrowerIds?.[0],
      personName: first?.personName,
      patch,
    });
  }

  const discoveredW2 = new Map<string, LocatedMatch[]>();
  // An unidentified W-2 is held out of qualifying income until the underwriter
  // assigns it, but it still belongs in the review workspace. Omitting it here
  // replaced the extracted employer and wages with an empty placeholder and
  // also discarded the document IDs needed for source-box highlighting.
  for (const match of [...result.discovered, ...(result.unidentified ?? [])].filter((item) => item.kind === 'w2')) {
    const key = discoveredIdentityKey(match);
    const list = discoveredW2.get(key) ?? [];
    list.push(match);
    discoveredW2.set(key, list);
  }
  for (const [id, matches] of discoveredW2) {
    const fields = matches.flatMap((match) => match.fields);
    const extras = wageDocsForEmployer(leftoverWageDocs, matches[0]?.name || '');
    const patch = liveWagePatch([...fields, ...extras]);
    current.push({
      id,
      documentIds: sourceDocumentIds([...fields, ...extras]),
      employerName: patch?.employerName || matches[0]?.name || 'Employer on return',
      ein: patch?.ein || matches[0]?.ein || '',
      role: current.some((item) => item.role === 'PRIMARY') ? 'SECONDARY' : 'PRIMARY',
      located: true,
      undisclosed: true,
      borrowerId: matches.find((match) => match.borrowerIds?.length)?.borrowerIds?.[0],
      personName: matches.find((match) => match.personName)?.personName,
      patch,
    });
  }

  if (!previous) {
    const prevRow = result.roster.find(
      (row) =>
        row.entity.classification === 'Previous' &&
        (!row.entity.borrowerId || !primaryId || row.entity.borrowerId === primaryId),
    );
    if (prevRow) {
      previous = { employerName: prevRow.entity.name, ein: prevRow.entity.ein || '' };
    }
  }

  return { current: uniqueByRosterThenEntity(current), previous };
}

function seedBusinesses<TPatch>(
  result: LocateResult,
  kind: DocKind,
  patchFn: (fields: LocatedMatch['fields']) => TPatch | null,
  nameFromPatch: (patch: TPatch | null) => string | undefined,
  einFromPatch: (patch: TPatch | null) => string | undefined,
  fallbackName: string,
): Array<HydratedBusinessSeed<TPatch>> {
  const grouped = new Map<string, { entity?: UrlAListedEntity; matches: LocatedMatch[] }>();

  for (const { row, match } of kindMatches(result, kind)) {
    const key = row?.entity.id ?? discoveredIdentityKey(match);
    const existing = grouped.get(key) ?? { entity: row?.entity, matches: [] };
    existing.matches.push(match);
    grouped.set(key, existing);
  }

  const seeds: Array<HydratedBusinessSeed<TPatch>> = [];
  for (const [id, { entity, matches }] of grouped) {
    const years = yearPatches(matches, patchFn);
    const patch = years[0];
    seeds.push({
      id,
      rosterId: entity?.id,
      businessName: nameFromPatch(patch) || entity?.name || matches[0]?.name || fallbackName,
      ein: einFromPatch(patch) || entity?.ein || matches[0]?.ein || '',
      located: true,
      undisclosed: !entity,
      borrowerId: entity?.borrowerId ?? matches.find((match) => match.borrowerIds?.length)?.borrowerIds?.[0],
      personName: matches.find((match) => match.personName)?.personName,
      years,
    });
  }

  for (const row of result.roster) {
    if (row.located || row.entity.kind !== 'self-employed') continue;
    if (seeds.some((seed) => seed.rosterId === row.entity.id)) continue;
    // Unlocated self-employed 1003 names stay on the roster panel; they are not
    // guessed into a Schedule C vs 1120-S vs 1065 tab until a form is found.
  }

  return seeds;
}

export function seedScheduleCFromLocation(result: LocateResult): Array<HydratedBusinessSeed<LiveSchCPatch>> {
  return seedBusinesses(result, 'schedule-c', liveSchCPatch, (p) => p?.businessName, (p) => p?.ein, 'Schedule C business');
}

export function seedSCorpFromLocation(result: LocateResult): Array<HydratedBusinessSeed<LiveCorpPatch>> {
  return seedBusinesses(result, 'scorp', liveSCorpPatch, (p) => p?.businessName, (p) => p?.ein, 'S-Corporation');
}

export function seedPartnershipFromLocation(result: LocateResult): Array<HydratedBusinessSeed<LiveCorpPatch>> {
  return seedBusinesses(result, 'partnership', livePartnershipPatch, (p) => p?.businessName, (p) => p?.ein, 'Partnership');
}

export function seedCCorpFromLocation(result: LocateResult): Array<HydratedBusinessSeed<LiveCCorpPatch>> {
  return seedBusinesses(result, 'ccorp', liveCCorpPatch, (p) => p?.businessName, (p) => p?.ein, 'C-Corporation');
}

export function seedFarmFromLocation(result: LocateResult): Array<HydratedBusinessSeed<LiveFarmPatch>> {
  return seedBusinesses(result, 'schedule-f', liveFarmPatch, (p) => p?.businessName, (p) => p?.ein, 'Farm');
}

export function rosterStatusLabel(row: LocateResult['roster'][number]): string {
  if (!row.located) return 'Not in packet';
  const kinds = [...new Set(row.matches.map((match) => match.kind))];
  const pages = [...new Set(row.matches.map((match) => match.pageIndex + 1))].join(', ');
  return `Located · ${kinds.join(', ')} · p.${pages}`;
}
