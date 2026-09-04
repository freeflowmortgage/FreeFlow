export type LoanProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
export type InputKind = 'text' | 'email' | 'tel' | 'number' | 'choice';

export interface IntakeChoice {
  id: string;
  label: string;
}

export interface IntakeAnswers {
  // 1a Personal information
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
  housingStatus?: 'OWN' | 'RENT' | 'RENT_FREE';
  monthlyHousing?: string;
  hasCoborrower?: boolean;
  coborrowerName?: string;

  // 4a Loan & property
  loanPurpose?: 'PURCHASE' | 'REFINANCE';
  propertyAddress?: string;
  propertyType?: 'SFR' | 'CONDO' | '2_4_UNIT' | 'PUD' | 'MANUFACTURED';
  occupancy?: 'PRIMARY' | 'SECOND_HOME' | 'INVESTMENT';
  purchasePrice?: string;
  loanAmount?: string;

  // 1b–1e Employment & income
  employmentType?: 'W2' | 'SELF_EMPLOYED';
  employerName?: string;
  jobTitle?: string;
  yearsAtJob?: string;
  yearsInBusiness?: string;
  sameBusinessFiveYears?: boolean;
  monthlyIncome?: string;
  hasSecondJob?: boolean;
  secondEmployer?: string;
  secondMonthlyIncome?: string;
  previousEmployer?: string;
  hasOtherIncome?: boolean;
  otherIncomeType?: string;
  otherIncomeMonthly?: string;

  // 2 Assets, 4d gifts
  checkingBalance?: string;
  savingsBalance?: string;
  retirementBalance?: string;
  receivingGift?: boolean;
  giftAmount?: string;
  giftSource?: 'RELATIVE' | 'EMPLOYER' | 'UNMARRIED_PARTNER' | 'OTHER';

  // 2c–2d Liabilities
  monthlyDebts?: string;
  hasAlimonyOrSupport?: boolean;
  alimonyMonthly?: string;

  // 3a Real estate owned
  ownsOtherRE?: boolean;
  otherReAddress?: string;
  otherReValue?: string;
  otherReMortgage?: string;

  // 5 Declarations
  declOccupyPrimary?: boolean;
  declJudgment?: boolean;
  declBankruptcy?: boolean;
  declForeclosure?: boolean;
  declLawsuit?: boolean;
  declDelinquentFed?: boolean;
  declBorrowedDown?: boolean;
  declCoMaker?: boolean;

  // 7 Military · 8 HMDA
  militaryService?: 'NEVER' | 'CURRENT' | 'VETERAN' | 'RESERVE';
  hmdaEthnicity?: 'HISPANIC' | 'NOT_HISPANIC' | 'DECLINE';
  hmdaRace?: 'WHITE' | 'BLACK' | 'ASIAN' | 'AIAN' | 'PACIFIC' | 'DECLINE';
  hmdaSex?: 'FEMALE' | 'MALE' | 'DECLINE';

  // Agency + close
  program?: LoanProgram | 'UNSURE';
  authorizeCaivrs?: boolean;
  acknowledgeInformedChoice?: boolean;
  vaDisabilityRating?: string;
  vaChildCareExpenses?: string;
  householdOccupants?: Array<{ name: string; age: string; annualIncome: string }>;
  occupantName?: string;
  occupantAge?: string;
  occupantIncome?: string;
  addAnotherOccupant?: boolean;
  acknowledgedUrla?: boolean;
  acknowledgedDocPlan?: boolean;
}

export interface AgentTurn {
  id: string;
  prompt: string;
  kind: InputKind;
  placeholder?: string;
  choices?: IntakeChoice[];
  helper?: string;
}

export interface ApplyBody {
  loanProgram: LoanProgram;
  letLoDecide: boolean;
  formData: Record<string, unknown>;
}

export function firstName(answers: IntakeAnswers) {
  return answers.borrowerName?.trim().split(/\s+/)[0] ?? 'there';
}

function yearsInBusiness(answers: IntakeAnswers) {
  const parsed = Number(answers.yearsInBusiness);
  return Number.isFinite(parsed) ? parsed : 0;
}

function workingProgram(answers: IntakeAnswers): LoanProgram {
  if (answers.program === 'FHA' || answers.program === 'VA' || answers.program === 'USDA') {
    return answers.program;
  }
  return 'CONVENTIONAL';
}

