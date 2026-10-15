import type { MappedIncomeField } from './parseTypes';
import { uiPayFrequencyFromMismo } from '../../../packages/mortgage-engine/src/paystubMismoMapper';
import { parseStubDate, paystubCoverage } from '../../../packages/mortgage-engine/src/paystubCoverage';

function bySource(fields: MappedIncomeField[], sourceId: string, entityId?: string): MappedIncomeField | undefined {
  return fields.find(
    (field) =>
      (field.sourceFieldId === sourceId || field.id === sourceId) &&
      (entityId == null || field.entityId === entityId),
  );
}

function num(fields: MappedIncomeField[], sourceId: string, entityId?: string): number | undefined {
  const field = bySource(fields, sourceId, entityId);
  if (!field || !Number.isFinite(field.numericValue)) return undefined;
  return field.numericValue;
}

function text(fields: MappedIncomeField[], sourceId: string, entityId?: string): string | undefined {
  const value = bySource(fields, sourceId, entityId)?.value?.trim();
  return value || undefined;
}

export type LiveWagePatch = {
  employerName?: string;
  ein?: string;
  hourlyRate?: number;
  weeklyHours?: number;
  currentPeriodBasePay?: number;
  baseYtd?: number;
  bonusYtd?: number;
  overtimeYtd?: number;
  tipsYtd?: number;
  commissionYtd?: number;
  rsuYtd?: number;
  otherYtd?: number;
  payFrequency?: 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY';
  periodEnd?: string;
  payDate?: string;
  /** Date-derived coverage of the paystub's year-to-date earnings column. */
  ytdMonthsElapsed?: number;
  wvoeBonus?: number;
  wvoeOvertime?: number;
  w2Year1Box5?: number;
  wageDocSource?: 'PAYSTUB' | 'WVOE';
  /** Which wage fields the parser actually located on the document. */
  extractedFieldIds?: string[];
};

export type LivePrevW2Patch = {
  employerName?: string;
  ein?: string;
  box5Wages?: number;
};

export type LiveSchCPatch = {
  businessName?: string;
  ein?: string;
  line31?: number;
  line13?: number;
  line12?: number;
  line24b?: number;
  line30?: number;
  line6?: number;
  line27a?: number;
  line44aMiles?: number;
};

export type LiveCorpPatch = {
  businessName?: string;
  ein?: string;
  ordinaryIncome?: number;
  netRentalRealEstate?: number;
  otherNetRental?: number;
  guaranteedPayments?: number;
  distributions?: number;
  ownershipPct?: number;
  profitPctEnd?: number;
  capitalPctEnd?: number;
  depreciation?: number;
  depreciation1125A?: number;
  depreciation8825?: number;
  gain4797?: number;
  otherIncome?: number;
  mealsM1?: number;
  section179?: number;
  depletion?: number;
};

export type LiveScheduleLPatch = {
  cash?: number;
  receivables?: number;
  taxExempt?: number;
  accountsPayable?: number;
  notesLt1Yr?: number;
  otherCurrentLiab?: number;
  /** Line printed as total current liabilities. Column (d) when the form has that total. */
  currentLiabilities?: number;
};

export type LiveCCorpPatch = {
  businessName?: string;
  ein?: string;
  taxableIncome?: number;
  totalTaxPaid?: number;
  depreciation?: number;
  depletion?: number;
};

export type LiveFarmPatch = {
  businessName?: string;
  ein?: string;
  netFarmProfitLoss?: number;
  depreciation?: number;
  coopCccPayments?: number;
  otherIncome?: number;
  otherExpenses?: number;
};

export type LiveAssetPatch = {
  interestIncome?: number;
  dividendIncome?: number;
  capitalGainsNetLoss?: number;
};

function compact<T extends Record<string, unknown>>(patch: T): T | null {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined && value !== '');
  if (!entries.length) return null;
  return Object.fromEntries(entries) as T;
}

function firstEntity(fields: MappedIncomeField[], sourceId: string): string | undefined {
  return fields.find((field) => field.sourceFieldId === sourceId)?.entityId;
}

