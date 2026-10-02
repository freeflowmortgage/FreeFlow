import type { MappedIncomeField, ParsePage } from './parseTypes';
import type { DocKind } from './livePacket';
import {
  borrowerIdAt,
  borrowersNamedIn,
  documentPersonName,
  personNameTokens,
  samePerson,
  type LoanBorrower,
} from './borrowers';
import {
  namesMatch,
  normalizeBusinessName,
  type UrlAListedEntity,
} from './urlaEmploymentRoster';

/**
 * - `matched`: the document names a borrower, the underwriter assigned it, or
 *   it is a return with no person on it and one borrower owns that business.
 * - `unidentified`: a 1003 is loaded and the document belongs to someone not
 *   on it. Its income is held out until it is assigned.
 * - `unknown`: nothing says whose it is and there is no 1003 to check against.
 */
export type BorrowerStatus = 'matched' | 'unidentified' | 'unknown';

export type BorrowerWarning = {
  code: 'UNIDENTIFIED_BORROWER' | 'UNCONFIRMED_BORROWERS';
  message: string;
  /** Key for `assignments` when the warning is about one document. */
  assignmentKey?: string;
  documentId?: string;
  pageIndex?: number;
  /** Parsed person name used only for an explicit, browser-session assignment. */
  personName?: string;
};

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
  /** The employee, partner, shareholder or proprietor the document names. */
  personName?: string;
  /** Borrowers this document belongs to; the first owns its income. */
  borrowerIds?: string[];
  borrowerStatus?: BorrowerStatus;
};

export type LocatedRosterRow = {
  entity: UrlAListedEntity;
  located: boolean;
  matches: LocatedMatch[];
};

export type LocateResult = {
  roster: LocatedRosterRow[];
  discovered: LocatedMatch[];
  /** The 1003 borrowers, or the people the documents name when no 1003 is loaded. */
  borrowers?: LoanBorrower[];
  /** Documents for someone not on the 1003. Not in `roster` or `discovered`, so not in income. */
  unidentified?: LocatedMatch[];
  warnings?: BorrowerWarning[];
};

const PERSON_NAME_IDS = new Set([
  'w2-employee-name',
  'ps-employee-name',
  'pt-partner-name',
  'scorp-shareholder-name',
  'ent1-proprietor',
]);

/** Kinds whose documents print the person they belong to. */
const PERSON_KINDS = new Set<DocKind>(['w2', 'paystub', 'schedule-c', 'scorp', 'partnership']);

type Person = { personName?: string; borrowerIds: string[] };

function personNameFrom(fields: MappedIncomeField[]): string | undefined {
  for (const field of fields) {
    if (!PERSON_NAME_IDS.has(field.sourceFieldId ?? field.id)) continue;
    const name = documentPersonName(field.value);
    if (name) return name;
  }
  return undefined;
}

function pageTexts(
  fields: MappedIncomeField[],
  pages: LocatePage[] | undefined,
  anchor?: { documentId?: string; pageIndex: number },
): string {
  const keys = new Set(fields.map((field) => `${field.documentId ?? ''}:${field.pageIndex}`));
  if (anchor) keys.add(`${anchor.documentId ?? ''}:${anchor.pageIndex}`);
  return (pages ?? [])
    .filter((page) => keys.has(`${page.documentId ?? ''}:${page.pageIndex}`))
    .map((page) => page.text)
    .join(' ');
}

/** Whose document: the printed person when read, otherwise any borrower the page text names. */
function personOf(
  fields: MappedIncomeField[],
  pages: LocatePage[] | undefined,
  borrowers: LoanBorrower[],
  anchor?: { documentId?: string; pageIndex: number },
): Person {
  const personName = personNameFrom(fields);
  if (personName) {
    return { personName, borrowerIds: borrowers.filter((b) => samePerson(personName, b.name)).map((b) => b.id) };
  }
  return { borrowerIds: borrowersNamedIn(pageTexts(fields, pages, anchor), borrowers).map((b) => b.id) };
}

function peopleConflict(left: Person, right: Person): boolean {
  if (left.personName && right.personName) return !samePerson(left.personName, right.personName);
  if (left.borrowerIds.length && right.borrowerIds.length) {
    return !left.borrowerIds.some((id) => right.borrowerIds.includes(id));
  }
  return false;
}

