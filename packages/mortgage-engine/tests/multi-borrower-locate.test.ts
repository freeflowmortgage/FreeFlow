import {
  assignmentKey,
  locateIncomeEntities,
  type LocatePage,
} from '../../../apps/underwriting-console/src/locateIncomeEntities';
import {
  seedPartnershipFromLocation,
  seedW2FromLocation,
} from '../../../apps/underwriting-console/src/hydrateFromUrlA';
import { borrowersFromUrlA, employmentEntitiesFromUrlA } from '../../../apps/underwriting-console/src/urlaEmploymentRoster';
import type { MappedIncomeField } from '../../../apps/underwriting-console/src/parseTypes';

function field(
  documentId: string,
  pageIndex: number,
  form: MappedIncomeField['form'],
  sourceFieldId: string,
  value: string,
  numericValue = 0,
): MappedIncomeField {
  return {
    id: `${sourceFieldId}--${documentId}-${pageIndex}`,
    sourceFieldId,
    entityId: `${form.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${pageIndex}`,
    documentId,
    form,
    boxLabel: '',
    fieldLabel: sourceFieldId,
    lineNum: '',
    category: 'income',
    value,
    numericValue,
    pageIndex,
    wordIndex: 0,
    box: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 },
  };
}

function w2(documentId: string, employee: string, employer = 'US Bank National Association', ein = '41-0255900', wages = 90000) {
  return [
    field(documentId, 0, 'W-2', 'w2-employer-name', employer),
    field(documentId, 0, 'W-2', 'w2-employer-ein', ein),
    field(documentId, 0, 'W-2', 'w2-employee-name', employee),
    field(documentId, 0, 'W-2', 'w2-box5', `$${wages}`, wages),
  ];
}

function stub(documentId: string, employee: string | undefined, employer = 'US Bank National Association', ytd = 60000) {
  return [
    field(documentId, 0, 'Paystub', 'ps-employer-name', employer),
    ...(employee ? [field(documentId, 0, 'Paystub', 'ps-employee-name', employee)] : []),
    field(documentId, 0, 'Paystub', 'ps-base-ytd', `$${ytd}`, ytd),
  ];
}

function pages(docs: Array<[string, string, string]>): LocatePage[] {
  return docs.map(([documentId, formId, text]) => ({ documentId, pageIndex: 0, formIds: [formId], text }));
}

const intake = {
  borrowerName: 'Nathan Jenson',
  employmentType: 'W2' as const,
  employerName: 'US Bank National Association',
  hasCoborrower: true,
  coborrowerName: 'Maria Jenson',
  coborrowers: [{ name: 'Maria Jenson', employmentType: 'W2' as const, employerName: 'US Bank National Association' }],
};