function latestPaystubEntity(fields: MappedIncomeField[]): string | undefined {
  const paystub = fields.filter(
    (field) =>
      field.form === 'Paystub' &&
      (field.sourceFieldId === 'ps-current-base' ||
        field.sourceFieldId === 'ps-base-ytd' ||
        field.sourceFieldId === 'ps-hourly-rate' ||
        field.sourceFieldId === 'ps-employer-name'),
  );
  if (!paystub.length) return undefined;
  return paystub.reduce((latest, field) => (field.pageIndex >= latest.pageIndex ? field : latest)).entityId;
}

/** Qualifying W-2 gross is Medicare wages (Box 5), which includes 401(k) and other pre-tax deferrals Box 1 excludes. */
function w2GrossWages(fields: MappedIncomeField[], entityId?: string): number | undefined {
  return num(fields, 'w2-box5', entityId) ?? num(fields, 'w2-box5');
}

export function liveBorrowerName(fields: MappedIncomeField[]): string | undefined {
  return text(fields, 'ps-employee-name') ?? text(fields, 'w2-employee-name');
}

/**
 * Source ids the wage panel reads, so the UI can tell a figure the parser
 * never found from one it read as zero. Without this every unextracted field
 * renders as a confident 0, which is indistinguishable from a verified zero.
 */
const WAGE_SOURCE_IDS = [
  'ps-employer-name',
  'ps-pay-frequency',
  'ps-period-end',
  'ps-pay-date',
  'ps-hourly-rate',
  'ps-hours-week',
  'ps-current-base',
  'ps-base-ytd',
  'ps-bonus-ytd',
  'ps-ot-ytd',
  'ps-tips-ytd',
  'ps-commission-ytd',
  'ps-rsu-ytd',
  'ps-other-ytd',
  'w2-employer-name',
  'w2-employer-ein',
  'w2-box5',
] as const;

export function liveWagePatch(fields: MappedIncomeField[]): LiveWagePatch | null {
  const entityId = firstEntity(fields, 'w2-box5') ?? firstEntity(fields, 'w2-employer-name');
  const paystubEntity = latestPaystubEntity(fields);
  const fromWvoe = fields.some((field) => field.form === 'WVOE');
  const periodEnd = text(fields, 'ps-period-end', paystubEntity);
  const payDate = text(fields, 'ps-pay-date', paystubEntity);
  const payFrequency = uiPayFrequencyFromMismo(text(fields, 'ps-pay-frequency', paystubEntity));
  const periodEndDate = parseStubDate(periodEnd);
  const coverage = periodEndDate
    ? paystubCoverage({ taxYear: periodEndDate.year, periodEnd, payFrequency })
    : null;
  const extractedFieldIds = WAGE_SOURCE_IDS.filter((sourceId) =>
    fields.some((field) => field.sourceFieldId === sourceId),
  );
  return compact({
    extractedFieldIds: extractedFieldIds.length > 0 ? extractedFieldIds : undefined,
    employerName:
      text(fields, 'w2-employer-name', entityId) ??
      text(fields, 'w2-employer-name') ??
      text(fields, 'ps-employer-name', paystubEntity) ??
      text(fields, 'ps-employer-name'),
    ein: text(fields, 'w2-employer-ein', entityId) ?? text(fields, 'w2-employer-ein'),
    hourlyRate: num(fields, 'ps-hourly-rate', paystubEntity) ?? num(fields, 'wvoe-base'),
    weeklyHours: num(fields, 'ps-hours-week', paystubEntity),
    currentPeriodBasePay: num(fields, 'ps-current-base', paystubEntity),
    baseYtd: num(fields, 'ps-base-ytd', paystubEntity),
    bonusYtd: num(fields, 'ps-bonus-ytd', paystubEntity),
    overtimeYtd: num(fields, 'ps-ot-ytd', paystubEntity),
    tipsYtd: num(fields, 'ps-tips-ytd', paystubEntity),
    commissionYtd: num(fields, 'ps-commission-ytd', paystubEntity),
    rsuYtd: num(fields, 'ps-rsu-ytd', paystubEntity),
    otherYtd: num(fields, 'ps-other-ytd', paystubEntity),
    payFrequency,
    periodEnd,
    payDate,
    ytdMonthsElapsed: coverage?.status === 'READY' ? coverage.elapsedMonths ?? undefined : undefined,
    wvoeBonus: num(fields, 'wvoe-bonus'),
    wvoeOvertime: num(fields, 'wvoe-ot'),
    w2Year1Box5: w2GrossWages(fields, entityId),
    wageDocSource: fromWvoe ? 'WVOE' : 'PAYSTUB',
  });
}

