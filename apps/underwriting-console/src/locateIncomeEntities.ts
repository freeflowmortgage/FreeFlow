import type { MappedIncomeField, ParsePage } from './parseTypes';
import type { DocKind } from './livePacket';
import {
  namesMatch,
  normalizeBusinessName,
  type UrlAListedEntity,
} from './urlaEmploymentRoster';

export type LocatePage = {
  documentId?: string;
  pageIndex: number;
  formIds: string[];
  text: string;
};

export type LocateRentalExtract = {
  address: string;
  pageIndex: number;
  documentId?: string;
  column?: string;
};

export type LocatedMatch = {
  entityId: string;
  form: MappedIncomeField['form'];
  kind: DocKind;
  documentId?: string;
  pageIndex: number;
  name?: string;
  ein?: string;
  fields: MappedIncomeField[];
};

export type LocatedRosterRow = {
  entity: UrlAListedEntity;
  located: boolean;
  matches: LocatedMatch[];
};

export type LocateResult = {
  roster: LocatedRosterRow[];
  discovered: LocatedMatch[];
};

const IDENTITY_NAME_IDS = new Set([
  'w2-employer-name',
  'ent1-name',
  'scorp-name',
  'pt-name',
  'c1120-name',
  'schedule-f-name',
]);

const IDENTITY_EIN_IDS = new Set([
  'w2-employer-ein',
  'ent1-ein',
  'scorp-ein',
  'pt-ein',
  'c1120-ein',
  'schedule-f-ein',
]);

const BUSINESS_FORMS = new Set<MappedIncomeField['form']>([
  'W-2',
  'Schedule C',
  'Schedule F',
  'Form 1120-S',
  'Form 1065',
  'Form 1120',
]);

export function formToDocKind(form: MappedIncomeField['form']): DocKind {
  if (form === 'W-2' || form === 'Paystub' || form === 'WVOE') return form === 'W-2' ? 'w2' : 'paystub';
  if (form === 'Schedule C') return 'schedule-c';
  if (form === 'Schedule E') return 'schedule-e';
  if (form === 'Schedule F') return 'schedule-f';
  if (form === 'Form 1120-S') return 'scorp';
  if (form === 'Form 1065') return 'partnership';
  if (form === 'Form 1120') return 'ccorp';
  if (form === 'Schedule B' || form === 'Schedule D') return 'asset';
  return 'unknown';
}

