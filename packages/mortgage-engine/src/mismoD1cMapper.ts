export type D1cVendorName = 'PLAID' | 'TRUEWORK' | 'ARGYLE' | 'THE_WORK_NUMBER';

export interface VerificationServicePayload {
  vendorName: D1cVendorName;
  reportIdentifier: string;
  verificationDate: string;
  monthlyIncomeAmount: number;
}

const VENDOR_MAP: Record<D1cVendorName, { identifier: string; name: string }> = {
  PLAID: {
    identifier: 'Plaid_Income',
    name: 'Plaid Technologies Inc.',
  },
  TRUEWORK: {
    identifier: 'Truework_Income',
    name: 'Truework Inc.',
  },
  ARGYLE: {
    identifier: 'Argyle_Employment',
    name: 'Argyle Outcomes Inc.',
  },
  THE_WORK_NUMBER: {
    identifier: 'The_Work_Number',
    name: 'Equifax Workforce Solutions',
  },
};

/**
 * Generates MISMO v3.4 Day 1 Certainty (D1C) Verification Block XML snippet.
 */
export function generateMismoD1cVerificationBlock(payload: VerificationServicePayload): string {
  const vendorInfo = VENDOR_MAP[payload.vendorName];
  if (!vendorInfo) {
    throw new Error(`[MISMO EXPORT ERROR] Unsupported Day 1 Certainty Vendor: ${payload.vendorName}`);
  }

  const datetime = payload.verificationDate.includes('T')
    ? payload.verificationDate
    : `${payload.verificationDate}T00:00:00Z`;

  return `
    <VERIFICATION_SERVICE>
      <ServiceType>Verification</ServiceType>
      <ServiceTypeOtherDescription>EmploymentAndIncomeVerification</ServiceTypeOtherDescription>
      <VerificationServiceProductType>EmploymentAndIncomeVerification</VerificationServiceProductType>
      <VerificationRequestDatetime>${datetime}</VerificationRequestDatetime>
      <VerificationReportIdentifier>${payload.reportIdentifier}</VerificationReportIdentifier>
      <VerificationVendorIdentifier>${vendorInfo.identifier}</VerificationVendorIdentifier>
      <VerificationVendorName>${vendorInfo.name}</VerificationVendorName>
    </VERIFICATION_SERVICE>
  `.trim();
}

/**
 * Generates MISMO v3.4 Income Verification Source Block XML snippet.
 */
export function generateMismoIncomeVerificationSourceBlock(
  monthlyAmount: number,
  isDirectApi: boolean
): string {
  const verificationType = isDirectApi ? 'AutomatedIncomeVerificationService' : 'Manual';
  const roundedAmount = Number(monthlyAmount).toFixed(2);

  return `
    <INCOME_VERIFICATION_SOURCE>
      <IncomeSourceAmount>${roundedAmount}</IncomeSourceAmount>
      <IncomeSourceVerificationType>${verificationType}</IncomeSourceVerificationType>
      <IncomeSourceFrequencyType>Monthly</IncomeSourceFrequencyType>
    </INCOME_VERIFICATION_SOURCE>
  `.trim();
}
