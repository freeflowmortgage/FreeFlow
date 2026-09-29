/**
 * AI 1003 / URLA → Encompass mapping.
 *
 * Two write shapes (direct Encompass connector):
 * 1. Loan PATCH  /encompass/v1/loans/{id}
 *    customFields MUST be [{ fieldName, value }], income lives on the application.
 * 2. Field Writer  POST /encompass/v1/loans/{id}/fieldWriter
 *    uses standard Encompass 1003 field IDs plus CX.FREEFLOW.* custom fields.
 *
 * This is the JSON contract. Live API keys are not part of the map.
 */

import { ENCOMPASS_CUSTOM_FIELD_SETUP } from './encompass-custom-fields';

/** Standard Encompass 1003 / URLA field IDs written via Field Writer. */
export const ENCOMPASS_URLA_FIELD_IDS = {
  BORROWER_FIRST_NAME: '4000',
  BORROWER_MIDDLE_NAME: '4001',
  BORROWER_LAST_NAME: '4002',
  BORROWER_EMAIL: '1240',
  BORROWER_CELL_PHONE: '1490',
  BORROWER_DOB: '1402',
  BORROWER_MARITAL_STATUS: '52',
  BORROWER_CITIZENSHIP: '471',
  BORROWER_DEPENDENTS: '53',
  BORROWER_PRESENT_STREET: 'FR0104',
  BORROWER_YEARS_AT_ADDRESS: '19',
  BORROWER_HOUSING_PAYMENT: '119',
  COBORROWER_FIRST_NAME: '4004',
  COBORROWER_LAST_NAME: '4006',
  COBORROWER_INCOME_BASE: '110',
  COBORROWER_INCOME_OVERTIME: '111',
  COBORROWER_EMPLOYER_NAME: 'CE0102',
  COBORROWER_EMPLOYER_POSITION: 'CE0116',
  COBORROWER_EMPLOYER_SELF_EMPLOYED: 'CE0151',
  COBORROWER_EMPLOYER_YEARS_ON_JOB: 'CE0144',
  SUBJECT_PROPERTY_STREET: '12',
  LOAN_AMOUNT: '1109',
  PURCHASE_PRICE: '136',
  LOAN_PURPOSE: '1811',
  OCCUPANCY: '1041',
  MORTGAGE_TYPE: '1172',
  PROPERTY_TYPE: '1553',
  INCOME_BASE: '101',
  INCOME_OVERTIME: '102',
  INCOME_BONUS: '103',
  INCOME_COMMISSION: '104',
  INCOME_DIVIDENDS: '105',
  INCOME_NET_RENTAL: '106',
  INCOME_OTHER: '107',
  EMPLOYER_NAME: 'BE0102',
  EMPLOYER_POSITION: 'BE0116',
  EMPLOYER_SELF_EMPLOYED: 'BE0151',
  EMPLOYER_YEARS_ON_JOB: 'BE0144',
  DECL_OCCUPY: '418',
  DECL_JUDGMENT: '169',
  DECL_BANKRUPTCY: '170',
  DECL_FORECLOSURE: '171',
  DECL_LAWSUIT: '172',
  DECL_DELINQUENT: '175',
  DECL_BORROWED_DOWN: '424',
  DECL_COMAKER: '173',
} as const;

/** One borrower's URLA employment section (1b–1d). */
export interface Urla1003Employment {
  employmentType?: 'W2' | 'SELF_EMPLOYED';
  employerName?: string;
  jobTitle?: string;
  yearsAtJob?: string;
  yearsInBusiness?: string;
  monthlyIncome?: string;
  hasSecondJob?: boolean;
  secondEmployer?: string;
  secondMonthlyIncome?: string;
  previousEmployer?: string;
  previousEmployerYears?: string;
}

export interface Urla1003Coborrower extends Urla1003Employment {
  name?: string;
}

