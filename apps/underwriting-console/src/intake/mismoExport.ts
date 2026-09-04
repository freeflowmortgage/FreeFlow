import { buildDocumentPlan, firstName, type IntakeAnswers, type LoanProgram } from './intake-agent';

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function num(value: unknown): string {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? String(parsed) : '0';
}

function mismoLoanPurpose(answers: IntakeAnswers): string {
  return answers.loanPurpose === 'REFINANCE' ? 'Refinance' : 'Purchase';
}

function mismoMortgageType(program: LoanProgram): string {
  if (program === 'FHA') return 'FHA';
  if (program === 'VA') return 'VA';
  if (program === 'USDA') return 'USDARuralDevelopment';
  return 'Conventional';
}

function mismoOccupancy(answers: IntakeAnswers): string {
  if (answers.occupancy === 'INVESTMENT') return 'Investment';
  if (answers.occupancy === 'SECOND_HOME') return 'SecondHome';
  return 'PrimaryResidence';
}

function residenceBlock(address: string | undefined, years: string | undefined, type: 'Current' | 'Prior'): string {
  if (!address) return '';
  return `
            <RESIDENCE>
              <ADDRESS>
                <AddressLineText>${esc(address)}</AddressLineText>
              </ADDRESS>
              <RESIDENCE_DETAIL>
                <BorrowerResidencyDurationYearsCount>${num(years)}</BorrowerResidencyDurationYearsCount>
                <BorrowerResidencyType>${type}</BorrowerResidencyType>
              </RESIDENCE_DETAIL>
            </RESIDENCE>`;
}

function employerBlock(
  name: string | undefined,
  years: string | undefined,
  income: string | undefined,
  classification: 'Primary' | 'Secondary' | 'Previous',
  selfEmployed: boolean,
): string {
  if (!name) return '';
  return `
            <EMPLOYER>
              <LEGAL_ENTITY><LEGAL_ENTITY_DETAIL><FullName>${esc(name)}</FullName></LEGAL_ENTITY_DETAIL></LEGAL_ENTITY>
              <EMPLOYMENT>
                <EmploymentClassificationType>${classification}</EmploymentClassificationType>
                <EmploymentBorrowerSelfEmployedIndicator>${selfEmployed}</EmploymentBorrowerSelfEmployedIndicator>
                <EmploymentTimeInLineOfWorkYearsCount>${num(years)}</EmploymentTimeInLineOfWorkYearsCount>${
                  income
                    ? `
                <EmploymentMonthlyIncomeAmount>${num(income)}</EmploymentMonthlyIncomeAmount>`
                    : ''
                }
              </EMPLOYMENT>
            </EMPLOYER>`;
}

/**
 * Serialize the intake session as a MISMO 3.4-style URLA payload for client
 * (lender/broker LOS) delivery. This is the deliverable — the borrower never
 * downloads anything, and FreeFlow relays without persisting (ZDR).
 */
