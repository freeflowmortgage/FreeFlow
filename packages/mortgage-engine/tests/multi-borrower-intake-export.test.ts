import {
  applyAnswer,
  coborrowerDocumentLines,
  coborrowersOf,
  getNextTurn,
  type IntakeAnswers,
} from '../../../apps/underwriting-console/src/intake/intake-agent';
import { buildMismo34Xml } from '../../../apps/underwriting-console/src/intake/mismoExport';
import {
  borrowersFromMismo,
  borrowersFromUrlA,
  employmentEntitiesFromMismo,
  employmentEntitiesFromUrlA,
} from '../../../apps/underwriting-console/src/urlaEmploymentRoster';
import { borrowersNamedIn, namesPerson, samePerson } from '../../../apps/underwriting-console/src/borrowers';
import { ENCOMPASS_URLA_FIELD_IDS, buildEncompassLoanUpdate, type Urla1003Intake } from '../src/encompass-urla-map';

const beforeEmployment: IntakeAnswers = {
  borrowerName: 'Nathan Jenson',
  email: 'n@example.com',
  phone: '602-555-0100',
  ssnLast4: '1234',
  dob: '01/01/1985',
  citizenship: 'US_CITIZEN',
  maritalStatus: 'MARRIED',
  dependentsCount: '0',
  currentAddress: '1 Main St, Phoenix, AZ',
  yearsAtAddress: '5',
  housingStatus: 'RENT',
  monthlyHousing: '1800',
  loanPurpose: 'PURCHASE',
  propertyAddress: 'TBD',
  propertyType: 'SFR',
  occupancy: 'PRIMARY',
  purchasePrice: '500000',
  loanAmount: '400000',
};

const primaryW2: Partial<IntakeAnswers> = {
  employmentType: 'W2',
  employerName: 'US Bank',
  jobTitle: 'Analyst',
  yearsAtJob: '6',
  monthlyIncome: '7000',
  hasSecondJob: false,
};

function nextId(answers: IntakeAnswers) {
  const turn = getNextTurn(answers);
  return 'done' in turn ? 'done' : turn.id;
}

function answerAll(start: IntakeAnswers, replies: Array<[string, string]>) {
  let answers = start;
  for (const [expectedId, reply] of replies) {
    expect(nextId(answers)).toBe(expectedId);
    answers = applyAnswer(answers, expectedId, reply);
  }
  return answers;
}

describe('intake asks for every co-borrower and their employment', () => {
  test('walks two co-borrowers through their own employment before other income', () => {
    const answers = answerAll(
      { ...beforeEmployment, ...primaryW2, hasCoborrower: true, coborrowerName: 'Maria Jenson' },
      [
        ['cob0.employmentType', 'SELF_EMPLOYED'],
        ['cob0.employerName', 'Riverbend Holdings LLC'],
        ['cob0.jobTitle', 'Owner'],
        ['cob0.yearsInBusiness', '4'],
        ['cob0.monthlyIncome', '5000'],
        ['cob0.hasSecondJob', 'no'],
        ['addCoborrower', 'yes'],
        ['cob1.name', 'Luis Ortega'],
        ['cob1.employmentType', 'W2'],
        ['cob1.employerName', 'Banner Health'],
        ['cob1.jobTitle', 'Nurse'],
        ['cob1.yearsAtJob', '3'],
        ['cob1.monthlyIncome', '6100'],
        ['cob1.hasSecondJob', 'no'],
        ['addCoborrower', 'no'],
      ],
    );
    expect(nextId(answers)).toBe('hasOtherIncome');
    expect(coborrowersOf(answers).map((c) => `${c.name}:${c.employmentType}:${c.employerName}`)).toEqual([
      'Maria Jenson:SELF_EMPLOYED:Riverbend Holdings LLC',
      'Luis Ortega:W2:Banner Health',
    ]);
    expect(answers.coborrowerName).toBe('Maria Jenson');
    expect(coborrowerDocumentLines(answers).join('\n')).toMatch(/Maria \(co-borrower\) is self-employed through Riverbend/);
    expect(coborrowerDocumentLines(answers).join('\n')).toMatch(/Luis \(co-borrower\).*Banner Health/);
  });

  test('a borrower without a co-borrower skips the co-borrower loop', () => {
    const answers = applyAnswer({ ...beforeEmployment, ...primaryW2 }, 'hasCoborrower', 'no');
    expect(nextId(answers)).toBe('hasOtherIncome');
    expect(coborrowersOf(answers)).toEqual([]);
  });

  test('keeps the primary borrower prompts unchanged', () => {
    const turn = getNextTurn({ ...beforeEmployment, hasCoborrower: false });
    expect('done' in turn ? '' : turn.id).toBe('employmentType');
  });
});

describe('person-name matching', () => {
  test('needs first and last name and tolerates one typo in long names', () => {
    expect(namesPerson('EMPLOYEE: JENSON, NATHAN W', 'Nathan Jenson')).toBe(true);
    expect(namesPerson('Nathen Jenson 123 Main St', 'Nathan Jenson')).toBe(true);
    expect(namesPerson('Maria Jenson', 'Nathan Jenson')).toBe(false);
    expect(samePerson('Nathan W. Jenson Jr.', 'nathan jenson')).toBe(true);
    const borrowers = [
      { id: 'borrower-1', name: 'Nathan Jenson', role: 'Borrower' as const },
      { id: 'borrower-2', name: 'Maria Jenson', role: 'CoBorrower' as const },
    ];
    expect(borrowersNamedIn('Pay to the order of MARIA JENSON', borrowers).map((b) => b.id)).toEqual(['borrower-2']);
  });
});

