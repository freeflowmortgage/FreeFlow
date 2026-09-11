import type { MappedIncomeField } from './parseTypes';

function num(fields: MappedIncomeField[], id: string): number | undefined {
  const hit = fields.find((field) => field.sourceFieldId === id || field.id === id);
  return hit && Number.isFinite(hit.numericValue) ? hit.numericValue : undefined;
}

function text(fields: MappedIncomeField[], id: string): string | undefined {
  const hit = fields.find((field) => field.sourceFieldId === id || field.id === id);
  const value = hit?.value?.trim();
  return value || undefined;
}

function byForm(fields: MappedIncomeField[], form: MappedIncomeField['form']) {
  return fields.filter((field) => field.form === form);
}

function pagesOf(fields: MappedIncomeField[]) {
  return [...new Set(fields.map((field) => field.pageIndex))].sort((a, b) => a - b);
}

function onPage(fields: MappedIncomeField[], pageIndex: number) {
  return fields.filter((field) => field.pageIndex === pageIndex);
}

export type LiveIncomeHydration = {
  wage?: {
    employerName?: string;
    ein?: string;
    hourlyRate?: number;
    periodPay?: number;
    baseYtd?: number;
    bonusYtd?: number;
    overtimeYtd?: number;
    box1?: number;
    yearEnd?: boolean;
  };
  schC?: Array<Partial<{ line31: number; line13: number; line30: number; line44aMiles: number; line24bMeals: number }>>;
  sCorp?: Array<Partial<{ ordinaryIncome: number; netRentalRealEstate: number; otherNetRental: number; distributions: number; ownershipPct: number }>>;
  partnership?: Array<Partial<{ ordinaryIncome: number; netRentalRealEstate: number; otherNetRental: number; guaranteedPayments: number; distributions: number; profitPctEnd: number; capitalPctEnd: number }>>;
  cCorp?: Array<Partial<{ taxableIncome: number; totalTaxPaid: number }>>;
  scheduleF?: Array<Partial<{ netFarmProfitLoss: number; depreciation: number }>>;
  asset?: Partial<{ interestIncome: number; dividendIncome: number; capitalGainsNetLoss: number }>;
  rental?: Array<Partial<{
    entityId: string;
    address: string;
    rentsReceived: number;
    insurance: number;
    mortgageInterest: number;
    taxes: number;
    depreciation: number;
    hoaDues: number;
    totalExpenses: number;
    netIncomeLoss: number;
    propertyTypeCode?: number;
    fairRentalDays: number;
  }>>;
};

export function rentalTypeFromCode(code?: number): 'SFR' | 'DUPLEX' | 'TRIPLEX' | 'FOURPLEX' | 'COMMERCIAL' | 'VACATION' | undefined {
  if (code === 1) return 'SFR';
  if (code === 2) return 'DUPLEX';
  if (code === 3) return 'VACATION';
  if (code === 4) return 'COMMERCIAL';
  return undefined;
}

function columnFields(fields: MappedIncomeField[], sourceFieldId: string): MappedIncomeField[] {
  return fields
    .filter((field) => (field.sourceFieldId ?? field.id) === sourceFieldId || field.id.startsWith(`${sourceFieldId}--`))
    .sort((a, b) => a.pageIndex - b.pageIndex || a.box.x - b.box.x);
}

function rentalEntityIds(fields: MappedIncomeField[]): string[] {
  const ids = new Set<string>();
  for (const field of fields) {
    if (!field.entityId) continue;
    const source = field.sourceFieldId ?? field.id;
    if (!/^(ent2-rent|ent2-address|ent2-net|ent2-days)/.test(source)) continue;
    ids.add(field.entityId);
  }
  return [...ids].sort((a, b) => {
    const doc = (id: string) => (id.includes(':') ? id.slice(0, id.indexOf(':')) : '');
    const page = (id: string) => Number(id.match(/p(\d+)-c\d+/)?.[1] ?? 0);
    const col = (id: string) => Number(id.match(/-c(\d+)$/)?.[1] ?? 0);
    return doc(a).localeCompare(doc(b)) || page(a) - page(b) || col(a) - col(b);
  });
}

function fieldOnEntity(fields: MappedIncomeField[], entityId: string, sourceFieldId: string): MappedIncomeField | undefined {
  return fields.find((field) => field.entityId === entityId && (field.sourceFieldId === sourceFieldId || field.id === sourceFieldId));
}

