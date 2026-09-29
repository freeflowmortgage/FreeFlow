import { z } from 'zod';
import type { UnifiedIncomeCalculationPayload } from '@mortgage-pos/mortgage-engine';

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
  year, interestIncome: money.optional(), dividendIncome: money.optional(), capitalGainsNetLoss: money.optional(),
  includeInQualifyingIncome: z.boolean().optional(), hasThreeYearAssetSupport: z.boolean().optional(),
}).strict();
const trusts = z.object({ year, trustIncome: money.optional(), hasThreeYearTrustContinuance: z.boolean().optional() }).strict();
const scheduleE = z.object({
  year, propertyAddress: text, propertyType: z.enum(['RENTAL', 'ROYALTY']), rentsReceived: money.optional(),
  royaltiesReceived: money.optional(), insurance: money.optional(), mortgageInterest: money.optional(), taxes: money.optional(),
  depreciation: money.optional(), depletion: money.optional(), hoaDues: money.optional(), totalExpenses: money.optional(),
  netIncomeLoss: money.optional(), extraordinaryAddBack: money.optional(), hasThreeYearRoyaltyContinuance: z.boolean().optional(),
  isMultiFamilySubjectToFhaDecline: z.boolean().optional(), fairRentalDays: z.number().int().min(0).max(366).optional(),
  fairRentalDaysOverride: z.number().int().min(0).max(366).optional(),
}).strict();

const extractionInput = z.object({
  gseInvestor: z.enum(['FNMA', 'FREDDIE']).optional(),
  w2Employers: z.array(w2).max(100).optional(), scheduleC: z.array(scheduleC).max(100).optional(),
  scheduleF: z.array(scheduleF).max(100).optional(), form1120S: z.array(form1120S).max(100).optional(),
  form1065: z.array(form1065).max(100).optional(), benefits: z.array(benefits).max(100).optional(),
  assets: z.array(assets).max(100).optional(), trusts: z.array(trusts).max(100).optional(),
  scheduleEProperties: z.array(scheduleE).max(300).optional(),
}).strict();

const persistedW2 = w2.omit({ role: true });
const persistedField = z.object({
  sourceFieldId: z.string().trim().min(1).max(100), value: z.string().max(255).optional(), numericValue: money.optional(),
}).strict();
const persistedFormRecord = z.object({
  entityId, form: z.enum(['Schedule C', 'Schedule F', 'Form 1120-S', 'Form 1065', 'Form 1120', 'Form 1040', 'Schedule B', 'Schedule D', 'Paystub']),
  pageIndex: z.number().int().min(0).max(10_000), fields: z.array(persistedField).min(1).max(100),
}).strict();
const persistedExtractionInput = z.object({
  gseInvestor: z.enum(['FNMA', 'FREDDIE']).optional(),
  w2Records: z.array(persistedW2).max(100).optional(),
  formRecords: z.array(persistedFormRecord).max(2_000).optional(),
  scheduleEProperties: z.array(scheduleE).max(300).optional(),
}).strict();

export type ExtractionMetadataAssignment = Readonly<{
  entityId: string;
  taxYear?: number;
  employmentRole?: z.infer<typeof employmentRole>;
  ownershipPercentage?: number;
}>;
export type ExtractionMetadataRequirement = Readonly<{
  extractionId: string;
  entityId: string;
  field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation';
  form: string;
}>;

export class ExtractionMetadataRequiredError extends Error {
  constructor(readonly requirements: readonly ExtractionMetadataRequirement[]) {
    super('Authoritative extraction metadata or parser fields are required.');
  }
}

type ExtractionInput = z.infer<typeof extractionInput>;

export function mergeAuthoritativeExtractionInputs(
  records: ReadonlyArray<Readonly<{
    extractionId: string;
    normalizedInput: unknown;
    metadataAssignments?: readonly ExtractionMetadataAssignment[];
  }>>,
): Omit<UnifiedIncomeCalculationPayload, 'loanProgram'> {
  const merged: Record<string, unknown[]> = {};
  const requirements: ExtractionMetadataRequirement[] = [];
  let gseInvestor: 'FNMA' | 'FREDDIE' | undefined;
  for (const record of records) {
    const persisted = persistedExtractionInput.safeParse(record.normalizedInput);
    const input = persisted.success
      ? projectPersistedInput(record.extractionId, persisted.data, record.metadataAssignments ?? [], requirements)
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
    throw new ExtractionMetadataRequiredError(requirements.sort((a, b) =>
      `${a.extractionId}:${a.entityId}:${a.field}`.localeCompare(`${b.extractionId}:${b.entityId}:${b.field}`)));
  }
  return {
    ...(gseInvestor ? { gseInvestor } : {}),
    ...Object.fromEntries(Object.entries(merged).map(([key, values]) => [key, sortEntries(values)])),
  } as Omit<UnifiedIncomeCalculationPayload, 'loanProgram'>;
}