const twoBorrowerIntake: IntakeAnswers = {
  ...beforeEmployment,
  ...primaryW2,
  hasCoborrower: true,
  coborrowerName: 'Maria Jenson',
  coborrowers: [
    {
      name: 'Maria Jenson',
      employmentType: 'SELF_EMPLOYED',
      employerName: 'Riverbend Holdings LLC',
      jobTitle: 'Owner',
      yearsInBusiness: '4',
      monthlyIncome: '5000',
    },
    { name: 'Luis Ortega', employmentType: 'W2', employerName: 'US Bank', jobTitle: 'Teller', yearsAtJob: '1', monthlyIncome: '3000', previousEmployer: 'Safeway', previousEmployerYears: '3' },
  ],
  coborrowersDone: true,
};

describe('1003 roster tags every employer with its borrower', () => {
  test('from intake answers', () => {
    expect(borrowersFromUrlA(twoBorrowerIntake).map((b) => `${b.id}:${b.role}:${b.name}`)).toEqual([
      'borrower-1:Borrower:Nathan Jenson',
      'borrower-2:CoBorrower:Maria Jenson',
      'borrower-3:CoBorrower:Luis Ortega',
    ]);
    const roster = employmentEntitiesFromUrlA(twoBorrowerIntake);
    expect(roster.map((e) => `${e.borrowerId}:${e.classification}:${e.name}`)).toEqual([
      'borrower-1:Primary:US Bank',
      'borrower-2:Primary:Riverbend Holdings LLC',
      'borrower-3:Primary:US Bank',
      'borrower-3:Previous:Safeway',
    ]);
    expect(new Set(roster.map((e) => e.id)).size).toBe(roster.length);
  });

  test('from the MISMO export, one PARTY per borrower', () => {
    const xml = buildMismo34Xml(twoBorrowerIntake);
    expect(xml.match(/<BorrowerClassificationType>Primary<\/BorrowerClassificationType>/g)).toHaveLength(1);
    expect(xml.match(/<BorrowerClassificationType>Secondary<\/BorrowerClassificationType>/g)).toHaveLength(2);
    expect(borrowersFromMismo(xml).map((b) => b.name)).toEqual(['Nathan Jenson', 'Maria Jenson', 'Luis Ortega']);
    const roster = employmentEntitiesFromMismo(xml);
    expect(roster.map((e) => `${e.borrowerId}:${e.classification}:${e.name}`)).toEqual([
      'borrower-1:Primary:US Bank',
      'borrower-2:Primary:Riverbend Holdings LLC',
      'borrower-3:Primary:US Bank',
      'borrower-3:Previous:Safeway',
    ]);
  });
});

describe('Encompass export writes each borrower’s own employment and income', () => {
  const urla = twoBorrowerIntake as Urla1003Intake;

  test('pairs borrowers into applications and marks the owner of every job', () => {
    const { loan } = buildEncompassLoanUpdate({ urla });
    expect(loan.applications).toHaveLength(2);
    expect(loan.applications[0].coborrower).toEqual({ firstName: 'Maria', lastName: 'Jenson' });
    expect(loan.applications[1].borrower).toEqual({ firstName: 'Luis', lastName: 'Ortega' });
    expect(loan.applications[0].employment.map((job) => `${job.owner}:${job.employerName}`)).toEqual([
      'Borrower:US Bank',
      'CoBorrower:Riverbend Holdings LLC',
    ]);
    expect(loan.applications[1].employment.map((job) => `${job.owner}:${job.employerName}:${job.currentEmploymentIndicator}`)).toEqual([
      'Borrower:US Bank:true',
      'Borrower:Safeway:false',
    ]);
  });

  test('splits 1084 income by borrower instead of crediting the primary with everything', () => {
    const { loan, fieldWriter } = buildEncompassLoanUpdate({
      urla,
      income1084: {
        qualifyingMonthlyIncome: 17100,
        w2BaseMonthly: 10000,
        form1065_MonthlyTotal: 4100,
        byBorrower: [
          { borrowerIndex: 0, w2BaseMonthly: 7000, qualifyingMonthlyIncome: 7000 },
          { borrowerIndex: 1, selfEmployedMonthly: 4100, qualifyingMonthlyIncome: 4100 },
          { borrowerIndex: 2, w2BaseMonthly: 3000, w2VariableMonthly: 250, qualifyingMonthlyIncome: 3250 },
        ],
      },
    });
    const fields = fieldWriter.fields;
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.INCOME_BASE]).toBe('7000.00');
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_FIRST_NAME]).toBe('Maria');
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_INCOME_BASE]).toBeUndefined();
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_NAME]).toBe('Riverbend Holdings LLC');
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_SELF_EMPLOYED]).toBe('Y');
    const maria = loan.applications[0].employment.find((job) => job.owner === 'CoBorrower');
    expect(maria?.monthlyIncomeAmount).toBe(4100);
    expect(loan.applications[1].employment[0].monthlyIncomeAmount).toBe(3000);
  });

  test('a W-2 co-borrower gets base and overtime in 110/111', () => {
    const { fieldWriter } = buildEncompassLoanUpdate({
      urla: {
        ...urla,
        coborrowers: [{ name: 'Maria Jenson', employmentType: 'W2', employerName: 'Banner Health', yearsAtJob: '3', monthlyIncome: '5200' }],
      },
      income1084: {
        qualifyingMonthlyIncome: 12500,
        byBorrower: [
          { borrowerIndex: 0, w2BaseMonthly: 7000, qualifyingMonthlyIncome: 7000 },
          { borrowerIndex: 1, w2BaseMonthly: 5000, w2VariableMonthly: 500, qualifyingMonthlyIncome: 5500 },
        ],
      },
    });
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_INCOME_BASE]).toBe('5000.00');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_INCOME_OVERTIME]).toBe('500.00');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_YEARS_ON_JOB]).toBe('3');
  });
});
