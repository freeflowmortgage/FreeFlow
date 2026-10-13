import { Decimal } from 'decimal.js'; // Standard financial rounding precision

export type LoanProgram = 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';

export interface WarningMessage {
  code: string;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
}

export interface GeneratedCondition {
  title: string;
  category: 'INCOME' | 'ASSETS' | 'CREDIT' | 'GENERAL';
  description: string;
  requiredDocType?: string;
}

// ────────────────────────────────────────────────────────────────────────
// 1. COMPLEX VARIABLE, MILITARY, AND TAX-EXEMPT INCOME INPUT INTERFACES
// ────────────────────────────────────────────────────────────────────────

export type GseInvestor = 'FNMA' | 'FREDDIE';

/** CURRENT/PRIMARY and CONCURRENT/SECONDARY are aliases. PRIOR is historical only. */
export type W2EmploymentRole = 'CURRENT' | 'CONCURRENT' | 'PRIOR' | 'PRIMARY' | 'SECONDARY';

/** Schedule L current-asset / current-liability inputs for the ≥25% liquidity test. */
export interface ScheduleLLiquidityInput {
  cash?: number;
  securities?: number;
  accountsReceivable?: number;
  allowanceForBadDebts?: number;
  taxExemptSecurities?: number;
  otherCurrentAssets?: number;
  accountsPayable?: number;
  notesPayableLt1Yr?: number;
  otherCurrentLiabilities?: number;
  /** If set, used as the denominator instead of summing payable lines. */
  currentLiabilities?: number;
}

export interface W2EmployerEntry {
  /** Stable source-system identifier. Do not derive this from the employer name. */
  entityId: string;
  employerName: string;
  ein?: string;
  role: W2EmploymentRole;
  year: number;
  monthsWorked?: number;
  /** Actual or projected annual total. Takes precedence over the component fields. */
  annualIncome?: number;
  /** Alias for annualIncome when the source is explicitly a W-2. */
  annualWages?: number;
  /** Annualized base and variable components when no annual total is supplied. */
  annualBaseIncome?: number;
  annualVariableIncome?: number;
  /**
   * Paystub component annuals. Qualifying income uses annualBaseIncome +
   * annualVariableIncome and does not read these fields.
   */
  annualOvertimeIncome?: number;
  annualBonusIncome?: number;
  annualCommissionIncome?: number;
  annualTipsIncome?: number;
  annualRsuIncome?: number;
  annualOtherIncome?: number;
  /** Backward-friendly aliases; these values are also treated as annual amounts. */
  baseIncome?: number;
  variableIncome?: number;
}

export interface ScheduleCEntry {
  entityId?: string;
  businessName?: string;
  ein?: string;
  year: number;
  monthsInBusiness?: number;
  netProfitLoss: number;
  depreciation?: number;
  depletion?: number;
  businessUseOfHome?: number;
  mealsExclusion?: number;
  nonrecurringOtherIncomeLoss?: number;
  amortizationCasualtyLoss?: number;
}

export interface Form1120SEntry {
  entityId?: string;
  businessName?: string;
  ein?: string;
  year: number;
  monthsInBusiness?: number;
  /** END-of-year stock ownership percentage from the K-1 (never the beginning figure) */
  ownershipPercentage: number;
  w2WagesFromBusiness?: number;
  k1OrdinaryIncome?: number;
  k1NetRentalRealEstate?: number;
  k1OtherNetRentalIncome?: number;
  /** Form 1120-S line 4, removed from qualifying income (× ownership). */
  gain4797?: number;
  /** Form 1120-S line 5, removed from qualifying income (× ownership). */
  otherIncome?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  k1Distributions?: number;
  hasStableDistributions?: boolean;
  /** When present and ownership ≥ 25%, quick ratio < 1.0 zeroes K-1 (W-2 still counts). */
  scheduleL?: ScheduleLLiquidityInput;
}

export interface Form1065Entry {
  entityId?: string;
  businessName?: string;
  ein?: string;
  year: number;
  monthsInBusiness?: number;
  /**
   * END-of-year percentage from K-1 Item J (never the beginning figure).
   * Freddie Mac qualifies on the ending PROFIT %; FNMA on the ending CAPITAL %.
   */
  ownershipPercentage: number;
  /** K-1 Item J ending profit % — Freddie Mac qualifying figure when both percents are present. */
  profitPercentageEnd?: number;
  /** K-1 Item J ending capital % — FNMA qualifying figure when both percents are present. */
  capitalPercentageEnd?: number;
  k1OrdinaryIncome?: number;
  k1NetRentalRealEstate?: number;
  k1OtherNetRentalIncome?: number;
  k1GuaranteedPayments?: number;
  /** Form 1065 line 6, removed from qualifying income (× ownership). */
  gain4797?: number;
  /** Form 1065 line 7, removed from qualifying income (× ownership). */
  otherIncome?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  k1Distributions?: number;
  hasStableDistributions?: boolean;
  /** When present and ownership ≥ 25%, quick ratio < 1.0 zeroes K-1 (guaranteed payments still count). */
  scheduleL?: ScheduleLLiquidityInput;
}

export interface Form1120Entry {
  entityId?: string;
  businessName?: string;
  ein?: string;
  year: number;
  monthsInBusiness?: number;
  ownershipPercentage: number;
  w2WagesFromCorporate?: number;
  taxableIncome: number;
  totalTaxPaid?: number;
  depreciation?: number;
  depletion?: number;
  amortization?: number;
  mealsExclusion?: number;
  nolAndSpecialDeductions?: number;
  cash?: number;
  securities?: number;
  accountsReceivable?: number;
  currentLiabilities?: number;
  borrowerDividendsReceived?: number; // C-Corp dividends distributed directly to the borrower (from Form 1099-DIV / Schedule B)
}

export interface ScheduleFEntry {
  entityId: string;
  businessName: string;
  ein?: string;
  year: number;
  monthsInBusiness?: number;
  netFarmProfitLoss: number;
  /** Form 1084 line 6b: only the verified recurring non-taxable portion. */
  nonTaxPortionOngoingCoopAndCccPayments?: number;
  /**
   * Form 1084 line 6c signed adjustment: use a negative value to remove
   * nonrecurring other income and a positive value to add back a nonrecurring loss.
   */
  nonrecurringOtherIncomeLoss?: number;
  depreciation?: number;
  amortizationCasualtyLossDepletion?: number;
  businessUseOfHome?: number;
}

export interface Form1040BenefitInput {
  year: number;
  totalSocialSecurity?: number;
  taxableSocialSecurity?: number;
  isSupplementalSecurityIncome?: boolean; // SSI
  totalPensionsAndAnnuities?: number;
  taxablePensionsAndAnnuities?: number;
  isNonGovernmentPension?: boolean; // FHA strictly requires continuance on private
  vaDisabilityMonthly?: number;
}

export interface ScheduleBAndDInput {
  year: number;
  interestIncome?: number;       // Schedule B, Part I
  dividendIncome?: number;       // Schedule B, Part II
  capitalGainsNetLoss?: number;  // Schedule D
  /** Asset-derived income is excluded unless an underwriter explicitly elects it. */
  includeInQualifyingIncome?: boolean;
  hasThreeYearAssetSupport?: boolean; // Underwriter verified continuance based on asset balance
}

export interface ScheduleEPartIIIInput {
  year: number;
  trustIncome?: number;          // Schedule E, Part III
  hasThreeYearTrustContinuance?: boolean;
}