function projectPersistedInput(
  extractionId: string,
  persisted: z.infer<typeof persistedExtractionInput>,
  assignments: readonly ExtractionMetadataAssignment[],
  requirements: ExtractionMetadataRequirement[],
): ExtractionInput {
  const metadata = new Map(assignments.map((item) => [item.entityId, item]));
  const projected: Record<string, unknown> = {};
  if (persisted.gseInvestor) projected.gseInvestor = persisted.gseInvestor;
  if (persisted.scheduleEProperties?.length) projected.scheduleEProperties = persisted.scheduleEProperties;
  for (const row of persisted.w2Records ?? []) {
    const role = metadata.get(row.entityId)?.employmentRole;
    if (!role) {
      requirements.push({ extractionId, entityId: row.entityId, field: 'employmentRole', form: 'W-2' });
      continue;
    }
    push(projected, 'w2Employers', { ...row, role });
  }
  for (const record of persisted.formRecords ?? []) {
    // Paystub evidence is safe to persist and review, but the authoritative
    // calculator does not yet have a defensible annualization contract for it.
    // Keep calculation fail-closed instead of treating YTD or period pay as
    // annual income.
    if (record.form === 'Paystub') {
      requirements.push({ extractionId, entityId: record.entityId, field: 'unsupportedCalculation', form: record.form });
      continue;
    }
    const meta = metadata.get(record.entityId);
    if (!meta?.taxYear) {
      requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: record.form });
      continue;
    }
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
      if (!hasAny(fields, ['scorp-ord', 'scorp-rre', 'scorp-onr', 'scorp-dist'])) { requireParserField(requirements, extractionId, record); continue; }
      const ownership = n('scorp-own-pct') ?? meta.ownershipPercentage;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1120S', compact({ ...base, businessName: t('scorp-name'), ein: t('scorp-ein'), ownershipPercentage: ownership, k1OrdinaryIncome: n('scorp-ord'), k1NetRentalRealEstate: n('scorp-rre'), k1OtherNetRentalIncome: n('scorp-onr'), k1Distributions: n('scorp-dist'), depletion: n('scorp-depletion'), mealsExclusion: n('scorp-meals') }));
    } else if (record.form === 'Form 1065') {
      if (!hasAny(fields, ['pt-ord', 'pt-rre', 'pt-onr', 'pt-gp', 'pt-dist'])) { requireParserField(requirements, extractionId, record); continue; }
      const profit = n('pt-profit-pct'); const capital = n('pt-capital-pct');
      const ownership = meta.ownershipPercentage ?? profit ?? capital;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1065', compact({ ...base, businessName: t('pt-name'), ein: t('pt-ein'), ownershipPercentage: ownership, profitPercentageEnd: profit, capitalPercentageEnd: capital, k1OrdinaryIncome: n('pt-ord'), k1NetRentalRealEstate: n('pt-rre'), k1OtherNetRentalIncome: n('pt-onr'), k1GuaranteedPayments: n('pt-gp'), k1Distributions: n('pt-dist'), depletion: n('pt-depletion'), mealsExclusion: n('pt-meals') }));
    } else if (record.form === 'Form 1120') {
      if (n('c1120-taxable') === undefined) { requireParserField(requirements, extractionId, record); continue; }
      if (meta.ownershipPercentage === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1120', compact({ ...base, businessName: t('c1120-name'), ein: t('c1120-ein'), ownershipPercentage: meta.ownershipPercentage, taxableIncome: n('c1120-taxable'), totalTaxPaid: n('c1120-tax'), depreciation: n('c1120-dep'), depletion: n('c1120-depletion'), amortization: n('c1120-amort'), mealsExclusion: n('c1120-meals'), nolAndSpecialDeductions: n('c1120-nol') }));
    } else if (record.form === 'Form 1040') {
      if (!hasAny(fields, ['f1040-ss-total', 'f1040-ss-taxable', 'f1040-pensions-total', 'f1040-pensions-taxable'])) { requireParserField(requirements, extractionId, record); continue; }
      push(projected, 'benefits', compact({ year: meta.taxYear, totalSocialSecurity: n('f1040-ss-total'), taxableSocialSecurity: n('f1040-ss-taxable'), totalPensionsAndAnnuities: n('f1040-pensions-total'), taxablePensionsAndAnnuities: n('f1040-pensions-taxable') }));
    } else {
      if (!hasAny(fields, ['schedule-b-interest', 'schedule-b-dividends', 'schedule-d-capital-gain-loss'])) { requireParserField(requirements, extractionId, record); continue; }
      push(projected, 'assets', compact({ year: meta.taxYear, interestIncome: n('schedule-b-interest'), dividendIncome: n('schedule-b-dividends'), capitalGainsNetLoss: n('schedule-d-capital-gain-loss') }));
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
function hasAny(fields: ReadonlyMap<string, unknown>, ids: readonly string[]): boolean {
  return ids.some((id) => fields.has(id));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
