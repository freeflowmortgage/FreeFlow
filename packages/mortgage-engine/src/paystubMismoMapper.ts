/**
 * Canonical paystub JSON for any payroll processor (MISMO 3.4 / URLA Section 1b)
 * plus CURRENT_INCOME XML. Maps FreeFlow ps-* buckets without dropping Tips, RSU,
 * or qualifying base (regular, PTO, holiday, vacation, sick, shift/weekend/night,
 * retro). Not written to match a single employer stub.
 */

export type PaymentFrequencyType = 'Weekly' | 'Biweekly' | 'SemiMonthly' | 'Monthly';

export type MismoPaystubIncomeType =
  | 'BasePay'
  | 'Overtime'
  | 'Bonus'
  | 'Commissions'
  | 'Tips'
  | 'RestrictedStockUnits'
  | 'OtherIncome';

export type PaystubEarningsLineItem = {
  rawDescription: string;
  mismoIncomeType: MismoPaystubIncomeType;
  isQualifyingBase: boolean;
  hours: number | null;
  rate: number | null;
  currentAmount: number;
  ytdHours: number | null;
  ytdAmount: number;
};

export type MortgageDocumentPaystubParser = {
  documentMetadata: {
    employerName?: string;
    employerAddress?: {
      street?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
    };
    employeeFirstName?: string;
    employeeLastName?: string;
    employeeIdentifier?: string | null;
    payPeriodStartDate?: string | null;
    payPeriodEndDate?: string | null;
    payDate?: string | null;
    paymentFrequencyType?: PaymentFrequencyType;
  };
  grossPaySummary: {
    currentGrossPayAmount?: number | null;
    ytdGrossPayAmount?: number | null;
    currentNetPayAmount?: number | null;
    ytdNetPayAmount?: number | null;
  };
  earningsLineItems: PaystubEarningsLineItem[];
  deductions: Array<{
    description: string;
    deductionTimingType?: 'PreTax' | 'PostTax';
    isMandatoryDebtObligation?: boolean;
    currentAmount: number;
    ytdAmount: number;
  }>;
  taxes: Array<{
    taxType: 'Federal' | 'State' | 'OASDI' | 'Medicare' | 'Local';
    currentAmount: number;
    ytdAmount: number;
  }>;
  calculatedUnderwritingSummary: {
    totalBasePayYTD: number;
    totalOvertimeYTD: number;
    totalBonusYTD: number;
    totalCommissionYTD: number;
    totalTipsYTD: number;
    totalRsuYTD: number;
    totalImputedNonCashYTD: number;
    derivedCalculatedMonthlyBase: number;
  };
};

export type PaystubCanonicalInput = {
  employerName?: string;
  employerAddress?: MortgageDocumentPaystubParser['documentMetadata']['employerAddress'];
  employeeFirstName?: string;
  employeeLastName?: string;
  employeeIdentifier?: string | null;
  payPeriodStartDate?: string | null;
  payPeriodEndDate?: string | null;
  payDate?: string | null;
  paymentFrequencyType?: string;
  hourlyRate?: number | null;
  weeklyHours?: number | null;
  currentGrossPayAmount?: number | null;
  ytdGrossPayAmount?: number | null;
  currentNetPayAmount?: number | null;
  ytdNetPayAmount?: number | null;
  currentBasePayAmount?: number | null;
  baseYtd?: number | null;
  overtimeYtd?: number | null;
  bonusYtd?: number | null;
  commissionYtd?: number | null;
  tipsYtd?: number | null;
  rsuYtd?: number | null;
  otherYtd?: number | null;
  imputedNonCashYtd?: number | null;
  earningsLineItems?: PaystubEarningsLineItem[];
  deductions?: MortgageDocumentPaystubParser['deductions'];
  taxes?: MortgageDocumentPaystubParser['taxes'];
};

export type PaystubFieldLike = {
  sourceFieldId: string;
  numericValue?: number;
  value?: string;
};

export const PAYS_PER_YEAR: Record<PaymentFrequencyType, number> = {
  Weekly: 52,
  Biweekly: 26,
  SemiMonthly: 24,
  Monthly: 12,
};

