/**
 * FreeFlow Mortgage Solutions - W-2 Fraud Auditing, Medicaid Waiver, & Secure Access Control Rules Engine (v2)
 * 
 * This upgraded module delivers:
 * 1. Standard W-2 extraction schema configurations including Box 12 Code II (Medicaid Waiver/IHSS).
 * 2. Automated Underwriter (UW) Withholding Fraud Validation (Medicare & Social Security math verification).
 * 3. Self-Employment W-2 Red Flag alerting (Name matching, EIN overlaps, and Zero-withholding warnings).
 * 4. Medicaid Waiver (W-2 Box 12, Code II) specific rules:
 *    - Identifies fully non-taxable Medicaid Waiver/Difficulty of Care payments.
 *    - Triggers historical verification warnings if only 1 tax year/return is present.
 *    - Grosses up verified Medicaid Waiver income and paystubs by 125% (1.25 multiplier).
 * 5. Child Support Gross-Up engine (125% / 1.25 multiplier on non-taxable child support income).
 * 6. Secure Shared Link Access Control (with strict Read-Only enforcement for Sales/Loan Officers).
 */

export interface W2OcrInputV2 {
  boxA_EmployeeSSN: string;         // Employee's SSN
  boxB_EmployerEIN: string;         // Employer's EIN
  boxC_EmployerName: string;        // Employer's Name
  boxE_EmployeeName: string;        // Employee's Name
  box1_WagesTipsComp: number;       // Gross taxable compensation
  box2_FederalTaxWithheld: number;  // Federal income tax withheld
  box3_SocialSecurityWages: number; // Social security base wages
  box4_SocialSecurityTax: number;   // Social security tax withheld (Expected: 6.2%)
  box5_MedicareWages: number;       // Medicare base wages
  box6_MedicareTax: number;         // Medicare tax withheld (Expected: 1.45%)
  box12_CodeII_MedicaidWaiver?: number; // Box 12 Code II: Excludable Medicaid Waiver/IHSS payments (IRS Notice 2014-7)
  taxYear: number;
}

export interface PaystubMedicaidInput {
  grossPay: number;
  payFrequency: 'WEEKLY' | 'BI_WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
  isMedicaidWaiver: boolean;
  loanProduct: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
}

export interface ChildSupportInput {
  monthlyAmount: number;
  has3YearContinuanceProof: boolean;
}

export interface W2AuditAlertV2 {
  type: 'WITHHOLDING_FRAUD_RISK' | 'SELF_EMPLOYED_RED_FLAG' | 'DATA_INTEGRITY_WARNING' | 'COMPLIANCE_MISSING_DOCS' | 'MEDICAID_WAIVER_ALERT';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  field: string;
  message: string;
  calculatedValue?: number;
  expectedValue?: number;
  variance?: number;
}

export interface W2AuditReportV2 {
  isSSWithholdingValid: boolean;
  isMedicareWithholdingValid: boolean;
  hasSelfEmployedRedFlags: boolean;
  medicaidWaiverIncomeCalculated: number; // Grossed up
  childSupportIncomeCalculated: number;   // Grossed up
  alerts: W2AuditAlertV2[];
  suggestedAction: 'AUTO_APPROVE' | 'FLAG_FOR_MANUAL_AUDIT' | 'BLOCK_AND_REPORT';
}

/**
 * 1. AUTOMATED W-2 TAX WITHHOLDING FRAUD & COMPLIANCE CHECKER (v2)
 * 
 * Verifies if the listed tax withholdings mathematically align with Federal tax law ratios.
 * Also scans for Box 12 Code II Medicaid Waiver / Difficulty of Care non-taxable income,
 * and handles child support gross-ups.
 */