export function livePrevW2Patch(fields: MappedIncomeField[]): LivePrevW2Patch | null {
  const wages = fields.filter((field) => field.sourceFieldId === 'w2-box5');
  if (wages.length < 2) return null;
  const second = wages[1];
  return compact({
    employerName: text(fields, 'w2-employer-name', second.entityId),
    ein: text(fields, 'w2-employer-ein', second.entityId),
    box5Wages: second.numericValue,
  });
}

export function groupFieldsByEntityId(
  fields: MappedIncomeField[],
  form?: MappedIncomeField['form'],
): Array<{ entityId: string; fields: MappedIncomeField[] }> {
  const groups = new Map<string, MappedIncomeField[]>();
  for (const field of fields) {
    if (form && field.form !== form) continue;
    const key = field.entityId || `${field.form}-p${field.pageIndex}`;
    const list = groups.get(key) ?? [];
    list.push(field);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([entityId, grouped]) => ({ entityId, fields: grouped }));
}

export function liveSchCPatch(fields: MappedIncomeField[]): LiveSchCPatch | null {
  return compact({
    businessName: text(fields, 'ent1-name'),
    ein: text(fields, 'ent1-ein'),
    line31: num(fields, 'ent1-net'),
    line13: num(fields, 'ent1-dep'),
    line12: num(fields, 'ent1-depletion'),
    line24b: num(fields, 'ent1-meals'),
    line30: num(fields, 'ent1-home'),
    line6: num(fields, 'ent1-other-income'),
    line27a: num(fields, 'ent1-amort'),
    line44aMiles: num(fields, 'ent1-miles'),
  });
}

// Depreciation is summed from the return line, Form 1125-A and Form 8825, so
// each is kept apart when the return line was read. Without it, Form 8825 and
// then Form 4562 stand in for it alone: line 22 of a 4562 can already include
// the rental depreciation, and adding 8825 on top would count it twice.
export function liveSCorpPatch(fields: MappedIncomeField[]): LiveCorpPatch | null {
  return compact({
    businessName: text(fields, 'scorp-name') ?? text(fields, 'scorp-return-name') ?? text(fields, 'form-8825-name'),
    ein: text(fields, 'scorp-ein') ?? text(fields, 'scorp-return-ein') ?? text(fields, 'form-8825-ein'),
    ordinaryIncome: num(fields, 'scorp-ord'),
    netRentalRealEstate: num(fields, 'scorp-rre'),
    otherNetRental: num(fields, 'scorp-onr'),
    distributions: num(fields, 'scorp-dist'),
    ownershipPct: num(fields, 'scorp-own-pct'),
    gain4797: num(fields, 'scorp-return-4797'),
    otherIncome: num(fields, 'scorp-return-other'),
    depreciation: num(fields, 'scorp-return-dep') ?? num(fields, 'form-8825-dep') ?? num(fields, 'form-4562-dep'),
    depreciation8825: num(fields, 'scorp-return-dep') != null ? num(fields, 'form-8825-dep') : undefined,
    mealsM1: num(fields, 'scorp-return-meals'),
    section179: num(fields, 'scorp-179') ?? num(fields, 'form-4562-179'),
    depletion: num(fields, 'scorp-return-depletion') ?? num(fields, 'scorp-depletion'),
  });
}