function personKey(person: Person): string {
  return person.borrowerIds[0] ?? (person.personName ? personNameTokens(person.personName).join('-') : '');
}

function isK1Field(field: MappedIncomeField): boolean {
  const id = field.sourceFieldId ?? field.id;
  return /^(?:pt|scorp)-/.test(id) && !returnKind(id);
}

/** A W-2, pay stub, Schedule C or K-1 names its person; a return face or 1120 does not. */
function expectsPerson(match: LocatedMatch, pages: LocatePage[] | undefined): boolean {
  if (!PERSON_KINDS.has(match.kind)) return false;
  if (match.kind !== 'scorp' && match.kind !== 'partnership') return true;
  if (match.fields.some(isK1Field)) return true;
  const page = pages?.find((item) => item.pageIndex === match.pageIndex && (item.documentId ?? '') === (match.documentId ?? ''));
  return Boolean(page && /K-1/i.test(page.formIds.join(' ')));
}

/** Key the underwriter's "assign to borrower" choice is stored under. */
export function assignmentKey(match: Pick<LocatedMatch, 'documentId' | 'pageIndex' | 'form'>): string {
  return `${match.documentId ?? ''}:${match.pageIndex}:${match.form}`;
}

/** Everyone the documents name, in packet order, for a file with no 1003. */
export function borrowersFromDocuments(fields: MappedIncomeField[]): LoanBorrower[] {
  const names: string[] = [];
  for (const field of fields) {
    if (!PERSON_NAME_IDS.has(field.sourceFieldId ?? field.id)) continue;
    const name = documentPersonName(field.value);
    if (name && !names.some((known) => samePerson(known, name))) names.push(name);
  }
  return names.map((name, index) => ({
    id: borrowerIdAt(index),
    name,
    role: index === 0 ? 'Borrower' : 'CoBorrower',
    fromDocuments: true,
  }));
}

const IDENTITY_NAME_IDS = new Set([
  'w2-employer-name',
  'ps-employer-name',
  'ent1-name',
  'scorp-name',
  'pt-name',
  'pt-return-name',
  'scorp-return-name',
  'c1120-name',
  'schedule-f-name',
  'form-8825-name',
]);

const IDENTITY_EIN_IDS = new Set([
  'w2-employer-ein',
  'ent1-ein',
  'scorp-ein',
  'pt-ein',
  'pt-return-ein',
  'scorp-return-ein',
  'c1120-ein',
  'schedule-f-ein',
  'form-8825-ein',
]);

const SUPPORTING_FORMS = new Set<MappedIncomeField['form']>(['Paystub', 'WVOE', 'Form 8825']);

const CORP_KINDS = new Set<DocKind>(['scorp', 'partnership', 'ccorp']);

function sourceId(field: MappedIncomeField): string {
  return field.sourceFieldId ?? field.id;
}

/**
 * The 1065 / 1120-S return face and its Schedule M-1 page carry entity-level
 * lines, not a separate business. Left as their own match they became a second
 * partnership (or a "prior year" of the first); they belong on the K-1.
 */
function returnKind(id: string): DocKind | undefined {
  if (id.startsWith('pt-return-')) return 'partnership';
  if (id.startsWith('scorp-return-')) return 'scorp';
  return undefined;
}

function isSupportingField(field: MappedIncomeField): boolean {
  const id = sourceId(field);
  if (SUPPORTING_FORMS.has(field.form)) return true;
  if (returnKind(id)) return true;
  return id.startsWith('form-8825-') || id.startsWith('form-4562-') || id.startsWith('sch-l-');
}

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
  // Form 8825 is an addback attachment, not its own 1003 business kind.
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
  if (/8825/i.test(labels)) return 'Form 8825';
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
  pages?: LocatePage[],
  borrowers: LoanBorrower[] = [],
): LocatedMatch[] {
  const groups = new Map<string, MappedIncomeField[]>();
  const supporting: MappedIncomeField[] = [];
  for (const field of fields) {
    if (form && field.form !== form) continue;
    if (isSupportingField(field)) {
      supporting.push(field);
      continue;
    }
    const key = `${field.documentId ?? ''}::${field.entityId || `${field.form}-p${field.pageIndex}`}`;
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }

  const matches = [...groups.values()].map((group) => {
    const head = group[0];
    const nameField = group.find((field) => IDENTITY_NAME_IDS.has(sourceId(field)));
    const einField = group.find((field) => IDENTITY_EIN_IDS.has(sourceId(field)));
    return {
      entityId: head.entityId || `${head.form.toLowerCase()}-p${head.pageIndex}`,
      form: head.form,
      kind: formToDocKind(head.form),
      documentId: head.documentId,
      pageIndex: head.pageIndex,
      name: nameField?.value?.trim() || undefined,
      ein: einField?.value?.trim() || undefined,
      fields: group,
    } satisfies LocatedMatch;
  });

  return attachSupportingFields(matches, supporting, pages, borrowers);
}