export function formFromPageLabels(formIds: string[]): MappedIncomeField['form'] | undefined {
  const labels = formIds.join(' ');
  if (/W-?2/i.test(labels)) return 'W-2';
  if (/Schedule C/i.test(labels)) return 'Schedule C';
  if (/Schedule E/i.test(labels)) return 'Schedule E';
  if (/Schedule F/i.test(labels)) return 'Schedule F';
  if (/1120-?S|K-1 \(1120/i.test(labels)) return 'Form 1120-S';
  if (/Form 1065|K-1 \(1065\)/i.test(labels)) return 'Form 1065';
  if (/1120 \(C-Corporation|C-Corporation Return/i.test(labels)) return 'Form 1120';
  return undefined;
}

export function fallbackUndisclosedName(form: MappedIncomeField['form']): string {
  switch (form) {
    case 'W-2':
      return 'Undisclosed employer (W-2)';
    case 'Schedule C':
      return 'Undisclosed Schedule C business';
    case 'Schedule E':
      return 'Undisclosed rental (Schedule E)';
    case 'Schedule F':
      return 'Undisclosed farm (Schedule F)';
    case 'Form 1120-S':
      return 'Undisclosed S-Corporation (Form 1120-S)';
    case 'Form 1065':
      return 'Undisclosed partnership (Form 1065)';
    case 'Form 1120':
      return 'Undisclosed C-Corporation (Form 1120)';
    default:
      return 'Undisclosed business on return';
  }
}

export function groupFieldsByEntity(
  fields: MappedIncomeField[],
  form?: MappedIncomeField['form'],
): LocatedMatch[] {
  const groups = new Map<string, MappedIncomeField[]>();
  for (const field of fields) {
    if (form && field.form !== form) continue;
    if (field.form === 'Paystub' || field.form === 'WVOE' || field.form === 'Schedule B' || field.form === 'Schedule D') {
      continue;
    }
    const key = `${field.documentId ?? ''}::${field.entityId || `${field.form}-p${field.pageIndex}`}`;
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }

  return [...groups.values()].map((group) => {
    const head = group[0];
    const nameField = group.find((field) => IDENTITY_NAME_IDS.has(field.sourceFieldId ?? field.id));
    const einField = group.find((field) => IDENTITY_EIN_IDS.has(field.sourceFieldId ?? field.id));
    return {
      entityId: head.entityId || `${head.form.toLowerCase()}-p${head.pageIndex}`,
      form: head.form,
      kind: formToDocKind(head.form),
      documentId: head.documentId,
      pageIndex: head.pageIndex,
      name: nameField?.value?.trim() || undefined,
      ein: einField?.value?.trim() || undefined,
      fields: group,
    };
  });
}

function normalizeEin(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function einsMatch(left?: string, right?: string): boolean {
  const a = normalizeEin(left);
  const b = normalizeEin(right);
  return a.length === 9 && a === b;
}

export function discoveredIdentityKey(match: Pick<LocatedMatch, 'kind' | 'name' | 'ein' | 'entityId' | 'documentId' | 'pageIndex'>): string {
  const ein = normalizeEin(match.ein);
  if (ein.length === 9) return `${match.kind}:ein:${ein}`;
  const name = normalizeBusinessName(match.name ?? '');
  if (name) return `${match.kind}:name:${name}`;
  return `${match.kind}:page:${match.documentId ?? ''}::${match.entityId}::${match.pageIndex}`;
}

export function discoveredSelectId(match: LocatedMatch): string {
  return `discovered:${discoveredIdentityKey(match)}`;
}

export function uniqueDiscoveredBusinesses(matches: LocatedMatch[]): LocatedMatch[] {
  const seen = new Set<string>();
  const out: LocatedMatch[] = [];
  for (const match of matches) {
    const key = discoveredIdentityKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
  }
  return out;
}

function pageTextMatches(page: LocatePage, entity: UrlAListedEntity): boolean {
  if (entity.kind === 'rental') {
    return namesMatch(page.text, entity.name) || page.text.toLowerCase().includes(entity.name.toLowerCase());
  }
  if (einsMatch(entity.ein, page.text.match(/(\d{2}-?\d{7})/)?.[1])) return true;
  const needle = normalizeBusinessName(entity.name);
  if (needle.length < 4) return false;
  return normalizeBusinessName(page.text).includes(needle);
}

function formFitsEntity(form: MappedIncomeField['form'] | undefined, entity: UrlAListedEntity): boolean {
  if (!form) return true;
  if (entity.kind === 'rental') return form === 'Schedule E';
  return form !== 'Schedule E';
}

function scoreMatch(entity: UrlAListedEntity, candidate: { name?: string; ein?: string; form?: MappedIncomeField['form'] }): number {
  if (!formFitsEntity(candidate.form, entity)) return 0;
  let score = 0;
  if (einsMatch(entity.ein, candidate.ein)) score += 100;
  if (candidate.name && namesMatch(entity.name, candidate.name)) score += 90;
  else if (candidate.name && normalizeBusinessName(candidate.name).includes(normalizeBusinessName(entity.name))) {
    score += 70;
  }
  return score;
}

export function identityFromPageText(text: string): { name?: string; ein?: string } {
  const ein = text.match(/\b(\d{2}-\d{7}|\d{9})\b/)?.[1];
  const nameMatchers = [
    /corporation(?:['’]s)? name\s+(.+?)(?=\s+corporation(?:['’]s)? employer|\s+\d{2}-?\d{7}|$)/i,
    /partnership(?:['’]s)? name\s+(.+?)(?=\s+partnership(?:['’]s)? employer|\s+\d{2}-?\d{7}|$)/i,
    /employer(?:['’]s)? name\s+(.+?)(?=\s+(?:[a-z]\s+)?employer identification|\s+\d{2}-?\d{7}|$)/i,
    /name of corporation\s+(.+?)(?=\s+employer identification|\s+\d{2}-?\d{7}|$)/i,
    /legal name of corporation\s+(.+?)(?=\s+employer identification|\s+\d{2}-?\d{7}|$)/i,
    /(?:^|\s)c\s+business name\s+(.+?)(?=\s+b\s+employer|\s+\d{2}-?\d{7}|$)/i,
    /business name(?:\.?\s+if no separate[^.]{0,40})?\s+(.+?)(?=\s+b\s+employer|\s+\d{2}-?\d{7}|$)/i,
    /(?:^|\s)c\s+farm name\s+(.+?)(?=\s+b\s+employer|\s+\d{2}-?\d{7}|$)/i,
    /farm name\s+(.+?)(?=\s+employer identification|\s+\d{2}-?\d{7}|$)/i,
  ];
  for (const pattern of nameMatchers) {
    const match = text.match(pattern);
    const name = match?.[1]?.replace(/\s+/g, ' ').trim();
    if (name && name.length >= 2) return { name, ein };
  }
  return { ein };
}

function matchFromPage(page: LocatePage, entity: UrlAListedEntity): LocatedMatch | null {
  if (!pageTextMatches(page, entity)) return null;
  const form = formFromPageLabels(page.formIds);
  if (!form || !formFitsEntity(form, entity)) return null;
  return {
    entityId: `${form.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${page.pageIndex}`,
    form,
    kind: formToDocKind(form),
    documentId: page.documentId,
    pageIndex: page.pageIndex,
    name: entity.name,
    ein: entity.ein,
    fields: [],
  };
}

function matchKey(match: LocatedMatch): string {
  return `${match.documentId ?? ''}::${match.entityId}::${match.form}::${match.pageIndex}`;
}

function samePageForm(
  left: { pageIndex: number; form: MappedIncomeField['form']; documentId?: string },
  right: { pageIndex: number; form?: MappedIncomeField['form']; documentId?: string },
): boolean {
  return left.pageIndex === right.pageIndex && left.form === right.form && (left.documentId ?? '') === (right.documentId ?? '');
}

function rentalMatch(rental: LocateRentalExtract): LocatedMatch {
  return {
    entityId: `schedule-e-p${rental.pageIndex}-${(rental.column ?? 'a').toLowerCase()}`,
    form: 'Schedule E',
    kind: 'schedule-e',
    documentId: rental.documentId,
    pageIndex: rental.pageIndex,
    name: rental.address.trim() || fallbackUndisclosedName('Schedule E'),
    fields: [],
  };
}

/**
 * List every 1003 entity, then search the whole packet for each one.
 * Later pages are not skipped after the first hit — two K-1s or two Schedule Cs
 * both attach if their names/EINs match.
 *
 * Anything in the packet that never matched a 1003 name stays in `discovered`
 * (undisclosed businesses and extra Schedule E properties).
 */
export function locateIncomeEntities(options: {
  roster: UrlAListedEntity[];
  fields: MappedIncomeField[];
  pages?: LocatePage[];
  rentals?: LocateRentalExtract[];
}): LocateResult {
  const groups = groupFieldsByEntity(options.fields);
  const claimed = new Set<string>();
  const roster: LocatedRosterRow[] = options.roster.map((entity) => {
    const matches: LocatedMatch[] = [];

    if (entity.kind === 'rental') {
      for (const rental of options.rentals ?? []) {
        if (!namesMatch(rental.address, entity.name) && !normalizeBusinessName(rental.address).includes(normalizeBusinessName(entity.name))) {
          continue;
        }
        const match = rentalMatch(rental);
        matches.push(match);
        claimed.add(matchKey(match));
      }
    }

    for (const group of groups) {
      const score = scoreMatch(entity, group);
      if (score < 70) continue;
      matches.push(group);
      claimed.add(matchKey(group));
    }

    for (const page of options.pages ?? []) {
      const fromPage = matchFromPage(page, entity);
      if (!fromPage) continue;
      if (matches.some((item) => samePageForm(item, fromPage))) continue;
      const overlapping = groups.find((group) => samePageForm(group, fromPage));
      const match = overlapping ?? fromPage;
      matches.push(match);
      claimed.add(matchKey(match));
    }

    matches.sort((a, b) => a.pageIndex - b.pageIndex || a.form.localeCompare(b.form));
    return { entity, located: matches.length > 0, matches };
  });

  const discovered: LocatedMatch[] = groups.filter((group) => !claimed.has(matchKey(group)));
  const covered = [...roster.flatMap((row) => row.matches), ...discovered];

  for (const page of options.pages ?? []) {
    const form = formFromPageLabels(page.formIds);
    if (!form || !BUSINESS_FORMS.has(form)) continue;
    if (covered.some((item) => samePageForm(item, { pageIndex: page.pageIndex, form, documentId: page.documentId }))) {
      continue;
    }
    const identity = identityFromPageText(page.text);
    const match: LocatedMatch = {
      entityId: `${form.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${page.pageIndex}`,
      form,
      kind: formToDocKind(form),
      documentId: page.documentId,
      pageIndex: page.pageIndex,
      name: identity.name || fallbackUndisclosedName(form),
      ein: identity.ein,
      fields: [],
    };
    discovered.push(match);
    covered.push(match);
  }

  for (const rental of options.rentals ?? []) {
    const match = rentalMatch(rental);
    if (claimed.has(matchKey(match))) continue;
    if (discovered.some((item) => matchKey(item) === matchKey(match))) continue;
    discovered.push(match);
  }

  return { roster, discovered };
}

export function pagesFromParsePages(
  pages: ParsePage[],
  documentId?: string,
): LocatePage[] {
  return pages.map((page) => ({
    documentId,
    pageIndex: page.index,
    formIds: page.formIds,
    text: page.words.map((word) => word.text).join(' '),
  }));
}

export function matchesForKind(result: LocateResult, kind: DocKind): LocatedMatch[] {
  return [
    ...result.roster.flatMap((row) => row.matches.filter((match) => match.kind === kind)),
    ...result.discovered.filter((match) => match.kind === kind),
  ];
}