export interface Urla1003Intake {
  borrowerName?: string;
  email?: string;
  phone?: string;
  ssnLast4?: string;
  dob?: string;
  citizenship?: 'US_CITIZEN' | 'PERM_RESIDENT' | 'NON_PERM';
  maritalStatus?: 'MARRIED' | 'SEPARATED' | 'UNMARRIED';
  dependentsCount?: string;
  dependentAges?: string;
  currentAddress?: string;
  yearsAtAddress?: string;
  previousAddress?: string;
  yearsAtPreviousAddress?: string;
  housingStatus?: 'OWN' | 'RENT' | 'RENT_FREE';
  monthlyHousing?: string;
  hasCoborrower?: boolean;
  coborrowerName?: string;
  /** Every co-borrower in 1003 order. When absent, `coborrowerName` is the only co-borrower. */
  coborrowers?: Urla1003Coborrower[];
  loanPurpose?: 'PURCHASE' | 'REFINANCE';
  propertyAddress?: string;
  propertyType?: 'SFR' | 'CONDO' | '2_4_UNIT' | 'PUD' | 'MANUFACTURED';
  occupancy?: 'PRIMARY' | 'SECOND_HOME' | 'INVESTMENT';
  purchasePrice?: string;
  loanAmount?: string;
  employmentType?: 'W2' | 'SELF_EMPLOYED';
  employerName?: string;
  jobTitle?: string;
  yearsAtJob?: string;
  yearsInBusiness?: string;
  monthlyIncome?: string;
  hasSecondJob?: boolean;
  secondEmployer?: string;
  secondMonthlyIncome?: string;
  previousEmployer?: string;
  previousEmployerYears?: string;
  hasOtherIncome?: boolean;
  otherIncomeType?: string;
  otherIncomeMonthly?: string;
  checkingBalance?: string;
  savingsBalance?: string;
  retirementBalance?: string;
  receivingGift?: boolean;
  giftAmount?: string;
  giftSource?: 'RELATIVE' | 'EMPLOYER' | 'UNMARRIED_PARTNER' | 'OTHER';
  monthlyDebts?: string;
  hasAlimonyOrSupport?: boolean;
  alimonyMonthly?: string;
  ownsOtherRE?: boolean;
  otherReAddress?: string;
  otherReValue?: string;
  otherReMortgage?: string;
  declOccupyPrimary?: boolean;
  declJudgment?: boolean;
  declBankruptcy?: boolean;
  declForeclosure?: boolean;
  declLawsuit?: boolean;
  declDelinquentFed?: boolean;
  declBorrowedDown?: boolean;
  declCoMaker?: boolean;
  militaryService?: 'NEVER' | 'CURRENT' | 'VETERAN' | 'RESERVE';
  hmdaEthnicity?: 'HISPANIC' | 'NOT_HISPANIC' | 'DECLINE';
  hmdaRace?: 'WHITE' | 'BLACK' | 'ASIAN' | 'AIAN' | 'PACIFIC' | 'DECLINE';
  hmdaSex?: 'FEMALE' | 'MALE' | 'DECLINE';
  program?: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA' | 'UNSURE';
}

/** One borrower's share of the 1084 result. `borrowerIndex` 0 is the primary borrower, 1 the first co-borrower. */
export interface Form1084BorrowerIncome {
  borrowerIndex: number;
  w2BaseMonthly?: number;
  w2VariableMonthly?: number;
  /** Schedule C, 1120-S, 1065, 1120 and Schedule F cash flow owned by this borrower. */
  selfEmployedMonthly?: number;
  qualifyingMonthlyIncome: number;
}

export interface Form1084EncompassIncome {
  qualifyingMonthlyIncome: number;
  /** Per-borrower split. Without it every figure is written to the primary borrower. */
  byBorrower?: Form1084BorrowerIncome[];
  trendingAnalysis?: string;
  yearsAnalyzed?: number[];
  w2BaseMonthly?: number;
  w2VariableMonthly?: number;
  scheduleC_MonthlyTotal?: number;
  form1120S_MonthlyTotal?: number;
  form1065_MonthlyTotal?: number;
  form1120_MonthlyTotal?: number;
  scheduleF_MonthlyTotal?: number;
  assetIncomeMonthly?: number;
  rentalMonthly?: number;
  rentalLiabilityMonthly?: number;
  housingExpenseAdjustment?: number;
  auditUrl?: string;
  programUsed?: string;
}

export interface EncompassCustomFieldWrite {
  fieldName: string;
  value: string;
}

export interface EncompassEmploymentWrite {
  /** Which borrower of the application pair holds this job. */
  owner: 'Borrower' | 'CoBorrower';
  employerName?: string;
  positionDescription?: string;
  currentEmploymentIndicator: boolean;
  selfEmployedIndicator: boolean;
  monthlyIncomeAmount?: number;
  timeOnJobTermYears?: number;
}

