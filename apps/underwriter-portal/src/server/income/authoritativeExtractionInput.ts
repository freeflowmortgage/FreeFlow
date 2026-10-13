import { z } from 'zod';
import {
  annualizePaystub,
  annualizeWvoe,
  elapsedMonthsAgree,
  parsePayFrequency,
  parseWvoeBasePayPeriod,
  parseWvoePayCycle,
  paystubCoverage,
  type PayFrequency,
  type PaystubBaseMethod,
  type UnifiedIncomeCalculationPayload,
  type WvoeBaseMethod,
  type WvoeVariableMethod,
} from '@mortgage-pos/mortgage-engine';

const money = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const year = z.number().int().min(1990).max(2100);
const text = z.string().trim().min(1).max(255);
const entityId = z.string().trim().min(1).max(160);
const employmentRole = z.enum(['CURRENT', 'CONCURRENT', 'PRIOR', 'PRIMARY', 'SECONDARY']);

const w2 = z.object({
  entityId, employerName: text, ein: z.string().max(20).optional(),
  role: employmentRole, year,
  monthsWorked: z.number().int().min(1).max(12).optional(), annualIncome: money.optional(),
  annualWages: money.optional(), annualBaseIncome: money.optional(), annualVariableIncome: money.optional(),
  annualOvertimeIncome: money.optional(), annualBonusIncome: money.optional(), annualCommissionIncome: money.optional(),
  annualTipsIncome: money.optional(), annualRsuIncome: money.optional(), annualOtherIncome: money.optional(),
  baseIncome: money.optional(), variableIncome: money.optional(),
}).strict();
const scheduleC = z.object({
  entityId: entityId.optional(), businessName: text.optional(), ein: z.string().max(20).optional(), year,
  monthsInBusiness: z.number().int().min(1).max(12).optional(), netProfitLoss: money,
  depreciation: money.optional(), depletion: money.optional(), businessUseOfHome: money.optional(),
  mealsExclusion: money.optional(), nonrecurringOtherIncomeLoss: money.optional(), amortizationCasualtyLoss: money.optional(),
}).strict();
const scheduleF = z.object({
  entityId, businessName: text, ein: z.string().max(20).optional(), year,
  monthsInBusiness: z.number().int().min(1).max(12).optional(), netFarmProfitLoss: money,
  nonTaxPortionOngoingCoopAndCccPayments: money.optional(), nonrecurringOtherIncomeLoss: money.optional(),
  depreciation: money.optional(), amortizationCasualtyLossDepletion: money.optional(), businessUseOfHome: money.optional(),
}).strict();
const scheduleL = z.object({
  cash: money.optional(), securities: money.optional(), accountsReceivable: money.optional(), allowanceForBadDebts: money.optional(),
  taxExemptSecurities: money.optional(), otherCurrentAssets: money.optional(), accountsPayable: money.optional(),
  notesPayableLt1Yr: money.optional(), otherCurrentLiabilities: money.optional(), currentLiabilities: money.optional(),
}).strict();
const form1120S = z.object({
  entityId: entityId.optional(), businessName: text.optional(), ein: z.string().max(20).optional(), year,
  monthsInBusiness: z.number().int().min(1).max(12).optional(), ownershipPercentage: money,
  w2WagesFromBusiness: money.optional(), k1OrdinaryIncome: money.optional(), k1NetRentalRealEstate: money.optional(),
  k1OtherNetRentalIncome: money.optional(), gain4797: money.optional(), otherIncome: money.optional(),
  depreciation: money.optional(), depletion: money.optional(), amortization: money.optional(), mealsExclusion: money.optional(),
  k1Distributions: money.optional(), hasStableDistributions: z.boolean().optional(), scheduleL: scheduleL.optional(),
}).strict();
const form1120 = z.object({
  entityId: entityId.optional(), businessName: text.optional(), ein: z.string().max(20).optional(), year,
  monthsInBusiness: z.number().int().min(1).max(12).optional(), ownershipPercentage: money,
  w2WagesFromCorporate: money.optional(), taxableIncome: money, totalTaxPaid: money.optional(),
  depreciation: money.optional(), depletion: money.optional(), amortization: money.optional(),
  mealsExclusion: money.optional(), nolAndSpecialDeductions: money.optional(),
  cash: money.optional(), securities: money.optional(), accountsReceivable: money.optional(),
  currentLiabilities: money.optional(), borrowerDividendsReceived: money.optional(),
}).strict();
const form1065 = z.object({
  entityId: entityId.optional(), businessName: text.optional(), ein: z.string().max(20).optional(), year,
  monthsInBusiness: z.number().int().min(1).max(12).optional(), ownershipPercentage: money,
  profitPercentageEnd: money.optional(), capitalPercentageEnd: money.optional(), k1OrdinaryIncome: money.optional(),
  k1NetRentalRealEstate: money.optional(), k1OtherNetRentalIncome: money.optional(), k1GuaranteedPayments: money.optional(),
  gain4797: money.optional(), otherIncome: money.optional(), depreciation: money.optional(), depletion: money.optional(),
  amortization: money.optional(), mealsExclusion: money.optional(), k1Distributions: money.optional(),
  hasStableDistributions: z.boolean().optional(), scheduleL: scheduleL.optional(),
}).strict();
const benefits = z.object({
  year, totalSocialSecurity: money.optional(), taxableSocialSecurity: money.optional(),
  isSupplementalSecurityIncome: z.boolean().optional(), totalPensionsAndAnnuities: money.optional(),
  taxablePensionsAndAnnuities: money.optional(), isNonGovernmentPension: z.boolean().optional(), vaDisabilityMonthly: money.optional(),
}).strict();
const assets = z.object({
  entityId: entityId.optional(), year, interestIncome: money.optional(), dividendIncome: money.optional(), capitalGainsNetLoss: money.optional(),
  includeInQualifyingIncome: z.boolean().optional(), hasThreeYearAssetSupport: z.boolean().optional(),
}).strict();
const trusts = z.object({ year, trustIncome: money.optional(), hasThreeYearTrustContinuance: z.boolean().optional() }).strict();
const scheduleE = z.object({
  entityId: entityId.optional(), year, propertyAddress: text, propertyType: z.enum(['RENTAL', 'ROYALTY']), rentsReceived: money.optional(),
  royaltiesReceived: money.optional(), insurance: money.optional(), mortgageInterest: money.optional(), taxes: money.optional(),
  depreciation: money.optional(), depletion: money.optional(), hoaDues: money.optional(), totalExpenses: money.optional(),
  netIncomeLoss: money.optional(), extraordinaryAddBack: money.optional(), hasThreeYearRoyaltyContinuance: z.boolean().optional(),
  isMultiFamilySubjectToFhaDecline: z.boolean().optional(), fairRentalDays: z.number().int().min(0).max(366).optional(),
  fairRentalDaysOverride: z.number().int().min(0).max(366).optional(),
}).strict();