export function buildDocumentPlan(answers: IntakeAnswers): string {
  const name = firstName(answers);
  const program = workingProgram(answers);
  const selfEmployed = answers.employmentType === 'SELF_EMPLOYED';
  const years = yearsInBusiness(answers);
  const fivePlus = years >= 5 && answers.sameBusinessFiveYears !== false;
  const purchase = answers.loanPurpose === 'PURCHASE';
  const lines: string[] = [];

  lines.push(`${name}, here is what we will collect next so underwriting is not guessing.`);

  if (selfEmployed) {
    if (program === 'CONVENTIONAL' && fivePlus) {
      lines.push(
        `You have about ${years} years in this business. On Conventional, Fannie/Freddie can allow one year of personal and matching business tax returns when you have at least five years of self-employment in the same business and income is stable. We will still run a Form 1084. If the most recent year is not filed yet, we will also need a signed YTD P&L and three months of business bank statements.`,
      );
    } else if (program === 'CONVENTIONAL' && years >= 5 && answers.sameBusinessFiveYears === false) {
      lines.push(
        `Even with ${years} years of self-employment, Conventional still wants two years of returns if this is a new entity or not the same continuous business. We will collect two years of personal and matching business returns and complete Form 1084.`,
      );
    } else if (program === 'CONVENTIONAL') {
      lines.push(
        `You have about ${years} year(s) in the business. Under five years, Conventional wants two years of personal tax returns plus the matching business returns (Schedule C, K-1, 1120-S, or 1120). We will complete a Form 1084 from those. A signed YTD P&L is required if the current year is not filed.`,
      );
    } else {
      lines.push(
        `${program} typically wants two full years of self-employment history and two years of personal and business tax returns, even if you have owned the company longer. The five-year / one-year-return shortcut is a Conventional (Fannie/Freddie) option, not an FHA/VA/USDA standard. We will still complete Form 1084.`,
      );
    }
    lines.push(
      'If you use business funds for down payment or closing costs, we will also need business bank statements — personal accounts alone are not enough.',
    );
  } else {
    lines.push(
      'As a W-2 borrower we will collect your most recent paystubs covering 30 days and two years of W-2s. A written VOE or payroll connect can replace some of the paper.',
    );
  }

  if (purchase) {
    lines.push(
      'Assets come in once we know purchase price and down payment: two months of bank statements. We need those to source the down payment and closing funds before disclosures go out.',
    );
  } else {
    lines.push(
      'On a refinance we still need assets if there is cash to close or reserve requirements. Two months of statements is enough unless you are drawing business funds.',
    );
  }

  lines.push(
    'Any non-payroll deposit larger than about 50% of monthly income will need a paper trail (gift letter, sale of asset, or transfer from a documented account).',
  );

  if (answers.occupancy === 'INVESTMENT' || answers.occupancy === 'SECOND_HOME') {
    lines.push(
      `${answers.occupancy === 'INVESTMENT' ? 'Investment' : 'Second-home'} occupancy usually adds reserve months after closing. We will size that after credit and the 1003 debts are in.`,
    );
  }

  lines.push('Your loan officer can still add conditions. This is the starting checklist, not a final underwrite.');
  return lines.join('\n\n');
}

function blank(value: unknown) {
  return value === undefined || value === null || value === '';
}

function yearsAtCurrentJob(answers: IntakeAnswers) {
  const parsed = Number(answers.yearsAtJob);
  return Number.isFinite(parsed) ? parsed : 0;
}

function yesNo(): IntakeChoice[] {
  return [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ];
}