describe('documents are assigned to the borrower they name', () => {
  const roster = employmentEntitiesFromUrlA(intake);
  const borrowers = borrowersFromUrlA(intake);
  const fields = [
    ...w2('w2-nathan', 'NATHAN W JENSON'),
    ...w2('w2-maria', 'Maria Jenson', undefined, undefined, 70000),
    ...stub('stub-nathan', 'Nathan Jenson', undefined, 61000),
    ...stub('stub-maria', 'Maria Jenson', undefined, 48000),
    ...stub('stub-luis', 'Luis Ortega', undefined, 30000),
  ];
  const located = locateIncomeEntities({
    roster,
    borrowers,
    fields,
    pages: pages([
      ['w2-nathan', 'W-2', 'Form W-2 US Bank Nathan W Jenson'],
      ['w2-maria', 'W-2', 'Form W-2 US Bank Maria Jenson'],
      ['stub-nathan', 'Paystub', 'Earnings statement Nathan Jenson'],
      ['stub-maria', 'Paystub', 'Earnings statement Maria Jenson'],
      ['stub-luis', 'Paystub', 'Earnings statement Luis Ortega'],
    ]),
  });

  test('spouses at the same employer each keep their own W-2 and pay stub', () => {
    const [nathanRow, mariaRow] = located.roster;
    expect(nathanRow.entity.borrowerId).toBe('borrower-1');
    expect(mariaRow.entity.borrowerId).toBe('borrower-2');
    const docsOf = (row: typeof nathanRow) => [...new Set(row.matches.flatMap((m) => m.fields.map((f) => f.documentId)))].sort();
    expect(docsOf(nathanRow)).toEqual(['stub-nathan', 'w2-nathan']);
    expect(docsOf(mariaRow)).toEqual(['stub-maria', 'w2-maria']);
    expect(nathanRow.matches.every((m) => m.borrowerIds?.[0] === 'borrower-1')).toBe(true);
  });

  test('a pay stub for someone not on the 1003 is held out with a warning', () => {
    expect(located.unidentified?.map((m) => m.personName)).toEqual(['Luis Ortega']);
    const allCounted = [...located.roster.flatMap((r) => r.matches), ...located.discovered].flatMap((m) => m.fields);
    expect(allCounted.some((f) => f.documentId === 'stub-luis')).toBe(false);
    expect(located.warnings).toEqual([
      expect.objectContaining({
        code: 'UNIDENTIFIED_BORROWER',
        documentId: 'stub-luis',
        message: expect.stringMatching(/names Luis Ortega, who is not a borrower on the 1003/),
      }),
    ]);
  });

  test('wage seeds carry the borrower, and the held-out stub is not folded in by employer name', () => {
    const { current } = seedW2FromLocation(located, fields);
    expect(current.map((seed) => `${seed.borrowerId}:${seed.documentIds.sort().join('+')}`)).toEqual([
      'borrower-1:stub-nathan+w2-nathan',
      'borrower-2:stub-maria+w2-maria',
    ]);
  });

  test('the underwriter can assign a held-out document to a borrower', () => {
    const luis = located.unidentified![0];
    const reassigned = locateIncomeEntities({
      roster,
      borrowers,
      fields,
      pages: pages([['stub-luis', 'Paystub', 'Earnings statement Luis Ortega']]),
      assignments: { [assignmentKey(luis)]: 'borrower-2' },
    });
    expect(reassigned.unidentified).toEqual([]);
    const mariaDocs = reassigned.roster[1].matches.flatMap((m) => m.fields.map((f) => f.documentId));
    expect(mariaDocs).toContain('stub-luis');
  });
});

describe('a document that names no borrower', () => {
  test('is held out when a 1003 is loaded', () => {
    const located = locateIncomeEntities({
      roster: employmentEntitiesFromUrlA({ borrowerName: 'Nathan Jenson', employerName: 'Apex Technology' }),
      borrowers: borrowersFromUrlA({ borrowerName: 'Nathan Jenson' }),
      fields: stub('stub-x', undefined, 'Apex Technology'),
      pages: pages([['stub-x', 'Paystub', 'Earnings statement Apex Technology Dana Rivera']]),
    });
    expect(located.unidentified).toHaveLength(1);
    expect(located.warnings?.[0].message).toMatch(/does not name any borrower on the 1003/);
  });

  test('is matched by the borrower name in the page text when no name field was read', () => {
    const located = locateIncomeEntities({
      roster: employmentEntitiesFromUrlA({ borrowerName: 'Nathan Jenson', employerName: 'Apex Technology' }),
      borrowers: borrowersFromUrlA({ borrowerName: 'Nathan Jenson' }),
      fields: stub('stub-x', undefined, 'Apex Technology'),
      pages: pages([['stub-x', 'Paystub', 'Nathan Jenson 22911 E Thornton Rd Name Company']]),
    });
    expect(located.unidentified).toEqual([]);
    expect(located.roster[0].matches[0].borrowerIds).toEqual(['borrower-1']);
  });
});