function pageTextFor(field: MappedIncomeField, pages?: LocatePage[]): string {
  return (
    pages?.find(
      (page) => page.pageIndex === field.pageIndex && (page.documentId ?? '') === (field.documentId ?? ''),
    )?.text ?? ''
  );
}

function identityFromFields(fields: MappedIncomeField[]): { name?: string; ein?: string } {
  const name = fields.find((field) => IDENTITY_NAME_IDS.has(sourceId(field)))?.value?.trim();
  const ein = fields.find((field) => IDENTITY_EIN_IDS.has(sourceId(field)))?.value?.trim();
  return { name: name || undefined, ein: ein || undefined };
}

function compatibleKinds(field: MappedIncomeField): DocKind[] {
  const id = sourceId(field);
  const fromReturn = returnKind(id);
  if (fromReturn) return [fromReturn];
  if (field.form === 'Form 8825' || id.startsWith('form-8825-') || id.startsWith('form-4562-') || id.startsWith('sch-l-')) {
    return [...CORP_KINDS];
  }
  if (field.form === 'Paystub' || field.form === 'WVOE') return ['w2'];
  return [];
}

function formForKind(kind: DocKind): MappedIncomeField['form'] {
  if (kind === 'partnership') return 'Form 1065';
  if (kind === 'ccorp') return 'Form 1120';
  if (kind === 'w2') return 'W-2';
  if (kind === 'schedule-c') return 'Schedule C';
  if (kind === 'schedule-f') return 'Schedule F';
  return 'Form 1120-S';
}

function kindFromSupportingBundle(bundle: MappedIncomeField[], pages?: LocatePage[]): DocKind {
  if (bundle.some((field) => field.form === 'Form 1065')) return 'partnership';
  if (bundle.some((field) => field.form === 'Form 1120')) return 'ccorp';
  if (bundle.some((field) => field.form === 'Form 1120-S')) return 'scorp';
  const text = `${pageTextFor(bundle[0], pages)} ${bundle.map((field) => field.value).join(' ')}`;
  if (/schedule k-1\s*\(form\s*1065\)|form\s+1065/i.test(text) && !/1120-?s/i.test(text)) return 'partnership';
  if (/form\s+1120(?!\s*-?\s*s)|c-corporation/i.test(text)) return 'ccorp';
  return 'scorp';
}

function pushField(target: LocatedMatch, field: MappedIncomeField): void {
  if (target.fields.some((existing) => existing.id === field.id && existing.pageIndex === field.pageIndex && existing.value === field.value)) {
    return;
  }
  target.fields.push(field);
  const id = sourceId(field);
  if (!target.name && IDENTITY_NAME_IDS.has(id) && field.value.trim()) target.name = field.value.trim();
  if (!target.ein && IDENTITY_EIN_IDS.has(id) && field.value.trim()) target.ein = field.value.trim();
}

/**
 * K-1s for one business issued to different borrowers. The return face and its
 * schedules are the business's, so each partner's K-1 carries them.
 */
function oneBusinessManyPeople(
  matches: LocatedMatch[],
  bundle: MappedIncomeField[],
  pages: LocatePage[] | undefined,
  borrowers: LoanBorrower[],
): LocatedMatch[] | undefined {
  if (matches.length < 2 || bundle.some((field) => field.form === 'Paystub' || field.form === 'WVOE')) return undefined;
  const [head, ...rest] = matches;
  const sameBusiness = rest.every(
    (match) => einsMatch(match.ein, head.ein) || Boolean(match.name && head.name && namesMatch(match.name, head.name)),
  );
  if (!sameBusiness) return undefined;
  const keys = matches.map((match) => personKey(personOf(match.fields, pages, borrowers, match)));
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return undefined;
  return matches;
}