export function hydrateFromMappedFields(fields: MappedIncomeField[], fileName = ''): LiveIncomeHydration {
  const out: LiveIncomeHydration = {};
  const yearEnd = /year[- ]?end|\bye\b|final pay/i.test(fileName);

  const employerName = text(fields, 'w2-employer-name') || text(fields, 'ps-emp-name');
  const ein = text(fields, 'w2-employer-ein');
  const hourlyRate = num(fields, 'ps-hourly-rate');
  const periodPay = num(fields, 'ps-current-base');
  const baseYtd = num(fields, 'ps-base-ytd');
  const bonusYtd = num(fields, 'ps-bonus-ytd');
  const overtimeYtd = num(fields, 'ps-ot-ytd');
  const box1 = num(fields, 'w2-box1');
  const hasWageDoc = fields.some((field) => field.form === 'W-2' || field.form === 'Paystub' || field.form === 'WVOE');
  if (hasWageDoc && (employerName || ein || hourlyRate != null || periodPay != null || baseYtd != null || box1 != null || yearEnd)) {
    out.wage = { employerName, ein, hourlyRate, periodPay, baseYtd, bonusYtd, overtimeYtd, box1, yearEnd };
  }

  const schCPages = pagesOf(byForm(fields, 'Schedule C'));
  if (schCPages.length) {
    out.schC = schCPages.map((page) => {
      const pageFields = onPage(fields, page);
      return {
        line31: num(pageFields, 'ent1-net'),
        line13: num(pageFields, 'ent1-dep'),
        line30: num(pageFields, 'ent1-home'),
        line44aMiles: num(pageFields, 'ent1-miles'),
        line24bMeals: num(pageFields, 'ent1-meals'),
      };
    });
  }

  const sCorpPages = pagesOf(byForm(fields, 'Form 1120-S'));
  if (sCorpPages.length) {
    out.sCorp = sCorpPages.map((page) => {
      const pageFields = onPage(fields, page);
      return {
        ordinaryIncome: num(pageFields, 'scorp-ord'),
        netRentalRealEstate: num(pageFields, 'scorp-rre'),
        otherNetRental: num(pageFields, 'scorp-onr'),
        distributions: num(pageFields, 'scorp-dist'),
        ownershipPct: num(pageFields, 'scorp-own-pct'),
      };
    });
  }

  const k1Pages = pagesOf(byForm(fields, 'Form 1065'));
  if (k1Pages.length) {
    out.partnership = k1Pages.map((page) => {
      const pageFields = onPage(fields, page);
      return {
        ordinaryIncome: num(pageFields, 'pt-ord'),
        netRentalRealEstate: num(pageFields, 'pt-rre'),
        otherNetRental: num(pageFields, 'pt-onr'),
        guaranteedPayments: num(pageFields, 'pt-gp'),
        distributions: num(pageFields, 'pt-dist'),
        profitPctEnd: num(pageFields, 'pt-profit-pct'),
        capitalPctEnd: num(pageFields, 'pt-capital-pct'),
      };
    });
  }

  const cCorpPages = pagesOf(byForm(fields, 'Form 1120'));
  if (cCorpPages.length) {
    out.cCorp = cCorpPages.map((page) => {
      const pageFields = onPage(fields, page);
      return { taxableIncome: num(pageFields, 'c1120-taxable'), totalTaxPaid: num(pageFields, 'c1120-tax') };
    });
  }

  const farmPages = pagesOf(byForm(fields, 'Schedule F'));
  if (farmPages.length) {
    out.scheduleF = farmPages.map((page) => {
      const pageFields = onPage(fields, page);
      return { netFarmProfitLoss: num(pageFields, 'schedule-f-net'), depreciation: num(pageFields, 'schedule-f-depreciation') };
    });
  }

  const interest = num(fields, 'schedule-b-interest');
  const dividends = num(fields, 'schedule-b-dividends');
  const gains = num(fields, 'schedule-d-capital-gain-loss');
  if (interest != null || dividends != null || gains != null) {
    out.asset = { interestIncome: interest, dividendIncome: dividends, capitalGainsNetLoss: gains };
  }

  const eFields = byForm(fields, 'Schedule E');
  if (eFields.length) {
    const entities = rentalEntityIds(eFields);
    const count = Math.max(
      entities.length,
      columnFields(eFields, 'ent2-rent').length,
      columnFields(eFields, 'ent2-address').length,
      columnFields(eFields, 'ent2-net').length,
    );
    if (count) {
      out.rental = Array.from({ length: count }, (_, index) => {
        const entityId = entities[index];
        const pick = (id: string) => (entityId ? fieldOnEntity(eFields, entityId, id) : columnFields(eFields, id)[index]);
        const valueOf = (id: string) => {
          const hit = pick(id);
          return hit && Number.isFinite(hit.numericValue) ? hit.numericValue : undefined;
        };
        const addressField = pick('ent2-address');
        const typeField = pick('ent2-type');
        return {
          entityId,
          address: addressField?.value,
          propertyTypeCode: typeField && Number.isFinite(typeField.numericValue) ? typeField.numericValue : undefined,
          rentsReceived: valueOf('ent2-rent'),
          insurance: valueOf('ent2-ins'),
          mortgageInterest: valueOf('ent2-int'),
          taxes: valueOf('ent2-tax'),
          depreciation: valueOf('ent2-dep'),
          hoaDues: valueOf('ent2-hoa'),
          totalExpenses: valueOf('ent2-exp'),
          netIncomeLoss: valueOf('ent2-net'),
          fairRentalDays: valueOf('ent2-days'),
        };
      });
    }
  }

  return out;
}
