import assert from 'node:assert/strict';
import test from 'node:test';
import type { MappedIncomeField, ParseWord } from './parseTypes';
import {
  calculateRetirementIncome,
  mostRecentRetirementReturn,
  retirementReturnsFromFields,
  taxYearFromPage,
} from './retirementIncome';

const box = { x: 0.7, y: 0.4, w: 0.1, h: 0.01 };
const field = (documentId: string, sourceFieldId: string, numericValue: number): MappedIncomeField => ({
  id: `${sourceFieldId}--form-1040-p0`, documentId, entityId: 'form-1040-p0', sourceFieldId, form: 'Form 1040',
  boxLabel: '', fieldLabel: '', lineNum: '', category: 'income', value: String(numericValue), numericValue,
  pageIndex: 0, wordIndex: 0, box,
});
const word = (text: string, y: number): ParseWord => ({ text, x: 0.8, y, w: 0.05, h: 0.02, confidence: 99 });

test('reads the tax year from the Form 1040 header only', () => {
  assert.equal(taxYearFromPage({ words: [word('Form', 0.03), word('1040', 0.03), word('2025', 0.04), word('2019', 0.6)] }), 2025);
  assert.equal(taxYearFromPage({ words: [word('2019', 0.6)] }), null);
});

test('groups lines per return and picks the most recent year', () => {
  const fields = [
    field('doc-2024', 'f1040-ira-total', 12000), field('doc-2024', 'f1040-ira-taxable', 12000),
    field('doc-2025', 'f1040-ira-total', 24000), field('doc-2025', 'f1040-ira-taxable', 18000),
    field('doc-2025', 'f1040-ss-total', 26400), field('doc-2025', 'f1040-ss-taxable', 22440),
    field('doc-w2only', 'f1040-wages', 90000),
  ];
  const years: Record<string, string> = { 'doc-2024': '2024', 'doc-2025': '2025' };
  const returns = retirementReturnsFromFields(fields, (documentId) => ({ words: [word(years[documentId ?? ''] ?? '', 0.04)] }));
  assert.equal(returns.length, 2);
  const latest = mostRecentRetirementReturn(returns);
  assert.equal(latest?.year, 2025);
  assert.equal(latest?.documentId, 'doc-2025');
  assert.deepEqual([latest?.iraTotal, latest?.iraTaxable, latest?.ssTotal, latest?.ssTaxable], [24000, 18000, 26400, 22440]);
});

test('IRA stays out of qualifying income until continuance is confirmed, then grosses up by program', () => {
  const lines = { year: 2025, iraTotal: 24000, iraTaxable: 18000, pensionTotal: 0, pensionTaxable: 0, ssTotal: 0, ssTaxable: 0 };
  const pending = calculateRetirementIncome(lines, { iraAccountBalance: null, iraContinuance: null }, 'CONVENTIONAL');
  assert.equal(pending.retirementIncomeMonthly, 0);
  assert.ok(pending.alerts.some((alert) => alert.id === 'IRA_DISTRIBUTION_EXCLUDED_PENDING_CONTINUANCE'));

  const fha = calculateRetirementIncome(lines, { iraAccountBalance: 400000, iraContinuance: 'CONFIRMED_GROSS_UP' }, 'FHA');
  assert.equal(fha.retirementIncomeMonthly, 2075);
  assert.equal(fha.ira?.monthsOfContinuance, 200);
  assert.deepEqual(fha.alerts, []);

  const plain = calculateRetirementIncome(lines, { iraAccountBalance: 400000, iraContinuance: 'CONFIRMED' }, 'FHA');
  assert.equal(plain.retirementIncomeMonthly, 2000);
});

test('flags a balance that cannot cover 36 months and a confirmation with no balance', () => {
  const lines = { year: 2025, iraTotal: 24000, iraTaxable: 24000, pensionTotal: 0, pensionTaxable: 0, ssTotal: 0, ssTaxable: 0 };
  const short = calculateRetirementIncome(lines, { iraAccountBalance: 50000, iraContinuance: 'CONFIRMED' }, 'VA');
  assert.equal(short.ira?.monthsOfContinuance, 25);
  assert.equal(short.alerts.find((alert) => alert.id === 'IRA_CONTINUANCE_BALANCE_SHORTFALL')?.type, 'ERROR');

  const missing = calculateRetirementIncome(lines, { iraAccountBalance: null, iraContinuance: 'CONFIRMED' }, 'VA');
  assert.ok(missing.alerts.some((alert) => alert.id === 'IRA_BALANCE_REQUIRED'));
  assert.equal(missing.retirementIncomeMonthly, 2000);
});

test('a Line 4a amount with nothing taxable is called out as a possible rollover', () => {
  const lines = { year: 2025, iraTotal: 50000, iraTaxable: 0, pensionTotal: 0, pensionTaxable: 0, ssTotal: 0, ssTaxable: 0 };
  const result = calculateRetirementIncome(lines, { iraAccountBalance: null, iraContinuance: null }, 'CONVENTIONAL');
  assert.ok(result.alerts.some((alert) => alert.id === 'IRA_DISTRIBUTION_NOT_TAXABLE'));
});