export function auditW2TaxWithholdingV2(
  input: W2OcrInputV2, 
  borrowerName: string, 
  taxYearsSubmitted: number,
  childSupport?: ChildSupportInput,
  paystubs: PaystubMedicaidInput[] = [],
  activeBusinessEins: string[] = []
): W2AuditReportV2 {
  const alerts: W2AuditAlertV2[] = [];
  const roundingTolerance = 1.50; // Allow a small variance of $1.50 for standard payroll roundings
  let medicaidWaiverIncomeCalculated = 0;
  let childSupportIncomeCalculated = 0;

  // A. Social Security Withholding Math (6.2%)
  // The Social Security Wage Cap scales annually. For 2026, it is approximately $168,600.
  const SS_WAGE_CAP = 168600; 
  const effectiveSSBase = Math.min(input.box3_SocialSecurityWages, SS_WAGE_CAP);
  const expectedSSTax = effectiveSSBase * 0.062;
  const ssVariance = Math.abs(input.box4_SocialSecurityTax - expectedSSTax);
  const isSSWithholdingValid = ssVariance <= roundingTolerance;

  if (!isSSWithholdingValid && input.box3_SocialSecurityWages > 0) {
    alerts.push({
      type: 'WITHHOLDING_FRAUD_RISK',
      severity: 'HIGH',
      field: 'box4_SocialSecurityTax',
      message: `Social Security tax withheld ($${input.box4_SocialSecurityTax.toFixed(2)}) is mathematically inconsistent with 6.2% of Box 3 wages ($${expectedSSTax.toFixed(2)}). Possible doctored document.`,
      calculatedValue: input.box4_SocialSecurityTax,
      expectedValue: expectedSSTax,
      variance: ssVariance
    });
  }

  // B. Medicare Withholding Math (1.45% base, with Additional 0.9% over $200k)
  let expectedMedicareTax = input.box5_MedicareWages * 0.0145;
  if (input.box5_MedicareWages > 200000) {
    const excessWages = input.box5_MedicareWages - 200000;
    expectedMedicareTax += (excessWages * 0.009); // Add 0.9% high-earner surtax
  }
  const medVariance = Math.abs(input.box6_MedicareTax - expectedMedicareTax);
  const isMedicareWithholdingValid = medVariance <= roundingTolerance;

  if (!isMedicareWithholdingValid && input.box5_MedicareWages > 0) {
    alerts.push({
      type: 'WITHHOLDING_FRAUD_RISK',
      severity: 'HIGH',
      field: 'box6_MedicareTax',
      message: `Medicare tax withheld ($${input.box6_MedicareTax.toFixed(2)}) is mathematically inconsistent with the statutory 1.45% base rate ($${expectedMedicareTax.toFixed(2)}). Possible fake W-2.`,
      calculatedValue: input.box6_MedicareTax,
      expectedValue: expectedMedicareTax,
      variance: medVariance
    });
  }

  // C. W-2 BOX 12 CODE II MEDICAID WAIVER / DIFFICULTY OF CARE CHECK (Notice 2014-7)
  const medicaidWaiverRaw = input.box12_CodeII_MedicaidWaiver || 0;
  if (medicaidWaiverRaw > 0) {
    alerts.push({
      type: 'MEDICAID_WAIVER_ALERT',
      severity: 'LOW',
      field: 'box12_CodeII_MedicaidWaiver',
      message: `Non-Taxable Medicaid Waiver (Notice 2014-7) / Difficulty of Care income of $${medicaidWaiverRaw.toLocaleString()} detected in Box 12 Code II. Income is eligible for a full 125% (1.25) gross-up.`
    });

    // Rule: If we see this unique income type and only have one year of tax history, raise alerts & required document warnings
    if (taxYearsSubmitted === 1) {
      alerts.push({
        type: 'COMPLIANCE_MISSING_DOCS',
        severity: 'MEDIUM',
        field: 'taxYear',
        message: 'Medicaid Waiver Income used with only 1 year of returns. Underwriting guidelines require 12-24 months verification. Warning generated: Please provide the State Medicaid Waiver agency agreement, or historical IHSS ledger payments.'
      });
    }

    // Standard W-2 Medicaid Waiver gross-up calculation (1.25 multiplier)
    const annualGrossedUp = medicaidWaiverRaw * 1.25;
    medicaidWaiverIncomeCalculated = annualGrossedUp / 12; // Monthly equivalent
  }

  // D. PAYSTUB MEDICAID WAIVER CALCULATION
  if (paystubs.length > 0) {
    let paystubTotalMonthlyRaw = 0;
    let medicaidPaystubCount = 0;

    for (const stub of paystubs) {
      if (stub.isMedicaidWaiver) {
        medicaidPaystubCount++;
        let annualMultiplier = 12;
        if (stub.payFrequency === 'WEEKLY') annualMultiplier = 52;
        else if (stub.payFrequency === 'BI_WEEKLY') annualMultiplier = 26;
        else if (stub.payFrequency === 'SEMI_MONTHLY') annualMultiplier = 24;

        const calculatedAnnual = stub.grossPay * annualMultiplier;
        paystubTotalMonthlyRaw += (calculatedAnnual / 12);
      }
    }

    if (medicaidPaystubCount > 0) {
      // Calculate average according to loan product and apply the full 1.25 gross-up since it is fully tax-free
      const monthlyAverageRaw = paystubTotalMonthlyRaw / medicaidPaystubCount;
      const monthlyGrossedUp = monthlyAverageRaw * 1.25;
      
      // Override or add to W-2 calculation
      medicaidWaiverIncomeCalculated = monthlyGrossedUp;

      alerts.push({
        type: 'MEDICAID_WAIVER_ALERT',
        severity: 'LOW',
        field: 'paystubs',
        message: `Parsed ${medicaidPaystubCount} Medicaid Waiver paystubs. Average raw monthly equivalent of $${monthlyAverageRaw.toFixed(2)} grossed up 125% to $${monthlyGrossedUp.toFixed(2)}/mo for loan qualification.`
      });
    }
  }

  // E. CHILD SUPPORT GROSS-UP ENGINE
  if (childSupport && childSupport.monthlyAmount > 0) {
    if (childSupport.has3YearContinuanceProof) {
      childSupportIncomeCalculated = childSupport.monthlyAmount * 1.25;
      alerts.push({
        type: 'MEDICAID_WAIVER_ALERT', // Grouped under non-taxable alerts
        severity: 'LOW',
        field: 'childSupport',
        message: `Child support income of $${childSupport.monthlyAmount.toFixed(2)}/mo validated for 3-year continuation. Fully grossed up (1.25 multiplier) to $${childSupportIncomeCalculated.toFixed(2)}/mo.`
      });
    } else {
      childSupportIncomeCalculated = childSupport.monthlyAmount; // No gross up if no continuance proof
      alerts.push({
        type: 'DATA_INTEGRITY_WARNING',
        severity: 'MEDIUM',
        field: 'childSupport',
        message: `Child support income detected ($${childSupport.monthlyAmount.toFixed(2)}/mo) but lacks 3-year continuation proof. Counted as raw, non-grossed up income.`
      });
    }
  }

  // F. SELF-EMPLOYMENT RED FLAG DETECTION
  let hasSelfEmployedRedFlags = false;

  // Rule 1: Company Name Matches Borrower's Last Name (Potential undisclosed self-employment)
  const borrowerNameUpper = borrowerName.toUpperCase();
  const employerNameUpper = input.boxC_EmployerName.toUpperCase();
  const nameTokens = borrowerNameUpper.split(' ').filter(token => token.length > 2); // get first/last names
  
  for (const token of nameTokens) {
    if (employerNameUpper.includes(token) && !employerNameUpper.includes('INCORPORATED') && !employerNameUpper.includes('INC.')) {
      alerts.push({
        type: 'SELF_EMPLOYED_RED_FLAG',
        severity: 'MEDIUM',
        field: 'boxC_EmployerName',
        message: `Employer name "${input.boxC_EmployerName}" contains borrower last name "${token}". Verify if borrower owns this entity; if so, full corporate Form 1084 tax evaluation is required.`
      });
      hasSelfEmployedRedFlags = true;
      break;
    }
  }

  // Rule 2: EIN overlap with corporate files
  const normalizedW2Ein = input.boxB_EmployerEIN.replace(/[^0-9]/g, '');
  for (const bizEin of activeBusinessEins) {
    const normalizedBizEin = bizEin.replace(/[^0-9]/g, '');
    if (normalizedW2Ein === normalizedBizEin && normalizedW2Ein.length > 0) {
      alerts.push({
        type: 'SELF_EMPLOYED_RED_FLAG',
        severity: 'HIGH',
        field: 'boxB_EmployerEIN',
        message: `W-2 Employer EIN (${input.boxB_EmployerEIN}) matches a corporate business entity listed in the borrower's file. The borrower must be qualified as Self-Employed under Fannie Mae guidelines.`
      });
      hasSelfEmployedRedFlags = true;
    }
  }

  // Rule 3: Zero Federal withholding on substantial wages
  if (input.box1_WagesTipsComp > 40000 && input.box2_FederalTaxWithheld === 0) {
    alerts.push({
      type: 'SELF_EMPLOYED_RED_FLAG',
      severity: 'MEDIUM',
      field: 'box2_FederalTaxWithheld',
      message: `Borrower claims $${input.box1_WagesTipsComp.toLocaleString()} in W-2 wages but has exactly $0.00 in Federal Income Tax Withheld (Box 2). Highly uncharacteristic for standard wage earners.`
    });
    hasSelfEmployedRedFlags = true;
  }

  // Rule 4: Perfectly round numbers on wage blocks
  const checkPerfectRound = (val: number) => val > 0 && val % 1000 === 0 && val % 1 === 0;
  if (checkPerfectRound(input.box1_WagesTipsComp) && checkPerfectRound(input.box3_SocialSecurityWages)) {
    alerts.push({
      type: 'DATA_INTEGRITY_WARNING',
      severity: 'LOW',
      field: 'box1_WagesTipsComp',
      message: `Box 1 and Box 3 wages are perfectly flat round numbers ($${input.box1_WagesTipsComp.toLocaleString()}). Standard payroll calculations typically generate fractional cent values.`
    });
  }

  // G. Suggest Final Underwriting Action
  let suggestedAction: 'AUTO_APPROVE' | 'FLAG_FOR_MANUAL_AUDIT' | 'BLOCK_AND_REPORT' = 'AUTO_APPROVE';
  const highSeverityAlerts = alerts.filter(a => a.severity === 'HIGH');
  
  if (highSeverityAlerts.some(a => a.type === 'WITHHOLDING_FRAUD_RISK')) {
    suggestedAction = 'BLOCK_AND_REPORT';
  } else if (alerts.length > 0) {
    suggestedAction = 'FLAG_FOR_MANUAL_AUDIT';
  }

  return {
    isSSWithholdingValid,
    isMedicareWithholdingValid,
    hasSelfEmployedRedFlags,
    medicaidWaiverIncomeCalculated,
    childSupportIncomeCalculated,
    alerts,
    suggestedAction
  };
}

