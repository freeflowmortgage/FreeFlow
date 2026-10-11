import { ENCOMPASS_CUSTOM_FIELD_SETUP, encompassCustomFieldNames } from '../src/encompass-custom-fields';
import {
  ENCOMPASS_URLA_FIELD_IDS,
  buildEncompassLoanUpdate,
  splitLegalName,
} from '../src/encompass-urla-map';
import { buildEncompassFieldUpdatePayload } from '../src/map-encompass-fields-v2';

const fullUrla = {
  borrowerName: 'Jordan A Lee',
  email: 'jordan@example.com',
  phone: '555-0100',
  ssnLast4: '4432',
  dob: '1988-04-12',
  citizenship: 'US_CITIZEN' as const,
  maritalStatus: 'MARRIED' as const,
  dependentsCount: '2',
  currentAddress: '88 Pine St, Austin TX',
  yearsAtAddress: '3',
  housingStatus: 'RENT' as const,
  monthlyHousing: '1850',
  hasCoborrower: true,
  coborrowerName: 'Alex Lee',
  loanPurpose: 'PURCHASE' as const,
  propertyAddress: '1200 Oak Ave',
  propertyType: 'SFR' as const,
  occupancy: 'PRIMARY' as const,
  purchasePrice: '425000',
  loanAmount: '340000',
  employmentType: 'W2' as const,
  employerName: 'Apex Technology',
  jobTitle: 'Analyst',
  yearsAtJob: '4',
  monthlyIncome: '6200',
  hasSecondJob: true,
  secondEmployer: 'Weekend Health',
  secondMonthlyIncome: '900',
  hasOtherIncome: true,
  otherIncomeType: 'Child Support',
  otherIncomeMonthly: '400',
  receivingGift: true,
  giftAmount: '10000',
  giftSource: 'RELATIVE' as const,
  ownsOtherRE: true,
  otherReAddress: '14 Lake Rd',
  otherReValue: '280000',
  otherReMortgage: '190000',
  declOccupyPrimary: true,
  declJudgment: false,
  declBankruptcy: false,
  declForeclosure: false,
  declLawsuit: false,
  declDelinquentFed: false,
  declBorrowedDown: false,
  declCoMaker: false,
  hmdaEthnicity: 'NOT_HISPANIC' as const,
  hmdaRace: 'WHITE' as const,
  hmdaSex: 'FEMALE' as const,
  program: 'CONVENTIONAL' as const,
};

const income1084 = {
  qualifyingMonthlyIncome: 8125.5,
  trendingAnalysis: 'Stable',
  yearsAnalyzed: [2024, 2025],
  w2BaseMonthly: 5200,
  w2VariableMonthly: 350,
  scheduleC_MonthlyTotal: 1100,
  form1120S_MonthlyTotal: 800,
  form1065_MonthlyTotal: 0,
  form1120_MonthlyTotal: 0,
  scheduleF_MonthlyTotal: 0,
  assetIncomeMonthly: 75,
  rentalMonthly: 600,
  rentalLiabilityMonthly: 0,
  housingExpenseAdjustment: 0,
  auditUrl: 'https://app.example.com/audit/loan-1',
  programUsed: 'CONVENTIONAL',
};

describe('Encompass custom field setup', () => {
  test('catalog covers every CX.FREEFLOW field the mapper writes', () => {
    const names = encompassCustomFieldNames();
    expect(names).toEqual(expect.arrayContaining([
      'CX.FREEFLOW.INCOME',
      'CX.FREEFLOW.W2.BASE',
      'CX.FREEFLOW.W2.VARIABLE',
      'CX.FREEFLOW.SCH.C',
      'CX.FREEFLOW.RENTAL',
      'CX.FREEFLOW.AUDIT.URL',
      'CX.FREEFLOW.SOURCE',
    ]));
    expect(new Set(names).size).toBe(ENCOMPASS_CUSTOM_FIELD_SETUP.length);
  });
});

