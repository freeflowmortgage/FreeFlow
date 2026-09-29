import { z } from 'zod';
import { annualizePaystub, parsePayFrequency, type PayFrequency, type PaystubBaseMethod, type UnifiedIncomeCalculationPayload } from '@mortgage-pos/mortgage-engine';

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
  borrowerKey?: string;
  elapsedMonths?: number;
  payFrequency?: PayFrequency;
  baseIncomeMethod?: PaystubBaseMethod;
  includeInQualifyingIncome?: boolean;
  hasThreeYearAssetSupport?: boolean;
  hasStableDistributions?: boolean;
  cash?: number;
  currentLiabilities?: number;
}>;
export type ExtractionMetadataRequirement = Readonly<{
  extractionId: string;
  entityId: string;
  field: 'taxYear' | 'employmentRole' | 'ownershipPercentage' | 'requiredParserField' | 'unsupportedCalculation' | 'borrowerAssignment' | 'assetElection';
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
      ? projectPersistedInput(record.extractionId, persisted.data, record.metadataAssignments ?? [], requirements, options.borrowerRoster ?? [])
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
      return { ...property, entityId: propertyEntityId };
    });
  }
  for (const row of persisted.w2Records ?? []) {
    const assignment = metadata.get(row.entityId);
    const role = assignment?.employmentRole;
    if (!role) requirements.push({ extractionId, entityId: row.entityId, field: 'employmentRole', form: 'W-2' });
    if (requireBorrower && (!assignment?.borrowerKey || !roster.has(assignment.borrowerKey))) {
      requirements.push({ extractionId, entityId: row.entityId, field: 'borrowerAssignment', form: 'W-2' });
    }
    if (!role || (requireBorrower && (!assignment?.borrowerKey || !roster.has(assignment.borrowerKey)))) continue;
    push(projected, 'w2Employers', { ...row, role });
  }
  for (const record of persisted.formRecords ?? []) {
    if (record.form === 'Paystub') {
      projectPaystub(extractionId, record, metadata.get(record.entityId), requireBorrower, roster, requirements, projected);
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
      if (!hasAny(fields, ['scorp-ord', 'scorp-rre', 'scorp-onr', 'scorp-dist'])) { requireParserField(requirements, extractionId, record); continue; }
      const ownership = n('scorp-own-pct') ?? meta.ownershipPercentage;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1120S', compact({ ...base, businessName: t('scorp-name'), ein: t('scorp-ein'), ownershipPercentage: ownership, k1OrdinaryIncome: n('scorp-ord'), k1NetRentalRealEstate: n('scorp-rre'), k1OtherNetRentalIncome: n('scorp-onr'), k1Distributions: n('scorp-dist'), depletion: n('scorp-depletion'), mealsExclusion: n('scorp-meals'), hasStableDistributions: meta.hasStableDistributions }));
    } else if (record.form === 'Form 1065') {
      if (!hasAny(fields, ['pt-ord', 'pt-rre', 'pt-onr', 'pt-gp', 'pt-dist'])) { requireParserField(requirements, extractionId, record); continue; }
      const profit = n('pt-profit-pct'); const capital = n('pt-capital-pct');
      const ownership = meta.ownershipPercentage ?? profit ?? capital;
      if (ownership === undefined) { requirements.push({ extractionId, entityId: record.entityId, field: 'ownershipPercentage', form: record.form }); continue; }
      push(projected, 'form1065', compact({ ...base, businessName: t('pt-name'), ein: t('pt-ein'), ownershipPercentage: ownership, profitPercentageEnd: profit, capitalPercentageEnd: capital, k1OrdinaryIncome: n('pt-ord'), k1NetRentalRealEstate: n('pt-rre'), k1OtherNetRentalIncome: n('pt-onr'), k1GuaranteedPayments: n('pt-gp'), k1Distributions: n('pt-dist'), depletion: n('pt-depletion'), mealsExclusion: n('pt-meals'), hasStableDistributions: meta.hasStableDistributions }));
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

function projectPaystub(
  extractionId: string,
  record: z.infer<typeof persistedFormRecord>,
  meta: ExtractionMetadataAssignment | undefined,
  requireBorrower: boolean,
  roster: ReadonlySet<string>,
  requirements: ExtractionMetadataRequirement[],
  projected: Record<string, unknown>,
): void {
  const fields = new Map(record.fields.map((field) => [field.sourceFieldId, field]));
  const numeric = (id: string) => fields.get(id)?.numericValue;
  const textValue = (id: string) => fields.get(id)?.value;
  const annualized = annualizePaystub({
    hourlyRate: numeric('ps-hourly-rate'), weeklyHours: numeric('ps-hours-week'), currentPeriodBasePay: numeric('ps-current-base'),
    payFrequency: meta?.payFrequency ?? parsePayFrequency(textValue('ps-pay-frequency')),
    baseYtd: numeric('ps-base-ytd'), overtimeYtd: numeric('ps-ot-ytd'), bonusYtd: numeric('ps-bonus-ytd'),
    commissionYtd: numeric('ps-commission-ytd'), tipsYtd: numeric('ps-tips-ytd'), rsuYtd: numeric('ps-rsu-ytd'), otherYtd: numeric('ps-other-ytd'),
    elapsedMonths: meta?.elapsedMonths, baseMethod: meta?.baseIncomeMethod,
  });
  if (annualized.status !== 'READY') {
    requirements.push({ extractionId, entityId: record.entityId, field: 'unsupportedCalculation', form: 'Paystub' });
    return;
  }
  let blocked = false;
  if (!meta?.employmentRole) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'employmentRole', form: 'Paystub' });
    blocked = true;
  }
  if (!meta?.taxYear) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'taxYear', form: 'Paystub' });
    blocked = true;
  }
  if (requireBorrower && (!meta?.borrowerKey || !roster.has(meta.borrowerKey))) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'borrowerAssignment', form: 'Paystub' });
    blocked = true;
  }
  if (blocked || !meta?.employmentRole || !meta.taxYear) return;
  const employerName = textValue('ps-employer-name');
  if (!employerName) {
    requirements.push({ extractionId, entityId: record.entityId, field: 'requiredParserField', form: 'Paystub' });
    return;
  }
  push(projected, 'w2Employers', {
    entityId: record.entityId, employerName, role: meta.employmentRole, year: meta.taxYear,
    annualBaseIncome: annualized.annualBase, annualVariableIncome: annualized.annualVariable,
  });
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
      if (!isRecord(row) || row.form !== 'Paystub' || typeof row.entityId !== 'string' || !Array.isArray(row.fields)) continue;
      const employer = row.fields.find((field) => isRecord(field) && field.sourceFieldId === 'ps-employer-name' && typeof field.value === 'string') as { value?: string } | undefined;
      wages.push({ id: `${record.extractionId}:${row.entityId}`, borrowerKey: assignments.get(row.entityId), employer: employerIdentityKey(employer?.value), kind: 'paystub' });
    }
  }
  const drop = new Set<string>();
  const gaps = new Set<string>();
  for (const stub of wages.filter((item) => item.kind === 'paystub' && item.borrowerKey)) {
    const sameBorrower = wages.filter((item) => item.kind === 'w2' && item.borrowerKey === stub.borrowerKey);
    const matched = sameBorrower.filter((item) => item.employer && item.employer === stub.employer);
    for (const item of matched) drop.add(item.id);
    if (sameBorrower.length && matched.length === 0) gaps.add('PAYSTUB_EMPLOYER_UNMATCHED');
    if (matched.length) gaps.add('PAYSTUB_W2_RECONCILED');
  }
  return { dropEntityIds: drop, gaps: [...gaps].sort() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