/**
 * 2. SECURE SHARED ACCESS & READ-ONLY ROLE ENFORCEMENT
 * 
 * Enforces Role-Based Access Control (RBAC) on shared loan payloads.
 * Loan Officers (Sales) or external parties accessing via a secure link
 * must be restricted strictly to "Read-Only" views to prevent compliance tampering.
 */
export interface SharedLinkMetadataV2 {
  shareId: string;
  loanId: string;
  isReadOnly: boolean;
  allowedRoles: string[]; // e.g. ['LOAN_OFFICER', 'BORROWER']
  expiresAt: Date | null;
}

export interface SecurityContextV2 {
  userId: string;
  userRole: 'SUPER_ADMIN' | 'BROKER_OWNER' | 'LOAN_OFFICER' | 'PROCESSOR' | 'UNDERWRITER' | 'BORROWER';
  isUsingSharedLink: boolean;
  sharedLinkMeta?: SharedLinkMetadataV2;
}

export interface AuthorizationResultV2 {
  canAccess: boolean;
  canMutate: boolean; // True if they can edit fields, upload files, or trigger Encompass updates
  enforcementNotes: string;
}

/**
 * Evaluates the incoming security context and enforces access boundaries.
 * Sales/Loan Officer roles or generic shared links are strictly blocked from writing data.
 */