export function livePartnershipPatch(fields: MappedIncomeField[]): LiveCorpPatch | null {
  return compact({
    businessName: text(fields, 'pt-name') ?? text(fields, 'pt-return-name') ?? text(fields, 'form-8825-name'),
    ein: text(fields, 'pt-ein') ?? text(fields, 'pt-return-ein') ?? text(fields, 'form-8825-ein'),
    ordinaryIncome: num(fields, 'pt-ord'),
    netRentalRealEstate: num(fields, 'pt-rre'),
    otherNetRental: num(fields, 'pt-onr'),
    guaranteedPayments: num(fields, 'pt-gp'),
    distributions: num(fields, 'pt-dist'),
    profitPctEnd: num(fields, 'pt-profit-pct'),
    capitalPctEnd: num(fields, 'pt-capital-pct'),
    gain4797: num(fields, 'pt-return-4797'),
    otherIncome: num(fields, 'pt-return-other'),
    depreciation: num(fields, 'pt-return-dep') ?? num(fields, 'form-8825-dep') ?? num(fields, 'form-4562-dep'),
    // Line 16b. Line 16c holds only what was deducted on line 16 itself, so
    // without this the addback is short by the depreciation that reached line
    // 23 through cost of goods sold.
    depreciation1125A: num(fields, 'pt-return-dep-1125a'),
    depreciation8825: num(fields, 'pt-return-dep') != null ? num(fields, 'form-8825-dep') : undefined,
    mealsM1: num(fields, 'pt-return-meals'),
    section179: num(fields, 'pt-179') ?? num(fields, 'form-4562-179'),
    depletion: num(fields, 'pt-return-depletion') ?? num(fields, 'pt-depletion'),
  });
}

/** A page of the packet as the classifier labelled it. */
export interface ClassifiedPage {
  documentId?: string;
  index: number;
  formIds: string[];
}

/**
 * The label the classifier puts on page 1 of a business return. Only that page
 * carries it: "U.S. Return of Partnership Income" is printed once, so the
 * balance sheet five pages later is labelled `Schedule L` and says nothing
 * about the return it belongs to.
 */