const FREQ_ALIASES: Record<string, PaymentFrequencyType> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  'bi-weekly': 'Biweekly',
  bi_weekly: 'Biweekly',
  semimonthly: 'SemiMonthly',
  'semi-monthly': 'SemiMonthly',
  semi_monthly: 'SemiMonthly',
  monthly: 'Monthly',
};

export function normalizePaymentFrequencyType(raw?: string | null): PaymentFrequencyType | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (FREQ_ALIASES[key]) return FREQ_ALIASES[key];
  if (/semi[-_ ]?month/i.test(raw)) return 'SemiMonthly';
  if (/bi[-_ ]?week/i.test(raw)) return 'Biweekly';
  if (/\bweekly\b/i.test(raw)) return 'Weekly';
  if (/\bmonthly\b/i.test(raw)) return 'Monthly';
  return undefined;
}

export function uiPayFrequencyFromMismo(
  frequency?: PaymentFrequencyType | string | null,
): 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY' | undefined {
  const normalized = normalizePaymentFrequencyType(frequency ?? undefined);
  if (!normalized) return undefined;
  const mapped: Record<PaymentFrequencyType, 'WEEKLY' | 'BIWEEKLY' | 'SEMIMONTHLY' | 'MONTHLY'> = {
    Weekly: 'WEEKLY',
    Biweekly: 'BIWEEKLY',
    SemiMonthly: 'SEMIMONTHLY',
    Monthly: 'MONTHLY',
  };
  return mapped[normalized];
}

