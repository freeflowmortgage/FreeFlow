/**
 * 1003 / URLA employment + REO roster.
 *
 * The loan application is the expected list of businesses, employers, and
 * rental properties. Income documents are searched for those names instead of
 * stopping at the first W-2, K-1, or Schedule C in the packet.
 */

import { borrowerIdAt, PRIMARY_BORROWER_ID, type LoanBorrower } from './borrowers';

export type UrlAEmploymentClassification = 'Primary' | 'Secondary' | 'Previous' | 'REO';
export type UrlAIncomeKind = 'wages' | 'self-employed' | 'rental';
export type UrlAEntitySource = 'intake' | 'mismo' | 'demo';

type UrlABorrowerEmployment = {
  employmentType?: 'W2' | 'SELF_EMPLOYED';
  employerName?: string;
  yearsAtJob?: string;
  yearsInBusiness?: string;
  monthlyIncome?: string;
  hasSecondJob?: boolean;
  secondEmployer?: string;
  secondMonthlyIncome?: string;
  previousEmployer?: string;
  previousEmployerYears?: string;
};

export type UrlAEmploymentAnswers = {
  borrowerName?: string;
  hasCoborrower?: boolean;
  coborrowerName?: string;
  coborrowers?: Array<UrlABorrowerEmployment & { name?: string }>;
  employmentType?: 'W2' | 'SELF_EMPLOYED';
  employerName?: string;
  yearsAtJob?: string;
  yearsInBusiness?: string;
  monthlyIncome?: string;
  hasSecondJob?: boolean;
  secondEmployer?: string;
  secondMonthlyIncome?: string;
  previousEmployer?: string;
  previousEmployerYears?: string;
  ownsOtherRE?: boolean;
  otherReAddress?: string;
};

export type UrlAListedEntity = {
  id: string;
  name: string;
  ein?: string;
  kind: UrlAIncomeKind;
  classification: UrlAEmploymentClassification;
  selfEmployed: boolean;
  monthlyIncome?: number;
  years?: number;
  source: UrlAEntitySource;
  /** The borrower this employer or business belongs to. Unset for REO, which is held jointly. */
  borrowerId?: string;
  borrowerName?: string;
};

const LEGAL_SUFFIX =
  /\b(l\.?l\.?c\.?|inc(?:orporated)?|l\.?l\.?p\.?|l\.?p\.?|corp(?:oration)?|company|co|ltd|p\.?c\.?|p\.?l\.?l\.?c\.?)\b/gi;

