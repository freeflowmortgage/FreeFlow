import { createHash } from 'node:crypto';

export const INCOME_EXTRACTION_SCHEMA_VERSION = 'income-extraction-v2';

const FORM_FIELD_ALLOWLIST: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  'Schedule C': new Set(['ent1-name', 'ent1-ein', 'ent1-net', 'ent1-dep', 'ent1-depletion', 'ent1-meals', 'ent1-home', 'ent1-other-income', 'ent1-amort']),
  'Schedule F': new Set(['schedule-f-name', 'schedule-f-ein', 'schedule-f-net', 'schedule-f-coop-ccc', 'schedule-f-other', 'schedule-f-depreciation', 'schedule-f-other-expense', 'schedule-f-home', 'schedule-f-amort']),
  'Form 1120-S': new Set(['scorp-name', 'scorp-ein', 'scorp-ord', 'scorp-rre', 'scorp-onr', 'scorp-dist', 'scorp-own-pct', 'scorp-depletion', 'scorp-meals']),
  'Form 1065': new Set([
    'pt-name', 'pt-ein', 'pt-ord', 'pt-rre', 'pt-onr', 'pt-gp', 'pt-dist', 'pt-profit-pct', 'pt-capital-pct', 'pt-depletion', 'pt-meals',
    'pt-return-name', 'pt-return-ein', 'pt-return-gross', 'pt-return-wages', 'pt-return-ord', 'pt-return-gp',
    'pt-return-4797', 'pt-return-other', 'pt-return-dep', 'pt-return-depletion', 'pt-return-meals',
  ]),
  'Form 1120': new Set(['c1120-name', 'c1120-ein', 'c1120-taxable', 'c1120-tax', 'c1120-dep', 'c1120-depletion', 'c1120-amort', 'c1120-meals', 'c1120-nol']),
  'Form 1040': new Set(['f1040-ss-total', 'f1040-ss-taxable', 'f1040-pensions-total', 'f1040-pensions-taxable']),
  'Schedule B': new Set(['schedule-b-interest', 'schedule-b-dividends']),
  'Schedule D': new Set(['schedule-d-capital-gain-loss']),
  'Paystub': new Set([
    'ps-employee-name', 'ps-employer-name', 'ps-hourly-rate', 'ps-hours-week', 'ps-current-base', 'ps-base-ytd',
    'ps-bonus-ytd', 'ps-ot-ytd', 'ps-tips-ytd', 'ps-commission-ytd', 'ps-rsu-ytd', 'ps-other-ytd', 'ps-pay-frequency',
  ]),
});

type JsonObject = Record<string, unknown>;

export type PersistableIncomeExtraction = Readonly<{
  schemaVersion: typeof INCOME_EXTRACTION_SCHEMA_VERSION;
  normalizedInput: JsonObject;
  evidence: JsonObject;
  warnings: readonly string[];
  canonicalHash: string;
}>;

/**
 * Selects a bounded persistence projection from the immutable parser response.
 * It does not reclassify pages, read OCR words, or alter parser coordinates.
 */