function pickSupportingTargets(
  allCandidates: LocatedMatch[],
  bundle: MappedIncomeField[],
  pages: LocatePage[] | undefined,
  borrowers: LoanBorrower[],
): LocatedMatch[] {
  // A pay stub for one spouse never lands on the other spouse's W-2 at the same employer.
  const bundlePerson = personOf(bundle, pages, borrowers);
  const candidates = allCandidates.filter(
    (match) => !peopleConflict(personOf(match.fields, pages, borrowers, match), bundlePerson),
  );
  if (!candidates.length) return [];
  const identity = identityFromFields(bundle);
  const pageText = pageTextFor(bundle[0], pages);
  const byEin = identity.ein ? candidates.filter((match) => einsMatch(match.ein, identity.ein)) : [];
  if (byEin.length === 1) return byEin;
  const byName = identity.name ? candidates.filter((match) => match.name && namesMatch(match.name, identity.name!)) : [];
  if (byName.length === 1 && !byEin.length) return byName;
  const shared = oneBusinessManyPeople(byEin.length ? byEin : byName, bundle, pages, borrowers);
  if (shared) return shared;
  if (byName.length === 1) return byName;
  // An explicit identity that conflicts with every candidate is evidence of a
  // separate employer/business, not permission to attach to the only candidate.
  if (identity.ein || identity.name) return [];
  const byPageText = pageText
    ? candidates.filter((match) => match.name && namesMatch(match.name, pageText))
    : [];
  if (byPageText.length === 1) return byPageText;
  const documentId = bundle[0].documentId;
  if (documentId) {
    const sameDoc = candidates.filter((match) => match.documentId === documentId);
    if (sameDoc.length === 1) return sameDoc;
  }
  if (candidates.length === 1) return candidates;
  return oneBusinessManyPeople(candidates, bundle, pages, borrowers) ?? [];
}

function inventMatch(bundle: MappedIncomeField[], kind: DocKind, pages?: LocatePage[]): LocatedMatch {
  const head = bundle[0];
  const identity = identityFromFields(bundle);
  const fromPage = identityFromPageText(pageTextFor(head, pages));
  const form = head.form === 'Paystub' || head.form === 'WVOE' ? head.form : formForKind(kind);
  return {
    entityId: head.entityId || `${form.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${head.pageIndex}`,
    form,
    kind,
    documentId: head.documentId,
    pageIndex: head.pageIndex,
    name: identity.name || fromPage.name || (kind === 'w2' ? fallbackUndisclosedName('W-2') : fallbackUndisclosedName(formForKind(kind))),
    ein: identity.ein || fromPage.ein,
    fields: [...bundle],
  };
}

/**
 * Fold 8825 / 4562 / Schedule L onto the K-1 or return they belong to, and
 * paystubs / WVOEs onto the matching W-2. Leftover 8825 (or paystub) packets
 * still become discovered jobs/businesses so an empty 1003 does not drop them.
 */