export interface EncompassResidenceWrite {
  residencyType: 'Current' | 'Prior';
  addressStreetLine1?: string;
  durationTermYears?: number;
  residencyBasisType?: 'Own' | 'Rent' | 'LivingRentFree';
  monthlyRentAmount?: number;
}

export interface EncompassReoWrite {
  urla2020StreetAddress?: string;
  marketValueAmount?: number;
  unpaidBalanceAmount?: number;
}

export interface EncompassGiftWrite {
  giftOrGrantSourceType?: string;
  amount?: number;
}

export interface EncompassLoanPatch {
  applications: Array<{
    borrower: Record<string, unknown>;
    coborrower?: Record<string, unknown>;
    residences: EncompassResidenceWrite[];
    employment: EncompassEmploymentWrite[];
    giftsGrants?: EncompassGiftWrite[];
    reoProperties?: EncompassReoWrite[];
  }>;
  property?: {
    streetAddress?: string;
    occupancyType?: 'PrimaryResidence' | 'SecondHome' | 'Investor';
    financedNumberOfUnits?: number;
  };
  borrowerRequestedLoanAmount?: number;
  purchasePriceAmount?: number;
  mortgageType?: 'Conventional' | 'FHA' | 'VA' | 'FarmersHomeAdministration';
  customFields: EncompassCustomFieldWrite[];
}

export interface EncompassFieldWriterPayload {
  fields: Record<string, string>;
}

export interface EncompassLoanUpdate {
  loan: EncompassLoanPatch;
  fieldWriter: EncompassFieldWriterPayload;
  source: 'AI_1003' | 'FORM_1084' | 'COMBINED';
  omitted: string[];
}

export function splitLegalName(fullName?: string): {
  firstName?: string;
  middleName?: string;
  lastName?: string;
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

export function parseMoney(value?: string | number): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseYears(value?: string): number | undefined {
  const parsed = parseMoney(value);
  return parsed == null ? undefined : parsed;
}

function yn(value?: boolean): string | undefined {
  if (value == null) return undefined;
  return value ? 'Y' : 'N';
}

function moneyText(value?: number): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return value.toFixed(2);
}

function setField(fields: Record<string, string>, id: string, value?: string | number | boolean) {
  if (value == null || value === '') return;
  fields[id] = typeof value === 'boolean' ? (value ? 'Y' : 'N') : String(value);
}

function pushCustom(customFields: EncompassCustomFieldWrite[], fieldName: string, value?: string) {
  if (value == null || value === '') return;
  customFields.push({ fieldName, value });
}

function maritalStatusType(status?: Urla1003Intake['maritalStatus']) {
  if (status === 'MARRIED') return 'Married';
  if (status === 'SEPARATED') return 'Separated';
  if (status === 'UNMARRIED') return 'Unmarried';
  return undefined;
}

function citizenshipType(status?: Urla1003Intake['citizenship']) {
  if (status === 'US_CITIZEN') return 'USCitizen';
  if (status === 'PERM_RESIDENT') return 'PermanentResidentAlien';
  if (status === 'NON_PERM') return 'NonPermanentResidentAlien';
  return undefined;
}

function occupancyType(occupancy?: Urla1003Intake['occupancy']) {
  if (occupancy === 'PRIMARY') return 'PrimaryResidence' as const;
  if (occupancy === 'SECOND_HOME') return 'SecondHome' as const;
  if (occupancy === 'INVESTMENT') return 'Investor' as const;
  return undefined;
}

function loanPurposeType(purpose?: Urla1003Intake['loanPurpose']) {
  if (purpose === 'PURCHASE') return 'Purchase';
  if (purpose === 'REFINANCE') return 'NoCash-Out Refinance';
  return undefined;
}

function mortgageType(program?: Urla1003Intake['program'] | string) {
  if (program === 'FHA') return 'FHA' as const;
  if (program === 'VA') return 'VA' as const;
  if (program === 'USDA') return 'FarmersHomeAdministration' as const;
  if (program === 'CONVENTIONAL') return 'Conventional' as const;
  return undefined;
}

