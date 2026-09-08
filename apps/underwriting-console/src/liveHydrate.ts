import type { MappedIncomeField } from './parseTypes';

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
  wvoeBonus?: number;
  wvoeOvertime?: number;
  w2Year1Box1?: number;
  wageDocSource?: 'PAYSTUB' | 'WVOE';
};

export type LivePrevW2Patch = {
  employerName?: string;
  ein?: string;
  box1Wages?: number;
};

export type LiveSchCPatch = {
  line31?: number;
  line13?: number;
  line44aMiles?: number;
};

export type LiveCorpPatch = {
  ordinaryIncome?: number;
  netRentalRealEstate?: number;
  otherNetRental?: number;
  guaranteedPayments?: number;
  distributions?: number;
  ownershipPct?: number;
  profitPctEnd?: number;
  capitalPctEnd?: number;
};

export type LiveCCorpPatch = {
  taxableIncome?: number;
  totalTaxPaid?: number;
  depreciation?: number;
};

export type LiveFarmPatch = {
  netFarmProfitLoss?: number;
  depreciation?: number;
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

export function liveWagePatch(fields: MappedIncomeField[]): LiveWagePatch | null {
  const entityId = firstEntity(fields, 'w2-box1') ?? firstEntity(fields, 'w2-employer-name');
  const fromWvoe = fields.some((field) => field.form === 'WVOE');
  return compact({
    employerName: text(fields, 'w2-employer-name', entityId) ?? text(fields, 'w2-employer-name'),
    ein: text(fields, 'w2-employer-ein', entityId) ?? text(fields, 'w2-employer-ein'),
    hourlyRate: num(fields, 'ps-hourly-rate') ?? num(fields, 'wvoe-base'),
    weeklyHours: num(fields, 'ps-hours-week'),
    currentPeriodBasePay: num(fields, 'ps-current-base'),
    baseYtd: num(fields, 'ps-base-ytd'),
    bonusYtd: num(fields, 'ps-bonus-ytd'),
    overtimeYtd: num(fields, 'ps-ot-ytd'),
    wvoeBonus: num(fields, 'wvoe-bonus'),
    wvoeOvertime: num(fields, 'wvoe-ot'),
    w2Year1Box1: num(fields, 'w2-box1', entityId) ?? num(fields, 'w2-box1'),
    wageDocSource: fromWvoe ? 'WVOE' : 'PAYSTUB',
  });
}

export function livePrevW2Patch(fields: MappedIncomeField[]): LivePrevW2Patch | null {
  const wages = fields.filter((field) => field.sourceFieldId === 'w2-box1');
  if (wages.length < 2) return null;
  const second = wages[1];
  return compact({
    employerName: text(fields, 'w2-employer-name', second.entityId),
    ein: text(fields, 'w2-employer-ein', second.entityId),
    box1Wages: second.numericValue,
  });
}

export function liveSchCPatch(fields: MappedIncomeField[]): LiveSchCPatch | null {
  return compact({
    line31: num(fields, 'ent1-net'),
    line13: num(fields, 'ent1-dep'),
    line44aMiles: num(fields, 'ent1-miles'),
  });
}

export function liveSCorpPatch(fields: MappedIncomeField[]): LiveCorpPatch | null {
  return compact({
    ordinaryIncome: num(fields, 'scorp-ord'),
    netRentalRealEstate: num(fields, 'scorp-rre'),
    otherNetRental: num(fields, 'scorp-onr'),
    distributions: num(fields, 'scorp-dist'),
    ownershipPct: num(fields, 'scorp-own-pct'),
  });
}

export function livePartnershipPatch(fields: MappedIncomeField[]): LiveCorpPatch | null {
  return compact({
    ordinaryIncome: num(fields, 'pt-ord'),
    netRentalRealEstate: num(fields, 'pt-rre'),
    otherNetRental: num(fields, 'pt-onr'),
    guaranteedPayments: num(fields, 'pt-gp'),
    distributions: num(fields, 'pt-dist'),
    profitPctEnd: num(fields, 'pt-profit-pct'),
    capitalPctEnd: num(fields, 'pt-capital-pct'),
  });
}

export function liveCCorpPatch(fields: MappedIncomeField[]): LiveCCorpPatch | null {
  return compact({
    taxableIncome: num(fields, 'c1120-taxable'),
    totalTaxPaid: num(fields, 'c1120-tax'),
    depreciation: num(fields, 'c1120-dep'),
  });
}

export function liveFarmPatch(fields: MappedIncomeField[]): LiveFarmPatch | null {
  return compact({
    netFarmProfitLoss: num(fields, 'schedule-f-net'),
    depreciation: num(fields, 'schedule-f-depreciation'),
  });
}

export function liveAssetPatch(fields: MappedIncomeField[]): LiveAssetPatch | null {
  return compact({
    interestIncome: num(fields, 'schedule-b-interest'),
    dividendIncome: num(fields, 'schedule-b-dividends'),
    capitalGainsNetLoss: num(fields, 'schedule-d-capital-gain-loss'),
  });
}