function attachSupportingFields(
  matches: LocatedMatch[],
  supporting: MappedIncomeField[],
  pages: LocatePage[] | undefined,
  borrowers: LoanBorrower[],
): LocatedMatch[] {
  if (!supporting.length) return matches;
  const next = matches.map((match) => ({ ...match, fields: [...match.fields] }));
  const used = new Set<MappedIncomeField>();
  const bundles = new Map<string, MappedIncomeField[]>();
  for (const field of supporting) {
    const key = `${field.documentId ?? ''}::${field.pageIndex}::${compatibleKinds(field)[0] ?? field.form}`;
    const list = bundles.get(key) ?? [];
    list.push(field);
    bundles.set(key, list);
  }

  const attachBundle = (bundle: MappedIncomeField[], kinds: DocKind[]): boolean => {
    const candidates = next.filter((match) => kinds.includes(match.kind));
    const targets = pickSupportingTargets(candidates, bundle, pages, borrowers);
    if (!targets.length) return false;
    bundle.forEach((field) => {
      targets.forEach((target) => pushField(target, field));
      used.add(field);
    });
    return true;
  };

  for (const bundle of bundles.values()) {
    attachBundle(bundle, compatibleKinds(bundle[0]));
  }

  const leftoverOf = (predicate: (field: MappedIncomeField) => boolean) =>
    [...bundles.values()].filter((bundle) => bundle.some((field) => !used.has(field) && predicate(field)));

  // A return with no K-1 in the packet is still that business. Its face and
  // M-1 pages sit in separate bundles, so they are joined per document first.
  // This runs before the anonymous 8825 / 4562 / Schedule L leftovers invent
  // an entity: an invented one has no name, so the named return face would
  // refuse it and be dropped, leaving Schedule L on a business of its own.
  const orphanReturns = new Map<string, MappedIncomeField[]>();
  for (const bundle of leftoverOf((field) => Boolean(returnKind(sourceId(field))))) {
    for (const field of bundle) {
      if (used.has(field)) continue;
      const key = `${field.documentId ?? ''}::${returnKind(sourceId(field))}`;
      orphanReturns.set(key, [...(orphanReturns.get(key) ?? []), field]);
    }
  }
  for (const unused of orphanReturns.values()) {
    const kind = returnKind(sourceId(unused[0]))!;
    if (attachBundle(unused, [kind])) continue;
    // Several K-1s and no identity to choose between them: guessing would put
    // one entity's depreciation on another, and inventing a business is worse.
    if (next.some((match) => match.kind === kind)) continue;
    next.push(inventMatch(unused, kind, pages));
    unused.forEach((field) => used.add(field));
  }

  for (const bundle of leftoverOf((field) => field.form === 'Form 8825' || sourceId(field).startsWith('form-8825-'))) {
    const unused = bundle.filter((field) => !used.has(field));
    if (!unused.length) continue;
    if (attachBundle(unused, [...CORP_KINDS])) continue;
    next.push(inventMatch(unused, kindFromSupportingBundle(unused, pages), pages));
    unused.forEach((field) => used.add(field));
  }

  for (const bundle of leftoverOf((field) => sourceId(field).startsWith('form-4562-') || sourceId(field).startsWith('sch-l-'))) {
    const unused = bundle.filter((field) => !used.has(field));
    if (!unused.length) continue;
    if (attachBundle(unused, [...CORP_KINDS])) continue;
    if (next.some((match) => CORP_KINDS.has(match.kind))) continue;
    next.push(inventMatch(unused, kindFromSupportingBundle(unused, pages), pages));
    unused.forEach((field) => used.add(field));
  }

  for (const bundle of leftoverOf((field) => field.form === 'Paystub' || field.form === 'WVOE')) {
    const unused = bundle.filter((field) => !used.has(field));
    if (!unused.length) continue;
    if (attachBundle(unused, ['w2'])) continue;
    // A stub that names its employer and matches none of the jobs so far is a
    // separate job. Skipping it whenever any job existed dropped the second
    // employer's pay stub. Only an anonymous stub is left out, since there is
    // nothing to say which job it belongs to.
    const identity = identityFromFields(unused);
    if (!identity.name && !identity.ein && next.some((match) => match.kind === 'w2')) continue;
    next.push(inventMatch(unused, 'w2', pages));
    unused.forEach((field) => used.add(field));
  }

  return next;
}