function propertyTypeLabel(type?: Urla1003Intake['propertyType']) {
  if (type === 'SFR') return 'Detached';
  if (type === 'CONDO') return 'Condominium';
  if (type === '2_4_UNIT') return 'TwoToFourUnit';
  if (type === 'PUD') return 'PUD';
  if (type === 'MANUFACTURED') return 'Manufactured';
  return undefined;
}

function residencyBasis(status?: Urla1003Intake['housingStatus']) {
  if (status === 'OWN') return 'Own' as const;
  if (status === 'RENT') return 'Rent' as const;
  if (status === 'RENT_FREE') return 'LivingRentFree' as const;
  return undefined;
}

function hmdaEthnicity(value?: Urla1003Intake['hmdaEthnicity']) {
  if (value === 'HISPANIC') return 'HispanicOrLatino';
  if (value === 'NOT_HISPANIC') return 'NotHispanicOrLatino';
  if (value === 'DECLINE') return 'InformationNotProvided';
  return undefined;
}

function hmdaRace(value?: Urla1003Intake['hmdaRace']) {
  if (value === 'WHITE') return 'White';
  if (value === 'BLACK') return 'BlackOrAfricanAmerican';
  if (value === 'ASIAN') return 'Asian';
  if (value === 'AIAN') return 'AmericanIndianOrAlaskaNative';
  if (value === 'PACIFIC') return 'NativeHawaiianOrOtherPacificIslander';
  if (value === 'DECLINE') return 'InformationNotProvided';
  return undefined;
}

function hmdaSex(value?: Urla1003Intake['hmdaSex']) {
  if (value === 'FEMALE') return 'Female';
  if (value === 'MALE') return 'Male';
  if (value === 'DECLINE') return 'InformationNotProvided';
  return undefined;
}

function giftSource(source?: Urla1003Intake['giftSource']) {
  if (source === 'RELATIVE') return 'Relative';
  if (source === 'EMPLOYER') return 'Employer';
  if (source === 'UNMARRIED_PARTNER') return 'UnmarriedPartner';
  if (source === 'OTHER') return 'Other';
  return undefined;
}

function coborrowersOfIntake(urla: Urla1003Intake): Urla1003Coborrower[] {
  if (urla.hasCoborrower === false) return [];
  const listed = urla.coborrowers?.filter((coborrower) => coborrower.name?.trim()) ?? [];
  if (listed.length) return listed;
  if (urla.hasCoborrower && urla.coborrowerName?.trim()) return [{ name: urla.coborrowerName.trim() }];
  return [];
}

function splitFor(income: Form1084EncompassIncome | undefined, borrowerIndex: number): Form1084BorrowerIncome | undefined {
  return income?.byBorrower?.find((entry) => entry.borrowerIndex === borrowerIndex);
}

function personRecord(fullName?: string): Record<string, unknown> {
  const name = splitLegalName(fullName);
  const person: Record<string, unknown> = {};
  if (name.firstName) person.firstName = name.firstName;
  if (name.middleName) person.middleName = name.middleName;
  if (name.lastName) person.lastName = name.lastName;
  return person;
}

/** A co-borrower's current, second and prior jobs, with 1084 income when the split is known. */
function employmentWrites(
  employment: Urla1003Employment,
  owner: EncompassEmploymentWrite['owner'],
  split?: Form1084BorrowerIncome,
): EncompassEmploymentWrite[] {
  const selfEmployed = employment.employmentType === 'SELF_EMPLOYED';
  const stated = parseMoney(employment.monthlyIncome);
  const writes: EncompassEmploymentWrite[] = [];
  if (employment.employerName || stated != null || split) {
    writes.push({
      owner,
      employerName: employment.employerName,
      positionDescription: employment.jobTitle,
      currentEmploymentIndicator: true,
      selfEmployedIndicator: selfEmployed,
      monthlyIncomeAmount: selfEmployed
        ? (split?.selfEmployedMonthly || stated)
        : split?.w2BaseMonthly ?? stated,
      timeOnJobTermYears: parseYears(selfEmployed ? employment.yearsInBusiness : employment.yearsAtJob),
    });
  }
  if (employment.hasSecondJob && (employment.secondEmployer || employment.secondMonthlyIncome)) {
    writes.push({
      owner,
      employerName: employment.secondEmployer,
      currentEmploymentIndicator: true,
      selfEmployedIndicator: false,
      monthlyIncomeAmount: parseMoney(employment.secondMonthlyIncome),
    });
  }
  if (employment.previousEmployer) {
    writes.push({
      owner,
      employerName: employment.previousEmployer,
      currentEmploymentIndicator: false,
      selfEmployedIndicator: false,
      timeOnJobTermYears: parseYears(employment.previousEmployerYears),
    });
  }
  return writes;
}