export function authorizeSessionAccessV2(context: SecurityContextV2): AuthorizationResultV2 {
  // If no user details are resolved
  if (!context.userId || !context.userRole) {
    return { canAccess: false, canMutate: false, enforcementNotes: 'Anonymous sessions are strictly blocked per GLBA safeguards.' };
  }

  // 1. Evaluate Shared Link Access Gate
  if (context.isUsingSharedLink && context.sharedLinkMeta) {
    const now = new Date();
    const isExpired = context.sharedLinkMeta.expiresAt && now > context.sharedLinkMeta.expiresAt;
    if (isExpired) {
      return { canAccess: false, canMutate: false, enforcementNotes: 'Secure sharing token has expired.' };
    }

    // Check if user's role is permitted inside the share's configuration
    const isRolePermitted = context.sharedLinkMeta.allowedRoles.includes(context.userRole);
    if (!isRolePermitted) {
      return { canAccess: false, canMutate: false, enforcementNotes: `Access denied. Shared link is restricted to roles: [${context.sharedLinkMeta.allowedRoles.join(', ')}].` };
    }

    // Force Read-Only constraint if share specifies it, OR if recipient belongs to Sales/LO
    const forceReadOnly = context.sharedLinkMeta.isReadOnly || context.userRole === 'LOAN_OFFICER';
    return {
      canAccess: true,
      canMutate: !forceReadOnly,
      enforcementNotes: forceReadOnly 
        ? 'Shared Link Authenticated. Access limited to READ-ONLY. Mutating requests (POST, PUT, DELETE) blocked.' 
        : 'Shared Link Authenticated. Mutation permissions granted.'
    };
  }

  // 2. Evaluate Normal System Session RBAC
  // Underwriters and Administrators possess full write/export capability
  if (context.userRole === 'SUPER_ADMIN' || context.userRole === 'BROKER_OWNER' || context.userRole === 'UNDERWRITER' || context.userRole === 'PROCESSOR') {
    return {
      canAccess: true,
      canMutate: true,
      enforcementNotes: `Administrative context validated (${context.userRole}). Complete modification and Encompass sync permissions authorized.`
    };
  }

  // 3. Loan Officers (Sales) possess READ-ONLY access to finalized underwriter audits to prevent TRID tampering
  if (context.userRole === 'LOAN_OFFICER') {
    return {
      canAccess: true,
      canMutate: false, // Sales cannot touch underwriter values
      enforcementNotes: 'Loan Officer (Sales) session verified. Full dashboard display granted; field modifications and write-back execution restricted.'
    };
  }

  // Default block
  return {
    canAccess: false,
    canMutate: false,
    enforcementNotes: 'Insufficient permissions for this context.'
  };
}
