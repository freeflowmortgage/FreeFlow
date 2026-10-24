import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadDemoPacket } from './demoPacket';
import { mapIncomeFields } from './incomeFieldMap';
import { livePartnershipPatches, liveScheduleLPatch, liveWagePatch, owningBusinessReturns } from './liveHydrate';
import { fieldForInspection, inspectOverlayFromField, kindsOf } from './livePacket';
import { w2BaseMethods } from '../../../packages/mortgage-engine/src/w2-income-methods';

const PUBLIC = new URL('../public', import.meta.url);

async function publicFetch(input: RequestInfo | URL): Promise<Response> {
  const path = String(input).replace(/^\//, '');
  try {
    return new Response(await readFile(new URL(path, `${PUBLIC.href}/`)));
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function packet() {
  const loaded = await loadDemoPacket(publicFetch as typeof fetch);
  const byId = new Map(loaded.documents.map((doc) => [doc.id, doc]));
  const fields = (id: string) => {
    const doc = byId.get(id);
    assert.ok(doc, `missing ${id}`);
    // The console stamps the owning document onto every mapped field, and
    // inspection is scoped by it, so a packet-faithful test has to do the same.
    return mapIncomeFields(doc.result).map((field) => ({ ...field, documentId: doc.id }));
  };
  return { ...loaded, byId, fields };
}

test('demo packet loads every sample PDF with its stored extraction', async () => {
  const { documents, context } = await packet();
  assert.deepEqual(
    documents.map((doc) => [doc.id, doc.fileName, doc.file.type]),
    [
      ['sample-paystub', 'paystub.pdf', 'application/pdf'],
      ['sample-w2', 'w2.pdf', 'application/pdf'],
      ['sample-schedule-e', 'schedule-e.pdf', 'application/pdf'],
      ['sample-schedule-k1', 'schedule-k1.pdf', 'application/pdf'],
      ['sample-form-1065', 'form-1065.pdf', 'application/pdf'],
    ],
  );
  assert.ok(documents.every((doc) => doc.file.size > 1000));
  assert.equal(context?.loanId, 'DEMO-TRAINING-2025');
  assert.deepEqual(context?.borrowers, [{ id: 'borrower-1', name: 'Jordan Example', role: 'Borrower' }]);
});

test('demo pay stub and W-2 hydrate the wage worksheet like a live upload', async () => {
  const { fields, byId } = await packet();
  assert.deepEqual(kindsOf(byId.get('sample-paystub')!), ['paystub']);
  assert.deepEqual(kindsOf(byId.get('sample-w2')!), ['w2']);

  const wages = liveWagePatch([...fields('sample-paystub'), ...fields('sample-w2')]);
  assert.equal(wages?.employerName, 'Example Services LLC');
  assert.equal(wages?.hourlyRate, 42);
  assert.equal(wages?.weeklyHours, 40);
  assert.equal(wages?.currentPeriodBasePay, 3360);
  assert.equal(wages?.baseYtd, 82656);
  assert.equal(wages?.overtimeYtd, 36);
  assert.equal(wages?.payFrequency, 'BIWEEKLY');
  assert.equal(wages?.periodEnd, '10/22/2022');
  assert.equal(wages?.payDate, '10/28/2022');
  assert.equal(wages?.w2Year1Box5, 90000);
  assert.equal(wages?.ein, '00-7654321');
});

test('the demo stub annualizes at its own 26 biweekly periods, not 24 semi-monthly ones', async () => {
  const { fields } = await packet();
  const wages = liveWagePatch([...fields('sample-paystub')]);
  const employer = {
    id: 'w2-live', wageDocSource: 'PAYSTUB' as const, monthsAtJob: 12, wvoeMonths: 12,
    bonusYtd: 0, overtimeYtd: 0, tipsYtd: 0, commissionYtd: 0, wvoeBonus: 0, wvoeOvertime: 0, w2Year1Box5: 0,
    payFrequency: wages!.payFrequency!, hourlyRate: wages!.hourlyRate!,
    weeklyHours: wages!.weeklyHours!, currentPeriodBasePay: wages!.currentPeriodBasePay!, baseYtd: wages!.baseYtd!,
  };
  const monthly = (id: string) =>
    w2BaseMethods(employer, { ownedByPrimary: true }).options.find((option) => option.id === id)?.monthly;

  // The hourly and period methods agree here because the stub pays two weeks
  // of scheduled hours (3360 = 42 x 40 x 2) and 26 biweekly periods is 52
  // weeks. Matching figures are the arithmetic working, not the period method
  // falling back to the hourly one, so pin what 24 periods would have paid.
  assert.equal(monthly('hourly'), 7280);
  assert.equal(monthly('period'), 7280);
  assert.equal(
    w2BaseMethods({ ...employer, payFrequency: 'SEMIMONTHLY' }, { ownedByPrimary: true })
      .options.find((option) => option.id === 'period')?.monthly,
    6720,
  );
});

test('demo Schedule E carries all five rental properties', async () => {
  const { byId } = await packet();
  const properties = byId.get('sample-schedule-e')!.result.scheduleEProperties ?? [];
  assert.equal(properties.length, 5);
  assert.match(properties[0].address, /101 Example Lane/);
  assert.match(properties[4].address, /505 Test Terrace/);
  assert.equal(properties[0].financials['3'], 24000);
  assert.ok(properties.every((property) => property.year === 2025));
});

test('demo K-1 and Form 1065 hydrate the partnership worksheet', async () => {
  const { fields, byId } = await packet();
  const k1 = livePartnershipPatches(fields('sample-schedule-k1'));
  assert.equal(k1.length, 1);
  assert.equal(k1[0].ordinaryIncome, -10800);
  assert.equal(k1[0].guaranteedPayments, 12000);
  assert.equal(k1[0].distributions, 11040);
  assert.equal(k1[0].profitPctEnd, 60);

  const returnFields = fields('sample-form-1065');
  assert.equal(returnFields.find((f) => f.sourceFieldId === 'pt-return-dep')?.value, '$18,000.00');
  const returnPages = byId.get('sample-form-1065')!.result.pages;
  const owners = owningBusinessReturns(returnPages.map((page) => ({ documentId: 'return', index: page.index, formIds: page.formIds })));
  assert.match(owners.get('return:5') ?? '', /^Form 1065 \(/);
  const scheduleL = liveScheduleLPatch(returnFields);
  assert.equal(scheduleL?.cash, 66000);
  assert.equal(scheduleL?.receivables, undefined);
  assert.equal(scheduleL?.otherCurrentLiab, undefined);
  assert.equal(scheduleL?.accountsPayable, 26400);
});

test('clicking a demo Schedule L row resolves to its Form 1065 balance-sheet box', async () => {
  const { fields } = await packet();
  const returnFields = fields('sample-form-1065');

  // The liquidity worksheet rows are keyed by ScheduleL property name; the
  // parser reports the balance sheet under its own ids. A click has to cross
  // that gap or the PDF never moves.
  for (const [worksheetId, sourceId] of [
    ['schl-cash', 'sch-l-cash'],
    ['schl-taxExempt', 'sch-l-securities'],
    ['schl-accountsPayable', 'sch-l-ap'],
    ['schl-notesLt1Yr', 'sch-l-notes'],
  ]) {
    const hit = fieldForInspection(returnFields, worksheetId, 'sample-form-1065');
    assert.equal(hit?.sourceFieldId, sourceId, worksheetId);
    assert.equal(hit?.pageIndex, 5, worksheetId);
    assert.ok(inspectOverlayFromField(hit), `${worksheetId} has no usable overlay box`);
  }

  // Lines the demo balance sheet leaves blank stay unresolved rather than
  // snapping the viewer to an unrelated row.
  assert.equal(fieldForInspection(returnFields, 'schl-allowance', 'sample-form-1065'), undefined);
});

test('demo borrower assignments match the reviewed metadata', async () => {
  const { context } = await packet();
  const assigned = Object.entries(context?.borrowerAssignments ?? {});
  assert.ok(assigned.length >= 5);
  assert.ok(assigned.every(([, borrower]) => borrower === 'borrower-1'));
  assert.ok(assigned.some(([key]) => key.startsWith('sample-paystub:0:')));
  assert.ok(assigned.some(([key]) => key.startsWith('sample-w2:0:')));
});