export function buildEncompassLoanUpdate(input: {
  urla?: Urla1003Intake;
  income1084?: Form1084EncompassIncome;
  syncedAt?: string;
}): EncompassLoanUpdate {
  const urla = input.urla ?? {};
  const income = input.income1084;
  const omitted: string[] = [];
  const customFields: EncompassCustomFieldWrite[] = [];
  const fields: Record<string, string> = {};

  if (urla.ssnLast4) {
    omitted.push('borrower.taxIdentificationIdentifier (SSN last-4 is not a valid Encompass SSN write)');
  }

  const borrowerName = splitLegalName(urla.borrowerName);
  const statedPrimaryIncome = parseMoney(urla.monthlyIncome);
  const statedOtherIncome = urla.hasOtherIncome ? parseMoney(urla.otherIncomeMonthly) : undefined;
  const statedSecondIncome = urla.hasSecondJob ? parseMoney(urla.secondMonthlyIncome) : undefined;

  // A self-employed borrower's income belongs on the employment record and the
  // 1084 business totals, not in the base-income field. Reading w2BaseMonthly
  // first put wage income into field 101 even when the borrower was flagged
  // self-employed, double-counting it against the business total.
  const primarySplit = splitFor(income, 0);
  const baseIncome =
    urla.employmentType === 'SELF_EMPLOYED'
      ? undefined
      : (primarySplit ? primarySplit.w2BaseMonthly : income?.w2BaseMonthly) ?? statedPrimaryIncome;
  const overtimeIncome = primarySplit ? primarySplit.w2VariableMonthly : income?.w2VariableMonthly;
  const rentalIncome = income?.rentalMonthly;
  const otherIncomePieces = [
    statedOtherIncome,
    income?.scheduleF_MonthlyTotal,
    income?.assetIncomeMonthly,
  ].filter((value): value is number => value != null && value !== 0);
  const otherIncomeTotal = otherIncomePieces.length > 0
    ? otherIncomePieces.reduce((sum, value) => sum + value, 0)
    : undefined;

  const borrower: Record<string, unknown> = {};
  if (borrowerName.firstName) borrower.firstName = borrowerName.firstName;
  if (borrowerName.middleName) borrower.middleName = borrowerName.middleName;
  if (borrowerName.lastName) borrower.lastName = borrowerName.lastName;
  if (urla.email) borrower.emailAddressText = urla.email;
  if (urla.phone) borrower.mobilePhone = urla.phone;
  if (urla.dob) borrower.birthDate = urla.dob;
  const marital = maritalStatusType(urla.maritalStatus);
  if (marital) borrower.maritalStatusType = marital;
  const citizenship = citizenshipType(urla.citizenship);
  if (citizenship) borrower.citizenshipResidencyType = citizenship;
  const dependents = parseMoney(urla.dependentsCount);
  if (dependents != null) borrower.dependentCount = dependents;
  if (urla.dependentAges) borrower.dependentsAgesDescription = urla.dependentAges;
  if (urla.declOccupyPrimary != null) borrower.intentToOccupyIndicator = urla.declOccupyPrimary;
  if (urla.declJudgment != null) borrower.outstandingJudgmentsIndicator = urla.declJudgment;
  if (urla.declBankruptcy != null) borrower.bankruptIndicator = urla.declBankruptcy;
  if (urla.declForeclosure != null) borrower.propertyForeclosedPastSevenYearsIndicator = urla.declForeclosure;
  if (urla.declLawsuit != null) borrower.partyToLawsuitIndicator = urla.declLawsuit;
  if (urla.declDelinquentFed != null) borrower.presentlyDelinquentIndicator = urla.declDelinquentFed;
  if (urla.declBorrowedDown != null) borrower.undisclosedBorrowedFundsIndicator = urla.declBorrowedDown;
  if (urla.declCoMaker != null) borrower.comakerEndorserOfNoteIndicator = urla.declCoMaker;
  const ethnicity = hmdaEthnicity(urla.hmdaEthnicity);
  if (ethnicity) borrower.hmdaEthnicityType = ethnicity;
  const race = hmdaRace(urla.hmdaRace);
  if (race) borrower.hmdaRaceType = race;
  const sex = hmdaSex(urla.hmdaSex);
  if (sex) borrower.hmdaGenderType = sex;
  if (coborrowersOfIntake(urla).length) {
    borrower.hasNonApplicantSpouseIndicator = false;
  }
  if (urla.monthlyDebts) borrower.totalMonthlyLiabilitiesImportedAmount = parseMoney(urla.monthlyDebts);
  if (urla.hasAlimonyOrSupport && urla.alimonyMonthly) {
    borrower.alimonyChildSupportObligationIndicator = true;
  }

  const residences: EncompassResidenceWrite[] = [];
  if (urla.currentAddress || urla.yearsAtAddress || urla.housingStatus || urla.monthlyHousing) {
    residences.push({
      residencyType: 'Current',
      addressStreetLine1: urla.currentAddress,
      durationTermYears: parseYears(urla.yearsAtAddress),
      residencyBasisType: residencyBasis(urla.housingStatus),
      monthlyRentAmount: urla.housingStatus === 'RENT' ? parseMoney(urla.monthlyHousing) : undefined,
    });
  }
  if (urla.previousAddress) {
    residences.push({
      residencyType: 'Prior',
      addressStreetLine1: urla.previousAddress,
      durationTermYears: parseYears(urla.yearsAtPreviousAddress),
    });
  }

  const selfEmployed = urla.employmentType === 'SELF_EMPLOYED';
  const primarySeMonthly = primarySplit
    ? primarySplit.selfEmployedMonthly ?? 0
    : (income?.scheduleC_MonthlyTotal ?? 0) +
      (income?.form1120S_MonthlyTotal ?? 0) +
      (income?.form1065_MonthlyTotal ?? 0) +
      (income?.form1120_MonthlyTotal ?? 0);
  const employment: EncompassEmploymentWrite[] = [];
  if (urla.employerName || statedPrimaryIncome != null || selfEmployed || primarySeMonthly > 0) {
    employment.push({
      owner: 'Borrower',
      employerName: urla.employerName,
      positionDescription: urla.jobTitle,
      currentEmploymentIndicator: true,
      selfEmployedIndicator: selfEmployed,
      monthlyIncomeAmount: selfEmployed
        ? (primarySeMonthly > 0 ? primarySeMonthly : statedPrimaryIncome)
        : baseIncome,
      timeOnJobTermYears: parseYears(selfEmployed ? urla.yearsInBusiness : urla.yearsAtJob),
    });
  }
  if (urla.hasSecondJob && (urla.secondEmployer || statedSecondIncome != null)) {
    employment.push({
      owner: 'Borrower',
      employerName: urla.secondEmployer,
      currentEmploymentIndicator: true,
      selfEmployedIndicator: false,
      monthlyIncomeAmount: statedSecondIncome,
    });
  }
  if (urla.previousEmployer) {
    employment.push({
      owner: 'Borrower',
      employerName: urla.previousEmployer,
      currentEmploymentIndicator: false,
      selfEmployedIndicator: false,
      timeOnJobTermYears: parseYears(urla.previousEmployerYears),
    });
  }

  const application: EncompassLoanPatch['applications'][0] = {
    borrower,
    residences,
    employment,
  };

  if (urla.receivingGift && parseMoney(urla.giftAmount) != null) {
    application.giftsGrants = [
      {
        giftOrGrantSourceType: giftSource(urla.giftSource),
        amount: parseMoney(urla.giftAmount),
      },
    ];
  }

  if (urla.ownsOtherRE && urla.otherReAddress) {
    application.reoProperties = [
      {
        urla2020StreetAddress: urla.otherReAddress,
        marketValueAmount: parseMoney(urla.otherReValue),
        unpaidBalanceAmount: parseMoney(urla.otherReMortgage),
      },
    ];
  }

  // Encompass holds borrowers in pairs: each application has a borrower and a
  // co-borrower. The 1003's second person is application 1's co-borrower, the
  // third starts application 2, and so on.
  const coborrowers = coborrowersOfIntake(urla);
  const applications: EncompassLoanPatch['applications'] = [application];
  coborrowers.forEach((coborrower, index) => {
    const personIndex = index + 1;
    const appIndex = Math.floor(personIndex / 2);
    const owner = personIndex % 2 === 1 ? 'CoBorrower' : 'Borrower';
    const target = applications[appIndex] ?? { borrower: {}, residences: [], employment: [] };
    applications[appIndex] = target;
    const person = personRecord(coborrower.name);
    if (owner === 'CoBorrower') target.coborrower = person;
    else target.borrower = person;
    target.employment.push(...employmentWrites(coborrower, owner, splitFor(income, personIndex)));
  });
  if (coborrowers.length > 1) {
    omitted.push(
      `Field Writer covers the first borrower pair only; ${coborrowers.length - 1} more borrower(s) are written through applications[1..] in the loan PATCH`,
    );
  }

  const loan: EncompassLoanPatch = {
    applications,
    customFields,
  };

  const occupancy = occupancyType(urla.occupancy);
  if (urla.propertyAddress || occupancy || urla.propertyType === '2_4_UNIT') {
    loan.property = {
      streetAddress: urla.propertyAddress,
      occupancyType: occupancy,
      financedNumberOfUnits: urla.propertyType === '2_4_UNIT' ? 2 : undefined,
    };
  }

  const loanAmount = parseMoney(urla.loanAmount);
  if (loanAmount != null) loan.borrowerRequestedLoanAmount = loanAmount;
  const purchasePrice = parseMoney(urla.purchasePrice);
  if (purchasePrice != null) loan.purchasePriceAmount = purchasePrice;
  const mortgage = mortgageType(income?.programUsed ?? urla.program);
  if (mortgage) loan.mortgageType = mortgage;

  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_FIRST_NAME, borrowerName.firstName);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_MIDDLE_NAME, borrowerName.middleName);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_LAST_NAME, borrowerName.lastName);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_EMAIL, urla.email);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_CELL_PHONE, urla.phone);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_DOB, urla.dob);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_MARITAL_STATUS, marital);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_CITIZENSHIP, citizenship);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_DEPENDENTS, dependents);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_PRESENT_STREET, urla.currentAddress);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_YEARS_AT_ADDRESS, parseYears(urla.yearsAtAddress));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.BORROWER_HOUSING_PAYMENT, parseMoney(urla.monthlyHousing));
  const firstCoborrower = coborrowers[0];
  if (firstCoborrower) {
    const name = splitLegalName(firstCoborrower.name);
    const split = splitFor(income, 1);
    const coborrowerSelfEmployed = firstCoborrower.employmentType === 'SELF_EMPLOYED';
    setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_FIRST_NAME, name.firstName);
    setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_LAST_NAME, name.lastName);
    if (!coborrowerSelfEmployed) {
      setField(
        fields,
        ENCOMPASS_URLA_FIELD_IDS.COBORROWER_INCOME_BASE,
        moneyText(split?.w2BaseMonthly ?? parseMoney(firstCoborrower.monthlyIncome)),
      );
      setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_INCOME_OVERTIME, moneyText(split?.w2VariableMonthly));
    }
    setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_NAME, firstCoborrower.employerName);
    setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_POSITION, firstCoborrower.jobTitle);
    if (firstCoborrower.employmentType) {
      setField(fields, ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_SELF_EMPLOYED, yn(coborrowerSelfEmployed));
    }
    setField(
      fields,
      ENCOMPASS_URLA_FIELD_IDS.COBORROWER_EMPLOYER_YEARS_ON_JOB,
      parseYears(coborrowerSelfEmployed ? firstCoborrower.yearsInBusiness : firstCoborrower.yearsAtJob),
    );
  }
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.SUBJECT_PROPERTY_STREET, urla.propertyAddress);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.LOAN_AMOUNT, moneyText(loanAmount));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.PURCHASE_PRICE, moneyText(purchasePrice));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.LOAN_PURPOSE, loanPurposeType(urla.loanPurpose));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.OCCUPANCY, occupancy);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.MORTGAGE_TYPE, mortgage);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.PROPERTY_TYPE, propertyTypeLabel(urla.propertyType));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.INCOME_BASE, moneyText(baseIncome));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.INCOME_OVERTIME, moneyText(overtimeIncome));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.INCOME_NET_RENTAL, moneyText(rentalIncome));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.INCOME_OTHER, moneyText(otherIncomeTotal));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.EMPLOYER_NAME, urla.employerName);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.EMPLOYER_POSITION, urla.jobTitle);
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.EMPLOYER_SELF_EMPLOYED, yn(selfEmployed));
  setField(
    fields,
    ENCOMPASS_URLA_FIELD_IDS.EMPLOYER_YEARS_ON_JOB,
    parseYears(selfEmployed ? urla.yearsInBusiness : urla.yearsAtJob),
  );
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_OCCUPY, yn(urla.declOccupyPrimary));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_JUDGMENT, yn(urla.declJudgment));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_BANKRUPTCY, yn(urla.declBankruptcy));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_FORECLOSURE, yn(urla.declForeclosure));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_LAWSUIT, yn(urla.declLawsuit));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_DELINQUENT, yn(urla.declDelinquentFed));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_BORROWED_DOWN, yn(urla.declBorrowedDown));
  setField(fields, ENCOMPASS_URLA_FIELD_IDS.DECL_COMAKER, yn(urla.declCoMaker));

  const source = input.urla && income ? 'COMBINED' : income ? 'FORM_1084' : 'AI_1003';
  pushCustom(customFields, 'CX.FREEFLOW.SOURCE', source);
  pushCustom(customFields, 'CX.FREEFLOW.SYNCED.AT', input.syncedAt ?? new Date().toISOString());
  if (income) {
    pushCustom(customFields, 'CX.FREEFLOW.INCOME', moneyText(income.qualifyingMonthlyIncome));
    pushCustom(customFields, 'CX.FREEFLOW.W2.BASE', moneyText(income.w2BaseMonthly));
    pushCustom(customFields, 'CX.FREEFLOW.W2.VARIABLE', moneyText(income.w2VariableMonthly));
    pushCustom(customFields, 'CX.FREEFLOW.SCH.C', moneyText(income.scheduleC_MonthlyTotal));
    pushCustom(customFields, 'CX.FREEFLOW.FORM.1120S', moneyText(income.form1120S_MonthlyTotal));
    pushCustom(customFields, 'CX.FREEFLOW.FORM.1065', moneyText(income.form1065_MonthlyTotal));
    pushCustom(customFields, 'CX.FREEFLOW.FORM.1120', moneyText(income.form1120_MonthlyTotal));
    pushCustom(customFields, 'CX.FREEFLOW.SCH.F', moneyText(income.scheduleF_MonthlyTotal));
    pushCustom(customFields, 'CX.FREEFLOW.ASSET.INCOME', moneyText(income.assetIncomeMonthly));
    pushCustom(customFields, 'CX.FREEFLOW.RENTAL', moneyText(income.rentalMonthly));
    pushCustom(customFields, 'CX.FREEFLOW.RENTAL.LIABILITY', moneyText(income.rentalLiabilityMonthly));
    pushCustom(customFields, 'CX.FREEFLOW.HOUSING.ADJ', moneyText(income.housingExpenseAdjustment));
    pushCustom(customFields, 'CX.FREEFLOW.TRENDING', income.trendingAnalysis);
    pushCustom(customFields, 'CX.FREEFLOW.YEARS', income.yearsAnalyzed?.join(', '));
    pushCustom(customFields, 'CX.FREEFLOW.PROGRAM', income.programUsed);
    pushCustom(customFields, 'CX.FREEFLOW.AUDIT.URL', income.auditUrl);
  }

  for (const field of customFields) {
    fields[field.fieldName] = field.value;
  }

  const setupNames = new Set(ENCOMPASS_CUSTOM_FIELD_SETUP.map((field) => field.fieldName));
  for (const field of customFields) {
    if (!setupNames.has(field.fieldName)) {
      throw new Error(`Custom field ${field.fieldName} is missing from ENCOMPASS_CUSTOM_FIELD_SETUP`);
    }
  }

  return {
    loan,
    fieldWriter: { fields },
    source,
    omitted,
  };
}

export function countEncompassWrites(update: EncompassLoanUpdate): number {
  return Object.keys(update.fieldWriter.fields).length;
}