function money(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function moneyOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlMoney(value: number): string {
  return money(value).toFixed(2);
}

export function derivedCalculatedMonthlyBase(input: PaystubCanonicalInput): number {
  const frequency = normalizePaymentFrequencyType(input.paymentFrequencyType);
  const current = input.currentBasePayAmount;
  if (current != null && Number.isFinite(current) && frequency) {
    return money((current * PAYS_PER_YEAR[frequency]) / 12);
  }
  const rate = input.hourlyRate;
  const hours = input.weeklyHours;
  if (rate != null && hours != null && Number.isFinite(rate) && Number.isFinite(hours)) {
    return money((rate * hours * 52) / 12);
  }
  return 0;
}

function lineItem(
  rawDescription: string,
  mismoIncomeType: MismoPaystubIncomeType,
  ytdAmount: number,
  currentAmount = 0,
  extras: Partial<PaystubEarningsLineItem> = {},
): PaystubEarningsLineItem {
  return {
    rawDescription,
    mismoIncomeType,
    isQualifyingBase: mismoIncomeType === 'BasePay',
    hours: extras.hours ?? null,
    rate: extras.rate ?? null,
    currentAmount: money(currentAmount),
    ytdHours: extras.ytdHours ?? null,
    ytdAmount: money(ytdAmount),
  };
}

function distinctOtherYtd(rsuYtd: number, otherYtd: number): number {
  if (!otherYtd) return 0;
  if (money(otherYtd) === money(rsuYtd)) return 0;
  return money(Math.max(0, otherYtd - rsuYtd));
}

export function mapPaystubToCanonical(input: PaystubCanonicalInput): MortgageDocumentPaystubParser {
  const frequency = normalizePaymentFrequencyType(input.paymentFrequencyType);
  const baseYtd = money(input.baseYtd);
  const overtimeYtd = money(input.overtimeYtd);
  const bonusYtd = money(input.bonusYtd);
  const commissionYtd = money(input.commissionYtd);
  const tipsYtd = money(input.tipsYtd);
  const rsuYtd = money(input.rsuYtd);
  const otherYtd = distinctOtherYtd(rsuYtd, money(input.otherYtd));
  const currentBase = money(input.currentBasePayAmount);
  const hourlyRate = moneyOrNull(input.hourlyRate);
  const weeklyHours = input.weeklyHours != null && Number.isFinite(input.weeklyHours) ? input.weeklyHours : null;

  const synthesized: PaystubEarningsLineItem[] = [];
  if (currentBase || baseYtd) {
    synthesized.push(
      lineItem('Base (regular, PTO, holiday, vacation, sick, differentials, retro)', 'BasePay', baseYtd, currentBase, {
        hours: weeklyHours,
        rate: hourlyRate,
      }),
    );
  }
  if (overtimeYtd) synthesized.push(lineItem('Overtime', 'Overtime', overtimeYtd));
  if (bonusYtd) synthesized.push(lineItem('Bonus', 'Bonus', bonusYtd));
  if (commissionYtd) synthesized.push(lineItem('Commission', 'Commissions', commissionYtd));
  if (tipsYtd) synthesized.push(lineItem('Tips', 'Tips', tipsYtd));
  if (rsuYtd) synthesized.push(lineItem('RSU / Stock Award', 'RestrictedStockUnits', rsuYtd));
  if (otherYtd) synthesized.push(lineItem('Other income', 'OtherIncome', otherYtd));

  return {
    documentMetadata: {
      employerName: input.employerName,
      employerAddress: input.employerAddress,
      employeeFirstName: input.employeeFirstName,
      employeeLastName: input.employeeLastName,
      employeeIdentifier: input.employeeIdentifier ?? null,
      payPeriodStartDate: input.payPeriodStartDate ?? null,
      payPeriodEndDate: input.payPeriodEndDate ?? null,
      payDate: input.payDate ?? null,
      paymentFrequencyType: frequency,
    },
    grossPaySummary: {
      currentGrossPayAmount: moneyOrNull(input.currentGrossPayAmount),
      ytdGrossPayAmount: moneyOrNull(input.ytdGrossPayAmount),
      currentNetPayAmount: moneyOrNull(input.currentNetPayAmount),
      ytdNetPayAmount: moneyOrNull(input.ytdNetPayAmount),
    },
    earningsLineItems: input.earningsLineItems?.length ? input.earningsLineItems : synthesized,
    deductions: input.deductions ?? [],
    taxes: input.taxes ?? [],
    calculatedUnderwritingSummary: {
      totalBasePayYTD: baseYtd,
      totalOvertimeYTD: overtimeYtd,
      totalBonusYTD: bonusYtd,
      totalCommissionYTD: commissionYtd,
      totalTipsYTD: tipsYtd,
      totalRsuYTD: rsuYtd,
      totalImputedNonCashYTD: money(input.imputedNonCashYtd),
      derivedCalculatedMonthlyBase: derivedCalculatedMonthlyBase(input),
    },
  };
}

export function canonicalPaystubFromFields(
  fields: PaystubFieldLike[],
  extras: Partial<PaystubCanonicalInput> = {},
): MortgageDocumentPaystubParser {
  const num = (id: string) => fields.find((field) => field.sourceFieldId === id)?.numericValue;
  const val = (id: string) => fields.find((field) => field.sourceFieldId === id)?.value?.trim();
  return mapPaystubToCanonical({
    employerName: val('ps-employer-name'),
    paymentFrequencyType: val('ps-pay-frequency'),
    hourlyRate: num('ps-hourly-rate'),
    weeklyHours: num('ps-hours-week'),
    currentBasePayAmount: num('ps-current-base'),
    baseYtd: num('ps-base-ytd'),
    overtimeYtd: num('ps-ot-ytd'),
    bonusYtd: num('ps-bonus-ytd'),
    commissionYtd: num('ps-commission-ytd'),
    tipsYtd: num('ps-tips-ytd'),
    rsuYtd: num('ps-rsu-ytd'),
    ...extras,
  });
}

type IncomeBucket = {
  category: string;
  incomeType: string;
  otherDescription?: string;
  monthly?: number;
  ytd: number;
};

function currentIncomeItemXml(bucket: IncomeBucket): string {
  const other = bucket.otherDescription
    ? `
                                                        <IncomeTypeOtherDescription>${esc(bucket.otherDescription)}</IncomeTypeOtherDescription>`
    : '';
  const monthly =
    bucket.monthly != null
      ? `
                                                        <CurrentIncomeMonthlyTotalAmount>${xmlMoney(bucket.monthly)}</CurrentIncomeMonthlyTotalAmount>`
      : '';
  return `
                                                <CURRENT_INCOME_ITEM>
                                                    <CURRENT_INCOME_ITEM_DETAIL>${monthly}
                                                        <EmploymentIncomeCategoryType>${esc(bucket.category)}</EmploymentIncomeCategoryType>
                                                        <IncomeType>${esc(bucket.incomeType)}</IncomeType>${other}
                                                    </CURRENT_INCOME_ITEM_DETAIL>
                                                    <VERIFICATION_OF_EMPLOYMENT_DETAIL>
                                                        <YearToDateAmount>${xmlMoney(bucket.ytd)}</YearToDateAmount>
                                                    </VERIFICATION_OF_EMPLOYMENT_DETAIL>
                                                </CURRENT_INCOME_ITEM>`;
}

export function generatePaystubCurrentIncomeItemsXml(document: MortgageDocumentPaystubParser): string {
  const summary = document.calculatedUnderwritingSummary;
  const otherYtd = document.earningsLineItems
    .filter((item) => item.mismoIncomeType === 'OtherIncome')
    .reduce((total, item) => total + item.ytdAmount, 0);
  const buckets: IncomeBucket[] = [
    {
      category: 'BasePay',
      incomeType: 'BasePay',
      monthly: summary.derivedCalculatedMonthlyBase,
      ytd: summary.totalBasePayYTD,
    },
    { category: 'Overtime', incomeType: 'Overtime', ytd: summary.totalOvertimeYTD },
    { category: 'Bonus', incomeType: 'Bonus', ytd: summary.totalBonusYTD },
    { category: 'Commission', incomeType: 'Commissions', ytd: summary.totalCommissionYTD },
    { category: 'Other', incomeType: 'Other', otherDescription: 'Tips', ytd: summary.totalTipsYTD },
    {
      category: 'Other',
      incomeType: 'Other',
      otherDescription: 'RestrictedStockUnits',
      ytd: summary.totalRsuYTD,
    },
  ];
  if (otherYtd > 0) {
    buckets.push({ category: 'Other', incomeType: 'Other', otherDescription: 'OtherIncome', ytd: otherYtd });
  }
  return `
                                            <CURRENT_INCOME>
                                            <CURRENT_INCOME_ITEMS>${buckets.map(currentIncomeItemXml).join('')}
                                            </CURRENT_INCOME_ITEMS>
                                            </CURRENT_INCOME>`.trim();
}

export function generatePaystubMismo34Message(document: MortgageDocumentPaystubParser): string {
  const meta = document.documentMetadata;
  const frequency = meta.paymentFrequencyType ?? 'SemiMonthly';
  const employer = esc(meta.employerName ?? '');
  const firstName = esc(meta.employeeFirstName ?? '');
  const lastName = esc(meta.employeeLastName ?? '');
  const income = generatePaystubCurrentIncomeItemsXml(document);
  return `<?xml version="1.0" encoding="UTF-8"?>
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" MISMOReferenceModelIdentifier="3.4.032420160128">
    <DEAL_SETS>
        <DEAL_SET>
            <DEALS>
                <DEAL>
                    <PARTIES>
                        <PARTY>
                            <INDIVIDUAL>
                                <NAME>
                                    <FirstName>${firstName}</FirstName>
                                    <LastName>${lastName}</LastName>
                                </NAME>
                            </INDIVIDUAL>
                            <ROLES>
                                <ROLE>
                                    <BORROWER>
                                        <EMPLOYERS>
                                            <EMPLOYER>
                                                <LEGAL_ENTITY>
                                                    <LEGAL_ENTITY_DETAIL>
                                                        <FullName>${employer}</FullName>
                                                    </LEGAL_ENTITY_DETAIL>
                                                </LEGAL_ENTITY>
                                                <EMPLOYMENT>
                                                    <EmploymentClassificationType>Primary</EmploymentClassificationType>
                                                    <EmploymentStatusType>Current</EmploymentStatusType>
                                                    <PaymentFrequencyType>${esc(frequency)}</PaymentFrequencyType>
                                                </EMPLOYMENT>
                                            </EMPLOYER>
                                        </EMPLOYERS>
                                        ${income}
                                    </BORROWER>
                                    <ROLE_DETAIL>
                                        <PartyRoleType>Borrower</PartyRoleType>
                                    </ROLE_DETAIL>
                                </ROLE>
                            </ROLES>
                        </PARTY>
                    </PARTIES>
                </DEAL>
            </DEALS>
        </DEAL_SET>
    </DEAL_SETS>
</MESSAGE>
`;
}