export function selectPersistableParserExtraction(value: unknown): PersistableIncomeExtraction {
  if (!isRecord(value)) throw new Error('Parser response must be an object.');
  const warnings = readWarnings(value.flags);
  const w2Records: JsonObject[] = [];
  const scheduleEProperties: JsonObject[] = [];
  const fields: JsonObject[] = [];

  const rawW2Extracts = boundedArray(value.w2Extracts, 100);
  for (let index = 0; index < rawW2Extracts.length; index += 1) {
    const raw = rawW2Extracts[index];
    if (!isRecord(raw)) throw new Error('Invalid W-2 extraction.');
    const pageIndex = integer(raw.pageIndex, 0, 10_000);
    const year = integer(raw.year, 1990, 2100);
    const employerName = limitedText(raw.employerName, 255);
    const box1 = money(raw.box1);
    const box5 = money(raw.box5);
    if (pageIndex === null || year === null || !employerName || (box1 === null && box5 === null)) {
      throw new Error('W-2 extraction is missing authoritative calculation fields.');
    }
    w2Records.push({
      entityId: `w2-p${pageIndex}-${index}`,
      employerName,
      ...(limitedText(raw.ein, 20) ? { ein: limitedText(raw.ein, 20) } : {}),
      year,
      annualWages: box1 ?? box5,
    });
    warnings.push('W2_EMPLOYMENT_ROLE_REVIEW_REQUIRED');
    collectBoxEvidence(fields, 'w2Extracts', index, pageIndex, raw.boxes);
  }

  const rawScheduleE = boundedArray(value.scheduleEProperties, 300);
  for (let index = 0; index < rawScheduleE.length; index += 1) {
    const raw = rawScheduleE[index];
    if (!isRecord(raw)) throw new Error('Invalid Schedule E extraction.');
    const pageIndex = integer(raw.pageIndex, 0, 10_000);
    const year = integer(raw.year, 1990, 2100);
    const address = limitedText(raw.address, 255);
    const financials = isRecord(raw.financials) ? raw.financials : {};
    if (pageIndex === null || year === null || !address) {
      throw new Error('Schedule E extraction is missing authoritative calculation fields.');
    }
    const propertyType = String(raw.propertyType ?? '').toLowerCase().includes('royal') ? 'ROYALTY' : 'RENTAL';
    const row: JsonObject = { year, propertyAddress: address, propertyType };
    copyMoney(row, financials, '3', propertyType === 'ROYALTY' ? 'royaltiesReceived' : 'rentsReceived');
    copyMoney(row, financials, '9', 'insurance');
    copyMoney(row, financials, '12', 'mortgageInterest');
    copyMoney(row, financials, '16', 'taxes');
    copyMoney(row, financials, '18', propertyType === 'ROYALTY' ? 'depletion' : 'depreciation');
    copyMoney(row, financials, '19', 'hoaDues');
    copyMoney(row, financials, '20', 'totalExpenses');
    copyMoney(row, financials, '21', 'netIncomeLoss');
    const fairRentalDays = integer(raw.fairRentalDays, 0, 366);
    if (fairRentalDays !== null) row.fairRentalDays = fairRentalDays;
    scheduleEProperties.push(row);
    collectBoxEvidence(fields, 'scheduleEProperties', index, pageIndex, raw.boxes);
  }

  const formRecordMap = new Map<string, { entityId: string; form: string; pageIndex: number; fields: JsonObject[] }>();
  for (const raw of boundedArray(value.formExtracts, 2_000)) {
    if (!isRecord(raw)) throw new Error('Invalid generic form extraction.');
    const form = limitedText(raw.form, 80);
    const sourceFieldId = limitedText(raw.sourceFieldId, 100);
    const pageIndex = integer(raw.pageIndex, 0, 10_000);
    if (!form || !sourceFieldId || pageIndex === null || form === 'W-2' || form === 'Schedule E') continue;
    const allowed = FORM_FIELD_ALLOWLIST[form];
    if (!allowed?.has(sourceFieldId)) continue;
    const parserEntity = limitedText(raw.entityId, 120);
    const entityId = parserEntity ? `${form}:${parserEntity}` : `${form}:p${pageIndex}`;
    const key = `${form}:${entityId}`;
    const record = formRecordMap.get(key) ?? { entityId, form, pageIndex, fields: [] };
    const valueText = limitedText(raw.value, 255);
    const numericValue = money(raw.numericValue);
    if (valueText === null && numericValue === null) continue;
    record.fields.push({ sourceFieldId, ...(valueText !== null ? { value: valueText } : {}), ...(numericValue !== null ? { numericValue } : {}) });
    formRecordMap.set(key, record);
    const box = coordinateBox(raw.box);
    if (box) fields.push({ collection: 'formExtracts', entityId, field: sourceFieldId, pageIndex, box });
  }
  const formRecords = Array.from(formRecordMap.values()).map((record) => ({
    ...record,
    fields: record.fields.sort((a, b) => String(a.sourceFieldId).localeCompare(String(b.sourceFieldId))),
  })).sort((a, b) => String(a.entityId).localeCompare(String(b.entityId)));
  if (formRecords.length) warnings.push('AUTHORITATIVE_TAX_YEAR_REQUIRED');
  if (!w2Records.length && !scheduleEProperties.length && !formRecords.length) {
    throw new Error('Parser response contained no supported normalized income fields.');
  }

  const normalizedInput = {
    ...(w2Records.length ? { w2Records } : {}),
    ...(scheduleEProperties.length ? { scheduleEProperties } : {}),
    ...(formRecords.length ? { formRecords } : {}),
  };
  const evidence = { fields };
  const stableWarnings = Array.from(new Set(warnings)).sort();
  return {
    schemaVersion: INCOME_EXTRACTION_SCHEMA_VERSION,
    normalizedInput,
    evidence,
    warnings: stableWarnings,
    canonicalHash: sha256(stableStringify({ normalizedInput, evidence, warnings: stableWarnings })),
  };
}

function collectBoxEvidence(target: JsonObject[], collection: string, index: number, pageIndex: number, raw: unknown): void {
  if (!isRecord(raw)) return;
  for (const key of Object.keys(raw).sort().slice(0, 40)) {
    const box = coordinateBox(raw[key]);
    if (box) target.push({ collection, index, field: key.slice(0, 80), pageIndex, box });
  }
}

function coordinateBox(value: unknown): JsonObject | null {
  if (!isRecord(value)) return null;
  const x = coordinate(value.x); const y = coordinate(value.y);
  const w = coordinate(value.w); const h = coordinate(value.h);
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

function coordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function copyMoney(target: JsonObject, source: JsonObject, sourceKey: string, targetKey: string): void {
  const value = money(source[sourceKey]);
  if (value !== null) target[targetKey] = value;
}

function money(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000_000 ? value : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function limitedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function boundedArray(value: unknown, max: number): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error('Parser extraction array exceeded its contract.');
  return value;
}

function readWarnings(value: unknown): string[] {
  return boundedArray(value, 100).map((entry) => {
    const text = limitedText(entry, 160);
    if (!text || !/^[A-Za-z0-9 ._:-]+$/.test(text)) throw new Error('Invalid parser warning.');
    return text;
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