function normalizeEin(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function einsMatch(left?: string, right?: string): boolean {
  const a = normalizeEin(left);
  const b = normalizeEin(right);
  return a.length === 9 && a === b;
}

export function discoveredIdentityKey(
  match: Pick<LocatedMatch, 'kind' | 'name' | 'ein' | 'entityId' | 'documentId' | 'pageIndex'> &
    Partial<Pick<LocatedMatch, 'personName' | 'borrowerIds'>>,
): string {
  // Two spouses' W-2s from one employer, or two partners' K-1s from one
  // partnership, are separate income: the person is part of the identity.
  const owner = PERSON_KINDS.has(match.kind)
    ? match.borrowerIds?.[0] ?? (match.personName ? personNameTokens(match.personName).join('-') : '')
    : '';
  const kind = owner ? `${match.kind}@${owner}` : match.kind;
  const ein = normalizeEin(match.ein);
  if (ein.length === 9) return `${kind}:ein:${ein}`;
  const name = normalizeBusinessName(match.name ?? '');
  if (name) return `${kind}:name:${name}`;
  return `${kind}:page:${match.documentId ?? ''}::${match.entityId}::${match.pageIndex}`;
}

export function discoveredSelectId(match: LocatedMatch): string {
  return `discovered:${discoveredIdentityKey(match)}`;
}

export function uniqueDiscoveredBusinesses(matches: LocatedMatch[]): LocatedMatch[] {
  const byKey = new Map<string, LocatedMatch>();
  for (const match of matches) {
    const key = discoveredIdentityKey(match);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...match, fields: [...match.fields] });
      continue;
    }
    existing.fields = [...existing.fields, ...match.fields];
    if (!existing.name) existing.name = match.name;
    if (!existing.ein) existing.ein = match.ein;
  }
  return [...byKey.values()];
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
    /name of partnership or s corporation\s+(.+?)(?=\s+employer identification|\s+\d{2}-?\d{7}|$)/i,
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
const FORM_LABEL: Partial<Record<DocKind, string>> = {
  w2: 'W-2',
  paystub: 'Pay stub',
  'schedule-c': 'Schedule C',
  scorp: 'K-1 (1120-S)',
  partnership: 'K-1 (1065)',
};

function documentLabel(match: LocatedMatch): string {
  const form = match.form === 'Paystub' ? 'Pay stub' : match.form === 'WVOE' ? 'WVOE' : FORM_LABEL[match.kind] ?? match.form;
  return `${form}${match.name ? ` from ${match.name}` : ''} (p.${match.pageIndex + 1})`;
}

/**
 * Decide whose document a match is. Borrower-less kinds (a return face, an
 * 1120) stay unassigned here and take the borrower of the 1003 entry that
 * claims them.
 */
function assignBorrower(
  match: LocatedMatch,
  context: {
    pages?: LocatePage[];
    borrowers: LoanBorrower[];
    fromLoan: boolean;
    assignments?: Record<string, string>;
  },
): void {
  const person = personOf(match.fields, context.pages, context.borrowers, match);
  match.personName = person.personName;
  const manual = context.assignments?.[assignmentKey(match)];
  if (manual && context.borrowers.some((borrower) => borrower.id === manual)) {
    match.borrowerIds = [manual];
    match.borrowerStatus = 'matched';
    return;
  }
  if (person.borrowerIds.length) {
    match.borrowerIds = person.borrowerIds;
    match.borrowerStatus = 'matched';
    return;
  }
  match.borrowerIds = [];
  if (!context.borrowers.length || !expectsPerson(match, context.pages)) {
    match.borrowerStatus = 'unknown';
    return;
  }
  if (context.fromLoan) {
    // It prints a person and that person is not on the 1003 (or its name
    // could not be read). Counting it would put a stranger's income on the loan.
    match.borrowerStatus = 'unidentified';
    return;
  }
  if (context.borrowers.length === 1 && !person.personName) {
    match.borrowerIds = [context.borrowers[0].id];
    match.borrowerStatus = 'matched';
    return;
  }
  match.borrowerStatus = 'unknown';
}

function belongsToOther(match: LocatedMatch, entity: UrlAListedEntity): boolean {
  if (!entity.borrowerId || !match.borrowerIds?.length) return false;
  return !match.borrowerIds.includes(entity.borrowerId);
}

