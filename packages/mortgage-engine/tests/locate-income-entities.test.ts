import { mapIncomeFields } from '../../../apps/underwriting-console/src/incomeFieldMap';
import { locateIncomeEntities, uniqueDiscoveredBusinesses } from '../../../apps/underwriting-console/src/locateIncomeEntities';
import {
  seedCCorpFromLocation,
  seedFarmFromLocation,
  seedPartnershipFromLocation,
  seedScheduleCFromLocation,
  seedSCorpFromLocation,
  seedW2FromLocation,
} from '../../../apps/underwriting-console/src/hydrateFromUrlA';
import { employmentEntitiesFromUrlA } from '../../../apps/underwriting-console/src/urlaEmploymentRoster';
import type { ParsePage, ParseResponse, ParseWord } from '../../../apps/underwriting-console/src/parseTypes';

declare global {
  interface File {}
}

function words(lines: string[]): ParseWord[] {
  return lines.map((text, index) => ({
    text,
    x: 0.1,
    y: 0.1 + index * 0.05,
    w: 0.8,
    h: 0.02,
    confidence: 99,
  }));
}

function page(index: number, formIds: string[], lines: string[]): ParsePage {
  return {
    index,
    formIds,
    isNativeText: true,
    meanConfidence: 99,
    skewDegrees: 0,
    flags: [],
    words: words(lines),
  };
}

function response(pages: ParsePage[]): ParseResponse {
  return {
    transaction_id: 'locate-test',
    total_pages_scanned: pages.length,
    pages_extracted_count: pages.length,
    extracted_page_indices: pages.map((item) => item.index),
    ocr_page_count: 0,
    has_business_returns: true,
    flags: [],
    classifications: Object.fromEntries(pages.map((item) => [String(item.index), item.formIds])),
    unresolved_statements: [],
    pages,
  };
}