const extractionInput = z.object({
  gseInvestor: z.enum(['FNMA', 'FREDDIE']).optional(),
  w2Employers: z.array(w2).max(100).optional(), scheduleC: z.array(scheduleC).max(100).optional(),
  scheduleF: z.array(scheduleF).max(100).optional(),   form1120S: z.array(form1120S).max(100).optional(), form1120: z.array(form1120).max(100).optional(),
  form1065: z.array(form1065).max(100).optional(), benefits: z.array(benefits).max(100).optional(),
  assets: z.array(assets).max(100).optional(), trusts: z.array(trusts).max(100).optional(),
  scheduleEProperties: z.array(scheduleE).max(300).optional(),
}).strict();

const persistedW2 = w2.omit({ role: true }).extend({
  pageIndex: z.number().int().min(0).max(10_000).optional(),
  box1Wages: money.optional(),
  box5Wages: money.optional(),
}).strict();
const persistedScheduleE = scheduleE.extend({
  pageIndex: z.number().int().min(0).max(10_000).optional(),
  column: z.enum(['A', 'B', 'C']).optional(),
}).strict();
const persistedField = z.object({
  sourceFieldId: z.string().trim().min(1).max(100), value: z.string().max(255).optional(), numericValue: money.optional(),
}).strict();
const persistedFormRecord = z.object({
  entityId, form: z.enum(['Schedule C', 'Schedule F', 'Form 1120-S', 'Form 1065', 'Form 1120', 'Form 1040', 'Schedule B', 'Schedule D', 'Paystub', 'WVOE']),
  pageIndex: z.number().int().min(0).max(10_000), fields: z.array(persistedField).min(1).max(100),
}).strict();
const persistedExtractionInput = z.object({
  gseInvestor: z.enum(['FNMA', 'FREDDIE']).optional(),
  w2Records: z.array(persistedW2).max(100).optional(),
  formRecords: z.array(persistedFormRecord).max(2_000).optional(),
  scheduleEProperties: z.array(persistedScheduleE).max(300).optional(),
}).strict();

export type ExtractionMetadataAssignment = Readonly<{
  entityId: string;
  taxYear?: number;
  employmentRole?: z.infer<typeof employmentRole>;
  ownershipPercentage?: number;
  borrowerKey?: string;
  elapsedMonths?: number;
  payFrequency?: PayFrequency;
  baseIncomeMethod?: PaystubBaseMethod;
  wvoeBaseMethod?: WvoeBaseMethod;
  wvoeVariableMethod?: WvoeVariableMethod;
  includeInQualifyingIncome?: boolean;
  hasThreeYearAssetSupport?: boolean;
  hasStableDistributions?: boolean;
  cash?: number;
  currentLiabilities?: number;
}>;
export type ExtractionMetadataRequirement = Readonly<{
  extractionId: string;
  entityId: string;
  field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation' | 'borrowerAssignment' | 'assetElection' | 'elapsedMonths' | 'payFrequency' | 'baseIncomeMethod';
  form: string;
}>;

export class ExtractionMetadataRequiredError extends Error {
  constructor(readonly requirements: readonly ExtractionMetadataRequirement[]) {
    super('Authoritative extraction metadata or parser fields are required.');
  }
}

type ExtractionInput = z.infer<typeof extractionInput>;

const BORROWER_KEY = /^borrower-[1-9][0-9]{0,2}$/;