describe('AI 1003 / URLA Encompass mapping', () => {
  test('uses the direct connector customFields array, not a dictionary or root otherIncome', () => {
    const update = buildEncompassLoanUpdate({ urla: fullUrla, income1084 });
    expect(Array.isArray(update.loan.customFields)).toBe(true);
    expect(update.loan.customFields[0]).toEqual(
      expect.objectContaining({ fieldName: expect.stringMatching(/^CX\.FREEFLOW\./), value: expect.any(String) }),
    );
    expect(update.loan).not.toHaveProperty('otherIncome');
    expect(update.source).toBe('COMBINED');
  });

  test('maps AI 1003 borrower and loan fields onto standard URLA IDs', () => {
    const { fieldWriter, loan } = buildEncompassLoanUpdate({ urla: fullUrla });
    expect(splitLegalName(fullUrla.borrowerName)).toEqual({
      firstName: 'Jordan',
      middleName: 'A',
      lastName: 'Lee',
    });
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.BORROWER_FIRST_NAME]).toBe('Jordan');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.BORROWER_LAST_NAME]).toBe('Lee');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.BORROWER_EMAIL]).toBe('jordan@example.com');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.LOAN_AMOUNT]).toBe('340000.00');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.PURCHASE_PRICE]).toBe('425000.00');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.LOAN_PURPOSE]).toBe('Purchase');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.OCCUPANCY]).toBe('PrimaryResidence');
    expect(fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.MORTGAGE_TYPE]).toBe('Conventional');
    expect(loan.applications[0].borrower.firstName).toBe('Jordan');
    expect(loan.applications[0].borrower.emailAddressText).toBe('jordan@example.com');
    expect(loan.borrowerRequestedLoanAmount).toBe(340000);
    expect(loan.property?.occupancyType).toBe('PrimaryResidence');
  });

  test('does not write SSN last-4 onto Encompass field 66', () => {
    const update = buildEncompassLoanUpdate({ urla: fullUrla });
    expect(update.fieldWriter.fields['66']).toBeUndefined();
    expect(update.loan.applications[0].borrower.taxIdentificationIdentifier).toBeUndefined();
    expect(update.omitted.join(' ')).toMatch(/SSN last-4/);
  });

  test('writes 1084 lines to 101/102/106 and keeps W-2 out of self-employment', () => {
    const update = buildEncompassLoanUpdate({ urla: fullUrla, income1084 });
    const fields = update.fieldWriter.fields;
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.INCOME_BASE]).toBe('5200.00');
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.INCOME_OVERTIME]).toBe('350.00');
    expect(fields[ENCOMPASS_URLA_FIELD_IDS.INCOME_NET_RENTAL]).toBe('600.00');
    expect(fields['CX.FREEFLOW.INCOME']).toBe('8125.50');
    expect(fields['CX.FREEFLOW.W2.BASE']).toBe('5200.00');
    expect(fields['CX.FREEFLOW.SCH.C']).toBe('1100.00');
    const primaryJob = update.loan.applications[0].employment[0];
    expect(primaryJob.selfEmployedIndicator).toBe(false);
    expect(primaryJob.monthlyIncomeAmount).toBe(5200);
    expect(update.loan.applications[0].employment[1].employerName).toBe('Weekend Health');
  });

  test('self-employed 1003 uses SE employment + 1084 business totals, not field 101 dump', () => {
    const update = buildEncompassLoanUpdate({
      urla: { ...fullUrla, employmentType: 'SELF_EMPLOYED', yearsInBusiness: '6' },
      income1084,
    });
    const job = update.loan.applications[0].employment[0];
    expect(job.selfEmployedIndicator).toBe(true);
    expect(job.monthlyIncomeAmount).toBe(1900);
    expect(update.fieldWriter.fields[ENCOMPASS_URLA_FIELD_IDS.INCOME_BASE]).toBeUndefined();
  });

  test('legacy income helper now emits the loan PATCH array shape', () => {
    const patch = buildEncompassFieldUpdatePayload('loan-1', {
      qualifyingMonthlyIncome: 5000,
      trendingAnalysis: 'Increasing',
      yearsAnalyzed: [2025],
      auditUrl: 'https://app.example.com/audit/2',
      w2BaseMonthly: 4000,
      w2VariableMonthly: 350,
      assetIncomeMonthly: 75,
      rentalMonthly: 500,
    });
    expect(Array.isArray(patch.customFields)).toBe(true);
    expect(patch.customFields.find((field) => field.fieldName === 'CX.FREEFLOW.INCOME')?.value).toBe('5000.00');
    expect(patch.customFields.find((field) => field.fieldName === 'CX.FREEFLOW.W2.VARIABLE')?.value).toBe('350.00');
    expect(patch.customFields.find((field) => field.fieldName === 'CX.FREEFLOW.ASSET.INCOME')?.value).toBe('75.00');
    expect(patch).not.toHaveProperty('otherIncome');
  });

  test('lender field overrides are closed, validated, and collision-free', () => {
    const overridden = buildEncompassFieldUpdatePayload('loan-1', {
      qualifyingMonthlyIncome: 5000,
      trendingAnalysis: 'Stable',
      yearsAnalyzed: [2025],
      auditUrl: 'https://app.example.com/audit/2',
      w2VariableMonthly: 350,
    }, { fieldMapOverrides: { FREEFLOW_W2_VARIABLE: 'CX.SYNTHETIC.VARIABLE' } });
    expect(overridden.customFields.find((field) => field.value === '350.00')?.fieldName).toBe('CX.SYNTHETIC.VARIABLE');

    expect(() => buildEncompassFieldUpdatePayload('loan-1', {
      qualifyingMonthlyIncome: 5000,
      trendingAnalysis: 'Stable',
      yearsAnalyzed: [2025],
      auditUrl: 'https://app.example.com/audit/2',
    }, { fieldMapOverrides: { MISSPELLED_KEY: 'CX.SYNTHETIC.VALUE' } })).toThrow('configured Encompass income field mapping is invalid');
    expect(() => buildEncompassFieldUpdatePayload('loan-1', {
      qualifyingMonthlyIncome: 5000,
      trendingAnalysis: 'Stable',
      yearsAnalyzed: [2025],
      auditUrl: 'https://app.example.com/audit/2',
    }, { fieldMapOverrides: { FREEFLOW_W2_VARIABLE: 'CX.FREEFLOW.W2.BASE' } })).toThrow('configured Encompass income field mapping is invalid');

    for (const reserved of ['CX.FREEFLOW.APPROVAL.ID', 'CX.FREEFLOW.BORROWER.1.INCOME']) {
      expect(() => buildEncompassFieldUpdatePayload('loan-1', {
        qualifyingMonthlyIncome: 5000,
        trendingAnalysis: 'Stable',
        yearsAnalyzed: [2025],
        auditUrl: 'https://app.example.com/audit/2',
      }, { fieldMapOverrides: { FREEFLOW_W2_VARIABLE: reserved } })).toThrow('configured Encompass income field mapping is invalid');
    }

    const withoutTimestamp = buildEncompassFieldUpdatePayload('loan-1', {
      qualifyingMonthlyIncome: 5000,
      trendingAnalysis: 'Stable',
      yearsAnalyzed: [2025],
      auditUrl: 'https://app.example.com/audit/2',
    }, {
      fieldMapOverrides: { FREEFLOW_SYNCED_TIMESTAMP: 'CX.SYNTHETIC.SYNCED.AT' },
      includeSyncedAt: false,
    });
    expect(withoutTimestamp.customFields.some((field) => field.fieldName === 'CX.SYNTHETIC.SYNCED.AT')).toBe(false);
  });
});
