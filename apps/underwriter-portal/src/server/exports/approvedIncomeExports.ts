import PDFDocument from 'pdfkit';
import type { ApprovedIncomeSnapshot } from './approvedIncomeSnapshot';

export const APPROVED_INCOME_JSON_PROFILE = 'freeflow-approved-income-json-v1' as const;
export const MISMO_REFERENCE_MODEL_IDENTIFIER = '3.4.0' as const;
export const MISMO_APPROVED_INCOME_PROFILE = 'freeflow-approved-income-mismo-3.4-profile-v1' as const;
export const MISMO_OFFICIAL_XSD_VALIDATION_STATUS = 'NOT_PERFORMED_OFFICIAL_XSD_NOT_BUNDLED' as const;

export type MismoProfileValidation = Readonly<{
  status: 'PASS';
  implementationProfile: typeof MISMO_APPROVED_INCOME_PROFILE;
  referenceModelIdentifier: typeof MISMO_REFERENCE_MODEL_IDENTIFIER;
  officialXsdValidation: typeof MISMO_OFFICIAL_XSD_VALIDATION_STATUS;
}>;

export function serializeApprovedIncomeJson(snapshot: ApprovedIncomeSnapshot): string {
  return `${JSON.stringify({ exportProfile: APPROVED_INCOME_JSON_PROFILE, ...snapshot }, null, 2)}\n`;
}

/**
 * Generates a narrow FreeFlow implementation profile carried in a MISMO 3.4
 * MESSAGE envelope. This is structurally/profile validated below, but the
 * repository does not contain the official MISMO XSD bundle. It must not be
 * described as official-XSD conformant.
 */
export function serializeApprovedIncomeMismo(snapshot: ApprovedIncomeSnapshot): string {
  const borrowerXml = snapshot.calculation.borrowers.map((borrower) => `
          <PARTY SequenceNumber="${borrower.ordinal + 1}">
            <ROLES><ROLE><BORROWER>
              <BORROWER_DETAIL>
                <BorrowerClassificationType>${borrower.role === 'PRIMARY' ? 'Primary' : 'Secondary'}</BorrowerClassificationType>
              </BORROWER_DETAIL>
              <EXTENSION><FREEFLOW:BORROWER_INCOME>
                <FREEFLOW:BorrowerKey>${xmlEscape(borrower.borrowerKey)}</FREEFLOW:BorrowerKey>
                <FREEFLOW:QualifyingMonthlyIncomeAmount>${borrower.qualifyingMonthlyIncome}</FREEFLOW:QualifyingMonthlyIncomeAmount>
              </FREEFLOW:BORROWER_INCOME></EXTENSION>
            </BORROWER><ROLE_DETAIL><PartyRoleType>Borrower</PartyRoleType></ROLE_DETAIL></ROLE></ROLES>
          </PARTY>`).join('');
  const components = Object.entries(snapshot.calculation.components)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([name, amount]) => `
                <FREEFLOW:INCOME_COMPONENT>
                  <FREEFLOW:ComponentType>${xmlEscape(name)}</FREEFLOW:ComponentType>
                  <FREEFLOW:MonthlyAmount>${amount}</FREEFLOW:MonthlyAmount>
                </FREEFLOW:INCOME_COMPONENT>`)
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas"
         xmlns:FREEFLOW="urn:freeflow:approved-income:1"
         MISMOReferenceModelIdentifier="${MISMO_REFERENCE_MODEL_IDENTIFIER}"
         FREEFLOW:ImplementationProfileIdentifier="${MISMO_APPROVED_INCOME_PROFILE}">
  <ABOUT_VERSIONS><ABOUT_VERSION>
    <CreatedDatetime>${xmlEscape(snapshot.approval.approvedAt)}</CreatedDatetime>
    <DataVersionIdentifier>${MISMO_APPROVED_INCOME_PROFILE}</DataVersionIdentifier>
  </ABOUT_VERSION></ABOUT_VERSIONS>
  <DEAL_SETS><DEAL_SET><DEALS><DEAL>
    <LOANS><LOAN LoanRoleType="SubjectLoan">
      <TERMS_OF_LOAN><MortgageType>${mismoMortgageType(snapshot.loan.program)}</MortgageType></TERMS_OF_LOAN>
    </LOAN></LOANS>
    <PARTIES>${borrowerXml}
    </PARTIES>
    <EXTENSION><FREEFLOW:APPROVED_INCOME>
      <FREEFLOW:ImplementationProfileIdentifier>${MISMO_APPROVED_INCOME_PROFILE}</FREEFLOW:ImplementationProfileIdentifier>
      <FREEFLOW:OfficialXsdValidationStatus>${MISMO_OFFICIAL_XSD_VALIDATION_STATUS}</FREEFLOW:OfficialXsdValidationStatus>
      <FREEFLOW:SnapshotSchemaVersion>${snapshot.schemaVersion}</FREEFLOW:SnapshotSchemaVersion>
      <FREEFLOW:SnapshotHash>${snapshot.snapshotHash}</FREEFLOW:SnapshotHash>
      <FREEFLOW:LoanIdentifier>${xmlEscape(snapshot.loan.id)}</FREEFLOW:LoanIdentifier>
      <FREEFLOW:LoanVersion>${snapshot.loan.version}</FREEFLOW:LoanVersion>
      <FREEFLOW:ApprovalEventIdentifier>${xmlEscape(snapshot.approval.eventId)}</FREEFLOW:ApprovalEventIdentifier>
      <FREEFLOW:ApprovalAction>${snapshot.approval.action}</FREEFLOW:ApprovalAction>
      <FREEFLOW:CalculationIdentifier>${xmlEscape(snapshot.approval.calculationId)}</FREEFLOW:CalculationIdentifier>
      <FREEFLOW:QualifyingMonthlyIncomeAmount>${snapshot.calculation.qualifyingMonthlyIncome}</FREEFLOW:QualifyingMonthlyIncomeAmount>
      <FREEFLOW:TotalAnnualCashFlowAmount>${snapshot.calculation.totalAnnualCashFlow}</FREEFLOW:TotalAnnualCashFlowAmount>
      <FREEFLOW:TrendingResult>${xmlEscape(snapshot.calculation.trendingResult)}</FREEFLOW:TrendingResult>
      <FREEFLOW:YearsAnalyzed>${snapshot.calculation.yearsAnalyzed.join(',')}</FREEFLOW:YearsAnalyzed>
      <FREEFLOW:INCOME_COMPONENTS>${components}
      </FREEFLOW:INCOME_COMPONENTS>
    </FREEFLOW:APPROVED_INCOME></EXTENSION>
  </DEAL></DEALS></DEAL_SET></DEAL_SETS>