export function buildMismo34Xml(answers: IntakeAnswers): string {
  const program: LoanProgram =
    answers.program && answers.program !== 'UNSURE' ? answers.program : 'CONVENTIONAL';
  const selfEmployed = answers.employmentType === 'SELF_EMPLOYED';
  const generatedAt = new Date().toISOString();

  const currentEmployerYears = selfEmployed ? answers.yearsInBusiness : answers.yearsAtJob;
  const priorEmployer = employerBlock(
    answers.previousEmployer,
    answers.previousEmployerYears,
    undefined,
    'Previous',
    false,
  );
  const secondEmployer = answers.hasSecondJob
    ? employerBlock(answers.secondEmployer, undefined, answers.secondMonthlyIncome, 'Secondary', false)
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas"
         MISMOReferenceModelIdentifier="3.4.0"
         xmlns:FREEFLOW="urn:freeflow-mortgage:intake">
  <ABOUT_VERSIONS>
    <ABOUT_VERSION>
      <CreatedDatetime>${generatedAt}</CreatedDatetime>
      <DataVersionIdentifier>FreeFlow AI 1003 Intake</DataVersionIdentifier>
    </ABOUT_VERSION>
  </ABOUT_VERSIONS>
  <DEAL_SETS><DEAL_SET><DEALS><DEAL>
    <COLLATERALS>
      <COLLATERAL>
        <SUBJECT_PROPERTY>
          <ADDRESS><AddressLineText>${esc(answers.propertyAddress)}</AddressLineText></ADDRESS>
          <PROPERTY_DETAIL>
            <PropertyEstateType>FeeSimple</PropertyEstateType>
            <PropertyUsageType>${mismoOccupancy(answers)}</PropertyUsageType>
          </PROPERTY_DETAIL>
        </SUBJECT_PROPERTY>
      </COLLATERAL>
    </COLLATERALS>
    <LOANS>
      <LOAN LoanRoleType="SubjectLoan">
        <TERMS_OF_LOAN>
          <BaseLoanAmount>${num(answers.loanAmount)}</BaseLoanAmount>
          <LoanPurposeType>${mismoLoanPurpose(answers)}</LoanPurposeType>
          <MortgageType>${mismoMortgageType(program)}</MortgageType>
        </TERMS_OF_LOAN>${
          answers.loanPurpose === 'PURCHASE'
            ? `
        <PURCHASE_CREDITS><PURCHASE_CREDIT><PurchasePriceAmount>${num(answers.purchasePrice)}</PurchasePriceAmount></PURCHASE_CREDIT></PURCHASE_CREDITS>`
            : ''
        }
      </LOAN>
    </LOANS>
    <PARTIES>
      <PARTY>
        <INDIVIDUAL>
          <NAME><FullName>${esc(answers.borrowerName)}</FullName></NAME>
          <CONTACT_POINTS>
            <CONTACT_POINT><CONTACT_POINT_EMAIL><EmailValue>${esc(answers.email)}</EmailValue></CONTACT_POINT_EMAIL></CONTACT_POINT>
            <CONTACT_POINT><CONTACT_POINT_TELEPHONE><TelephoneValue>${esc(answers.phone)}</TelephoneValue></CONTACT_POINT_TELEPHONE></CONTACT_POINT>
          </CONTACT_POINTS>
        </INDIVIDUAL>
        <ROLES>
          <ROLE>
            <BORROWER>
              <BORROWER_DETAIL>
                <BorrowerBirthDate>${esc(answers.dob)}</BorrowerBirthDate>
                <MaritalStatusType>${esc(answers.maritalStatus ?? '')}</MaritalStatusType>
                <DependentCount>${num(answers.dependentsCount)}</DependentCount>
                <CitizenshipResidencyType>${esc(answers.citizenship ?? '')}</CitizenshipResidencyType>
                <FREEFLOW:SSNLastFour>${esc(answers.ssnLast4)}</FREEFLOW:SSNLastFour>
              </BORROWER_DETAIL>
              <RESIDENCES>${residenceBlock(answers.currentAddress, answers.yearsAtAddress, 'Current')}${residenceBlock(
                answers.previousAddress,
                answers.yearsAtPreviousAddress,
                'Prior',
              )}
              </RESIDENCES>
              <EMPLOYERS>${employerBlock(answers.employerName, currentEmployerYears, answers.monthlyIncome, 'Primary', selfEmployed)}${secondEmployer}${priorEmployer}
              </EMPLOYERS>
              <DECLARATION>
                <DECLARATION_DETAIL>
                  <IntentToOccupyType>${answers.declOccupyPrimary ? 'Yes' : 'No'}</IntentToOccupyType>
                  <OutstandingJudgmentsIndicator>${answers.declJudgment === true}</OutstandingJudgmentsIndicator>
                  <BankruptcyIndicator>${answers.declBankruptcy === true}</BankruptcyIndicator>
                  <PriorPropertyForeclosureCompletedIndicator>${answers.declForeclosure === true}</PriorPropertyForeclosureCompletedIndicator>
                  <PartyToLawsuitIndicator>${answers.declLawsuit === true}</PartyToLawsuitIndicator>
                  <PresentlyDelinquentIndicator>${answers.declDelinquentFed === true}</PresentlyDelinquentIndicator>
                  <UndisclosedBorrowedFundsIndicator>${answers.declBorrowedDown === true}</UndisclosedBorrowedFundsIndicator>
                  <UndisclosedComakerOfNoteIndicator>${answers.declCoMaker === true}</UndisclosedComakerOfNoteIndicator>
                </DECLARATION_DETAIL>
              </DECLARATION>
              <GOVERNMENT_MONITORING>
                <GOVERNMENT_MONITORING_DETAIL>
                  <HMDAEthnicityType>${esc(answers.hmdaEthnicity ?? 'DECLINE')}</HMDAEthnicityType>
                  <HMDARaceType>${esc(answers.hmdaRace ?? 'DECLINE')}</HMDARaceType>
                  <HMDAGenderType>${esc(answers.hmdaSex ?? 'DECLINE')}</HMDAGenderType>
                </GOVERNMENT_MONITORING_DETAIL>
              </GOVERNMENT_MONITORING>
            </BORROWER>
            <ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL>
          </ROLE>
        </ROLES>
      </PARTY>${
        answers.hasCoborrower && answers.coborrowerName
          ? `
      <PARTY>
        <INDIVIDUAL><NAME><FullName>${esc(answers.coborrowerName)}</FullName></NAME></INDIVIDUAL>
        <ROLES><ROLE><ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL></ROLE></ROLES>
      </PARTY>`
          : ''
      }
    </PARTIES>
    <EXTENSION>
      <FREEFLOW:INTAKE>
        <FREEFLOW:Retention>zero-data-retention-relay</FREEFLOW:Retention>
        <FREEFLOW:BorrowerFirstName>${esc(firstName(answers))}</FREEFLOW:BorrowerFirstName>
        <FREEFLOW:PRE_UNDERWRITING_CHECKLIST>${esc(buildDocumentPlan(answers))}</FREEFLOW:PRE_UNDERWRITING_CHECKLIST>
        <FREEFLOW:INTEGRATIONS>
          <FREEFLOW:CreditReport provider="CREDCO" method="CLIENT_API"
            borrowerConsent="${answers.creditPullConsent === true}"
            pullType="${answers.creditPullType ?? 'NONE'}"
            action="${
              answers.creditPullType === 'SOFT'
                ? 'QUEUE_SOFT_TRI_MERGE'
                : answers.creditPullType === 'HARD'
                  ? 'QUEUE_TRI_MERGE_PULL'
                  : 'LO_MUST_OBTAIN_CONSENT'
            }" />
          <FREEFLOW:AssetVerification provider="${answers.assetLinkConsent === 'PLAID' ? 'PLAID' : 'MANUAL_STATEMENTS'}"
            method="${answers.assetLinkConsent === 'PLAID' ? 'CLIENT_API' : 'DOCUMENT_COLLECTION'}"
            borrowerConsent="${answers.assetLinkConsent === 'PLAID'}"
            action="${answers.assetLinkConsent === 'PLAID' ? 'SEND_PLAID_LINK_INVITE' : 'REQUEST_TWO_MONTHS_STATEMENTS'}" />
        </FREEFLOW:INTEGRATIONS>
      </FREEFLOW:INTAKE>
    </EXTENSION>
  </DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>
`;
}
