import {
  liveAssetPatch,
  liveCCorpPatch,
  liveFarmPatch,
  livePartnershipPatch,
  livePartnershipPatches,
  livePrevW2Patch,
  liveSchCPatch,
  liveSCorpPatch,
  liveSCorpPatches,
  liveWagePatch,
} from '../../../apps/underwriting-console/src/liveHydrate';
import type { MappedIncomeField } from '../../../apps/underwriting-console/src/parseTypes';

function field(sourceFieldId: string, numericValue: number, extras: Partial<MappedIncomeField> = {}): MappedIncomeField {
  return {
    id: sourceFieldId,
    sourceFieldId,
    form: 'W-2',
    boxLabel: sourceFieldId,
    fieldLabel: sourceFieldId,
    lineNum: '',
    category: 'wages',
    value: String(numericValue),
    numericValue,
    pageIndex: 0,
    wordIndex: 0,
    box: { x: 0.1, y: 0.1, w: 0.1, h: 0.02 },
    ...extras,
  };
}

describe('live worksheet hydration', () => {
  test('maps wage and prior W-2 values from parsed fields', () => {
    const fields = [
      field('w2-box1', 78500, { form: 'W-2' }),
      field('ps-base-ytd', 54000, { form: 'Paystub' }),
      field('ps-hourly-rate', 45, { form: 'Paystub' }),
      { ...field('w2-employer-name', 0, { form: 'W-2', category: 'identity' }), value: 'Apex LLC' },
    ];
    expect(liveWagePatch(fields)).toMatchObject({
      w2Year1Box1: 78500,
      baseYtd: 54000,
      hourlyRate: 45,
      employerName: 'Apex LLC',
    });
    expect(livePrevW2Patch(fields)?.box1Wages).toBeUndefined();
    expect(
      livePrevW2Patch([
        ...fields,
        field('w2-box1', 24000, { form: 'W-2', entityId: 'w-2-p1', id: 'w2-box1--w-2-p1' }),
      ])?.box1Wages,
    ).toBe(24000);
  });

  test('maps each self-employed and asset form onto its worksheet patch', () => {
    expect(liveSchCPatch([field('ent1-net', 115000, { form: 'Schedule C' })])?.line31).toBe(115000);
    expect(liveSCorpPatch([field('scorp-ord', 142000, { form: 'Form 1120-S' })])?.ordinaryIncome).toBe(142000);
    expect(livePartnershipPatch([field('pt-gp', 24000, { form: 'Form 1065' })])?.guaranteedPayments).toBe(24000);
    expect(liveCCorpPatch([field('c1120-taxable', 200000, { form: 'Form 1120' })])?.taxableIncome).toBe(200000);
    expect(liveFarmPatch([field('schedule-f-net', 64000, { form: 'Schedule F' })])?.netFarmProfitLoss).toBe(64000);
    expect(liveAssetPatch([field('schedule-b-interest', 4200, { form: 'Schedule B' })])?.interestIncome).toBe(4200);
  });

  test('hydrates a worksheet patch per 1120-S and 1065 entity instead of the first only', () => {
    const fields: MappedIncomeField[] = [
      field('scorp-ord', 142000, { form: 'Form 1120-S', entityId: 'form-1120-s-p0' }),
      field('scorp-ord', 88000, { form: 'Form 1120-S', entityId: 'form-1120-s-p1', id: 'scorp-ord--form-1120-s-p1' }),
      field('pt-gp', 24000, { form: 'Form 1065', entityId: 'form-1065-p2' }),
      field('pt-gp', 12000, { form: 'Form 1065', entityId: 'form-1065-p3', id: 'pt-gp--form-1065-p3' }),
    ];
    expect(liveSCorpPatches(fields).map((patch) => patch.ordinaryIncome)).toEqual([142000, 88000]);
    expect(livePartnershipPatches(fields).map((patch) => patch.guaranteedPayments)).toEqual([24000, 12000]);
  });
});