// Schedule E Page 1 - Rental vs Royalty Properties
export interface ScheduleEPage1PropertyInput {
  year: number;
  propertyAddress: string;
  propertyType: 'RENTAL' | 'ROYALTY'; // Distinguish between rental real estate and royalties
  rentsReceived?: number;             // Line 3 (Rents Received)
  royaltiesReceived?: number;         // Line 4 (Royalties Received)
  insurance?: number;                 // Line 9 — 1038 add-back
  mortgageInterest?: number;          // Line 12 — 1038 add-back
  taxes?: number;                     // Line 16 — 1038 add-back
  depreciation?: number;              // Line 18 (Depreciation Expense - Rental)
  depletion?: number;                 // Line 18 (Depletion Expense - Royalty)
  hoaDues?: number;                   // Line 19 — 1038 add-back when included in PITIA
  totalExpenses?: number;             // Line 20 (Total Expenses) — do not rebuild; add back from it
  netIncomeLoss?: number;             // Line 21 (Net Income/Loss)
  /** UW extraordinary / other allowed add-back (not an IRS line). */
  extraordinaryAddBack?: number;
  hasThreeYearRoyaltyContinuance?: boolean; // Underwriter verified continuance of royalties
  isMultiFamilySubjectToFhaDecline?: boolean; // Trigger FHA declining 2–4 unit property checks
  fairRentalDays?: number;            // Line 2 (Fair Rental Days)
  fairRentalDaysOverride?: number;    // Underwriter Days Rented Override
}

export interface MilitaryLESInput {
  militaryBasicPay: number;      // Taxable Basic Pay
  militaryBAH: number;           // Basic Allowance for Housing (Tax-Free)
  militaryBAS: number;           // Basic Allowance for Subsistence (Tax-Free)
  militarySpecialPay?: number;   // Flight, Hazard, Sea, Combat pay
  hasSpecialPayHistory?: boolean; // Minimum 12-24 month history verification
}

export interface SubjectPropertyRentalInput {
  grossMarketRent: number;                 // Form 1007 / Form 1025 / Lease
  subjectPITIA: number;                    // Full PITIA of the subject property
  isPrimaryMultiFamily2To4Unit?: boolean;  // Flags if borrower occupies one unit
}

export interface UnifiedIncomeCalculationPayload {
  loanProgram: LoanProgram;
  /** Selects K-1 Item J ending profit % (Freddie) vs ending capital % (FNMA) for Form 1065. */
  gseInvestor?: GseInvestor;
  w2Employers?: W2EmployerEntry[];
  scheduleC?: ScheduleCEntry[];
  scheduleF?: ScheduleFEntry[];
  form1120S?: Form1120SEntry[];
  form1065?: Form1065Entry[];
  form1120?: Form1120Entry[];
  benefits?: Form1040BenefitInput[];
  assets?: ScheduleBAndDInput[];
  trusts?: ScheduleEPartIIIInput[];
  scheduleEProperties?: ScheduleEPage1PropertyInput[]; // Added Schedule E Page 1
  militaryLES?: MilitaryLESInput;
  subjectPropertyRental?: SubjectPropertyRentalInput; // Added Subject Property Rent in v9
}

// ────────────────────────────────────────────────────────────────────────
// 2. HELPER FUNCTIONS: RECURRING MATH AND DAYS RENTED CONVERSIONS
// ────────────────────────────────────────────────────────────────────────

function getMonthsInService(entry: ScheduleEPage1PropertyInput): number {
  if (entry.fairRentalDaysOverride !== undefined && entry.fairRentalDaysOverride !== null) {
    return Math.max(1, Math.min(12, Math.ceil(entry.fairRentalDaysOverride / 30)));
  }
  if (entry.fairRentalDays !== undefined && entry.fairRentalDays !== null && entry.fairRentalDays > 0) {
    return Math.max(1, Math.min(12, Math.ceil(entry.fairRentalDays / 30)));
  }
  return 12; // Default to standard 12 months if no days rented is specified
}

function isActiveW2Role(role: W2EmploymentRole): boolean {
  return role !== 'PRIOR';
}

export interface Form1065OwnershipBasis {
  percentage: number;
  /** Which K-1 Item J figure the percentage came from. */
  basis: 'ENDING_PROFIT' | 'ENDING_CAPITAL' | 'STATED';
  /** Set when profit and capital disagree, so the choice can be shown. */
  note?: string;
}

/**
 * Resolve the K-1 Item J percentage used to share partnership income.
 *
 * FNMA qualifies on the ending CAPITAL percentage and Freddie Mac on the
 * ending PROFIT percentage. When a partnership agreement splits those
 * differently the two figures disagree, and taking the agency's own figure at
 * face value can share more income to the borrower than the other agency would
 * allow. The lower of the two is used whenever they differ, and the reason is
 * reported so the file shows which figure was applied and why.
 */
export function resolve1065Ownership(entry: Form1065Entry, gse: GseInvestor): Form1065OwnershipBasis {
  const profit = entry.profitPercentageEnd;
  const capital = entry.capitalPercentageEnd;
  const agencyBasis = gse === 'FREDDIE' ? 'ENDING_PROFIT' : 'ENDING_CAPITAL';

  if (profit != null && capital != null) {
    if (profit === capital) {
      return { percentage: profit, basis: agencyBasis };
    }
    const lower = Math.min(profit, capital);
    const lowerBasis = lower === capital ? 'ENDING_CAPITAL' : 'ENDING_PROFIT';
    const agencyFigure = gse === 'FREDDIE' ? profit : capital;
    return {
      percentage: lower,
      basis: lowerBasis,
      note:
        `K-1 Item J ending profit ${profit}% and ending capital ${capital}% disagree. ` +
        `${gse === 'FREDDIE' ? 'Freddie Mac' : 'FNMA'} qualifies on ` +
        `${gse === 'FREDDIE' ? 'ending profit' : 'ending capital'} (${agencyFigure}%); ` +
        `the lower ${lowerBasis === 'ENDING_CAPITAL' ? 'ending capital' : 'ending profit'} ` +
        `${lower}% was applied. Confirm the partnership agreement before using the higher figure.`,
    };
  }

  if (gse === 'FREDDIE' && profit != null) return { percentage: profit, basis: 'ENDING_PROFIT' };
  if (gse === 'FNMA' && capital != null) return { percentage: capital, basis: 'ENDING_CAPITAL' };
  if (profit != null) return { percentage: profit, basis: 'ENDING_PROFIT' };
  if (capital != null) return { percentage: capital, basis: 'ENDING_CAPITAL' };
  return { percentage: entry.ownershipPercentage, basis: 'STATED' };
}

export function scheduleLQuickRatioFromInput(sheet?: ScheduleLLiquidityInput): {
  ratio: Decimal;
  assets: Decimal;
  liabilities: Decimal;
} | null {
  if (!sheet) return null;
  const hasAny =
    sheet.cash != null ||
    sheet.securities != null ||
    sheet.accountsReceivable != null ||
    sheet.allowanceForBadDebts != null ||
    sheet.taxExemptSecurities != null ||
    sheet.otherCurrentAssets != null ||
    sheet.accountsPayable != null ||
    sheet.notesPayableLt1Yr != null ||
    sheet.otherCurrentLiabilities != null ||
    sheet.currentLiabilities != null;
  if (!hasAny) return null;

  const assets = new Decimal(sheet.cash || 0)
    .add(sheet.securities || 0)
    .add(new Decimal(sheet.accountsReceivable || 0).sub(sheet.allowanceForBadDebts || 0))
    .add(sheet.taxExemptSecurities || 0)
    .add(sheet.otherCurrentAssets || 0);
  const liabilities =
    sheet.currentLiabilities != null
      ? new Decimal(sheet.currentLiabilities)
      : new Decimal(sheet.accountsPayable || 0)
          .add(sheet.notesPayableLt1Yr || 0)
          .add(sheet.otherCurrentLiabilities || 0);
  if (liabilities.eq(0)) {
    return { ratio: assets.gt(0) ? new Decimal(999) : new Decimal(0), assets, liabilities };
  }
  return { ratio: assets.div(liabilities), assets, liabilities };
}

export interface DistributionSupport {
  /** The business income the evidence actually supports. */
  eligibleIncome: Decimal;
  /** Distributions reported on the K-1, or null when the box was not read. */
  reported: Decimal | null;
  /** Set when a recorded distribution history is contradicted by the K-1. */
  shortfall: { required: Decimal; restsOnLiquidity: boolean } | null;
}

/**
 * How much business income the distribution evidence supports.
 *
 * Distributions are evidence only up to what was distributed, so a recorded
 * history that outruns the K-1 does not justify the excess. Fannie Mae's other
 * route is business liquidity, which is why a passing Schedule L still carries
 * the income; with no balance sheet to test, nothing is left holding up the
 * shortfall and the income falls back to what was actually distributed.
 *
 * `liquidityPasses` is null when the return carried no Schedule L. An absent
 * distributions box is likewise null rather than zero: a figure that was never
 * read contradicts nothing, and capping on it would zero a supported business.
 */