export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function namesMatch(left: string, right: string): boolean {
  const a = normalizeBusinessName(left);
  const b = normalizeBusinessName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function money(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function years(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function slug(name: string): string {
  return normalizeBusinessName(name).replace(/\s+/g, '-').slice(0, 40) || 'entity';
}

function uniqueId(used: Set<string>, base: string): string {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function pushEntity(
  out: UrlAListedEntity[],
  used: Set<string>,
  entity: Omit<UrlAListedEntity, 'id'>,
): void {
  const name = entity.name.trim();
  if (!name) return;
  const duplicate = out.some(
    (existing) =>
      namesMatch(existing.name, name) &&
      existing.classification === entity.classification &&
      existing.borrowerId === entity.borrowerId,
  );
  if (duplicate) return;
  // The primary borrower keeps the original ids so saved choices still apply.
  const owner = entity.borrowerId && entity.borrowerId !== PRIMARY_BORROWER_ID ? `${entity.borrowerId}-` : '';
  out.push({
    ...entity,
    name,
    id: uniqueId(used, `urla-${owner}${entity.classification.toLowerCase()}-${slug(name)}`),
  });
}

function coborrowerEntries(answers: UrlAEmploymentAnswers): Array<UrlABorrowerEmployment & { name?: string }> {
  if (answers.hasCoborrower === false) return [];
  if (answers.coborrowers?.length) return answers.coborrowers;
  if (answers.hasCoborrower && answers.coborrowerName?.trim()) return [{ name: answers.coborrowerName.trim() }];
  return [];
}

/** Everyone applying on the 1003, primary borrower first. */
export function borrowersFromUrlA(answers: UrlAEmploymentAnswers | null | undefined): LoanBorrower[] {
  if (!answers) return [];
  const out: LoanBorrower[] = [];
  if (answers.borrowerName?.trim()) {
    out.push({ id: PRIMARY_BORROWER_ID, name: answers.borrowerName.trim(), role: 'Borrower' });
  }
  coborrowerEntries(answers).forEach((coborrower, index) => {
    if (!coborrower.name?.trim()) return;
    out.push({ id: borrowerIdAt(index + 1), name: coborrower.name.trim(), role: 'CoBorrower' });
  });
  return out;
}

function pushEmployment(
  out: UrlAListedEntity[],
  used: Set<string>,
  employment: UrlABorrowerEmployment,
  owner: { borrowerId?: string; borrowerName?: string },
  source: UrlAEntitySource,
): void {
  const selfEmployed = employment.employmentType === 'SELF_EMPLOYED';
  pushEntity(out, used, {
    name: employment.employerName ?? '',
    kind: selfEmployed ? 'self-employed' : 'wages',
    classification: 'Primary',
    selfEmployed,
    monthlyIncome: money(employment.monthlyIncome),
    years: selfEmployed ? years(employment.yearsInBusiness) : years(employment.yearsAtJob),
    source,
    ...owner,
  });

  if (employment.hasSecondJob) {
    pushEntity(out, used, {
      name: employment.secondEmployer ?? '',
      kind: 'wages',
      classification: 'Secondary',
      selfEmployed: false,
      monthlyIncome: money(employment.secondMonthlyIncome),
      source,
      ...owner,
    });
  }

  pushEntity(out, used, {
    name: employment.previousEmployer ?? '',
    kind: 'wages',
    classification: 'Previous',
    selfEmployed: false,
    years: years(employment.previousEmployerYears),
    source,
    ...owner,
  });
}

/** Every employer / business / REO listed on a 1003 intake session, for every borrower on it. */
export function employmentEntitiesFromUrlA(
  answers: UrlAEmploymentAnswers | null | undefined,
  source: UrlAEntitySource = 'intake',
): UrlAListedEntity[] {
  if (!answers) return [];
  const out: UrlAListedEntity[] = [];
  const used = new Set<string>();
  const borrowers = borrowersFromUrlA(answers);
  const primary = borrowers.find((borrower) => borrower.id === PRIMARY_BORROWER_ID);

  pushEmployment(out, used, answers, { borrowerId: PRIMARY_BORROWER_ID, borrowerName: primary?.name }, source);
  coborrowerEntries(answers).forEach((coborrower, index) => {
    const borrowerId = borrowerIdAt(index + 1);
    pushEmployment(out, used, coborrower, { borrowerId, borrowerName: coborrower.name?.trim() || undefined }, source);
  });

  if (answers.ownsOtherRE) {
    pushEntity(out, used, {
      name: answers.otherReAddress ?? '',
      kind: 'rental',
      classification: 'REO',
      selfEmployed: false,
      source,
    });
  }

  return out;
}

function xmlText(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  const value = match?.[1]?.trim();
  return value || undefined;
}

function xmlFlag(block: string, tag: string): boolean {
  return /true|1|yes/i.test(xmlText(block, tag) ?? '');
}

function partyName(block: string): string | undefined {
  const individual = block.match(/<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/i)?.[1] ?? '';
  const full = xmlText(individual, 'FullName');
  if (full) return full;
  const parts = ['FirstName', 'MiddleName', 'LastName'].map((tag) => xmlText(individual, tag)).filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

function borrowerParties(xml: string): Array<{ name?: string; block: string }> {
  return [...xml.matchAll(/<PARTY\b[^>]*>([\s\S]*?)<\/PARTY>/gi)]
    .map((match) => match[1])
    .filter((block) => /<PartyRoleType>\s*Borrower\s*<\/PartyRoleType>/i.test(block))
    .map((block) => ({ name: partyName(block), block }));
}

/** Every borrower PARTY in a MISMO 3.4 URLA payload, in file order. */
export function borrowersFromMismo(xml: string | null | undefined): LoanBorrower[] {
  if (!xml) return [];
  return borrowerParties(xml)
    .filter((party) => party.name)
    .map((party, index) => ({
      id: borrowerIdAt(index),
      name: party.name!,
      role: index === 0 ? 'Borrower' : 'CoBorrower',
    }));
}

function pushMismoEmployers(
  out: UrlAListedEntity[],
  used: Set<string>,
  xml: string,
  owner: { borrowerId?: string; borrowerName?: string },
): void {
  for (const match of xml.matchAll(/<EMPLOYER>([\s\S]*?)<\/EMPLOYER>/gi)) {
    const block = match[1];
    const name = xmlText(block, 'FullName');
    if (!name) continue;
    const classificationRaw = xmlText(block, 'EmploymentClassificationType') ?? 'Primary';
    const classification: UrlAEmploymentClassification =
      /secondary/i.test(classificationRaw) ? 'Secondary' : /previous|prior/i.test(classificationRaw) ? 'Previous' : 'Primary';
    const selfEmployed = xmlFlag(block, 'EmploymentBorrowerSelfEmployedIndicator');
    pushEntity(out, used, {
      name,
      kind: selfEmployed ? 'self-employed' : 'wages',
      classification,
      selfEmployed,
      monthlyIncome: money(xmlText(block, 'EmploymentMonthlyIncomeAmount')),
      years: years(xmlText(block, 'EmploymentTimeInLineOfWorkYearsCount')),
      source: 'mismo',
      ...owner,
    });
  }
}

/** Every EMPLOYER in a MISMO 3.4 URLA payload, tagged with the borrower PARTY it sits under. */
export function employmentEntitiesFromMismo(xml: string | null | undefined): UrlAListedEntity[] {
  if (!xml) return [];
  const out: UrlAListedEntity[] = [];
  const used = new Set<string>();
  const parties = borrowerParties(xml);
  if (!parties.some((party) => /<EMPLOYER>/i.test(party.block))) {
    pushMismoEmployers(out, used, xml, {});
    return out;
  }
  parties.forEach((party, index) => {
    pushMismoEmployers(out, used, party.block, { borrowerId: borrowerIdAt(index), borrowerName: party.name });
  });
  return out;
}

/**
 * Demo 1003 employment list used when no live intake/MISMO file is present.
 * Names match the income workspace demo entities so locate can be exercised.
 */
export const DEMO_URLA_ENTITIES: UrlAListedEntity[] = ([
  {
    id: 'urla-primary-apex-technology-partners',
    name: 'Apex Technology Partners LLC',
    ein: '74-1234567',
    kind: 'wages',
    classification: 'Primary',
    selfEmployed: false,
    source: 'demo',
  },
  {
    id: 'urla-secondary-meridian-health-systems',
    name: 'Meridian Health Systems',
    ein: '52-7654321',
    kind: 'wages',
    classification: 'Secondary',
    selfEmployed: false,
    source: 'demo',
  },
  {
    id: 'urla-previous-digital-solutions',
    name: 'Digital Solutions Corp',
    ein: '94-8765432',
    kind: 'wages',
    classification: 'Previous',
    selfEmployed: false,
    source: 'demo',
  },
  {
    id: 'urla-primary-vance-technology',
    name: 'Vance Technology Consulting',
    kind: 'self-employed',
    classification: 'Primary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-secondary-vance-design',
    name: 'Vance Design Studio',
    kind: 'self-employed',
    classification: 'Secondary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-secondary-apex-advisory',
    name: 'Apex Advisory Holdings',
    ein: '74-9876543',
    kind: 'self-employed',
    classification: 'Secondary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-secondary-horizon-property',
    name: 'Horizon Property Partners',
    ein: '52-2468101',
    kind: 'self-employed',
    classification: 'Secondary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-secondary-summit-manufacturing',
    name: 'Summit Manufacturing Inc',
    ein: '36-5551212',
    kind: 'self-employed',
    classification: 'Secondary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-secondary-vance-family-farm',
    name: 'Vance Family Farm',
    ein: '74-1122334',
    kind: 'self-employed',
    classification: 'Secondary',
    selfEmployed: true,
    source: 'demo',
  },
  {
    id: 'urla-reo-742-evergreen-terrace',
    name: '742 Evergreen Terrace, Springfield, IL',
    kind: 'rental',
    classification: 'REO',
    selfEmployed: false,
    source: 'demo',
  },
] satisfies UrlAListedEntity[]).map((entity): UrlAListedEntity =>
  entity.kind === 'rental' ? entity : { ...entity, borrowerId: PRIMARY_BORROWER_ID, borrowerName: 'Sarah K. Vance' },
);

/** The demo file has one borrower. */
export const DEMO_BORROWERS: LoanBorrower[] = [{ id: PRIMARY_BORROWER_ID, name: 'Sarah K. Vance', role: 'Borrower' }];

export function resolveUrlARoster(options: {
  answers?: UrlAEmploymentAnswers | null;
  mismoXml?: string | null;
  fallbackToDemo?: boolean;
}): UrlAListedEntity[] {
  const fromAnswers = employmentEntitiesFromUrlA(options.answers);
  if (fromAnswers.length) return fromAnswers;
  const fromMismo = employmentEntitiesFromMismo(options.mismoXml);
  if (fromMismo.length) return fromMismo;
  return options.fallbackToDemo ? DEMO_URLA_ENTITIES : [];
}