describe('locate 1003 entities in the income packet', () => {
  test('maps two 1120-S K-1s and two 1065 K-1s without stopping at the first instance', () => {
    const fields = mapIncomeFields(
      response([
        page(0, ['Schedule K-1 (1120-S)'], [
          "Corporation's name Apex Advisory Holdings",
          "Corporation's employer identification number 74-9876543",
          'Ordinary business income 142000.00',
        ]),
        page(1, ['Schedule K-1 (1120-S)'], [
          "Corporation's name Lakeside Dental Group",
          "Corporation's employer identification number 36-1112223",
          'Ordinary business income 88000.00',
        ]),
        page(2, ['Schedule K-1 (1065)'], [
          "Partnership's name Horizon Property Partners",
          "Partnership's employer identification number 52-2468101",
          'Ordinary business income 96000.00',
          'Guaranteed payments 24000.00',
        ]),
        page(3, ['Schedule K-1 (1065)'], [
          "Partnership's name Pine Street Holdings LLP",
          "Partnership's employer identification number 84-7130996",
          'Ordinary business income 41000.00',
          'Guaranteed payments 12000.00',
        ]),
      ]),
    );

    const scorpOrd = fields.filter((field) => field.sourceFieldId === 'scorp-ord');
    const ptOrd = fields.filter((field) => field.sourceFieldId === 'pt-ord');
    expect(scorpOrd).toHaveLength(2);
    expect(ptOrd).toHaveLength(2);
    expect(scorpOrd.map((field) => field.numericValue)).toEqual([142000, 88000]);
    expect(ptOrd.map((field) => field.numericValue)).toEqual([96000, 41000]);
    expect(fields.find((field) => field.sourceFieldId === 'scorp-name' && field.pageIndex === 1)?.value).toMatch(/Lakeside Dental/);
    expect(fields.find((field) => field.sourceFieldId === 'pt-name' && field.pageIndex === 3)?.value).toMatch(/Pine Street/);
  });

  test('grabs every 1003 business first, then locates each one in the packet', () => {
    const roster = employmentEntitiesFromUrlA({
      employmentType: 'SELF_EMPLOYED',
      employerName: 'Apex Advisory Holdings',
      hasSecondJob: true,
      secondEmployer: 'Horizon Property Partners',
      previousEmployer: 'Digital Solutions Corp',
    });

    const pages = [
      page(0, ['W-2'], [
        "c Employer's name Digital Solutions Corp",
        'b Employer identification number (EIN) 94-8765432',
        'Box 1 Wages tips other compensation 24000.00',
      ]),
      page(1, ['Schedule K-1 (1120-S)'], [
        "Corporation's name Apex Advisory Holdings LLC",
        "Corporation's employer identification number 74-9876543",
        'Ordinary business income 142000.00',
      ]),
      page(2, ['Schedule K-1 (1065)'], [
        "Partnership's name Horizon Property Partners LLP",
        "Partnership's employer identification number 52-2468101",
        'Guaranteed payments 24000.00',
      ]),
      page(3, ['Schedule K-1 (1065)'], [
        "Partnership's name Undisclosed Side LLC",
        "Partnership's employer identification number 11-2233445",
        'Guaranteed payments 8000.00',
      ]),
    ];
    const fields = mapIncomeFields(response(pages));
    const located = locateIncomeEntities({
      roster,
      fields,
      pages: pages.map((item) => ({
        pageIndex: item.index,
        formIds: item.formIds,
        text: item.words.map((word) => word.text).join(' '),
      })),
    });

    expect(located.roster).toHaveLength(3);
    expect(located.roster.every((row) => row.located)).toBe(true);
    expect(located.roster.find((row) => row.entity.name === 'Apex Advisory Holdings')?.matches[0].form).toBe('Form 1120-S');
    expect(located.roster.find((row) => row.entity.name === 'Horizon Property Partners')?.matches[0].form).toBe('Form 1065');
    expect(located.roster.find((row) => row.entity.name === 'Digital Solutions Corp')?.matches[0].form).toBe('W-2');
    expect(located.discovered.some((match) => match.name?.includes('Undisclosed Side'))).toBe(true);

    const scorps = seedSCorpFromLocation(located);
    const partnerships = seedPartnershipFromLocation(located);
    const wages = seedW2FromLocation(located, fields);
    expect(scorps).toHaveLength(1);
    expect(scorps[0].businessName).toMatch(/Apex Advisory/);
    expect(partnerships.map((seed) => seed.businessName).join(' ')).toMatch(/Horizon Property/);
    expect(partnerships.map((seed) => seed.businessName).join(' ')).toMatch(/Undisclosed Side/);
    expect(partnerships.find((seed) => seed.businessName?.includes('Undisclosed Side'))?.undisclosed).toBe(true);
    expect(wages.previous?.employerName).toMatch(/Digital Solutions/);
  });

  test('keeps a 1003 entity listed when the packet does not contain it', () => {
    const roster = employmentEntitiesFromUrlA({
      employmentType: 'W2',
      employerName: 'Missing Employer Inc',
      hasSecondJob: true,
      secondEmployer: 'Apex Technology Partners LLC',
    });
    const pages = [
      page(0, ['W-2'], [
        "c Employer's name Apex Technology Partners LLC",
        'b Employer identification number (EIN) 74-1234567',
        'Box 1 Wages tips other compensation 78500.00',
      ]),
    ];
    const located = locateIncomeEntities({
      roster,
      fields: mapIncomeFields(response(pages)),
      pages: pages.map((item) => ({
        pageIndex: item.index,
        formIds: item.formIds,
        text: item.words.map((word) => word.text).join(' '),
      })),
    });

    const missing = located.roster.find((row) => row.entity.name === 'Missing Employer Inc');
    const found = located.roster.find((row) => row.entity.name === 'Apex Technology Partners LLC');
    expect(missing?.located).toBe(false);
    expect(found?.located).toBe(true);
    const wages = seedW2FromLocation(located, mapIncomeFields(response(pages)));
    expect(wages.current).toHaveLength(2);
    expect(wages.current.find((seed) => seed.employerName === 'Missing Employer Inc')?.located).toBe(false);
  });
});