export function distributionSupport(
  businessIncome: Decimal,
  reportedDistributions: number | undefined,
  recordedStableHistory: boolean | undefined,
  liquidityPasses: boolean | null,
): DistributionSupport {
  const reported = reportedDistributions === undefined ? null : new Decimal(reportedDistributions);
  if (!recordedStableHistory) {
    return { eligibleIncome: Decimal.min(businessIncome, reported ?? new Decimal(0)), reported, shortfall: null };
  }
  if (reported === null || reported.gte(businessIncome)) {
    return { eligibleIncome: businessIncome, reported, shortfall: null };
  }
  const restsOnLiquidity = liquidityPasses === true;
  return {
    eligibleIncome: restsOnLiquidity ? businessIncome : reported,
    reported,
    shortfall: { required: businessIncome, restsOnLiquidity },
  };
}

interface ComputedPropertyCashFlow {
  totalAnnualCashFlow: Decimal;
  monthsInService: number;
  monthlyAverage: Decimal;
  addBacks: Decimal;
}

/**
 * FNMA Form 1038 / 1038A rental cash flow.
 * Prefer Line 21 net, then add back Lines 9, 12, 16, 18, 19 plus any UW extraordinary box.
 * Do not rebuild total expenses from those lines — Line 20 is used only when Line 21 is absent
 * (L3 − L20 + the same add-backs).
 */
export function computeRental1038CashFlow(entry: ScheduleEPage1PropertyInput): ComputedPropertyCashFlow {
  const insurance = new Decimal(entry.insurance || 0);
  const mortgageInterest = new Decimal(entry.mortgageInterest || 0);
  const taxes = new Decimal(entry.taxes || 0);
  const depr = new Decimal(entry.depreciation || 0);
  const hoa = new Decimal(entry.hoaDues || 0);
  const extraordinary = new Decimal(entry.extraordinaryAddBack || 0);
  const addBacks = insurance.add(mortgageInterest).add(taxes).add(depr).add(hoa).add(extraordinary);

  let totalAnnual: Decimal;
  if (entry.netIncomeLoss !== undefined && entry.netIncomeLoss !== null) {
    totalAnnual = new Decimal(entry.netIncomeLoss).add(addBacks);
  } else {
    totalAnnual = new Decimal(entry.rentsReceived || 0).sub(entry.totalExpenses || 0).add(addBacks);
  }
  const months = getMonthsInService(entry);
  return {
    totalAnnualCashFlow: totalAnnual,
    monthsInService: months,
    monthlyAverage: totalAnnual.div(months),
    addBacks,
  };
}

function getMonthlyPropertyCashFlow(entry: ScheduleEPage1PropertyInput): ComputedPropertyCashFlow {
  return computeRental1038CashFlow(entry);
}

// ────────────────────────────────────────────────────────────────────────
// 3. MAIN UNIFIED INCOME CALCULATION ENGINE (v9 Production Core)
// ────────────────────────────────────────────────────────────────────────