export function mergeAuthoritativeExtractionInputs(
  records: ReadonlyArray<Readonly<{
    extractionId: string;
    normalizedInput: unknown;
    metadataAssignments?: readonly ExtractionMetadataAssignment[];
  }>>,
  options: Readonly<{ borrowerRoster?: readonly string[] }> = {},
): Omit<UnifiedIncomeCalculationPayload, 'loanProgram'> {
  const merged: Record<string, unknown[]> = {};
  const requirements: ExtractionMetadataRequirement[] = [];
  let gseInvestor: 'FNMA' | 'FREDDIE' | undefined;
  for (const record of records) {
    const persisted = persistedExtractionInput.safeParse(record.normalizedInput);
    const input = persisted.success
      ? projectPersistedInput(record.extractionId, persisted.data, record.metadataAssignments ?? [], requirements, options.borrowerRoster ?? [], priorW2WageLookup(records))
      : extractionInput.parse(record.normalizedInput) as ExtractionInput;
    if (input.gseInvestor) {
      if (gseInvestor && gseInvestor !== input.gseInvestor) throw new Error('Conflicting persisted GSE investor values.');
      gseInvestor = input.gseInvestor;
    }
    for (const [key, value] of Object.entries(input)) {
      if (key === 'gseInvestor' || !Array.isArray(value)) continue;
      const namespaced = value.map((entry) => namespaceEntity(entry, record.extractionId));
      merged[key] = [...(merged[key] ?? []), ...namespaced];
    }
  }
  if (requirements.length) {
    // A requirement names a fact the reviewer has to supply, so naming it
    // twice says nothing more than naming it once.
    const seen = new Set<string>();
    const unique = requirements.filter((item) => {
      const key = `${item.extractionId}:${item.entityId}:${item.field}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
    throw new ExtractionMetadataRequiredError(unique.sort((a, b) =>
      `${a.extractionId}:${a.entityId}:${a.field}`.localeCompare(`${b.extractionId}:${b.entityId}:${b.field}`)));
  }
  return {
    ...(gseInvestor ? { gseInvestor } : {}),
    ...Object.fromEntries(Object.entries(merged).map(([key, values]) => [key, sortEntries(values)])),
  } as Omit<UnifiedIncomeCalculationPayload, 'loanProgram'>;
}

export function namespacedBorrowerKeys(
  records: ReadonlyArray<Readonly<{
    extractionId: string;
    metadataAssignments?: readonly ExtractionMetadataAssignment[];
  }>>,
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const record of records) {
    for (const assignment of record.metadataAssignments ?? []) {
      if (assignment.borrowerKey && BORROWER_KEY.test(assignment.borrowerKey)) {
        keys.set(`${record.extractionId}:${assignment.entityId}`, assignment.borrowerKey);
      }
    }
  }
  return keys;
}

function projectPersistedInput(
  extractionId: string,
  persisted: z.infer<typeof persistedExtractionInput>,
  assignments: readonly ExtractionMetadataAssignment[],
  requirements: ExtractionMetadataRequirement[],
  borrowerRoster: readonly string[],
  priorW2Wages: (borrowerKey: string | undefined, employerKey: string) => number | undefined,
): ExtractionInput {
  const metadata = new Map(assignments.map((item) => [item.entityId, item]));
  const projected: Record<string, unknown> = {};
  if (persisted.gseInvestor) projected.gseInvestor = persisted.gseInvestor;
  const requireBorrower = borrowerRoster.length >= 2;
  const roster = new Set(borrowerRoster);
  if (persisted.scheduleEProperties?.length) {
    projected.scheduleEProperties = persisted.scheduleEProperties.map((property, index) => {
      const propertyEntityId = `schedule-e-${index}`;
      if (requireBorrower && !roster.has(metadata.get(propertyEntityId)?.borrowerKey ?? '')) {
        requirements.push({ extractionId, entityId: propertyEntityId, field: 'borrowerAssignment', form: 'Schedule E' });
      }
      const { pageIndex: _pageIndex, column: _column, ...calculationProperty } = property;
      return { ...calculationProperty, entityId: propertyEntityId };
    });
  }
  for (const row of persisted.w2Records ?? []) {
    const assignment = metadata.get(row.entityId);
    const role = assignment?.employmentRole;
    const authoritativeBox5 = typeof row.box5Wages === 'number' && row.box5Wages > 0 ? row.box5Wages : undefined;
    if (authoritativeBox5 === undefined) {
      requirements.push({ extractionId, entityId: row.entityId, field: 'requiredParserField', form: 'W-2' });
    }
    if (!role) requirements.push({ extractionId, entityId: row.entityId, field: 'employmentRole', form: 'W-2' });
    if (requireBorrower && (!assignment?.borrowerKey || !roster.has(assignment.borrowerKey))) {
      requirements.push({ extractionId, entityId: row.entityId, field: 'borrowerAssignment', form: 'W-2' });
    }
    if (authoritativeBox5 === undefined || !role || (requireBorrower && (!assignment?.borrowerKey || !roster.has(assignment.borrowerKey)))) continue;
    const { pageIndex: _pageIndex, annualWages: _annualWages, box1Wages: _box1Wages, box5Wages: _box5Wages, ...calculationRow } = row;
    push(projected, 'w2Employers', { ...calculationRow, annualWages: authoritativeBox5, role });
  }
  for (const record of persisted.formRecords ?? []) {
    if (record.form === 'Paystub') {
      projectPaystub(extractionId, record, metadata, requirements, requireBorrower, roster, priorW2Wages, projected);
      continue;
    }
    if (record.form === 'WVOE') {
      projectWvoe(extractionId, record, metadata, requirements, requireBorrower, roster, projected);
      continue;
    }
    const meta = metadata.get(record.entityId);
    const borrowerBlocked = requireBorrower && (!meta?.borrowerKey || !roster.has(meta.borrowerKey));
    let blocked = false;
    if (borrowerBlocked) {
      requirements.push({ extractionId, entityId: record.entityId, field: 'borrowerAssignment', form: record.form });
      blocked = true;
    }
    if (!meta?.taxYear) {
      requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
      blocked = true;
    }
    if (blocked || !meta?.taxYear) continue;
    const fields = new Map(record.fields.map((field) => [field.sourceFieldId, field]));
    const n = (id: string) => fields.get(id)?.numericValue;
    const t = (id: string) => fields.get(id)?.value;
    const base = { entityId: record.entityId, year: meta.taxYear };
    if (record.form === 'Schedule C') {
      if (n('ent1-net') === undefined) { requireParserField(requirements, extractionId, record); continue; }
      push(projected, 'scheduleC', compact({ ...base, businessName: t('ent1-name'), ein: t('ent1-ein'), netProfitLoss: n('ent1-net'), depreciation: n('ent1-dep'), depletion: n('ent1-depletion'), mealsExclusion: n('ent1-meals'), businessUseOfHome: n('ent1-home'), nonrecurringOtherIncomeLoss: n('ent1-other-income'), amortizationCasualtyLoss: n('ent1-amort') }));
    } else if (record.form === 'Schedule F') {
      if (!t('schedule-f-name') || n('schedule-f-net') === undefined) { requireParserField(requirements, extractionId, record); continue; }
      push(projected, 'scheduleF', compact({ ...base, businessName: t('schedule-f-name'), ein: t('schedule-f-ein'), netFarmProfitLoss: n('schedule-f-net'), nonTaxPortionOngoingCoopAndCccPayments: n('schedule-f-coop-ccc'), nonrecurringOtherIncomeLoss: n('schedule-f-other'), depreciation: n('schedule-f-depreciation'), amortizationCasualtyLossDepletion: n('schedule-f-amort'), businessUseOfHome: n('schedule-f-home') }));
    } else if (record.form === 'Form 1120-S') {
      if (!hasAny(fields, S_CORP_K1_INCOME_FIELD_IDS)) {
        // Return pages persist scorp-return-* lines as evidence for the K-1.
        // They are not an independent borrower income calculation row.
        if (isSCorpReturnEvidenceOnly(record.fields) || isScheduleLEvidenceOnly(record.fields)) continue;
        requireParserField(requirements, extractionId, record);
        continue;
      }
      const ownership = n('scorp-own-pct') ?? meta.ownershipPercentage;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1120S', compact({ ...base, businessName: t('scorp-name'), ein: t('scorp-ein'), ownershipPercentage: ownership, k1OrdinaryIncome: n('scorp-ord'), k1NetRentalRealEstate: n('scorp-rre'), k1OtherNetRentalIncome: n('scorp-onr'), k1Distributions: n('scorp-dist'), depletion: n('scorp-depletion'), mealsExclusion: n('scorp-meals'), hasStableDistributions: meta.hasStableDistributions, scheduleL: scheduleLFor(persisted.formRecords ?? [], 'Form 1120-S') }));
    } else if (record.form === 'Form 1065') {
      if (!hasAny(fields, PARTNERSHIP_K1_INCOME_FIELD_IDS)) {
        // Return pages persist entity-level pt-return-* lines on their own formRecord.
        // They are evidence for the K-1 extraction, not a calc row, and must not fail-close.
        if (isPartnershipReturnEvidenceOnly(record.fields) || isScheduleLEvidenceOnly(record.fields)) continue;
        requireParserField(requirements, extractionId, record);
        continue;
      }
      const profit = n('pt-profit-pct'); const capital = n('pt-capital-pct');
      const ownership = meta.ownershipPercentage ?? profit ?? capital;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1065', compact({ ...base, businessName: t('pt-name'), ein: t('pt-ein'), ownershipPercentage: ownership, profitPercentageEnd: profit, capitalPercentageEnd: capital, k1OrdinaryIncome: n('pt-ord'), k1NetRentalRealEstate: n('pt-rre'), k1OtherNetRentalIncome: n('pt-onr'), k1GuaranteedPayments: n('pt-gp'), k1Distributions: n('pt-dist'), depletion: n('pt-depletion'), mealsExclusion: n('pt-meals'), hasStableDistributions: meta.hasStableDistributions, scheduleL: scheduleLFor(persisted.formRecords ?? [], 'Form 1065') }));
    } else if (record.form === 'Form 1120') {
      if (n('c1120-taxable') === undefined) { requireParserField(requirements, extractionId, record); continue; }
      if (meta.ownershipPercentage === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1120', compact({ ...base, businessName: t('c1120-name'), ein: t('c1120-ein'), ownershipPercentage: meta.ownershipPercentage, taxableIncome: n('c1120-taxable'), totalTaxPaid: n('c1120-tax'), depreciation: n('c1120-dep'), depletion: n('c1120-depletion'), amortization: n('c1120-amort'), mealsExclusion: n('c1120-meals'), nolAndSpecialDeductions: n('c1120-nol'), cash: meta.cash, currentLiabilities: meta.currentLiabilities }));
    } else if (record.form === 'Form 1040') {
      if (!hasAny(fields, ['f1040-ss-total', 'f1040-ss-taxable', 'f1040-pensions-total', 'f1040-pensions-taxable'])) { requireParserField(requirements, extractionId, record); continue; }
      push(projected, 'benefits', compact({ year: meta.taxYear, totalSocialSecurity: n('f1040-ss-total'), taxableSocialSecurity: n('f1040-ss-taxable'), totalPensionsAndAnnuities: n('f1040-pensions-total'), taxablePensionsAndAnnuities: n('f1040-pensions-taxable') }));
    } else {
      if (!hasAny(fields, ['schedule-b-interest', 'schedule-b-dividends', 'schedule-d-capital-gain-loss'])) { requireParserField(requirements, extractionId, record); continue; }
      if (meta.includeInQualifyingIncome === undefined) {
        requirements.push({ extractionId, entityId: record.entityId, field: 'assetElection', form: record.form });
        continue;
      }
      push(projected, 'assets', compact({
        entityId: record.entityId, year: meta.taxYear, interestIncome: n('schedule-b-interest'), dividendIncome: n('schedule-b-dividends'),
        capitalGainsNetLoss: n('schedule-d-capital-gain-loss'), includeInQualifyingIncome: meta.includeInQualifyingIncome,
        hasThreeYearAssetSupport: meta.hasThreeYearAssetSupport,
      }));
    }
  }
  return extractionInput.parse(projected) as ExtractionInput;
}

function push(target: Record<string, unknown>, key: string, value: unknown): void {
  const rows = target[key] as unknown[] | undefined;
  target[key] = [...(rows ?? []), value];
}
function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
const PARTNERSHIP_K1_INCOME_FIELD_IDS = ['pt-ord', 'pt-rre', 'pt-onr', 'pt-gp', 'pt-dist'] as const;
const S_CORP_K1_INCOME_FIELD_IDS = ['scorp-ord', 'scorp-rre', 'scorp-onr', 'scorp-dist'] as const;

/** Parser id -> the balance-sheet line the liquidity test reads it as. */
const SCHEDULE_L_LINES = {
  'sch-l-cash': 'cash',
  'sch-l-ar': 'accountsReceivable',
  'sch-l-securities': 'taxExemptSecurities',
  'sch-l-ap': 'accountsPayable',
  'sch-l-notes': 'notesPayableLt1Yr',
  'sch-l-other-current': 'otherCurrentLiabilities',
  'sch-l-current-liabilities': 'currentLiabilities',
} as const;

function hasAny(fields: ReadonlyMap<string, unknown>, ids: readonly string[]): boolean {
  return ids.some((id) => fields.has(id));
}

/** True when a record carries only Schedule L lines, which are not a calc row of their own. */
function isScheduleLEvidenceOnly(fields: ReadonlyArray<{ sourceFieldId?: string }>): boolean {
  return fields.length > 0 && fields.every((field) => (field.sourceFieldId ?? '') in SCHEDULE_L_LINES);
}

/**
 * The balance sheet a return's K-1 is tested against.
 *
 * Schedule L prints on its own page, so it arrives as a separate record from
 * the K-1 it belongs to. Returned only when the packet holds exactly one for
 * the form: with two partnerships in one packet there is no way to tell which
 * balance sheet belongs to which K-1, and guessing would let one business's
 * liquidity carry another's income. Without it the K-1 falls back to the
 * distributions actually received, which is the safe direction.
 */
function scheduleLFor(
  records: ReadonlyArray<z.infer<typeof persistedFormRecord>>,
  form: 'Form 1065' | 'Form 1120-S',
): Record<string, number> | undefined {
  const sheets = records.filter((record) => record.form === form && isScheduleLEvidenceOnly(record.fields));
  if (sheets.length !== 1) return undefined;
  const sheet: Record<string, number> = {};
  for (const field of sheets[0].fields) {
    const line = SCHEDULE_L_LINES[field.sourceFieldId as keyof typeof SCHEDULE_L_LINES];
    if (line && typeof field.numericValue === 'number') sheet[line] = field.numericValue;
  }
  return Object.keys(sheet).length > 0 ? sheet : undefined;
}

/** True when every captured field is a partnership return id (pt-return-*) and none are K-1 income boxes. */
function isPartnershipReturnEvidenceOnly(fields: ReadonlyArray<{ sourceFieldId?: string }>): boolean {
  if (fields.length === 0) return false;
  const k1Income = new Set<string>(PARTNERSHIP_K1_INCOME_FIELD_IDS);
  let returnField = false;
  for (const field of fields) {
    if (k1Income.has(field.sourceFieldId)) return false;
    if (!field.sourceFieldId.startsWith('pt-return-')) return false;
    returnField = true;
  }
  return returnField;
}
/** True when every captured field is an S-corporation return id and none are K-1 income boxes. */
function isSCorpReturnEvidenceOnly(fields: ReadonlyArray<{ sourceFieldId?: string }>): boolean {
  if (fields.length === 0) return false;
  const k1Income = new Set<string>(S_CORP_K1_INCOME_FIELD_IDS);
  let returnField = false;
  for (const field of fields) {
    if (k1Income.has(field.sourceFieldId)) return false;
    if (!field.sourceFieldId?.startsWith('scorp-return-')) return false;
    returnField = true;
  }
  return returnField;
}
function requireParserField(target: ExtractionMetadataRequirement[], extractionId: string, record: z.infer<typeof persistedFormRecord>): void {
  target.push({ extractionId, entityId: record.entityId, field: 'requiredParserField', form: record.form });
}

function namespaceEntity(value: unknown, extractionId: string): unknown {
  if (!isRecord(value) || typeof value.entityId !== 'string') return value;
  return { ...value, entityId: `${extractionId}:${value.entityId}` };
}

function sortEntries(values: unknown[]): unknown[] {
  return values.sort((left, right) => {
    const a = isRecord(left) ? `${left.year ?? ''}:${left.entityId ?? ''}:${left.propertyAddress ?? ''}` : '';
    const b = isRecord(right) ? `${right.year ?? ''}:${right.entityId ?? ''}:${right.propertyAddress ?? ''}` : '';
    return a.localeCompare(b);
  });
}

/**
 * The months a year-to-date column covers, read from the document first.
 *
 * `elapsedMonths` divides every year-to-date figure, so it decides the answer
 * outright: a December stub divided by the mid-year default of 7.5 overstates
 * income by 60%. Both a stub and a verification print the date their column
 * was struck, which settles the figure without a reviewer recalling it, and a
 * reviewed figure that contradicts the document is a contradiction to settle
 * rather than one to average away.
 */
function resolveElapsedMonths(
  extractionId: string,
  record: z.infer<typeof persistedFormRecord>,
  reviewed: number | undefined,
  taxYear: number | undefined,
  dates: Readonly<{ periodEnd?: string; payDate?: string; payFrequency?: PayFrequency }>,
  requirements: ExtractionMetadataRequirement[],
): number | undefined {
  if (typeof taxYear !== 'number' || !(dates.periodEnd ?? dates.payDate)) return reviewed;
  const coverage = paystubCoverage({
    taxYear,
    periodEnd: dates.periodEnd,
    payDate: dates.payDate,
    payFrequency: dates.payFrequency,
  });
  if (coverage.gaps.includes('PERIOD_END_OUTSIDE_TAX_YEAR')) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
    return undefined;
  }
  if (coverage.status !== 'READY' || coverage.elapsedMonths === null) return reviewed;
  if (reviewed === undefined) return coverage.elapsedMonths;
  if (elapsedMonthsAgree(reviewed, coverage.elapsedMonths)) return reviewed;
  requirements.push({ extractionId, entityId: record.entityId, field: 'elapsedMonths', form: record.form });
  return undefined;
}

/**
 * A verification of employment, on Form 1005 or in a vendor's own report.
 *
 * It lands in `w2Employers` the way a pay stub does, because a verification
 * states the same facts a stub does: a rate of pay, the year-to-date earnings
 * by category, and often the prior full year. Nothing is inferred when the
 * document is silent; a missing divisor or a rate quoted in hours with no hours
 * stated comes back as a gap for a person to close.
 */
function projectWvoe(
  extractionId: string,
  record: z.infer<typeof persistedFormRecord>,
  metadata: ReadonlyMap<string, ExtractionMetadataAssignment>,
  requirements: ExtractionMetadataRequirement[],
  requireBorrower: boolean,
  roster: ReadonlySet<string>,
  projected: Record<string, unknown>,
): void {
  const meta = metadata.get(record.entityId);
  const fields = new Map(record.fields.map((field) => [field.sourceFieldId, field]));
  const n = (id: string) => fields.get(id)?.numericValue;
  const t = (id: string) => {
    const value = fields.get(id)?.value;
    return typeof value === 'string' ? value.trim() : undefined;
  };
  const employerName = t('wvoe-employer-name');
  const role = meta?.employmentRole;
  const year = meta?.taxYear;
  const borrowerKey = meta?.borrowerKey;
  const borrowerBlocked = requireBorrower && (!borrowerKey || !roster.has(borrowerKey));
  if (!employerName || !employerIdentityKey(employerName)) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'requiredParserField', form: record.form });
  }
  if (borrowerBlocked) requirements.push({ extractionId, entityId: record.entityId, field: 'borrowerAssignment', form: record.form });
  if (!role) requirements.push({ extractionId, entityId: record.entityId, field: 'employmentRole', form: record.form });
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
  }
  // The column heading names the year it accumulated over, so a reviewed tax
  // year that disagrees with it is reading the wrong column.
  const columnYear = n('wvoe-ytd-year');
  if (typeof year === 'number' && typeof columnYear === 'number' && columnYear !== year) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
  }
  const payCycle = parseWvoePayCycle(t('wvoe-pay-cycle'));
  const elapsedMonths = resolveElapsedMonths(extractionId, record, meta?.elapsedMonths, year, {
    periodEnd: t('wvoe-ytd-thru'),
    payFrequency: parsePayFrequency(t('wvoe-pay-cycle')),
  }, requirements);
  const annualized = annualizeWvoe({
    currentBasePay: n('wvoe-base'),
    basePayPeriod: parseWvoeBasePayPeriod(t('wvoe-base-period')),
    weeklyHours: n('wvoe-hours-week'),
    payPeriodHours: n('wvoe-hours-period'),
    payCycle,
    baseYtd: n('wvoe-base-ytd'),
    overtimeYtd: n('wvoe-ot'),
    bonusYtd: n('wvoe-bonus'),
    commissionYtd: n('wvoe-commission'),
    overtimePriorYear: n('wvoe-ot-prior'),
    bonusPriorYear: n('wvoe-bonus-prior'),
    commissionPriorYear: n('wvoe-commission-prior'),
    elapsedMonths,
    monthsEmployed: n('wvoe-months'),
    baseMethod: meta?.wvoeBaseMethod,
    variableMethod: meta?.wvoeVariableMethod,
  });
  const gaps = new Set(annualized.gaps);
  if (gaps.delete('ELAPSED_MONTHS_REQUIRED')) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'elapsedMonths', form: record.form });
    if (typeof n('wvoe-base-ytd') === 'number') {
      gaps.delete('NO_BASE_METHOD');
      if (meta?.wvoeBaseMethod === 'ytd') gaps.delete('BASE_METHOD_UNAVAILABLE');
    }
  }
  if (gaps.size) requirements.push({ extractionId, entityId: record.entityId, field: 'unsupportedCalculation', form: record.form });
  if (!employerName || borrowerBlocked || !role || typeof year !== 'number' || annualized.status !== 'READY') return;
  const parts = annualized.annualComponents;
  push(projected, 'w2Employers', {
    entityId: record.entityId,
    employerName,
    role,
    year,
    annualBaseIncome: annualized.annualBase,
    annualVariableIncome: annualized.annualVariable,
    annualOvertimeIncome: parts.overtime,
    annualBonusIncome: parts.bonus,
    annualCommissionIncome: parts.commission,
  });
}

function projectPaystub(
  extractionId: string,
  record: z.infer<typeof persistedFormRecord>,
  metadata: ReadonlyMap<string, ExtractionMetadataAssignment>,
  requirements: ExtractionMetadataRequirement[],
  requireBorrower: boolean,
  roster: ReadonlySet<string>,
  priorW2Wages: (borrowerKey: string | undefined, employerKey: string) => number | undefined,
  projected: Record<string, unknown>,
): void {
  const meta = metadata.get(record.entityId);
  const fields = new Map(record.fields.map((field) => [field.sourceFieldId, field]));
  const n = (id: string) => fields.get(id)?.numericValue;
  const t = (id: string) => {
    const value = fields.get(id)?.value;
    return typeof value === 'string' ? value.trim() : undefined;
  };
  const employerName = t('ps-employer-name');
  const employerKey = employerIdentityKey(employerName);
  const role = meta?.employmentRole;
  const year = meta?.taxYear;
  const borrowerKey = meta?.borrowerKey;
  const borrowerBlocked = requireBorrower && (!borrowerKey || !roster.has(borrowerKey));
  if (!employerName || !employerKey) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'requiredParserField', form: record.form });
  }
  if (borrowerBlocked) requirements.push({ extractionId, entityId: record.entityId, field: 'borrowerAssignment', form: record.form });
  if (!role) requirements.push({ extractionId, entityId: record.entityId, field: 'employmentRole', form: record.form });
  if (typeof year !== 'number' || !Number.isInteger(year)) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
  }
  const payFrequency = meta?.payFrequency ?? parsePayFrequency(t('ps-pay-frequency'));
  const elapsedMonths = resolveElapsedMonths(extractionId, record, meta?.elapsedMonths, year, {
    periodEnd: t('ps-period-end'),
    payDate: t('ps-pay-date'),
    payFrequency,
  }, requirements);
  const baseYtd = n('ps-base-ytd');
  const method = meta?.baseIncomeMethod;
  const annualized = annualizePaystub({
    hourlyRate: n('ps-hourly-rate'),
    weeklyHours: n('ps-hours-week'),
    currentPeriodBasePay: n('ps-current-base'),
    payFrequency,
    baseYtd,
    overtimeYtd: n('ps-ot-ytd'),
    bonusYtd: n('ps-bonus-ytd'),
    commissionYtd: n('ps-commission-ytd'),
    tipsYtd: n('ps-tips-ytd'),
    rsuYtd: n('ps-rsu-ytd'),
    otherYtd: n('ps-other-ytd'),
    elapsedMonths,
    priorYearW2Wages: method === 'prior' ? priorW2Wages(borrowerKey, employerKey) : undefined,
    baseMethod: method,
  });
  const gaps = new Set(annualized.gaps);
  if (gaps.has('ELAPSED_MONTHS_REQUIRED')) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'elapsedMonths', form: record.form });
    gaps.delete('ELAPSED_MONTHS_REQUIRED');
    if (typeof baseYtd === 'number') {
      gaps.delete('NO_BASE_METHOD');
      // The year-to-date method is unavailable only because the divisor is,
      // which the elapsed-months requirement above already says.
      if (method === 'ytd') gaps.delete('BASE_METHOD_UNAVAILABLE');
    }
  }
  if (gaps.has('BASE_METHOD_UNAVAILABLE') && method === 'period' && !payFrequency) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'payFrequency', form: record.form });
    gaps.delete('BASE_METHOD_UNAVAILABLE');
  }
  if (gaps.size) requirements.push({ extractionId, entityId: record.entityId, field: 'unsupportedCalculation', form: record.form });
  if (!employerName || !employerKey || borrowerBlocked || !role || typeof year !== 'number' || !Number.isInteger(year) || annualized.status !== 'READY') return;
  const parts = annualized.annualComponents;
  push(projected, 'w2Employers', {
    entityId: record.entityId,
    employerName,
    role,
    year,
    annualBaseIncome: annualized.annualBase,
    annualVariableIncome: annualized.annualVariable,
    annualOvertimeIncome: parts.overtime,
    annualBonusIncome: parts.bonus,
    annualCommissionIncome: parts.commission,
    annualTipsIncome: parts.tips,
    annualRsuIncome: parts.rsu,
    annualOtherIncome: parts.other,
  });
}

function priorW2WageLookup(
  records: ReadonlyArray<Readonly<{ normalizedInput: unknown; metadataAssignments?: readonly ExtractionMetadataAssignment[] }>>,
): (borrowerKey: string | undefined, employerKey: string) => number | undefined {
  const keyed = new Map<string, number>();
  const unkeyed = new Map<string, number>();
  for (const record of records) {
    const assignments = new Map((record.metadataAssignments ?? []).map((item) => [item.entityId, item.borrowerKey]));
    const input = isRecord(record.normalizedInput) ? record.normalizedInput : {};
    for (const row of Array.isArray(input.w2Records) ? input.w2Records : []) {
      if (!isRecord(row) || typeof row.entityId !== 'string') continue;
      const employer = employerIdentityKey(typeof row.employerName === 'string' ? row.employerName : '');
      const wages = typeof row.box5Wages === 'number' && row.box5Wages > 0 ? row.box5Wages : undefined;
      if (!employer || typeof wages !== 'number') continue;
      const borrowerKey = assignments.get(row.entityId);
      if (borrowerKey) keyed.set(`${borrowerKey}:${employer}`, wages);
      else unkeyed.set(employer, wages);
    }
  }
  return (borrowerKey, employerKey) => {
    if (!employerKey) return undefined;
    if (borrowerKey) return keyed.get(`${borrowerKey}:${employerKey}`);
    return unkeyed.get(employerKey);
  };
}

export function employerIdentityKey(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function reconcileDuplicateWages(
  records: ReadonlyArray<Readonly<{
    extractionId: string;
    normalizedInput: unknown;
    metadataAssignments?: readonly ExtractionMetadataAssignment[];
  }>>,
): Readonly<{ dropEntityIds: ReadonlySet<string>; gaps: readonly string[] }> {
  type Wage = { id: string; borrowerKey?: string; employer: string; kind: 'w2' | 'paystub' };
  const wages: Wage[] = [];
  for (const record of records) {
    const assignments = new Map((record.metadataAssignments ?? []).map((item) => [item.entityId, item.borrowerKey]));
    const input = isRecord(record.normalizedInput) ? record.normalizedInput : {};
    for (const row of Array.isArray(input.w2Records) ? input.w2Records : []) {
      if (!isRecord(row) || typeof row.entityId !== 'string') continue;
      wages.push({ id: `${record.extractionId}:${row.entityId}`, borrowerKey: assignments.get(row.entityId), employer: employerIdentityKey(typeof row.employerName === 'string' ? row.employerName : ''), kind: 'w2' });
    }
    for (const row of Array.isArray(input.formRecords) ? input.formRecords : []) {
      if (!isRecord(row) || typeof row.entityId !== 'string' || !Array.isArray(row.fields)) continue;
      // A verification carries the same current wage a stub does, so it
      // supersedes a W-2 for the same employer on the same terms.
      const employerField = row.form === 'Paystub' ? 'ps-employer-name' : row.form === 'WVOE' ? 'wvoe-employer-name' : null;
      if (!employerField) continue;
      const employer = row.fields.find((field) => isRecord(field) && field.sourceFieldId === employerField && typeof field.value === 'string') as { value?: string } | undefined;
      wages.push({ id: `${record.extractionId}:${row.entityId}`, borrowerKey: assignments.get(row.entityId), employer: employerIdentityKey(employer?.value), kind: 'paystub' });
    }
  }
  const drop = new Set<string>();
  const gaps = new Set<string>();
  // Same borrower is a shared roster key. When neither side has a key, this is
  // a single-borrower packet. 1003 stated wages are not an input here.
  for (const stub of wages.filter((item) => item.kind === 'paystub' && item.employer)) {
    const sameBorrower = wages.filter((item) => item.kind === 'w2' && sameWageBorrower(item, stub));
    const matched = sameBorrower.filter((item) => item.employer === stub.employer);
    for (const item of matched) drop.add(item.id);
    if (sameBorrower.length && matched.length === 0) gaps.add('PAYSTUB_EMPLOYER_UNMATCHED');
    if (matched.length) gaps.add('PAYSTUB_W2_RECONCILED');
  }
  return { dropEntityIds: drop, gaps: [...gaps].sort() };
}

function sameWageBorrower(left: { borrowerKey?: string }, right: { borrowerKey?: string }): boolean {
  if (left.borrowerKey && right.borrowerKey) return left.borrowerKey === right.borrowerKey;
  return !left.borrowerKey && !right.borrowerKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
