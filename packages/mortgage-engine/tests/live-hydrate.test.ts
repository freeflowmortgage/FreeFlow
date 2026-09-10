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
      field('w2-box1', 70000, { form: 'W-2' }),
      field('w2-box5', 78500, { form: 'W-2' }),
      field('ps-base-ytd', 54000, { form: 'Paystub' }),
      field('ps-hourly-rate', 45, { form: 'Paystub' }),
      { ...field('w2-employer-name', 0, { form: 'W-2', category: 'identity' }), value: 'Apex LLC' },
    ];
    expect(liveWagePatch(fields)).toMatchObject({
      w2Year1Box5: 78500,
      baseYtd: 54000,
      hourlyRate: 45,
      employerName: 'Apex LLC',
    });
    expect(liveWagePatch(fields)?.w2Year1Box5).not.toBe(70000);
    expect(livePrevW2Patch(fields)?.box5Wages).toBeUndefined();
    expect(
      livePrevW2Patch([
        ...fields,
        field('w2-box1', 20000, { form: 'W-2', entityId: 'w-2-p1', id: 'w2-box1--w-2-p1' }),
        field('w2-box5', 24000, { form: 'W-2', entityId: 'w-2-p1', id: 'w2-box5--w-2-p1' }),
      ])?.box5Wages,
    ).toBe(24000);
  });

  test('does not treat W-2 Box 1 taxable wages as qualifying gross', () => {
    expect(liveWagePatch([field('w2-box1', 78500, { form: 'W-2' })])?.w2Year1Box5).toBeUndefined();
  });

  test('hydrates tips, commission, and RSU as their own fields', () => {
    expect(
      liveWagePatch([
        field('ps-bonus-ytd', 3000, { form: 'Paystub' }),
        field('ps-commission-ytd', 6000, { form: 'Paystub' }),
        field('ps-tips-ytd', 1800, { form: 'Paystub' }),
        field('ps-rsu-ytd', 7500, { form: 'Paystub' }),
      ]),
    ).toMatchObject({
      bonusYtd: 3000,
      tipsYtd: 1800,
      commissionYtd: 6000,
      rsuYtd: 7500,
      otherYtd: 7500,
    });
  });

  test('maps each self-employed and asset form onto its worksheet patch', () => {
    expect(liveSchCPatch([field('ent1-net', 115000, { form: 'Schedule C' })])?.line31).toBe(115000);
    expect(liveSCorpPatch([field('scorp-ord', 142000, { form: 'Form 1120-S' })])?.ordinaryIncome).toBe(142000);
    expect(livePartnershipPatch([field('pt-gp', 24000, { form: 'Form 1065' })])?.guaranteedPayments).toBe(24000);
    expect(liveCCorpPatch([field('c1120-taxable', 200000, { form: 'Form 1120' })])?.taxableIncome).toBe(200000);
    expect(liveFarmPatch([field('schedule-f-net', 64000, { form: 'Schedule F' })])?.netFarmProfitLoss).toBe(64000);
    expect(
      liveFarmPatch([
        field('schedule-f-net', 64000, { form: 'Schedule F' }),
        field('schedule-f-coop-ccc', 2100, { form: 'Schedule F' }),
      ])?.coopCccPayments,
    ).toBe(2100);
    expect(liveAssetPatch([field('schedule-b-interest', 4200, { form: 'Schedule B' })])?.interestIncome).toBe(4200);
    expect(liveSCorpPatch([field('scorp-179', 1500, { form: 'Form 1120-S' })])?.section179).toBe(1500);
  });

  test('folds Form 8825 Line 14 depreciation onto a single 1120-S, preferring it over Form 4562', () => {
    const fields: MappedIncomeField[] = [
      field('scorp-ord', 142000, { form: 'Form 1120-S', entityId: 'form-1120-s-p0' }),
      field('form-8825-dep', 8200, { form: 'Form 8825', entityId: 'form-8825-p1' }),
      field('form-4562-dep', 1100, { form: 'Form 1120-S', entityId: 'form-4562-p2' }),
    ];
    expect(liveSCorpPatches(fields)).toEqual([
      expect.objectContaining({ entityId: 'form-1120-s-p0', ordinaryIncome: 142000, depreciation: 8200 }),
    ]);
  });

  test('falls back to Form 4562 depreciation when Form 8825 Line 14 is absent', () => {
    const fields: MappedIncomeField[] = [
      field('pt-ord', 41000, { form: 'Form 1065', entityId: 'form-1065-p0' }),
      field('form-4562-dep', 2750, { form: 'Form 1065', entityId: 'form-4562-p1' }),
    ];
    expect(livePartnershipPatches(fields)[0].depreciation).toBe(2750);
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