export function calculateUnifiedIncome(payload: UnifiedIncomeCalculationPayload) {
  const program = payload.loanProgram;
  const warnings: WarningMessage[] = [];
  const conditions: GeneratedCondition[] = [];
  
  // Determine Program-Specific Gross-Up Multiplier [FHA = 1.15, Conventional/VA/USDA = 1.25]
  const grossUpMultiplier = program === 'FHA' ? new Decimal(1.15) : new Decimal(1.25);
  const grossUpPercentText = program === 'FHA' ? '15%' : '25%';

  let totalQualifyingMonthlyIncome = new Decimal(0);
  const annualCalculatedTotals: Record<number, Decimal> = {};

  // Helper to add calculated cash flow directly to annual totals
  const addFlowToYear = (year: number, amount: Decimal) => {
    if (!annualCalculatedTotals[year]) {
      annualCalculatedTotals[year] = new Decimal(0);
    }
    annualCalculatedTotals[year] = annualCalculatedTotals[year].add(amount);
  };

  // ──────────────────────────────────────────────────────────────────────
  // W-2 EMPLOYERS - EXPLICIT ROLE PREVENTS CONCURRENT JOBS FROM BEING
  // MISCLASSIFIED AS EMPLOYMENT TRANSITIONS
  // ──────────────────────────────────────────────────────────────────────
  const w2EmployerBreakdown = (payload.w2Employers || []).map((entry) => {
    const base = new Decimal(entry.annualBaseIncome ?? entry.baseIncome ?? 0);
    const variable = new Decimal(entry.annualVariableIncome ?? entry.variableIncome ?? 0);
    const annualQualifying = new Decimal(
      entry.annualIncome ?? entry.annualWages ?? base.add(variable).toNumber()
    );

    // CURRENT and CONCURRENT are both active qualifying employments. PRIOR is
    // retained as its own historical entity and contributes only to its stated
    // tax year; no role is inferred from array order or employer count.
    addFlowToYear(entry.year, annualQualifying);

    return {
      entityId: entry.entityId,
      employerName: entry.employerName,
      ein: entry.ein ?? null,
      role: entry.role,
      isActiveEmployment: isActiveW2Role(entry.role),
      year: entry.year,
      monthsWorked: entry.monthsWorked ?? null,
      annualBaseIncome: base.toNumber(),
      annualVariableIncome: variable.toNumber(),
      annualQualifyingIncome: annualQualifying.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // A. SCHEDULE C - INDIVIDUAL PROFIT OR LOSS SOLE PROPRIETOR
  // ──────────────────────────────────────────────────────────────────────
  const scheduleCBreakdown = (payload.scheduleC || []).map((entry) => {
    const netProfit = new Decimal(entry.netProfitLoss);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const homeUse = new Decimal(entry.businessUseOfHome || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nonrecurring = new Decimal(entry.nonrecurringOtherIncomeLoss || 0);
    const amortCasualty = new Decimal(entry.amortizationCasualtyLoss || 0);

    // Form 1084 Adjustments: Net Profit + Depreciation + Depletion + Home Use - Meals + Nonrecurring + Amortization
    const totalAdjusted = netProfit
      .add(depr)
      .add(depl)
      .add(homeUse)
      .sub(meals)
      .add(nonrecurring)
      .add(amortCasualty);

    addFlowToYear(entry.year, totalAdjusted);

    return {
      entityId: entry.entityId ?? null,
      businessName: entry.businessName ?? null,
      ein: entry.ein ?? null,
      year: entry.year,
      netProfitLoss: netProfit.toNumber(),
      depreciation: depr.toNumber(),
      businessUseOfHome: homeUse.toNumber(),
      mealsExclusion: meals.toNumber(),
      totalAdjustedIncome: totalAdjusted.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // A2. SCHEDULE F - PROFIT OR LOSS FROM FARMING (FORM 1084 SECTION 6)
  // ──────────────────────────────────────────────────────────────────────
  const scheduleFBreakdown = (payload.scheduleF || []).map((entry) => {
    const netFarmProfitLoss = new Decimal(entry.netFarmProfitLoss);
    const ongoingCoopAndCcc = new Decimal(entry.nonTaxPortionOngoingCoopAndCccPayments || 0);
    const nonrecurringOther = new Decimal(entry.nonrecurringOtherIncomeLoss || 0);
    const depreciation = new Decimal(entry.depreciation || 0);
    const amortizationCasualtyLossDepletion = new Decimal(entry.amortizationCasualtyLossDepletion || 0);
    const businessUseOfHome = new Decimal(entry.businessUseOfHome || 0);

    const totalAdjusted = netFarmProfitLoss
      .add(ongoingCoopAndCcc)
      .add(nonrecurringOther)
      .add(depreciation)
      .add(amortizationCasualtyLossDepletion)
      .add(businessUseOfHome);

    addFlowToYear(entry.year, totalAdjusted);

    return {
      entityId: entry.entityId,
      businessName: entry.businessName,
      ein: entry.ein ?? null,
      year: entry.year,
      monthsInBusiness: entry.monthsInBusiness ?? null,
      netFarmProfitLoss: netFarmProfitLoss.toNumber(),
      nonTaxPortionOngoingCoopAndCccPayments: ongoingCoopAndCcc.toNumber(),
      nonrecurringOtherIncomeLoss: nonrecurringOther.toNumber(),
      depreciation: depreciation.toNumber(),
      amortizationCasualtyLossDepletion: amortizationCasualtyLossDepletion.toNumber(),
      businessUseOfHome: businessUseOfHome.toNumber(),
      totalAdjustedIncome: totalAdjusted.toNumber()
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // B. FORM 1120S - SHAREHOLDER SHARE OF INCOME FROM S-CORPORATION
  // ──────────────────────────────────────────────────────────────────────
  const form1120SBreakdown = (payload.form1120S || []).map((entry) => {
    const w2 = new Decimal(entry.w2WagesFromBusiness || 0);
    const ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const rentalRealEstate = new Decimal(entry.k1NetRentalRealEstate || 0);
    const otherRental = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const gain4797 = new Decimal(entry.gain4797 || 0);
    const otherIncome = new Decimal(entry.otherIncome || 0);
    const distributions = new Decimal(entry.k1Distributions || 0);
    const liquidity = scheduleLQuickRatioFromInput(entry.scheduleL);
    const passesLiquidity = liquidity ? liquidity.ratio.gte(1.0) : true;
    // K-1 boxes are already the shareholder's share and count at 100%.
    const k1Income = ordinary.add(rentalRealEstate).add(otherRental);

    let k1EligibleIncome = new Decimal(0);
    let distributionShortfall = false;

    // FNMA S-Corp Liquidity Exception & Stable Distribution Triggers
    if (entry.ownershipPercentage >= 25) {
      if (liquidity && !passesLiquidity) {
        k1EligibleIncome = new Decimal(0);
        warnings.push({
          code: 'SCORP_LIQUIDITY_FAILED',
          severity: 'WARNING',
          message: `S-Corporation Year ${entry.year}: Schedule L quick ratio is ${liquidity.ratio.toFixed(2)} (< 1.0). Business income locked out ($0.00). Officer W-2 wages still qualify.`
        });
      } else {
      // Only the entity-level return lines are the shareholder's by ownership.
      const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
      const returnAdjustments = depr
        .add(depl)
        .add(amort)
        .sub(meals)
        .sub(gain4797)
        .sub(otherIncome);

      const borrowerShareOfAdjustments = k1Income.add(returnAdjustments.mul(shareFactor));

      const support = distributionSupport(
        borrowerShareOfAdjustments,
        entry.k1Distributions,
        entry.hasStableDistributions,
        liquidity ? passesLiquidity : null,
      );
      k1EligibleIncome = support.eligibleIncome;
      distributionShortfall = support.shortfall !== null;

      if (support.shortfall) {
        warnings.push({
          code: 'SCORP_DISTRIBUTIONS_BELOW_INCOME',
          severity: 'WARNING',
          message: support.shortfall.restsOnLiquidity
            ? `S-Corporation Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 16D reports distributions of $${distributions.toFixed(2)} against $${borrowerShareOfAdjustments.toFixed(2)} of business income. The $${borrowerShareOfAdjustments.sub(distributions).toFixed(2)} shortfall is not supported by distributions and rests on the Schedule L quick ratio of ${liquidity!.ratio.toFixed(2)} instead. Evidence the distribution history or qualify the business on liquidity.`
            : `S-Corporation Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 16D reports distributions of $${distributions.toFixed(2)} against $${borrowerShareOfAdjustments.toFixed(2)} of business income, and the return carried no Schedule L to test liquidity. Business income has been capped at the $${distributions.toFixed(2)} actually distributed.`
        });
      } else if (!entry.hasStableDistributions) {
        warnings.push({
          code: 'SCORP_DISTRIBUTION_LIMITATION_ACTIVE',
          severity: 'WARNING',
          message: `S-Corporation Year ${entry.year}: Borrower has ownership of ${entry.ownershipPercentage}%, but hasStableDistributions is false. K-1 ordinary income has been capped at the lesser of corporate share ($${borrowerShareOfAdjustments.toFixed(2)}) or actual distributions received ($${distributions.toFixed(2)}).`
        });
      }
      }
    } else if (entry.ownershipPercentage > 0) {
      // Under 25%: borrower is NOT self-employed. K-1 boxes 1/2/3 remain usable as
      // ordinary income — no business-level non-cash add-backs, no liquidity test —
      // capped at actual distributions received unless a stable history is documented.
      const minorityK1Income = k1Income;
      // No liquidity route under 25%: the borrower is not self-employed, so a
      // recorded history the K-1 contradicts leaves only what was distributed.
      const support = distributionSupport(minorityK1Income, entry.k1Distributions, entry.hasStableDistributions, null);
      k1EligibleIncome = support.eligibleIncome;
      distributionShortfall = support.shortfall !== null;
      const capped = support.eligibleIncome.lt(minorityK1Income);
      warnings.push({
        code: 'SCORP_MINORITY_K1_INCOME',
        severity: 'WARNING',
        message: `S-Corporation Year ${entry.year}: Ownership ${entry.ownershipPercentage}% is under 25% — borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 ($${minorityK1Income.toFixed(2)}) with no business add-backs${capped ? `, capped at distributions received ($${distributions.toFixed(2)})` : ''}. Document a 2-year receipt history.`
      });
      if (support.shortfall) {
        warnings.push({
          code: 'SCORP_DISTRIBUTIONS_BELOW_INCOME',
          severity: 'WARNING',
          message: `S-Corporation Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 16D reports distributions of $${distributions.toFixed(2)} against $${minorityK1Income.toFixed(2)} of K-1 income. Business income has been capped at the $${distributions.toFixed(2)} actually distributed.`
        });
      }
    }

    const totalCombined = w2.add(k1EligibleIncome);
    addFlowToYear(entry.year, totalCombined);

    return {
      entityId: entry.entityId ?? null,
      businessName: entry.businessName ?? null,
      ein: entry.ein ?? null,
      year: entry.year,
      w2WagesFromBusiness: w2.toNumber(),
      k1EligibleIncome: k1EligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber(),
      quickRatio: entry.ownershipPercentage >= 25 && liquidity ? liquidity.ratio.toDecimalPlaces(2).toNumber() : null,
      passesLiquidity: entry.ownershipPercentage >= 25 && liquidity ? passesLiquidity : null,
      distributionsReported: entry.k1Distributions ?? null,
      // True when a recorded distribution history is contradicted by Box 16D.
      distributionShortfall
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // C. FORM 1065 - PARTNERSHIP INCOME
  // ──────────────────────────────────────────────────────────────────────
  const gseInvestor: GseInvestor = payload.gseInvestor === 'FREDDIE' ? 'FREDDIE' : 'FNMA';
  const form1065Breakdown = (payload.form1065 || []).map((entry) => {
    const ownership = resolve1065Ownership(entry, gseInvestor);
    const ownershipPercentage = ownership.percentage;
    if (ownership.note) {
      warnings.push({
        code: 'PARTNERSHIP_OWNERSHIP_BASIS',
        severity: 'WARNING',
        message: `Partnership Year ${entry.year}: ${ownership.note}`,
      });
    }
    const ordinary = new Decimal(entry.k1OrdinaryIncome || 0);
    const rentalRealEstate = new Decimal(entry.k1NetRentalRealEstate || 0);
    const otherRental = new Decimal(entry.k1OtherNetRentalIncome || 0);
    const guaranteed = new Decimal(entry.k1GuaranteedPayments || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const gain4797 = new Decimal(entry.gain4797 || 0);
    const otherIncome = new Decimal(entry.otherIncome || 0);
    const distributions = new Decimal(entry.k1Distributions || 0);
    const liquidity = scheduleLQuickRatioFromInput(entry.scheduleL);
    const passesLiquidity = liquidity ? liquidity.ratio.gte(1.0) : true;
    // K-1 boxes are already the partner's share and count at 100%.
    const k1Income = ordinary.add(rentalRealEstate).add(otherRental);

    let k1EligibleIncome = new Decimal(0);
    let distributionShortfall = false;

    if (ownershipPercentage >= 25) {
      if (liquidity && !passesLiquidity) {
        k1EligibleIncome = new Decimal(0);
        warnings.push({
          code: 'PARTNERSHIP_LIQUIDITY_FAILED',
          severity: 'WARNING',
          message: `Partnership Year ${entry.year}: Schedule L quick ratio is ${liquidity.ratio.toFixed(2)} (< 1.0). Business income locked out ($0.00). Guaranteed payments still qualify.`
        });
      } else {
      // Only the entity-level return lines are the partner's by ownership.
      const shareFactor = new Decimal(ownershipPercentage).div(100);
      const returnAdjustments = depr
        .add(depl)
        .add(amort)
        .sub(meals)
        .sub(gain4797)
        .sub(otherIncome);

      const borrowerShareOfAdjustments = k1Income.add(returnAdjustments.mul(shareFactor));

      const support = distributionSupport(
        borrowerShareOfAdjustments,
        entry.k1Distributions,
        entry.hasStableDistributions,
        liquidity ? passesLiquidity : null,
      );
      k1EligibleIncome = support.eligibleIncome;
      distributionShortfall = support.shortfall !== null;

      if (support.shortfall) {
        warnings.push({
          code: 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME',
          severity: 'WARNING',
          message: support.shortfall.restsOnLiquidity
            ? `Partnership Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 19A reports distributions of $${distributions.toFixed(2)} against $${borrowerShareOfAdjustments.toFixed(2)} of business income. The $${borrowerShareOfAdjustments.sub(distributions).toFixed(2)} shortfall is not supported by distributions and rests on the Schedule L quick ratio of ${liquidity!.ratio.toFixed(2)} instead. Evidence the distribution history or qualify the business on liquidity.`
            : `Partnership Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 19A reports distributions of $${distributions.toFixed(2)} against $${borrowerShareOfAdjustments.toFixed(2)} of business income, and the return carried no Schedule L to test liquidity. Business income has been capped at the $${distributions.toFixed(2)} actually distributed.`
        });
      } else if (!entry.hasStableDistributions) {
        warnings.push({
          code: 'PARTNERSHIP_DISTRIBUTION_LIMITATION_ACTIVE',
          severity: 'WARNING',
          message: `Partnership Year ${entry.year}: Borrower has ownership of ${ownershipPercentage}%, but hasStableDistributions is false. K-1 ordinary income has been capped at the lesser of corporate share ($${borrowerShareOfAdjustments.toFixed(2)}) or actual distributions received ($${distributions.toFixed(2)}).`
        });
      }
      }
    } else if (ownershipPercentage > 0) {
      // Under 25%: borrower is NOT self-employed. K-1 boxes 1/2/3 remain usable as
      // ordinary income (guaranteed payments are added separately below) — no
      // business add-backs, no liquidity test — capped at distributions received
      // unless a stable history is documented.
      const minorityK1Income = k1Income;
      // No liquidity route under 25%: the borrower is not self-employed, so a
      // recorded history the K-1 contradicts leaves only what was distributed.
      const support = distributionSupport(minorityK1Income, entry.k1Distributions, entry.hasStableDistributions, null);
      k1EligibleIncome = support.eligibleIncome;
      distributionShortfall = support.shortfall !== null;
      const capped = support.eligibleIncome.lt(minorityK1Income);
      warnings.push({
        code: 'PARTNERSHIP_MINORITY_K1_INCOME',
        severity: 'WARNING',
        message: `Partnership Year ${entry.year}: Ownership ${ownershipPercentage}% is under 25% — borrower is not self-employed. Usable income limited to K-1 boxes 1/2/3 ($${minorityK1Income.toFixed(2)}) plus guaranteed payments, with no business add-backs${capped ? ` and capped at distributions received ($${distributions.toFixed(2)})` : ''}. Document a 2-year receipt history. Note: qualify on the END-of-year percentage — Freddie Mac uses the Item J profit %, FNMA uses the capital %.`
      });
      if (support.shortfall) {
        warnings.push({
          code: 'PARTNERSHIP_DISTRIBUTIONS_BELOW_INCOME',
          severity: 'WARNING',
          message: `Partnership Year ${entry.year}: a stable distribution history is recorded, but K-1 Box 19A reports distributions of $${distributions.toFixed(2)} against $${minorityK1Income.toFixed(2)} of K-1 income. Business income has been capped at the $${distributions.toFixed(2)} actually distributed.`
        });
      }
    }

    const totalCombined = k1EligibleIncome.add(guaranteed);
    addFlowToYear(entry.year, totalCombined);

    return {
      entityId: entry.entityId ?? null,
      businessName: entry.businessName ?? null,
      ein: entry.ein ?? null,
      year: entry.year,
      ownershipPercentage,
      guaranteedPayments: guaranteed.toNumber(),
      k1EligibleIncome: k1EligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber(),
      quickRatio: ownershipPercentage >= 25 && liquidity ? liquidity.ratio.toDecimalPlaces(2).toNumber() : null,
      passesLiquidity: ownershipPercentage >= 25 && liquidity ? passesLiquidity : null,
      distributionsReported: entry.k1Distributions ?? null,
      // True when a recorded distribution history is contradicted by Box 19A.
      distributionShortfall
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // D. FORM 1120 - U.S. CORPORATION INCOME TAX RETURN
  // ──────────────────────────────────────────────────────────────────────
  const form1120Breakdown = (payload.form1120 || []).map((entry) => {
    const w2 = new Decimal(entry.w2WagesFromCorporate || 0);
    const taxable = new Decimal(entry.taxableIncome || 0);
    const taxPaid = new Decimal(entry.totalTaxPaid || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);
    const amort = new Decimal(entry.amortization || 0);
    const meals = new Decimal(entry.mealsExclusion || 0);
    const nol = new Decimal(entry.nolAndSpecialDeductions || 0);
    const dividends = new Decimal(entry.borrowerDividendsReceived || 0);

    const cash = new Decimal(entry.cash || 0);
    const securities = new Decimal(entry.securities || 0);
    const ar = new Decimal(entry.accountsReceivable || 0);
    const currentLiabilities = new Decimal(entry.currentLiabilities || 1); // Avoid division by zero

    // Quick Ratio Test: (Cash + Securities + Accounts Receivable) / Current Liabilities
    const quickRatio = cash.add(securities).add(ar).div(currentLiabilities);
    const passesLiquidity = quickRatio.gte(1.0);

    let corporateEligibleIncome = new Decimal(0);

    if (entry.ownershipPercentage >= 25) {
      if (passesLiquidity) {
        // Form 1084 Corp Calculation: (Taxable Income - Tax Paid + Depreciation + Depletion + Amortization - Meals + NOL) * Share%
        const totalCorpAdjustments = taxable
          .sub(taxPaid)
          .add(depr)
          .add(depl)
          .add(amort)
          .sub(meals)
          .add(nol);

        const shareFactor = new Decimal(entry.ownershipPercentage).div(100);
        corporateEligibleIncome = totalCorpAdjustments.mul(shareFactor);
      } else {
        corporateEligibleIncome = new Decimal(0);
        warnings.push({
          code: 'CORPORATE_LIQUIDITY_FAILED',
          severity: 'WARNING',
          message: `C-Corporation Year ${entry.year}: Quick Ratio is ${quickRatio.toFixed(2)} (< 1.0). Balance sheet liquidity failed Fannie Mae requirements. Corporate adjustments have been locked out ($0.00). Only borrower W-2 wages and direct dividends can qualify.`
        });
      }
    }

    // Dividends are always eligible for minority shareholders (<25%) and stack with corporate income for SE owners
    const totalCombined = w2.add(corporateEligibleIncome).add(dividends);
    addFlowToYear(entry.year, totalCombined);

    return {
      entityId: entry.entityId ?? null,
      businessName: entry.businessName ?? null,
      ein: entry.ein ?? null,
      year: entry.year,
      w2WagesFromCorporate: w2.toNumber(),
      borrowerDividendsReceived: dividends.toNumber(),
      corporateEligibleIncome: corporateEligibleIncome.toNumber(),
      totalCombinedQualifying: totalCombined.toNumber(),
      quickRatio: entry.ownershipPercentage >= 25 ? quickRatio.toDecimalPlaces(2).toNumber() : null,
      passesLiquidity: entry.ownershipPercentage >= 25 ? passesLiquidity : null
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // E. FORM 1040 BENEFIT INPUTS (SOCIAL SECURITY, DISABILITY, AND PENSIONS)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.benefits && payload.benefits.length > 0) {
    payload.benefits.forEach((entry) => {
      let benefitFlow = new Decimal(0);

      // 1. Social Security Retirement & Disability OASDI Gross-Up Math
      const ssTotal = new Decimal(entry.totalSocialSecurity || 0);
      const ssTaxable = new Decimal(entry.taxableSocialSecurity || 0);
      const ssExempt = Decimal.max(0, ssTotal.sub(ssTaxable));

      const ssQualifying = ssTaxable.add(ssExempt.mul(grossUpMultiplier));
      benefitFlow = benefitFlow.add(ssQualifying);

      if (ssExempt.gt(0)) {
        if (entry.isSupplementalSecurityIncome) {
          conditions.push({
            title: 'Supplemental Security Income (SSI) Continuance',
            category: 'INCOME',
            description: `SSI benefits detected. Verify 3-year continuance and confirm borrower meets active asset and income qualification limits.`,
            requiredDocType: 'SSI_AWARD_LETTER'
          });
        }
      }

      // 2. Pension & Annuity Distributions
      const totalPension = new Decimal(entry.totalPensionsAndAnnuities || 0);
      const taxablePension = new Decimal(entry.taxablePensionsAndAnnuities || 0);
      const exemptPension = Decimal.max(0, totalPension.sub(taxablePension));
      
      const pensionQualifying = taxablePension.add(exemptPension.mul(grossUpMultiplier));
      benefitFlow = benefitFlow.add(pensionQualifying);

      if (entry.isNonGovernmentPension && program === 'FHA') {
        conditions.push({
          title: 'Private Pension Continuance (FHA)',
          category: 'INCOME',
          description: `FHA guidelines (HUD 4000.1) require proof of 3-year continuance for non-government (private) pension distributions.`,
          requiredDocType: 'PENSION_BENEFITS_LETTER_OR_TRUST_STATEMENT'
        });
      }

      // 3. VA Disability & Benefits (100% Tax-Free, grossed up)
      const vaDisability = new Decimal(entry.vaDisabilityMonthly || 0);
      if (vaDisability.gt(0)) {
        const vaQualifyingAnnual = vaDisability.mul(grossUpMultiplier).mul(12);
        benefitFlow = benefitFlow.add(vaQualifyingAnnual);
      }

      addFlowToYear(entry.year, benefitFlow);
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // F. ASSET-DERIVED INCOME (SCHEDULE B INTEREST/DIVIDENDS & SCHEDULE D GAINS)
  // ──────────────────────────────────────────────────────────────────────
  const assetIncomeBreakdown = (payload.assets || []).map((entry) => {
    const interest = new Decimal(entry.interestIncome || 0);
    const dividends = new Decimal(entry.dividendIncome || 0);
    const capitalGains = new Decimal(entry.capitalGainsNetLoss || 0);
    const detectedAssetIncome = interest.add(dividends).add(capitalGains);
    const included = entry.includeInQualifyingIncome === true;
    const qualifyingAssetIncome = included ? detectedAssetIncome : new Decimal(0);

    if (included) {
      addFlowToYear(entry.year, qualifyingAssetIncome);

      if (detectedAssetIncome.gt(0) && !entry.hasThreeYearAssetSupport) {
        conditions.push({
          title: 'Asset Income Continuance & Asset Balance Audit',
          category: 'INCOME',
          description: `Underwriter elected to include asset-derived income for ${entry.year}. Verify that the underlying brokerage or deposit asset balance and receipt history support continuance for at least 36 months.`,
          requiredDocType: 'BROKERAGE_ACCOUNT_STATEMENTS_3_YEARS'
        });
      }
    } else if (!detectedAssetIncome.eq(0) || !capitalGains.eq(0)) {
      warnings.push({
        code: 'ASSET_INCOME_EXCLUDED_BY_DEFAULT',
        severity: 'WARNING',
        message: `Schedule B/D income for ${entry.year} was detected but excluded from qualifying income by default. An underwriter may elect inclusion with includeInQualifyingIncome only after documenting receipt history, asset sufficiency, stability, and continuance.`
      });
      conditions.push({
        title: 'Asset Income Underwriter Election',
        category: 'INCOME',
        description: `Interest, dividends, or capital gain/loss was detected for ${entry.year} and remains excluded. If the underwriter elects inclusion, document the required receipt history, underlying asset balance, stability, and continuance before setting includeInQualifyingIncome.`,
        requiredDocType: 'BROKERAGE_ACCOUNT_STATEMENTS_3_YEARS'
      });
    }

    return {
      year: entry.year,
      interestIncome: interest.toNumber(),
      dividendIncome: dividends.toNumber(),
      capitalGainsNetLoss: capitalGains.toNumber(),
      detectedAssetIncome: detectedAssetIncome.toNumber(),
      includeInQualifyingIncome: included,
      qualifyingAssetIncome: qualifyingAssetIncome.toNumber(),
      hasThreeYearAssetSupport: entry.hasThreeYearAssetSupport === true
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // G. TRUST INCOME (SCHEDULE E, PART III & K-1 1041)
  // ──────────────────────────────────────────────────────────────────────
  if (payload.trusts && payload.trusts.length > 0) {
    payload.trusts.forEach((entry) => {
      const trust = new Decimal(entry.trustIncome || 0);
      addFlowToYear(entry.year, trust);

      if (trust.gt(0) && !entry.hasThreeYearTrustContinuance) {
        conditions.push({
          title: 'Trust Agreement and Continuance Verification',
          category: 'INCOME',
          description: `Trust income detected on Schedule E Part III. Underwriter must verify the Trust Agreement or Trustee's Letter confirming stable distribution and 3-year continuance.`,
          requiredDocType: 'TRUST_AGREEMENT_AND_CERTIFICATE'
        });
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // H. SCHEDULE E PAGE 1 - RENTAL PROPERTY VS. ROYALTY INCOME
  // ──────────────────────────────────────────────────────────────────────
  let totalQualifyingRentalMonthly = new Decimal(0);
  const rentalPropertiesMap: Record<string, ScheduleEPage1PropertyInput[]> = {};

  (payload.scheduleEProperties || []).forEach((prop) => {
    if (prop.propertyType === 'RENTAL') {
      if (!rentalPropertiesMap[prop.propertyAddress]) {
        rentalPropertiesMap[prop.propertyAddress] = [];
      }
      rentalPropertiesMap[prop.propertyAddress].push(prop);
    }
  });

  Object.entries(rentalPropertiesMap).forEach(([address, entries]) => {
    const sortedProps = [...entries].sort((a, b) => b.year - a.year);
    const hasMultipleYears = sortedProps.length >= 2;
    const isMultiFamily = sortedProps[0].isMultiFamilySubjectToFhaDecline === true;

    if (hasMultipleYears) {
      const propYear1 = sortedProps[0];
      const propYear2 = sortedProps[1];

      const p1 = getMonthlyPropertyCashFlow(propYear1);
      const p2 = getMonthlyPropertyCashFlow(propYear2);

      const monthly1 = p1.monthlyAverage;
      const monthly2 = p2.monthlyAverage;

      let finalPropertyMonthly = new Decimal(0);

      if (monthly1.lt(monthly2)) {
        const declineAmount = monthly2.sub(monthly1);
        const declinePercent = declineAmount.div(monthly2).mul(100).toNumber();

        if (program === 'FHA' && isMultiFamily) {
          if (declinePercent <= 5.0) {
            finalPropertyMonthly = monthly1.add(monthly2).div(2);
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_DECLINE_STABLE',
              severity: 'WARNING',
              message: `FHA Multi-Family rental cash flow for ${address} declined slightly by ${declinePercent.toFixed(1)}% (within 5% HUD stable decline threshold). Standard 24-month average ($${finalPropertyMonthly.toFixed(2)}/mo) utilized.`
            });
          } else if (declinePercent > 5.0 && declinePercent <= 20.0) {
            finalPropertyMonthly = monthly1;
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_DECLINE_ENFORCED',
              severity: 'WARNING',
              message: `FHA Multi-Family rental cash flow for ${address} declined by ${declinePercent.toFixed(1)}% (exceeds 5% HUD stable limit). Qualifying rental income restricted strictly to the lower most recent period of $${finalPropertyMonthly.toFixed(2)}/mo.`
            });
          } else {
            finalPropertyMonthly = new Decimal(0);
            warnings.push({
              code: 'FHA_MULTIFAMILY_RENTAL_CRITICAL_DECLINE',
              severity: 'CRITICAL',
              message: `FHA Multi-Family rental cash flow for ${address} declined catastrophically by ${declinePercent.toFixed(1)}% (exceeds 20% limit). Income from this property has been completely disqualified ($0.00/mo) and locked out to prevent severe audit risk.`
            });
            conditions.push({
              title: 'FHA Multi-Family Rental Income Disqualification Review',
              category: 'INCOME',
              description: `Multi-family property ${address} rental income declined by ${declinePercent.toFixed(1)}% (exceeds 20% FHA boundary). Complete viability review required to satisfy HUD 4000.1 checklist.`,
              requiredDocType: 'MULTI_FAMILY_RENTAL_LEASE_AND_LEGER_PROOF'
            });
          }
        } else {
          finalPropertyMonthly = monthly1.add(monthly2).div(2);
          warnings.push({
            code: 'RENTAL_INCOME_DECLINE_WARN',
            severity: 'WARNING',
            message: `Rental income for property ${address} declined by ${declinePercent.toFixed(1)}% year-over-year. Two years in file — 24-month average used ($${finalPropertyMonthly.toFixed(2)}/mo). Decline is a warning only and does not switch the guideline pick to the lower year.`
          });
        }
      } else {
        finalPropertyMonthly = monthly1.add(monthly2).div(2);
      }

      totalQualifyingRentalMonthly = totalQualifyingRentalMonthly.add(finalPropertyMonthly);

    } else {
      const propYear1 = sortedProps[0];
      const p1 = getMonthlyPropertyCashFlow(propYear1);
      const finalPropertyMonthly = p1.monthlyAverage;
      totalQualifyingRentalMonthly = totalQualifyingRentalMonthly.add(finalPropertyMonthly);
    }
  });

  const scheduleEPropertiesBreakdown = (payload.scheduleEProperties || []).map((entry) => {
    const flow = getMonthlyPropertyCashFlow(entry);
    const net = new Decimal(entry.netIncomeLoss || 0);
    const depr = new Decimal(entry.depreciation || 0);
    const depl = new Decimal(entry.depletion || 0);

    let totalPropertyFlow = new Decimal(0);
    let calculatedMonths = 12;

    if (entry.propertyType === 'ROYALTY') {
      totalPropertyFlow = net.add(depl);

      if (totalPropertyFlow.gt(0) && !entry.hasThreeYearRoyaltyContinuance) {
        conditions.push({
          title: 'Royalty Income Continuance Verification',
          category: 'INCOME',
          description: `Royalty income detected from property: ${entry.propertyAddress}. Underwriter must verify 3-year continuance and confirm royalty agreements/contracts remain valid.`,
          requiredDocType: 'ROYALTY_CONTRACT_OR_AGREEMENT_AND_PROOFS'
        });
      }
      addFlowToYear(entry.year, totalPropertyFlow);
    } else {
      totalPropertyFlow = flow.totalAnnualCashFlow;
      calculatedMonths = flow.monthsInService;
    }

    return {
      year: entry.year,
      propertyAddress: entry.propertyAddress,
      propertyType: entry.propertyType,
      totalCashFlow: totalPropertyFlow.toNumber(),
      netIncomeLoss: net.toNumber(),
      depreciation: depr.toNumber(),
      depletion: depl.toNumber(),
      addBacks: flow.addBacks.toNumber(),
      fairRentalDays: entry.fairRentalDays !== undefined ? entry.fairRentalDays : null,
      fairRentalDaysOverride: entry.fairRentalDaysOverride !== undefined ? entry.fairRentalDaysOverride : null,
      monthsInService: calculatedMonths
    };
  });

  // ──────────────────────────────────────────────────────────────────────
  // I. MULTI-YEAR TRENDING ANALYSIS & REGULATORY PROGRAM OVERLAYS
  // ──────────────────────────────────────────────────────────────────────
  const sortedYears = Object.keys(annualCalculatedTotals)
    .map(Number)
    .sort((a, b) => b - a);

  let trendingResult = 'INSUFFICIENT_DATA';

  const hasSelfEmployment =
    (payload.scheduleC?.length || 0) > 0 ||
    (payload.scheduleF?.length || 0) > 0 ||
    (payload.form1120S?.length || 0) > 0 ||
    (payload.form1065?.length || 0) > 0 ||
    (payload.form1120?.length || 0) > 0;

  if (program === 'VA' && sortedYears.length < 2 && hasSelfEmployment) {
    warnings.push({
      code: 'VA_MIN_HISTORY_BREACH',
      severity: 'WARNING',
      message: `VA self-employed underwriting requires a minimum of 2 years history. Only ${sortedYears.length} year(s) provided. Loan Officer must verify standard matching industry background for a history exception.`
    });
  }

  if (sortedYears.length >= 2) {
    const year1 = annualCalculatedTotals[sortedYears[0]];
    const year2 = annualCalculatedTotals[sortedYears[1]];

    if (year1.gte(year2)) {
      trendingResult = `${program}_STABLE_OR_INCREASING`;
      totalQualifyingMonthlyIncome = year1.add(year2).div(24);

      const increaseAmount = year1.sub(year2);
      const increasePercent = increaseAmount.div(year2).mul(100).toNumber();
      if (increasePercent > 10.0 && program === 'CONVENTIONAL') {
        warnings.push({
          code: 'FHLMC_SIGNIFICANT_INCREASE_AUDIT',
          severity: 'WARNING',
          message: `Freddie Mac Alert: Variable cash flow increased by ${increasePercent.toFixed(1)}% year-over-year. Fluctuation requires underwriter analysis.`
        });
      }
    } else {
      const declineAmount = year2.sub(year1);
      const declinePercent = declineAmount.div(year2).mul(100).toNumber();

      trendingResult = `${program}_DECLINING`;

      if (program === 'FHA') {
        totalQualifyingMonthlyIncome = year1.div(12);
        if (declinePercent <= 5.0) {
          trendingResult = 'FHA_DECLINE_STABLE';
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
        } else if (declinePercent > 5.0 && declinePercent <= 20.0) {
          warnings.push({
            code: 'FHA_INCOME_DECLINE_ENFORCED',
            severity: 'WARNING',
            message: `FHA self-employed and variable cash flow declined by ${declinePercent.toFixed(1)}% year-over-year. Under HUD 4000.1, calculations are restricted strictly to the lower most recent 12-month period ($${totalQualifyingMonthlyIncome.toFixed(2)}/mo).`
          });
        } else {
          trendingResult = 'FHA_CRITICAL_DECLINE';
          warnings.push({
            code: 'FHA_CRITICAL_INCOME_DECLINE',
            severity: 'CRITICAL',
            message: `FHA Alert: Self-employed cash flow declined by ${declinePercent.toFixed(1)}% (exceeds 20% limit). Business viability is highly suspect.`
          });
        }
      } else if (program === 'CONVENTIONAL') {
        if (declinePercent <= 10.0) {
          totalQualifyingMonthlyIncome = year1.add(year2).div(24);
          warnings.push({
            code: 'CONVENTIONAL_MILD_DECLINE_STABLE',
            severity: 'WARNING',
            message: `Conventional Warning: Cash flow declined by ${declinePercent.toFixed(1)}% (within 10% FHLMC limit). Standard 24-month average ($${totalQualifyingMonthlyIncome.toFixed(2)}/mo) is utilized.`
          });
        } else {
          totalQualifyingMonthlyIncome = year1.div(12);
          warnings.push({
            code: 'FHLMC_SIGNIFICANT_DECLINE_ENFORCED',
            severity: 'WARNING',
            message: `Freddie Mac Alert: Cash flow declined by ${declinePercent.toFixed(1)}% (exceeds 10% limit). Qualifying restricted to lower most recent 12-month average of $${totalQualifyingMonthlyIncome.toFixed(2)}/mo.`
          });
        }
      } else {
        totalQualifyingMonthlyIncome = year1.div(12);
        warnings.push({
          code: 'INCOME_DECLINE_DETECTED',
          severity: 'WARNING',
          message: `Alert: Income declined by ${declinePercent.toFixed(1)}%. Restricted strictly to lower most recent 12-month average of $${totalQualifyingMonthlyIncome.toFixed(2)}/mo.`
        });
      }
    }
  } else if (sortedYears.length === 1) {
    trendingResult = 'SINGLE_YEAR';
    totalQualifyingMonthlyIncome = annualCalculatedTotals[sortedYears[0]].div(12);
  }

  // ──────────────────────────────────────────────────────────────────────
  // J. MILITARY LES PARSING & BASE PAY / TAX-FREE HOUSING GROSS-UP
  // ──────────────────────────────────────────────────────────────────────
  let totalQualifyingMilitaryMonthly = new Decimal(0);
  let militaryBreakdown = null;

  if (payload.militaryLES) {
    const les = payload.militaryLES;
    const basicPay = new Decimal(les.militaryBasicPay);
    const bah = new Decimal(les.militaryBAH);
    const bas = new Decimal(les.militaryBAS);
    const taxFreeAllowances = bah.add(bas);

    const qualifyingAllowances = taxFreeAllowances.mul(grossUpMultiplier);
    const militaryGrossUpBenefit = qualifyingAllowances.sub(taxFreeAllowances);

    let eligibleSpecialPay = new Decimal(0);
    if (les.militarySpecialPay && les.militarySpecialPay > 0) {
      if (les.hasSpecialPayHistory) {
        eligibleSpecialPay = new Decimal(les.militarySpecialPay);
      } else {
        conditions.push({
          title: 'Military Special Pay History Audit',
          category: 'INCOME',
          description: `Military special pay (flight/hazard/combat) of $${les.militarySpecialPay}/mo detected on LES, but lacks verified 12-month receipt history. Excluded from qualifying baseline.`,
          requiredDocType: 'MILITARY_ORDERS_OR_YTD_HISTORY_PROOF'
        });
      }
    }

    totalQualifyingMilitaryMonthly = basicPay.add(eligibleSpecialPay).add(qualifyingAllowances);

    militaryBreakdown = {
      basicPay: basicPay.toNumber(),
      eligibleSpecialPay: eligibleSpecialPay.toNumber(),
      taxFreeAllowances: taxFreeAllowances.toNumber(),
      qualifyingAllowances: qualifyingAllowances.toNumber(),
      monthlyGrossUpBenefit: militaryGrossUpBenefit.toNumber(),
      totalQualifyingMilitaryMonthly: totalQualifyingMilitaryMonthly.toNumber()
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // K. FINAL CASH FLOW ASSEMBLY: VA INCOME REDUCTION VS. CONVENTIONAL DEBT OFFSET (v9 Core)
  // ──────────────────────────────────────────────────────────────────────
  let finalRentalIncomeImpact = new Decimal(0);
  let proposedRentalLossDebt = new Decimal(0);
  let subjectHousingExpenseAdjustment = new Decimal(0);

  if (totalQualifyingRentalMonthly.lt(0)) {
    if (program === 'VA') {
      // VA Rule: Direct reduction of gross qualifying income [cite: 122]
      finalRentalIncomeImpact = totalQualifyingRentalMonthly;
      warnings.push({
        code: 'VA_RENTAL_LOSS_INCOME_REDUCTION',
        severity: 'WARNING',
        message: `VA Guidelines require net aggregated rental loss of ($${Math.abs(totalQualifyingRentalMonthly.toNumber()).toFixed(2)}/mo) to be deducted directly from gross qualifying income.`
      });
    } else {
      // FNMA/Conventional & FHA Rule: Clamp income impact to $0.00 and redirect loss as debt [cite: 107]
      finalRentalIncomeImpact = new Decimal(0);
      proposedRentalLossDebt = totalQualifyingRentalMonthly.abs();
      warnings.push({
        code: 'CONVENTIONAL_RENTAL_LOSS_LIABILITY',
        severity: 'WARNING',
        message: `Conventional/FHA net aggregated rental loss of ($${proposedRentalLossDebt.toFixed(2)}/mo) has been clamped to $0.00 for qualifying income and redirected as a proposed monthly liability on the 1003.`
      });
    }
  } else {
    // Net positive rental income is added directly to gross income for all programs [cite: 122]
    finalRentalIncomeImpact = totalQualifyingRentalMonthly;
  }

  // Handle optional Subject Property Rental inputs [cite: 35]
  if (payload.subjectPropertyRental) {
    const { grossMarketRent, subjectPITIA, isPrimaryMultiFamily2To4Unit } = payload.subjectPropertyRental;
    const rawRent = new Decimal(grossMarketRent || 0);
    const pitia = new Decimal(subjectPITIA || 0);
    const adjustedRent = rawRent.mul(0.75); // Fannie Mae 75% vacancy factor [cite: 35]
    const netSubjectCashFlow = adjustedRent.sub(pitia);

    if (isPrimaryMultiFamily2To4Unit) {
      // Duplex/triplex/fourplex primary residence offset check [cite: 35]
      if (netSubjectCashFlow.gt(0)) {
        finalRentalIncomeImpact = finalRentalIncomeImpact.add(netSubjectCashFlow);
      } else {
        subjectHousingExpenseAdjustment = netSubjectCashFlow.abs();
        warnings.push({
          code: 'PRIMARY_2_4_UNIT_RENTAL_DEFICIT',
          severity: 'WARNING',
          message: `Subject multi-family primary residence tenant unit rental deficit of ($${subjectHousingExpenseAdjustment.toFixed(2)}/mo) has been applied as an adjustment to the primary housing expense, bypassing consumer liability categorization.`
        });
      }
    } else {
      // Investment Property Subject Rent [cite: 35]
      if (netSubjectCashFlow.gt(0)) {
        finalRentalIncomeImpact = finalRentalIncomeImpact.add(netSubjectCashFlow);
      } else {
        proposedRentalLossDebt = proposedRentalLossDebt.add(netSubjectCashFlow.abs());
        warnings.push({
          code: 'INVESTMENT_SUBJECT_RENTAL_DEFICIT',
          severity: 'WARNING',
          message: `Subject investment property net rental loss of ($${netSubjectCashFlow.abs().toFixed(2)}/mo) has been mapped as a proposed monthly liability debt.`
        });
      }
    }
  }

  // Combine military and rental impact
  totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(totalQualifyingMilitaryMonthly);
  totalQualifyingMonthlyIncome = totalQualifyingMonthlyIncome.add(finalRentalIncomeImpact);

  return {
    summary: {
      qualifyingMonthlyIncome: totalQualifyingMonthlyIncome.toDecimalPlaces(2).toNumber(),
      proposedRentalLossDebt: proposedRentalLossDebt.toDecimalPlaces(2).toNumber(),
      subjectHousingExpenseAdjustment: subjectHousingExpenseAdjustment.toDecimalPlaces(2).toNumber(),
      trendingResult,
      yearsAnalyzed: sortedYears,
      programUsed: program,
      appliedGrossUpMultiplier: grossUpMultiplier.toNumber(),
      appliedGrossUpPercentText: grossUpPercentText
    },
    warnings,
    conditions,
    annualCalculatedTotals: Object.fromEntries(
      Object.entries(annualCalculatedTotals).map(([year, amount]) => [year, amount.toNumber()])
    ),
    w2EmployerBreakdown,
    scheduleCBreakdown,
    scheduleFBreakdown,
    form1120SBreakdown,
    form1065Breakdown,
    form1120Breakdown,
    assetIncomeBreakdown,
    scheduleEPropertiesBreakdown,
    militaryBreakdown
  };
}