/** Full FNMA URLA conversation. Stays in browser memory (ZDR) until the broker exports. */
export function getNextTurn(answers: IntakeAnswers): AgentTurn | { done: true } {
  if (blank(answers.borrowerName)) {
    return {
      id: 'borrowerName',
      prompt: "Hi — I'll walk you through the full loan application (URLA / 1003). What is your full legal name?",
      kind: 'text',
      placeholder: 'Alex Morgan',
    };
  }
  if (blank(answers.email)) {
    return {
      id: 'email',
      prompt: `Nice to meet you, ${firstName(answers)}. What email should we use for this file?`,
      kind: 'email',
      placeholder: 'you@email.com',
    };
  }
  if (blank(answers.phone)) {
    return {
      id: 'phone',
      prompt: 'And a mobile number in case your loan officer needs to reach you?',
      kind: 'tel',
      placeholder: '602-555-0199',
    };
  }
  if (blank(answers.ssnLast4)) {
    return {
      id: 'ssnLast4',
      prompt: 'Last four of your Social Security number? We do not keep the full SSN — that stays with your lender.',
      kind: 'text',
      placeholder: '1234',
      helper: 'FreeFlow holds this session in memory only (ZDR). Your LOS collects the full SSN under the lender’s GLBA custody.',
    };
  }
  if (blank(answers.dob)) {
    return {
      id: 'dob',
      prompt: 'What is your date of birth?',
      kind: 'text',
      placeholder: 'MM/DD/YYYY',
    };
  }
  if (!answers.citizenship) {
    return {
      id: 'citizenship',
      prompt: 'Citizenship status?',
      kind: 'choice',
      choices: [
        { id: 'US_CITIZEN', label: 'U.S. citizen' },
        { id: 'PERM_RESIDENT', label: 'Permanent resident' },
        { id: 'NON_PERM', label: 'Non-permanent resident' },
      ],
    };
  }
  if (!answers.maritalStatus) {
    return {
      id: 'maritalStatus',
      prompt: 'Marital status?',
      kind: 'choice',
      choices: [
        { id: 'MARRIED', label: 'Married' },
        { id: 'SEPARATED', label: 'Separated' },
        { id: 'UNMARRIED', label: 'Unmarried' },
      ],
    };
  }
  if (blank(answers.dependentsCount)) {
    return {
      id: 'dependentsCount',
      prompt: 'How many dependents (not including a co-borrower)? Enter 0 if none.',
      kind: 'number',
      placeholder: '0',
    };
  }
  if (Number(answers.dependentsCount) > 0 && blank(answers.dependentAges)) {
    return {
      id: 'dependentAges',
      prompt: 'Ages of those dependents? (for example 4, 9)',
      kind: 'text',
      placeholder: '4, 9',
    };
  }
  if (blank(answers.currentAddress)) {
    return {
      id: 'currentAddress',
      prompt: 'Current street address, city, state, and ZIP?',
      kind: 'text',
      placeholder: '100 Main St, Phoenix, AZ 85001',
    };
  }
  if (blank(answers.yearsAtAddress)) {
    return {
      id: 'yearsAtAddress',
      prompt: 'How many years have you lived there?',
      kind: 'number',
      placeholder: '3',
    };
  }
  if (!answers.housingStatus) {
    return {
      id: 'housingStatus',
      prompt: 'Do you own, rent, or live rent-free?',
      kind: 'choice',
      choices: [
        { id: 'OWN', label: 'Own' },
        { id: 'RENT', label: 'Rent' },
        { id: 'RENT_FREE', label: 'Live rent-free' },
      ],
    };
  }
  if (answers.housingStatus !== 'RENT_FREE' && blank(answers.monthlyHousing)) {
    return {
      id: 'monthlyHousing',
      prompt: answers.housingStatus === 'RENT' ? 'What is your monthly rent?' : 'What is your monthly housing payment (PITIA)?',
      kind: 'number',
      placeholder: '1800',
    };
  }
  if (answers.hasCoborrower == null) {
    return {
      id: 'hasCoborrower',
      prompt: 'Will anyone else be on this loan as a co-borrower?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.hasCoborrower && blank(answers.coborrowerName)) {
    return {
      id: 'coborrowerName',
      prompt: 'What is the co-borrower’s full legal name?',
      kind: 'text',
      placeholder: 'Jordan Morgan',
    };
  }
  if (!answers.loanPurpose) {
    return {
      id: 'loanPurpose',
      prompt: 'Are you purchasing a home or refinancing one you already own?',
      kind: 'choice',
      choices: [
        { id: 'PURCHASE', label: 'Purchasing' },
        { id: 'REFINANCE', label: 'Refinancing' },
      ],
    };
  }
  if (blank(answers.propertyAddress)) {
    return {
      id: 'propertyAddress',
      prompt:
        answers.loanPurpose === 'REFINANCE'
          ? 'Subject property address? Type SAME if it is your current address.'
          : 'Property address if you have one. Type TBD if you are still shopping.',
      kind: 'text',
      placeholder: answers.loanPurpose === 'REFINANCE' ? 'SAME' : 'TBD',
    };
  }
  if (!answers.propertyType) {
    return {
      id: 'propertyType',
      prompt: 'What type of property is this?',
      kind: 'choice',
      choices: [
        { id: 'SFR', label: 'Single-family' },
        { id: 'CONDO', label: 'Condo' },
        { id: '2_4_UNIT', label: '2–4 unit' },
        { id: 'PUD', label: 'PUD' },
        { id: 'MANUFACTURED', label: 'Manufactured' },
      ],
    };
  }
  if (!answers.occupancy) {
    return {
      id: 'occupancy',
      prompt: 'Will this be your primary home, a second home, or an investment property?',
      kind: 'choice',
      choices: [
        { id: 'PRIMARY', label: 'Primary home' },
        { id: 'SECOND_HOME', label: 'Second home' },
        { id: 'INVESTMENT', label: 'Investment' },
      ],
    };
  }
  if (answers.loanPurpose === 'PURCHASE' && blank(answers.purchasePrice)) {
    return {
      id: 'purchasePrice',
      prompt: 'About what purchase price are you targeting?',
      kind: 'number',
      placeholder: '500000',
      helper: 'A round estimate is fine. We can tighten this later.',
    };
  }
  if (blank(answers.loanAmount)) {
    return {
      id: 'loanAmount',
      prompt:
        answers.loanPurpose === 'REFINANCE'
          ? 'What loan amount are you looking to refinance?'
          : 'How much do you expect to borrow?',
      kind: 'number',
      placeholder: '400000',
    };
  }
  if (!answers.employmentType) {
    return {
      id: 'employmentType',
      prompt: 'How are you paid today?',
      kind: 'choice',
      choices: [
        { id: 'W2', label: 'W-2 employee' },
        { id: 'SELF_EMPLOYED', label: 'Self-employed' },
      ],
    };
  }
  if (blank(answers.employerName)) {
    return {
      id: 'employerName',
      prompt:
        answers.employmentType === 'SELF_EMPLOYED'
          ? 'What is the legal name of the business?'
          : 'Who is your current employer?',
      kind: 'text',
      placeholder: answers.employmentType === 'SELF_EMPLOYED' ? 'Morgan Consulting LLC' : 'Apex Technology Partners',
    };
  }
  if (blank(answers.jobTitle)) {
    return {
      id: 'jobTitle',
      prompt: 'What is your title or position?',
      kind: 'text',
      placeholder: 'Operations manager',
    };
  }
  if (answers.employmentType === 'W2' && blank(answers.yearsAtJob)) {
    return {
      id: 'yearsAtJob',
      prompt: 'How many years have you been in this job (or line of work)?',
      kind: 'number',
      placeholder: '3',
      helper: 'GSE files need a two-year work history. If this job is newer, we will ask about the prior employer.',
    };
  }
  if (answers.employmentType === 'SELF_EMPLOYED' && blank(answers.yearsInBusiness)) {
    return {
      id: 'yearsInBusiness',
      prompt: 'How many years have you been self-employed in this same business?',
      kind: 'number',
      placeholder: '5',
      helper: 'Count years of ownership in this company, not total years working.',
    };
  }
  if (
    answers.employmentType === 'SELF_EMPLOYED' &&
    yearsInBusiness(answers) >= 5 &&
    answers.sameBusinessFiveYears == null
  ) {
    return {
      id: 'sameBusinessFiveYears',
      prompt:
        'Just to confirm: has that been the same business (same ownership) for five years or more, not a recent restart or new entity?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (blank(answers.monthlyIncome)) {
    return {
      id: 'monthlyIncome',
      prompt:
        answers.employmentType === 'SELF_EMPLOYED'
          ? 'What is your typical monthly take-home from the business, before the 1084 audit?'
          : 'What is your gross monthly income from this job?',
      kind: 'number',
      placeholder: '7500',
    };
  }
  if (answers.hasSecondJob == null) {
    return {
      id: 'hasSecondJob',
      prompt: 'Do you have a second job or additional employment we should count?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.hasSecondJob && blank(answers.secondEmployer)) {
    return {
      id: 'secondEmployer',
      prompt: 'Second employer or business name?',
      kind: 'text',
      placeholder: 'Evening retail',
    };
  }
  if (answers.hasSecondJob && blank(answers.secondMonthlyIncome)) {
    return {
      id: 'secondMonthlyIncome',
      prompt: 'Gross monthly income from that second job?',
      kind: 'number',
      placeholder: '1200',
    };
  }
  if (answers.employmentType === 'W2' && yearsAtCurrentJob(answers) < 2 && blank(answers.previousEmployer)) {
    return {
      id: 'previousEmployer',
      prompt: 'You have under two years at this job. Who was the previous employer?',
      kind: 'text',
      placeholder: 'Prior employer name',
    };
  }
  if (answers.hasOtherIncome == null) {
    return {
      id: 'hasOtherIncome',
      prompt: 'Any other income (Social Security, pension, alimony received, boarder, overtime already counted separately)?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.hasOtherIncome && blank(answers.otherIncomeType)) {
    return {
      id: 'otherIncomeType',
      prompt: 'What type of other income?',
      kind: 'text',
      placeholder: 'Social Security',
    };
  }
  if (answers.hasOtherIncome && blank(answers.otherIncomeMonthly)) {
    return {
      id: 'otherIncomeMonthly',
      prompt: 'Monthly amount from that other income?',
      kind: 'number',
      placeholder: '800',
    };
  }
  if (blank(answers.checkingBalance)) {
    return {
      id: 'checkingBalance',
      prompt: 'About how much is in checking today? Enter 0 if none.',
      kind: 'number',
      placeholder: '12000',
      helper: 'Section 2a assets. Credit and bank statements will confirm — a round number is fine.',
    };
  }
  if (blank(answers.savingsBalance)) {
    return {
      id: 'savingsBalance',
      prompt: 'Savings, money market, or cash-equivalent balance? Enter 0 if none.',
      kind: 'number',
      placeholder: '8000',
    };
  }
  if (blank(answers.retirementBalance)) {
    return {
      id: 'retirementBalance',
      prompt: 'Retirement accounts (401k, IRA) approximate balance? Enter 0 if none.',
      kind: 'number',
      placeholder: '45000',
    };
  }
  if (answers.receivingGift == null) {
    return {
      id: 'receivingGift',
      prompt: 'Are you receiving gift funds or a grant for this transaction?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.receivingGift && blank(answers.giftAmount)) {
    return {
      id: 'giftAmount',
      prompt: 'Gift or grant amount?',
      kind: 'number',
      placeholder: '20000',
    };
  }
  if (answers.receivingGift && !answers.giftSource) {
    return {
      id: 'giftSource',
      prompt: 'Who is the gift from?',
      kind: 'choice',
      choices: [
        { id: 'RELATIVE', label: 'Relative' },
        { id: 'EMPLOYER', label: 'Employer' },
        { id: 'UNMARRIED_PARTNER', label: 'Unmarried partner' },
        { id: 'OTHER', label: 'Other (grant / nonprofit)' },
      ],
    };
  }
  if (blank(answers.monthlyDebts)) {
    return {
      id: 'monthlyDebts',
      prompt: 'Roughly how much do you pay each month toward credit cards, auto, student loans, and other debts?',
      kind: 'number',
      placeholder: '1200',
      helper: 'Skip $0 if you are not sure — credit will fill this in.',
    };
  }
  if (answers.hasAlimonyOrSupport == null) {
    return {
      id: 'hasAlimonyOrSupport',
      prompt: 'Do you pay alimony, child support, or separate maintenance?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.hasAlimonyOrSupport && blank(answers.alimonyMonthly)) {
    return {
      id: 'alimonyMonthly',
      prompt: 'Monthly alimony / child support / separate maintenance you pay?',
      kind: 'number',
      placeholder: '400',
    };
  }
  if (answers.ownsOtherRE == null) {
    return {
      id: 'ownsOtherRE',
      prompt: 'Do you own any other real estate (current home if this is a purchase, rentals, land)?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.ownsOtherRE && blank(answers.otherReAddress)) {
    return {
      id: 'otherReAddress',
      prompt: 'Address of that other property? If more than one, start with the most important.',
      kind: 'text',
      placeholder: '200 Oak Ave, Mesa, AZ 85201',
    };
  }
  if (answers.ownsOtherRE && blank(answers.otherReValue)) {
    return {
      id: 'otherReValue',
      prompt: 'About what is that property worth?',
      kind: 'number',
      placeholder: '425000',
    };
  }
  if (answers.ownsOtherRE && blank(answers.otherReMortgage)) {
    return {
      id: 'otherReMortgage',
      prompt: 'Remaining mortgage balance on it? Enter 0 if free and clear.',
      kind: 'number',
      placeholder: '280000',
    };
  }
  if (answers.declOccupyPrimary == null) {
    return {
      id: 'declOccupyPrimary',
      prompt: 'Declarations — will you occupy the property as your primary residence?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declJudgment == null) {
    return {
      id: 'declJudgment',
      prompt: 'Are there any outstanding judgments against you?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declBankruptcy == null) {
    return {
      id: 'declBankruptcy',
      prompt: 'Have you declared bankruptcy in the last 7 years?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declForeclosure == null) {
    return {
      id: 'declForeclosure',
      prompt: 'Have you had a foreclosure, deed-in-lieu, or short sale in the last 7 years?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declLawsuit == null) {
    return {
      id: 'declLawsuit',
      prompt: 'Are you currently a party to a lawsuit?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declDelinquentFed == null) {
    return {
      id: 'declDelinquentFed',
      prompt: 'Are you presently delinquent or in default on a federal debt?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declBorrowedDown == null) {
    return {
      id: 'declBorrowedDown',
      prompt: 'Are you borrowing any money for this transaction that has not already been disclosed (including from the seller)?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (answers.declCoMaker == null) {
    return {
      id: 'declCoMaker',
      prompt: 'Are you a co-signer or guarantor on any debt or loan that is not disclosed on this application?',
      kind: 'choice',
      choices: yesNo(),
    };
  }
  if (!answers.militaryService) {
    return {
      id: 'militaryService',
      prompt: 'Military service — which applies?',
      kind: 'choice',
      choices: [
        { id: 'NEVER', label: 'Never served' },
        { id: 'CURRENT', label: 'Currently serving' },
        { id: 'VETERAN', label: 'Veteran' },
        { id: 'RESERVE', label: 'Reserve / National Guard (not currently serving on active duty)' },
      ],
    };
  }
  if (!answers.hmdaEthnicity) {
    return {
      id: 'hmdaEthnicity',
      prompt: 'Demographic information (HMDA) — ethnicity? You may decline.',
      kind: 'choice',
      helper: 'This is collected to monitor fair lending. It is not used to decide your loan.',
      choices: [
        { id: 'HISPANIC', label: 'Hispanic or Latino' },
        { id: 'NOT_HISPANIC', label: 'Not Hispanic or Latino' },
        { id: 'DECLINE', label: 'I do not wish to provide' },
      ],
    };
  }
  if (!answers.hmdaRace) {
    return {
      id: 'hmdaRace',
      prompt: 'Race? You may decline.',
      kind: 'choice',
      choices: [
        { id: 'WHITE', label: 'White' },
        { id: 'BLACK', label: 'Black or African American' },
        { id: 'ASIAN', label: 'Asian' },
        { id: 'AIAN', label: 'American Indian or Alaska Native' },
        { id: 'PACIFIC', label: 'Native Hawaiian or Other Pacific Islander' },
        { id: 'DECLINE', label: 'I do not wish to provide' },
      ],
    };
  }
  if (!answers.hmdaSex) {
    return {
      id: 'hmdaSex',
      prompt: 'Sex? You may decline.',
      kind: 'choice',
      choices: [
        { id: 'FEMALE', label: 'Female' },
        { id: 'MALE', label: 'Male' },
        { id: 'DECLINE', label: 'I do not wish to provide' },
      ],
    };
  }
  if (!answers.program) {
    return {
      id: 'program',
      prompt: 'Do you already know which loan program you want, or should your loan officer recommend one after credit?',
      kind: 'choice',
      helper: 'If you are not sure, we will start as Conventional and your LO can switch to FHA, VA, or USDA.',
      choices: [
        { id: 'CONVENTIONAL', label: 'Conventional' },
        { id: 'FHA', label: 'FHA' },
        { id: 'VA', label: 'VA' },
        { id: 'USDA', label: 'USDA' },
        { id: 'UNSURE', label: "I'm not sure — let my LO decide" },
      ],
    };
  }

  if (answers.program === 'FHA') {
    if (answers.authorizeCaivrs == null) {
      return {
        id: 'authorizeCaivrs',
        prompt: `${firstName(answers)}, FHA requires a CAIVRS check for federal debt. Can we run that?`,
        kind: 'choice',
        choices: yesNo(),
      };
    }
    if (answers.acknowledgeInformedChoice == null) {
      return {
        id: 'acknowledgeInformedChoice',
        prompt:
          'HUD also needs you to acknowledge the FHA Informed Consumer Choice disclosure (FHA vs Conventional cost comparison). Do you acknowledge that?',
        kind: 'choice',
        choices: yesNo(),
      };
    }
  }

  if (answers.program === 'VA') {
    if (!answers.vaDisabilityRating) {
      return {
        id: 'vaDisabilityRating',
        prompt: 'VA files need disability status for the funding-fee waiver. What applies?',
        kind: 'choice',
        choices: [
          { id: '0', label: 'None / 0% disability' },
          { id: '10_plus', label: '10% or greater' },
        ],
      };
    }
    if (blank(answers.vaChildCareExpenses)) {
      return {
        id: 'vaChildCareExpenses',
        prompt: 'Any monthly child-care expense we should count in residual income? Enter 0 if none.',
        kind: 'number',
        placeholder: '0',
      };
    }
  }

  if (answers.program === 'USDA') {
    const occupants = answers.householdOccupants ?? [];
    if (answers.addAnotherOccupant === undefined && occupants.length === 0 && !answers.occupantName) {
      return {
        id: 'hasHousehold',
        prompt:
          'USDA counts income for everyone living in the home, even if they are not on the loan. Anyone else in the household?',
        kind: 'choice',
        choices: yesNo(),
      };
    }
    if (answers.addAnotherOccupant) {
      if (!answers.occupantName) {
        return {
          id: 'occupantName',
          prompt: occupants.length ? "What is the next occupant's name?" : 'What is their name?',
          kind: 'text',
          placeholder: 'Jordan Chen',
        };
      }
      if (!answers.occupantAge) {
        return {
          id: 'occupantAge',
          prompt: `How old is ${answers.occupantName}?`,
          kind: 'number',
          placeholder: '34',
        };
      }
      if (!answers.occupantIncome) {
        return {
          id: 'occupantIncome',
          prompt: `What is ${answers.occupantName}'s annual income? Use 0 if they have none.`,
          kind: 'number',
          placeholder: '0',
        };
      }
      return {
        id: 'addAnotherOccupant',
        prompt: 'Add another household occupant?',
        kind: 'choice',
        choices: yesNo(),
      };
    }
  }

  if (answers.acknowledgedUrla == null) {
    return {
      id: 'acknowledgedUrla',
      prompt:
        'You are completing a Uniform Residential Loan Application. The information you give is true to the best of your knowledge, and your lender will verify it. Do you acknowledge that?',
      kind: 'choice',
      choices: [{ id: 'got_it', label: 'I acknowledge — continue' }],
    };
  }

  if (!answers.acknowledgedDocPlan) {
    return {
      id: 'acknowledgedDocPlan',
      prompt: buildDocumentPlan(answers),
      kind: 'choice',
      helper: 'This checklist is based on typical Fannie/Freddie, FHA, VA, and USDA documentation — your LO still signs off.',
      choices: [{ id: 'got_it', label: 'Got it — continue' }],
    };
  }

  return { done: true };
}

export function applyAnswer(answers: IntakeAnswers, turnId: string, raw: string): IntakeAnswers {
  const value = raw.trim();
  const next: IntakeAnswers = { ...answers };
  const yes = value === 'yes' || value === 'true' || value === 'got_it';

  const textKeys: Array<keyof IntakeAnswers> = [
    'borrowerName',
    'email',
    'phone',
    'ssnLast4',
    'dob',
    'dependentAges',
    'currentAddress',
    'yearsAtAddress',
    'monthlyHousing',
    'coborrowerName',
    'propertyAddress',
    'purchasePrice',
    'loanAmount',
    'employerName',
    'jobTitle',
    'yearsAtJob',
    'yearsInBusiness',
    'monthlyIncome',
    'secondEmployer',
    'secondMonthlyIncome',
    'previousEmployer',
    'otherIncomeType',
    'otherIncomeMonthly',
    'checkingBalance',
    'savingsBalance',
    'retirementBalance',
    'giftAmount',
    'monthlyDebts',
    'alimonyMonthly',
    'otherReAddress',
    'otherReValue',
    'otherReMortgage',
    'dependentsCount',
    'vaDisabilityRating',
    'vaChildCareExpenses',
    'occupantName',
    'occupantAge',
    'occupantIncome',
  ];
  if ((textKeys as string[]).includes(turnId)) {
    (next as Record<string, unknown>)[turnId] = value || '0';
    if (turnId === 'ssnLast4') next.ssnLast4 = value.replace(/\D/g, '').slice(-4);
    if (turnId === 'borrowerName' || turnId === 'email' || turnId === 'phone' || turnId === 'dob') {
      (next as Record<string, unknown>)[turnId] = value;
    }
    return next;
  }

  const boolKeys: Array<keyof IntakeAnswers> = [
    'hasCoborrower',
    'sameBusinessFiveYears',
    'hasSecondJob',
    'hasOtherIncome',
    'receivingGift',
    'hasAlimonyOrSupport',
    'ownsOtherRE',
    'declOccupyPrimary',
    'declJudgment',
    'declBankruptcy',
    'declForeclosure',
    'declLawsuit',
    'declDelinquentFed',
    'declBorrowedDown',
    'declCoMaker',
    'authorizeCaivrs',
    'acknowledgeInformedChoice',
  ];
  if ((boolKeys as string[]).includes(turnId)) {
    (next as Record<string, unknown>)[turnId] = yes;
    return next;
  }

  switch (turnId) {
    case 'citizenship':
      next.citizenship = value === 'PERM_RESIDENT' || value === 'NON_PERM' ? value : 'US_CITIZEN';
      break;
    case 'maritalStatus':
      next.maritalStatus = value === 'SEPARATED' || value === 'UNMARRIED' ? value : 'MARRIED';
      break;
    case 'housingStatus':
      next.housingStatus = value === 'RENT' || value === 'RENT_FREE' ? value : 'OWN';
      break;
    case 'loanPurpose':
      next.loanPurpose = value === 'REFINANCE' ? 'REFINANCE' : 'PURCHASE';
      break;
    case 'propertyType':
      next.propertyType =
        value === 'CONDO' || value === '2_4_UNIT' || value === 'PUD' || value === 'MANUFACTURED' ? value : 'SFR';
      break;
    case 'occupancy':
      next.occupancy = value === 'SECOND_HOME' || value === 'INVESTMENT' ? value : 'PRIMARY';
      break;
    case 'employmentType':
      next.employmentType = value === 'SELF_EMPLOYED' ? 'SELF_EMPLOYED' : 'W2';
      break;
    case 'giftSource':
      next.giftSource =
        value === 'EMPLOYER' || value === 'UNMARRIED_PARTNER' || value === 'OTHER' ? value : 'RELATIVE';
      break;
    case 'militaryService':
      next.militaryService =
        value === 'CURRENT' || value === 'VETERAN' || value === 'RESERVE' ? value : 'NEVER';
      break;
    case 'hmdaEthnicity':
      next.hmdaEthnicity = value === 'HISPANIC' || value === 'NOT_HISPANIC' || value === 'DECLINE' ? value : 'DECLINE';
      break;
    case 'hmdaRace':
      next.hmdaRace =
        value === 'WHITE' || value === 'BLACK' || value === 'ASIAN' || value === 'AIAN' || value === 'PACIFIC'
          ? value
          : 'DECLINE';
      break;
    case 'hmdaSex':
      next.hmdaSex = value === 'FEMALE' || value === 'MALE' ? value : 'DECLINE';
      break;
    case 'acknowledgedUrla':
      next.acknowledgedUrla = true;
      break;
    case 'acknowledgedDocPlan':
      next.acknowledgedDocPlan = true;
      break;
    case 'program':
      if (value === 'UNSURE') next.program = 'UNSURE';
      else if (value === 'FHA' || value === 'VA' || value === 'USDA' || value === 'CONVENTIONAL') next.program = value;
      break;
    case 'hasHousehold':
      next.addAnotherOccupant = yes;
      if (!yes) {
        next.householdOccupants = [];
        next.addAnotherOccupant = false;
      }
      break;
    case 'addAnotherOccupant': {
      const occupants = [...(next.householdOccupants ?? [])];
      if (next.occupantName) {
        occupants.push({
          name: next.occupantName,
          age: next.occupantAge ?? '',
          annualIncome: next.occupantIncome ?? '0',
        });
      }
      next.householdOccupants = occupants;
      next.occupantName = undefined;
      next.occupantAge = undefined;
      next.occupantIncome = undefined;
      next.addAnotherOccupant = yes;
      break;
    }
    default:
      break;
  }

  return next;
}

export function matchChoice(input: string, choices: IntakeChoice[]): string | null {
  const normalized = input.trim().toLowerCase().replace(/[?.!]/g, '');
  const exact = choices.find(
    (choice) => choice.id.toLowerCase() === normalized || choice.label.toLowerCase() === normalized,
  );
  if (exact) {
    return exact.id;
  }
  const byInclude = choices.find((choice) => {
    const label = choice.label.toLowerCase();
    const id = choice.id.toLowerCase().replace(/_/g, ' ');
    return (label.length > 2 && normalized.includes(label)) || (id.length > 2 && normalized.includes(id));
  });
  if (byInclude) {
    return byInclude.id;
  }
  if (/\b(yes|yeah|yep|correct|sure|sí|si|có|是|예|네)\b/.test(normalized)) {
    return choices.find((choice) => choice.id === 'yes')?.id ?? null;
  }
  if (/\b(no|nope|not really|không|否|아니|아니오)\b/.test(normalized)) {
    return choices.find((choice) => choice.id === 'no')?.id ?? null;
  }
  if (normalized.includes('got it') || normalized.includes('entendido') || normalized.includes('明白')) {
    return choices.find((choice) => choice.id === 'got_it')?.id ?? null;
  }
  if (/\b(buy|buying|purchase|purchasing|compra|comprar|mua)\b/.test(normalized)) {
    return choices.find((choice) => choice.id === 'PURCHASE')?.id ?? null;
  }
  if (/\b(refi|refinance|refinancing|refinanciar|tái cấp vốn)\b/.test(normalized)) {
    return choices.find((choice) => choice.id === 'REFINANCE')?.id ?? null;
  }
  if (/\b(w-?2|employee|empleado|nhân viên)\b/.test(normalized)) {
    return choices.find((choice) => choice.id === 'W2')?.id ?? null;
  }
  if (/\bself[- ]?employ/.test(normalized) || normalized.includes('own my business') || normalized.includes('autónomo')) {
    return choices.find((choice) => choice.id === 'SELF_EMPLOYED')?.id ?? null;
  }
  if (/\bnot sure\b/.test(normalized) || normalized.includes('loan officer') || normalized.includes('no sé')) {
    return choices.find((choice) => choice.id === 'UNSURE')?.id ?? null;
  }
  return null;
}

export function toApplyBody(answers: IntakeAnswers): ApplyBody {
  const letLoDecide = answers.program === 'UNSURE';
  const loanProgram: LoanProgram =
    letLoDecide || !answers.program || answers.program === 'UNSURE' ? 'CONVENTIONAL' : answers.program;

  return {
    loanProgram,
    letLoDecide,
    formData: {
      retention: 'zero-data-retention',
      custody: 'in-browser-session-until-export',
      form: 'FNMA 1003 / URLA',
      ...answers,
      documentPlan: buildDocumentPlan(answers),
    },
  };
}

export function completionSummary(answers: IntakeAnswers) {
  return `${firstName(answers)}, the Uniform Residential Loan Application is complete in this session. Download the 1003 JSON for your loan officer — FreeFlow does not keep a copy. Next they will pull credit, send disclosures, and collect the documents we listed.`;
}

/** Core URLA slots used for the live-form progress bar (conditionals still asked in chat). */
export const URLA_PROGRESS_TOTAL = 42;

export function filledFieldCount(answers: IntakeAnswers): number {
  return [
    answers.borrowerName,
    answers.email,
    answers.phone,
    answers.ssnLast4,
    answers.dob,
    answers.citizenship,
    answers.maritalStatus,
    answers.dependentsCount,
    answers.currentAddress,
    answers.yearsAtAddress,
    answers.housingStatus,
    answers.hasCoborrower == null ? undefined : 'y',
    answers.loanPurpose,
    answers.propertyAddress,
    answers.propertyType,
    answers.occupancy,
    answers.purchasePrice ?? (answers.loanPurpose === 'REFINANCE' ? 'n/a' : undefined),
    answers.loanAmount,
    answers.employmentType,
    answers.employerName,
    answers.jobTitle,
    answers.monthlyIncome,
    answers.hasSecondJob == null ? undefined : 'y',
    answers.hasOtherIncome == null ? undefined : 'y',
    answers.checkingBalance,
    answers.savingsBalance,
    answers.retirementBalance,
    answers.receivingGift == null ? undefined : 'y',
    answers.monthlyDebts,
    answers.hasAlimonyOrSupport == null ? undefined : 'y',
    answers.ownsOtherRE == null ? undefined : 'y',
    answers.declOccupyPrimary == null ? undefined : 'y',
    answers.declJudgment == null ? undefined : 'y',
    answers.declBankruptcy == null ? undefined : 'y',
    answers.declForeclosure == null ? undefined : 'y',
    answers.declLawsuit == null ? undefined : 'y',
    answers.declDelinquentFed == null ? undefined : 'y',
    answers.declBorrowedDown == null ? undefined : 'y',
    answers.declCoMaker == null ? undefined : 'y',
    answers.militaryService,
    answers.hmdaEthnicity,
    answers.program,
  ].filter(Boolean).length;
}
