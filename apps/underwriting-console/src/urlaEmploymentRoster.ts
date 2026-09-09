/**
 * 1003 / URLA employment + REO roster.
 *
 * The loan application is the expected list of businesses, employers, and
 * rental properties. Income documents are searched for those names instead of
 * stopping at the first W-2, K-1, or Schedule C in the packet.
 */

export type UrlAEmploymentClassification = 'Primary' | 'Secondary' | 'Previous' | 'REO';
export type UrlAIncomeKind = 'wages' | 'self-employed' | 'rental';
export type UrlAEntitySource = 'intake' | 'mismo' | 'demo';

export type UrlAEmploymentAnswers = {
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
    (existing) => namesMatch(existing.name, name) && existing.classification === entity.classification,
  );
  if (duplicate) return;
  out.push({
    ...entity,
    name,
    id: uniqueId(used, `urla-${entity.classification.toLowerCase()}-${slug(name)}`),
  });
}

/** Every employer / business / REO listed on a 1003 intake session. */
export function employmentEntitiesFromUrlA(
  answers: UrlAEmploymentAnswers | null | undefined,
  source: UrlAEntitySource = 'intake',
): UrlAListedEntity[] {
  if (!answers) return [];
  const out: UrlAListedEntity[] = [];
  const used = new Set<string>();
  const selfEmployed = answers.employmentType === 'SELF_EMPLOYED';

  pushEntity(out, used, {
    name: answers.employerName ?? '',
    kind: selfEmployed ? 'self-employed' : 'wages',
    classification: 'Primary',
    selfEmployed,
    monthlyIncome: money(answers.monthlyIncome),
    years: selfEmployed ? years(answers.yearsInBusiness) : years(answers.yearsAtJob),
    source,
  });

  if (answers.hasSecondJob) {
    pushEntity(out, used, {
      name: answers.secondEmployer ?? '',
      kind: 'wages',
      classification: 'Secondary',
      selfEmployed: false,
      monthlyIncome: money(answers.secondMonthlyIncome),
      source,
    });
  }

  pushEntity(out, used, {
    name: answers.previousEmployer ?? '',
    kind: 'wages',
    classification: 'Previous',
    selfEmployed: false,
    years: years(answers.previousEmployerYears),
    source,
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

/** Every EMPLOYER (and optional REO address) in a MISMO 3.4 URLA payload. */
export function employmentEntitiesFromMismo(xml: string | null | undefined): UrlAListedEntity[] {
  if (!xml) return [];
  const out: UrlAListedEntity[] = [];
  const used = new Set<string>();

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
    });
  }

  return out;
}

/**
 * Demo 1003 employment list used when no live intake/MISMO file is present.
 * Names match the income workspace demo entities so locate can be exercised.
 */
export const DEMO_URLA_ENTITIES: UrlAListedEntity[] = [
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
];

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