const RETURN_MASTHEAD = /^Form (?:1065|1120S|1120) \(/;

/**
 * Resolve the business return each page was printed in, keyed
 * `${documentId}:${index}`. Pages ahead of the first masthead are left out.
 *
 * Schedule L, M-1 and M-2 are attributed to the nearest masthead before them in
 * the same document, which holds whether each return was uploaded on its own or
 * several were concatenated into one file. Matching on the page's own labels
 * instead never reaches a balance sheet, and falling back to "the only business
 * in the packet" silently gives up as soon as there are two.
 */
export function owningBusinessReturns(pages: ClassifiedPage[]): Map<string, string> {
  const owners = new Map<string, string>();
  const byDocument = new Map<string, ClassifiedPage[]>();
  for (const page of pages) {
    const key = page.documentId ?? '';
    byDocument.set(key, [...(byDocument.get(key) ?? []), page]);
  }
  for (const [documentId, group] of byDocument) {
    let current: string | undefined;
    for (const page of [...group].sort((left, right) => left.index - right.index)) {
      current = page.formIds.find((label) => RETURN_MASTHEAD.test(label)) ?? current;
      if (current) owners.set(`${documentId}:${page.index}`, current);
    }
  }
  return owners;
}

export function liveScheduleLPatch(fields: MappedIncomeField[]): LiveScheduleLPatch | null {
  return compact({
    cash: num(fields, 'sch-l-cash'),
    receivables: num(fields, 'sch-l-ar'),
    taxExempt: num(fields, 'sch-l-securities'),
    accountsPayable: num(fields, 'sch-l-ap'),
    notesLt1Yr: num(fields, 'sch-l-notes'),
    otherCurrentLiab: num(fields, 'sch-l-other-current'),
    currentLiabilities: num(fields, 'sch-l-current-liabilities'),
  });
}

export function liveCCorpPatch(fields: MappedIncomeField[]): LiveCCorpPatch | null {
  return compact({
    businessName: text(fields, 'c1120-name'),
    ein: text(fields, 'c1120-ein'),
    taxableIncome: num(fields, 'c1120-taxable'),
    totalTaxPaid: num(fields, 'c1120-tax'),
    depreciation: num(fields, 'c1120-dep'),
    depletion: num(fields, 'c1120-depletion'),
  });
}

export function liveFarmPatch(fields: MappedIncomeField[]): LiveFarmPatch | null {
  return compact({
    businessName: text(fields, 'schedule-f-name'),
    ein: text(fields, 'schedule-f-ein'),
    netFarmProfitLoss: num(fields, 'schedule-f-net'),
    depreciation: num(fields, 'schedule-f-depreciation'),
    coopCccPayments: num(fields, 'schedule-f-coop-ccc'),
    otherIncome: num(fields, 'schedule-f-other'),
    otherExpenses: num(fields, 'schedule-f-other-expense'),
  });
}

function patchesFor<T extends Record<string, unknown>>(
  fields: MappedIncomeField[],
  form: MappedIncomeField['form'],
  patchFn: (group: MappedIncomeField[]) => T | null,
): Array<T & { entityId: string }> {
  return groupFieldsByEntityId(fields, form).flatMap(({ entityId, fields: group }) => {
    const patch = patchFn(group);
    return patch ? [{ entityId, ...patch }] : [];
  });
}

export function liveWagePatches(fields: MappedIncomeField[]): Array<LiveWagePatch & { entityId: string }> {
  return groupFieldsByEntityId(fields, 'W-2').flatMap(({ entityId, fields: group }) => {
    const patch = liveWagePatch(group);
    return patch ? [{ entityId, ...patch }] : [];
  });
}

export function liveSchCPatches(fields: MappedIncomeField[]): Array<LiveSchCPatch & { entityId: string }> {
  return patchesFor(fields, 'Schedule C', liveSchCPatch);
}

export function liveSCorpPatches(fields: MappedIncomeField[]): Array<LiveCorpPatch & { entityId: string }> {
  return attachEntityDepreciation(patchesFor(fields, 'Form 1120-S', liveSCorpPatch), fields, 'scorp-return-dep');
}

export function livePartnershipPatches(fields: MappedIncomeField[]): Array<LiveCorpPatch & { entityId: string }> {
  return attachEntityDepreciation(patchesFor(fields, 'Form 1065', livePartnershipPatch), fields, 'pt-return-dep');
}

export function liveCCorpPatches(fields: MappedIncomeField[]): Array<LiveCCorpPatch & { entityId: string }> {
  return patchesFor(fields, 'Form 1120', liveCCorpPatch);
}

export function liveFarmPatches(fields: MappedIncomeField[]): Array<LiveFarmPatch & { entityId: string }> {
  return patchesFor(fields, 'Schedule F', liveFarmPatch);
}

function isIdentityCorpPatch(patch: LiveCorpPatch): boolean {
  return (
    Boolean(patch.businessName) ||
    Boolean(patch.ein) ||
    patch.ordinaryIncome != null ||
    patch.netRentalRealEstate != null ||
    patch.otherNetRental != null ||
    patch.guaranteedPayments != null
  );
}

function attachEntityDepreciation(
  patches: Array<LiveCorpPatch & { entityId: string }>,
  fields: MappedIncomeField[],
  returnDepId: string,
): Array<LiveCorpPatch & { entityId: string }> {
  // Form 4562 / 8825 are tagged onto 1120-S or 1065 but live on other pages, so
  // drop depreciation-only groups and fold Line 14 (preferred) or 4562 onto the
  // single remaining K-1 / return entity.
  const entities = patches.filter(isIdentityCorpPatch);
  if (entities.length !== 1) return entities;
  const depreciation8825 = num(fields, 'form-8825-dep');
  const depreciation4562 = num(fields, 'form-4562-dep');
  const returnDep = num(fields, returnDepId);
  const returnLineRead = returnDep != null;
  return entities.map((patch) => ({
    ...patch,
    depreciation: patch.depreciation ?? returnDep ?? depreciation8825 ?? depreciation4562,
    depreciation8825: patch.depreciation8825 ?? (returnLineRead ? depreciation8825 : undefined),
  }));
}

export function liveAssetPatch(fields: MappedIncomeField[]): LiveAssetPatch | null {
  return compact({
    interestIncome: num(fields, 'schedule-b-interest'),
    dividendIncome: num(fields, 'schedule-b-dividends'),
    capitalGainsNetLoss: num(fields, 'schedule-d-capital-gain-loss'),
  });
}