describe('without a 1003', () => {
  test('borrowers come from the documents, income is still counted, and the underwriter is warned', () => {
    const located = locateIncomeEntities({
      roster: [],
      fields: [...w2('w2-a', 'Nathan Jenson'), ...w2('w2-b', 'Maria Jenson', 'Banner Health', '86-0000001')],
    });
    expect(located.borrowers?.map((b) => `${b.id}:${b.name}:${b.fromDocuments}`)).toEqual([
      'borrower-1:Nathan Jenson:true',
      'borrower-2:Maria Jenson:true',
    ]);
    expect(located.discovered.map((m) => m.borrowerIds?.[0])).toEqual(['borrower-1', 'borrower-2']);
    expect(located.unidentified).toEqual([]);
    expect(located.warnings?.map((w) => w.code)).toEqual(['UNCONFIRMED_BORROWERS']);
  });

  test('one person on the documents raises no warning', () => {
    const located = locateIncomeEntities({ roster: [], fields: [...w2('w2-a', 'Nathan Jenson'), ...stub('s', 'Nathan Jenson')] });
    expect(located.warnings).toEqual([]);
  });
});

describe('two partners in one partnership', () => {
  const k1 = (documentId: string, partner: string, ordinary: number, pct: number) => [
    field(documentId, 0, 'Form 1065', 'pt-name', 'Riverbend Holdings LLC'),
    field(documentId, 0, 'Form 1065', 'pt-ein', '86-1234567'),
    field(documentId, 0, 'Form 1065', 'pt-partner-name', partner),
    field(documentId, 0, 'Form 1065', 'pt-ord', `$${ordinary}`, ordinary),
    field(documentId, 0, 'Form 1065', 'pt-profit-pct', `${pct}%`, pct),
  ];
  const returnFace = [
    field('return', 0, 'Form 1065', 'pt-return-name', 'Riverbend Holdings LLC'),
    field('return', 0, 'Form 1065', 'pt-return-ein', '86-1234567'),
    field('return', 0, 'Form 1065', 'pt-return-dep', '$10000', 10000),
  ];
  const both = {
    ...intake,
    employmentType: 'SELF_EMPLOYED' as const,
    employerName: 'Riverbend Holdings LLC',
    coborrowers: [{ name: 'Maria Jenson', employmentType: 'SELF_EMPLOYED' as const, employerName: 'Riverbend Holdings LLC' }],
  };

  test('each borrower gets their own K-1, and the return lines go on both', () => {
    const located = locateIncomeEntities({
      roster: employmentEntitiesFromUrlA(both),
      borrowers: borrowersFromUrlA(both),
      fields: [...k1('k1-n', 'Nathan Jenson', 42000, 50), ...k1('k1-m', 'Maria Jenson', 42000, 50), ...returnFace],
    });
    const [nathan, maria] = located.roster;
    expect(nathan.matches.map((m) => m.documentId)).toEqual(['k1-n']);
    expect(maria.matches.map((m) => m.documentId)).toEqual(['k1-m']);
    for (const row of [nathan, maria]) {
      expect(row.matches[0].fields.some((f) => f.sourceFieldId === 'pt-return-dep')).toBe(true);
    }
    const seeds = seedPartnershipFromLocation(located);
    expect(seeds.map((seed) => seed.borrowerId)).toEqual(['borrower-1', 'borrower-2']);
  });

  test('undisclosed K-1s for two people stay two partnerships', () => {
    const located = locateIncomeEntities({
      roster: [],
      fields: [...k1('k1-n', 'Nathan Jenson', 42000, 50), ...k1('k1-m', 'Maria Jenson', 42000, 50)],
    });
    const seeds = seedPartnershipFromLocation(located);
    expect(seeds.map((seed) => `${seed.borrowerId}:${seed.personName}`)).toEqual([
      'borrower-1:Nathan Jenson',
      'borrower-2:Maria Jenson',
    ]);
  });
});