export function locateIncomeEntities(options: {
  roster: UrlAListedEntity[];
  fields: MappedIncomeField[];
  pages?: LocatePage[];
  rentals?: LocateRentalExtract[];
  /** Borrowers on the 1003. Without them, the people the documents name are used. */
  borrowers?: LoanBorrower[];
  /** Underwriter's "assign to borrower" choices, keyed by `assignmentKey`. */
  assignments?: Record<string, string>;
}): LocateResult {
  const loanBorrowers = (options.borrowers ?? []).filter((borrower) => borrower.name.trim());
  const fromLoan = loanBorrowers.length > 0;
  const borrowers = fromLoan ? loanBorrowers : borrowersFromDocuments(options.fields);
  const context = { pages: options.pages, borrowers, fromLoan, assignments: options.assignments };
  const warnings: BorrowerWarning[] = [];

  const allGroups = groupFieldsByEntity(options.fields, undefined, options.pages, borrowers);
  allGroups.forEach((group) => assignBorrower(group, context));
  const unidentified = allGroups.filter((group) => group.borrowerStatus === 'unidentified');
  const groups = allGroups.filter((group) => group.borrowerStatus !== 'unidentified');
  const heldOut = (here: { pageIndex: number; form: MappedIncomeField['form']; documentId?: string }) =>
    unidentified.some((item) => samePageForm(item, here) || item.fields.some((field) => samePageForm(field, here)));

  const claimed = new Set<string>();
  const claimedBy = new Map<LocatedMatch, Set<string>>();
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
      if (belongsToOther(group, entity)) continue;
      matches.push(group);
      claimed.add(matchKey(group));
      if (entity.borrowerId) claimedBy.set(group, new Set([...(claimedBy.get(group) ?? []), entity.borrowerId]));
    }

    for (const page of options.pages ?? []) {
      const fromPage = matchFromPage(page, entity);
      if (!fromPage) continue;
      if (matches.some((item) => samePageForm(item, fromPage))) continue;
      if (heldOut(fromPage)) continue;
      const overlapping = groups.find((group) => samePageForm(group, fromPage));
      if (overlapping) {
        if (belongsToOther(overlapping, entity)) continue;
        matches.push(overlapping);
        claimed.add(matchKey(overlapping));
        if (entity.borrowerId) claimedBy.set(overlapping, new Set([...(claimedBy.get(overlapping) ?? []), entity.borrowerId]));
        continue;
      }
      assignBorrower(fromPage, context);
      if (fromPage.borrowerStatus === 'unidentified' || belongsToOther(fromPage, entity)) continue;
      if (entity.borrowerId && !fromPage.borrowerIds?.length) {
        fromPage.borrowerIds = [entity.borrowerId];
        fromPage.borrowerStatus = 'matched';
      }
      matches.push(fromPage);
      claimed.add(matchKey(fromPage));
    }

    matches.sort((a, b) => a.pageIndex - b.pageIndex || a.form.localeCompare(b.form));
    return { entity, located: matches.length > 0, matches };
  });

  // A return or 1120 with no person on it belongs to the one borrower whose
  // 1003 entry claimed it.
  for (const [group, owners] of claimedBy) {
    if (group.borrowerIds?.length || owners.size !== 1) continue;
    group.borrowerIds = [...owners];
    group.borrowerStatus = 'matched';
  }

  const discovered: LocatedMatch[] = groups.filter((group) => !claimed.has(matchKey(group)));
  const covered = [...roster.flatMap((row) => row.matches), ...discovered, ...unidentified];

  for (const page of options.pages ?? []) {
    const form = formFromPageLabels(page.formIds);
    if (!form || !BUSINESS_FORMS.has(form)) continue;
    const here = { pageIndex: page.pageIndex, form, documentId: page.documentId };
    // A return face folded onto its K-1 is covered by that K-1's match even
    // though the match is anchored on the K-1's page.
    if (covered.some((item) => samePageForm(item, here) || item.fields.some((field) => samePageForm(field, here)))) {
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
    assignBorrower(match, context);
    if (match.borrowerStatus === 'unidentified') unidentified.push(match);
    else discovered.push(match);
    covered.push(match);
  }

  for (const rental of options.rentals ?? []) {
    const match = rentalMatch(rental);
    if (claimed.has(matchKey(match))) continue;
    if (discovered.some((item) => matchKey(item) === matchKey(match))) continue;
    discovered.push(match);
  }

  for (const match of unidentified) {
    const who = match.personName ? `names ${match.personName}, who is not a borrower on the 1003` : 'does not name any borrower on the 1003';
    warnings.push({
      code: 'UNIDENTIFIED_BORROWER',
      message: `${documentLabel(match)} ${who}. Its income is left out until it is assigned to a borrower.`,
      assignmentKey: assignmentKey(match),
      documentId: match.documentId,
      pageIndex: match.pageIndex,
      personName: match.personName,
    });
  }
  if (!fromLoan && borrowers.length > 1) {
    warnings.push({
      code: 'UNCONFIRMED_BORROWERS',
      message: `No 1003 is loaded and the documents name ${borrowers.length} people (${borrowers
        .map((borrower) => borrower.name)
        .join(', ')}). Income is split by the person on each document; load the 1003 to confirm who is applying.`,
    });
  }

  return { roster, discovered, borrowers, unidentified, warnings };
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