describe('undisclosed businesses on returns', () => {
  function locatePages(pages: ParsePage[], roster = employmentEntitiesFromUrlA({}), rentals?: { address: string; pageIndex: number; column?: string }[]) {
    const fields = mapIncomeFields(response(pages));
    return {
      fields,
      located: locateIncomeEntities({
        roster,
        fields,
        pages: pages.map((item) => ({
          pageIndex: item.index,
          formIds: item.formIds,
          text: item.words.map((word) => word.text).join(' '),
        })),
        rentals,
      }),
    };
  }

  test('discovers W-2, Schedule C, 1120-S, 1065, and Schedule F when the 1003 is empty', () => {
    const pages = [
      page(0, ['W-2'], [
        "c Employer's name Hidden Payroll Inc",
        'b Employer identification number (EIN) 99-1111111',
        'Box 1 Wages tips other compensation 51000.00',
      ]),
      page(1, ['Schedule C'], [
        'C Business name Hidden Consulting LLC',
        'B Employer identification number 99-2222222',
        'Line 31 Net profit or loss 18000.00',
      ]),
      page(2, ['Schedule K-1 (1120-S)'], [
        "Corporation's name Lakeside Dental Group",
        "Corporation's employer identification number 36-1112223",
        'Ordinary business income 88000.00',
      ]),
      page(3, ['Schedule K-1 (1065)'], [
        "Partnership's name Undisclosed Side LLC",
        "Partnership's employer identification number 11-2233445",
        'Guaranteed payments 8000.00',
      ]),
      page(4, ['Schedule F'], [
        'C Farm name Hidden Acre Farm',
        'B Employer identification number 99-3333333',
        'Line 34 Net farm profit or loss 64000.00',
      ]),
    ];
    const { located, fields } = locatePages(pages);
    expect(located.roster).toHaveLength(0);
    const names = located.discovered.map((match) => match.name).join(' | ');
    expect(names).toMatch(/Hidden Payroll/);
    expect(names).toMatch(/Hidden Consulting/);
    expect(names).toMatch(/Lakeside Dental/);
    expect(names).toMatch(/Undisclosed Side/);
    expect(names).toMatch(/Hidden Acre/);

    const wages = seedW2FromLocation(located, fields);
    expect(wages.current).toHaveLength(1);
    expect(wages.current[0].undisclosed).toBe(true);
    expect(seedScheduleCFromLocation(located)[0].undisclosed).toBe(true);
    expect(seedSCorpFromLocation(located)[0].undisclosed).toBe(true);
    expect(seedPartnershipFromLocation(located)[0].undisclosed).toBe(true);
    expect(seedFarmFromLocation(located)[0].undisclosed).toBe(true);
  });

  test('still discovers a classified business page when identity fields were not mapped', () => {
    const pages = [
      page(0, ['C-Corporation Return'], [
        'Form 1120 classified page without extractable identity boxes',
        'Some supporting schedule text',
      ]),
    ];
    const { located, fields } = locatePages(pages);
    expect(fields.filter((field) => field.form === 'Form 1120')).toHaveLength(0);
    expect(located.discovered).toHaveLength(1);
    expect(located.discovered[0].form).toBe('Form 1120');
    expect(located.discovered[0].name).toMatch(/Undisclosed C-Corporation/);
    expect(seedCCorpFromLocation(located)[0].undisclosed).toBe(true);
  });

  test('keeps extra Schedule E properties that were never listed on the 1003', () => {
    const roster = employmentEntitiesFromUrlA({
      ownsOtherRE: true,
      otherReAddress: '742 Evergreen Terrace',
    });
    const { located } = locatePages([], roster, [
      { address: '742 Evergreen Terrace, Springfield, IL', pageIndex: 0, column: 'A' },
      { address: '99 Hidden Lane', pageIndex: 1, column: 'B' },
    ]);
    expect(located.roster[0]?.located).toBe(true);
    expect(located.discovered.some((match) => match.name?.includes('99 Hidden Lane'))).toBe(true);
    expect(located.discovered.every((match) => match.form === 'Schedule E')).toBe(true);
  });

  test('merges two years of the same undisclosed business into one worksheet', () => {
    const pages = [
      page(0, ['Schedule K-1 (1065)'], [
        "Partnership's name Undisclosed Side LLC",
        "Partnership's employer identification number 11-2233445",
        'Ordinary business income 41000.00',
      ]),
      page(1, ['Schedule K-1 (1065)'], [
        "Partnership's name Undisclosed Side LLC",
        "Partnership's employer identification number 11-2233445",
        'Ordinary business income 38000.00',
      ]),
    ];
    const { located } = locatePages(pages);
    expect(located.discovered).toHaveLength(2);
    expect(uniqueDiscoveredBusinesses(located.discovered)).toHaveLength(1);
    const partnerships = seedPartnershipFromLocation(located);
    expect(partnerships).toHaveLength(1);
    expect(partnerships[0].undisclosed).toBe(true);
    expect(partnerships[0].years[0]).toMatchObject({ ordinaryIncome: 41000 });
    expect(partnerships[0].years[1]).toMatchObject({ ordinaryIncome: 38000 });
  });
});

