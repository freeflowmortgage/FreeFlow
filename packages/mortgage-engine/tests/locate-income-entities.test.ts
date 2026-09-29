import { mapIncomeFields } from '../../../apps/underwriting-console/src/incomeFieldMap';
import {
  formFromPageLabels,
  formToDocKind,
  locateIncomeEntities,
  uniqueDiscoveredBusinesses,
} from '../../../apps/underwriting-console/src/locateIncomeEntities';
import {
  seedCCorpFromLocation,
  seedFarmFromLocation,
  seedPartnershipFromLocation,
  seedScheduleCFromLocation,
  seedSCorpFromLocation,
  seedW2FromLocation,
} from '../../../apps/underwriting-console/src/hydrateFromUrlA';
import { employmentEntitiesFromUrlA } from '../../../apps/underwriting-console/src/urlaEmploymentRoster';
import type { MappedIncomeField, ParsePage, ParseResponse, ParseWord } from '../../../apps/underwriting-console/src/parseTypes';

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
        'Box 1 Wages tips other compensation 21000.00',
        'Box 5 Medicare wages and tips 24000.00',
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
    expect(wages.previous?.box5Wages).toBe(24000);
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
        'Box 1 Wages tips other compensation 74000.00',
        'Box 5 Medicare wages and tips 78500.00',
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
        'Box 1 Wages tips other compensation 46000.00',
        'Box 5 Medicare wages and tips 51000.00',
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

  test('recognizes Form 8825 pages without treating them as a separate business', () => {
    expect(formFromPageLabels(['Form 8825 (Corporate Rentals)'])).toBe('Form 8825');
    expect(formToDocKind('Form 8825')).toBe('unknown');
    const { located } = locatePages([
      page(0, ['Schedule K-1 (1120-S)'], [
        "Corporation's name Apex Advisory Holdings",
        "Corporation's employer identification number 74-9876543",
        'Ordinary business income 142000.00',
      ]),
      page(1, ['Form 8825 (Corporate Rentals)'], [
        'Form 8825 Rental Real Estate Income and Expenses',
        '14 Depreciation 400.00 600.00 8,200.00',
      ]),
    ]);
    expect(located.discovered.every((match) => match.form !== 'Form 8825')).toBe(true);
    expect(located.discovered.some((match) => match.form === 'Form 1120-S')).toBe(true);
    const scorp = located.discovered.find((match) => match.form === 'Form 1120-S');
    expect(scorp?.fields.some((field) => field.sourceFieldId === 'form-8825-dep' && field.numericValue === 8200)).toBe(true);
    expect(seedSCorpFromLocation(located)[0].years[0]).toMatchObject({ ordinaryIncome: 142000, depreciation: 8200 });
  });

  test('keeps an 8825 packet that never appeared on the 1003 as a discovered business', () => {
    const { located } = locatePages([
      page(0, ['Form 8825 (Corporate Rentals)'], [
        'Form 8825 Rental Real Estate Income and Expenses',
        'Name of partnership or S corporation Lakeside Dental Group',
        'Employer identification number 36-1112223',
        '14 Depreciation 400.00 600.00 8,200.00',
      ]),
    ]);
    expect(located.roster).toHaveLength(0);
    expect(located.discovered).toHaveLength(1);
    expect(located.discovered[0].kind).toBe('scorp');
    expect(located.discovered[0].name).toMatch(/Lakeside Dental/);
    expect(located.discovered[0].fields.some((field) => field.sourceFieldId === 'form-8825-dep')).toBe(true);
    const scorps = seedSCorpFromLocation(located);
    expect(scorps).toHaveLength(1);
    expect(scorps[0].undisclosed).toBe(true);
    expect(scorps[0].years[0]).toMatchObject({ depreciation: 8200, businessName: expect.stringMatching(/Lakeside Dental/) });
  });

  test('keeps two undisclosed W-2 jobs and folds each paystub onto the matching employer', () => {
    const pages = [
      page(0, ['W-2'], [
        "c Employer's name Hidden Payroll Inc",
        'b Employer identification number (EIN) 99-1111111',
        'Box 1 Wages tips other compensation 46000.00',
        'Box 5 Medicare wages and tips 51000.00',
      ]),
      page(1, ['W-2'], [
        "c Employer's name Weekend Health Inc",
        'b Employer identification number (EIN) 22-2222222',
        'Box 1 Wages tips other compensation 21000.00',
        'Box 5 Medicare wages and tips 24000.00',
      ]),
      page(2, ['Paystub'], [
        'Employer: Hidden Payroll Inc',
        'Regular 45.00 80.00 3,600.00 54,000.00',
      ]),
      page(3, ['Paystub'], [
        'Employer: Weekend Health Inc',
        'Regular 20.00 40.00 800.00 9,600.00',
      ]),
    ];
    const { located, fields } = locatePages(pages);
    expect(located.discovered.filter((match) => match.kind === 'w2')).toHaveLength(2);
    const wages = seedW2FromLocation(located, fields);
    expect(wages.current).toHaveLength(2);
    const hidden = wages.current.find((seed) => seed.employerName.includes('Hidden Payroll'));
    const weekend = wages.current.find((seed) => seed.employerName.includes('Weekend Health'));
    expect(hidden?.patch).toMatchObject({ w2Year1Box5: 51000, baseYtd: 54000 });
    expect(weekend?.patch).toMatchObject({ w2Year1Box5: 24000, baseYtd: 9600 });
  });

  test('keeps a second employer when the packet has only pay stubs', () => {
    const pages = [
      page(0, ['Paystub'], ['Employer: Contoso Freight Inc', 'Regular 30.00 80.00 2,400.00 31,200.00']),
      page(1, ['Paystub'], ['Employer: Northwind Medical Group', 'Regular 22.00 40.00 880.00 11,440.00']),
    ];
    const { located, fields } = locatePages(pages);
    const jobs = located.discovered.filter((match) => match.kind === 'w2').map((match) => match.name);
    expect(jobs).toEqual(expect.arrayContaining([
      expect.stringMatching(/Contoso Freight/),
      expect.stringMatching(/Northwind Medical/),
    ]));
    expect(seedW2FromLocation(located, fields).current).toHaveLength(2);
  });

  test('does not merge page zero from an unrelated PDF into a matched employer', () => {
    const w2Page = page(0, ['W-2'], [
      "c Employer's name Hidden Payroll Inc",
      'b Employer identification number (EIN) 99-1111111',
      'Box 5 Medicare wages and tips 51000.00',
    ]);
    const hiddenPaystub = page(0, ['Paystub'], [
      'Employer: Hidden Payroll Inc',
      'Regular 45.00 80.00 3,600.00 54,000.00',
    ]);
    const unrelatedPaystub = page(0, ['Paystub'], [
      'Employer: Other Company LLC',
      'Regular 20.00 40.00 800.00 9,600.00',
    ]);
    const withDocument = (doc: string, source: ParsePage) =>
      mapIncomeFields(response([source])).map((field) => ({ ...field, documentId: doc }));
    const fields = [
      ...withDocument('w2-hidden', w2Page),
      ...withDocument('stub-hidden', hiddenPaystub),
      ...withDocument('stub-other', unrelatedPaystub),
    ];
    const located = locateIncomeEntities({
      roster: employmentEntitiesFromUrlA({}),
      fields,
      pages: [
        { documentId: 'w2-hidden', pageIndex: 0, formIds: w2Page.formIds, text: w2Page.words.map((word) => word.text).join(' ') },
        { documentId: 'stub-hidden', pageIndex: 0, formIds: hiddenPaystub.formIds, text: hiddenPaystub.words.map((word) => word.text).join(' ') },
        { documentId: 'stub-other', pageIndex: 0, formIds: unrelatedPaystub.formIds, text: unrelatedPaystub.words.map((word) => word.text).join(' ') },
      ],
    });

    const wages = seedW2FromLocation(located, fields);
    const hidden = wages.current.find((seed) => seed.employerName.includes('Hidden Payroll'));
    expect(hidden?.patch).toMatchObject({ w2Year1Box5: 51000, baseYtd: 54000 });
    expect(hidden?.documentIds).toEqual(expect.arrayContaining(['w2-hidden', 'stub-hidden']));
    expect(hidden?.documentIds).not.toContain('stub-other');
  });

  test('keeps two undisclosed Schedule C businesses on separate worksheets', () => {
    const { located } = locatePages([
      page(0, ['Schedule C'], [
        'C Business name Hidden Consulting LLC',
        'B Employer identification number 99-2222222',
        'Line 31 Net profit or loss 18000.00',
      ]),
      page(1, ['Schedule C'], [
        'C Business name Night Market Stand',
        'B Employer identification number 99-4444444',
        'Line 31 Net profit or loss 6200.00',
      ]),
    ]);
    const businesses = seedScheduleCFromLocation(located);
    expect(businesses).toHaveLength(2);
    expect(businesses.map((seed) => seed.businessName).join(' ')).toMatch(/Hidden Consulting/);
    expect(businesses.map((seed) => seed.businessName).join(' ')).toMatch(/Night Market/);
    expect(businesses.every((seed) => seed.undisclosed)).toBe(true);
  });
});