</MESSAGE>
`;
  validateApprovedIncomeMismoProfile(xml, snapshot);
  return xml;
}

export function validateApprovedIncomeMismoProfile(
  xml: string,
  snapshot: ApprovedIncomeSnapshot,
): MismoProfileValidation {
  assertWellFormedXml(xml);
  const required = [
    `xmlns="http://www.mismo.org/residential/2009/schemas"`,
    `MISMOReferenceModelIdentifier="${MISMO_REFERENCE_MODEL_IDENTIFIER}"`,
    `FREEFLOW:ImplementationProfileIdentifier="${MISMO_APPROVED_INCOME_PROFILE}"`,
    `<FREEFLOW:OfficialXsdValidationStatus>${MISMO_OFFICIAL_XSD_VALIDATION_STATUS}</FREEFLOW:OfficialXsdValidationStatus>`,
    `<FREEFLOW:SnapshotHash>${snapshot.snapshotHash}</FREEFLOW:SnapshotHash>`,
    `<FREEFLOW:LoanIdentifier>${xmlEscape(snapshot.loan.id)}</FREEFLOW:LoanIdentifier>`,
    `<FREEFLOW:ApprovalEventIdentifier>${xmlEscape(snapshot.approval.eventId)}</FREEFLOW:ApprovalEventIdentifier>`,
    `<FREEFLOW:ApprovalAction>${snapshot.approval.action}</FREEFLOW:ApprovalAction>`,
    `<FREEFLOW:CalculationIdentifier>${xmlEscape(snapshot.approval.calculationId)}</FREEFLOW:CalculationIdentifier>`,
    `<FREEFLOW:QualifyingMonthlyIncomeAmount>${snapshot.calculation.qualifyingMonthlyIncome}</FREEFLOW:QualifyingMonthlyIncomeAmount>`,
  ];
  if (required.some((value) => !xml.includes(value))) throw new Error('MISMO_PROFILE_REQUIRED_VALUE_MISSING');
  const borrowerCount = (xml.match(/<FREEFLOW:BORROWER_INCOME>/g) ?? []).length;
  if (borrowerCount !== snapshot.calculation.borrowers.length) throw new Error('MISMO_PROFILE_BORROWER_COUNT_MISMATCH');
  return {
    status: 'PASS',
    implementationProfile: MISMO_APPROVED_INCOME_PROFILE,
    referenceModelIdentifier: MISMO_REFERENCE_MODEL_IDENTIFIER,
    officialXsdValidation: MISMO_OFFICIAL_XSD_VALIDATION_STATUS,
  };
}

export function approvedIncomeSummaryLines(snapshot: ApprovedIncomeSnapshot): readonly string[] {
  const lines = [
    'FREEFLOW APPROVED INCOME UNDERWRITING SUMMARY',
    `Snapshot: ${snapshot.snapshotHash}`,
    `Loan: ${snapshot.loan.id} / version ${snapshot.loan.version}`,
    `Program: ${snapshot.loan.program}`,
    `Approval: ${snapshot.approval.action} on ${snapshot.approval.approvedAt}`,
    `Calculation: ${snapshot.approval.calculationId}`,
    `Qualifying monthly income: $${snapshot.calculation.qualifyingMonthlyIncome}`,
    `Total annual cash flow: $${snapshot.calculation.totalAnnualCashFlow}`,
    `Trend: ${snapshot.calculation.trendingResult}`,
    `Years analyzed: ${snapshot.calculation.yearsAnalyzed.join(', ')}`,
  ];
  for (const borrower of snapshot.calculation.borrowers) {
    lines.push(`${borrower.role === 'PRIMARY' ? 'Primary' : 'Co-borrower'} ${borrower.borrowerKey}: $${borrower.qualifyingMonthlyIncome} monthly`);
  }
  return lines;
}

export async function renderApprovedIncomeSummaryPdf(snapshot: ApprovedIncomeSnapshot): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const approvedAt = new Date(snapshot.approval.approvedAt);
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 48, right: 48, bottom: 48, left: 48 },
    compress: false,
    info: {
      Title: 'FreeFlow Approved Income Underwriting Summary',
      Author: 'FreeFlow',
      Subject: `Approved income snapshot ${snapshot.snapshotHash}`,
      CreationDate: approvedAt,
      ModDate: approvedAt,
    },
  });
  doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(17).fillColor('#0f172a').text('FreeFlow Approved Income');
  doc.fontSize(9).fillColor('#475569').text('Human-readable underwriting summary from an immutable approved calculation snapshot.');
  doc.moveDown();
  const lines = approvedIncomeSummaryLines(snapshot);
  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;
    doc.fontSize(index === 6 ? 13 : 10).fillColor(index === 6 ? '#047857' : '#0f172a').text(line);
    if (index === 1 || index === 5 || index === 9) doc.moveDown(0.45);
  }
  doc.moveDown();
  doc.fontSize(8).fillColor('#64748b').text(`Calculation schema: ${snapshot.calculation.schemaVersion}`);
  doc.text(`Mortgage rule version: ${snapshot.calculation.mortgageRuleVersion}`);
  doc.text('Generated in memory; no source document bytes are embedded.');
  doc.end();
  return complete;
}

function mismoMortgageType(program: ApprovedIncomeSnapshot['loan']['program']): string {
  if (program === 'FHA') return 'FHA';
  if (program === 'VA') return 'VA';
  if (program === 'USDA') return 'USDARuralDevelopment';
  return 'Conventional';
}

function xmlEscape(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function assertWellFormedXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('MISMO_PROFILE_FORBIDDEN_DECLARATION');
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#[0-9]+;|#x[0-9a-f]+;)/i.test(xml)) throw new Error('MISMO_PROFILE_UNESCAPED_ENTITY');
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? [];
  const stack: string[] = [];
  for (const token of tokens) {
    if (!token.startsWith('<') || token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      if (stack.pop() !== name) throw new Error('MISMO_PROFILE_XML_NOT_WELL_FORMED');
      continue;
    }
    if (token.startsWith('<!')) continue;
    const match = token.match(/^<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*)?\s*\/?>$/);
    if (!match) throw new Error('MISMO_PROFILE_XML_NOT_WELL_FORMED');
    if (!token.endsWith('/>')) stack.push(match[1]);
  }
  if (stack.length !== 0) throw new Error('MISMO_PROFILE_XML_NOT_WELL_FORMED');
}