describe('a 1065 return with its Schedule L', () => {
  function field(sourceFieldId: string, pageIndex: number, value: string, numericValue = 0): MappedIncomeField {
    return {
      id: sourceFieldId,
      sourceFieldId,
      entityId: `form-1065-p${pageIndex}`,
      documentId: 'doc1',
      form: 'Form 1065',
      boxLabel: '',
      fieldLabel: sourceFieldId,
      lineNum: '',
      category: '',
      value,
      numericValue,
      pageIndex,
      wordIndex: 0,
      box: { x: 0, y: 0, w: 0, h: 0 },
    };
  }

  const returnFace = [
    field('pt-return-name', 0, 'Riverbend Holdings LLC'),
    field('pt-return-ein', 0, '86-1234567'),
    field('pt-return-ord', 0, '$4,570.00', 4570),
  ];
  const scheduleL = [field('sch-l-cash', 5, '$55,000.00', 55000), field('sch-l-ap', 5, '$22,000.00', 22000)];
  const k1 = [
    field('pt-name', 6, 'Riverbend Holdings LLC'),
    field('pt-ein', 6, '86-1234567'),
    field('pt-ord', 6, '$42,000.00', 42000),
  ];
  const pages = [
    { documentId: 'doc1', pageIndex: 0, formIds: ['Form 1065 (Partnership Return)'], text: 'Form 1065 Riverbend Holdings LLC 86-1234567' },
    { documentId: 'doc1', pageIndex: 5, formIds: ['Schedule L'], text: 'Schedule L Balance Sheets per Books' },
    { documentId: 'doc1', pageIndex: 6, formIds: ['Schedule K-1 (1065)'], text: 'Schedule K-1 (Form 1065)' },
  ];

  test('keeps Schedule L on the return when the packet has no K-1', () => {
    const located = locateIncomeEntities({ roster: [], fields: [...returnFace, ...scheduleL], pages: pages.slice(0, 2) });
    expect(located.discovered).toHaveLength(1);
    expect(located.discovered[0].name).toBe('Riverbend Holdings LLC');
    const ids = located.discovered[0].fields.map((item) => item.sourceFieldId);
    expect(ids).toEqual(expect.arrayContaining(['pt-return-ord', 'sch-l-cash', 'sch-l-ap']));
  });

  test('does not add the return face as a second, empty partnership beside its K-1', () => {
    const located = locateIncomeEntities({ roster: [], fields: [...returnFace, ...scheduleL, ...k1], pages });
    expect(located.discovered).toHaveLength(1);
    const ids = located.discovered[0].fields.map((item) => item.sourceFieldId);
    expect(ids).toEqual(expect.arrayContaining(['pt-ord', 'pt-return-ord', 'sch-l-cash']));
  });
});

