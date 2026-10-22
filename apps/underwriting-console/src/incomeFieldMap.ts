import type { MappedIncomeField, OverlayBox, ParsePage, ParseResponse, ParseWord, ScheduleEPropertyExtract, ReviewNote, W2BoxExtract } from './parseTypes';
import {
  PAYSTUB_YTD_FIELD_BY_KIND,
  isPrimaryRateRow,
  paystubFrequencyType,
  paystubHoursBeforeRate,
  paystubPaysPerYear,
  paystubRowKind,
  weeklyHoursFromPeriod,
  type PaystubRowKind,
} from './paystubRowRules';

export type IncomeForm = 'W-2' | 'Paystub' | 'WVOE' | 'Schedule B' | 'Schedule C' | 'Schedule D' | 'Schedule E' | 'Schedule F' | 'Form 1040' | 'Form 1120-S' | 'Form 1065' | 'Form 1120' | 'Form 8825';

export type IncomeFieldDef = {
  id: string;
  form: IncomeForm;
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: 'wages' | 'withholding' | 'income' | 'addback' | 'mileage' | 'rental' | 'property' | 'identity' | 'asset' | 'farm';
  patterns: RegExp[];
  /** How the value is extracted from a matched line. Defaults to 'money'. */
  capture?: 'money' | 'money_last' | 'integer' | 'text' | 'percent' | 'ein';
};

const MONEY = /(?:\$\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}|\((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\))/;
// Last standalone integer on the line (values sit at the right edge on tax forms)
const TRAILING_INT = /(\d{1,3}(?:,\d{3})+|\d+)\s*$/;
// All percentage tokens on a line. K-1 Item J prints Beginning then Ending columns,
// so the LAST match is the end-of-year percentage used to qualify.
const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*%/g;

export const W2_FIELD_DEFS: IncomeFieldDef[] = [
  {
    id: 'w2-employer-name',
    form: 'W-2',
    boxLabel: 'Box c',
    fieldLabel: 'Employer Name',
    lineNum: 'Box c',
    category: 'identity',
    capture: 'text',
    patterns: [/employer(?:['’]s)? name(?:,?\s*address(?:\s*,?\s*and\s+zip\s*code)?)?\s*[:#–—-]?\s*/i, /\bc\s+employer/i],
  },
  {
    id: 'w2-employee-name',
    form: 'W-2',
    boxLabel: 'Box e',
    fieldLabel: 'Employee Name',
    lineNum: 'Box e',
    category: 'identity',
    capture: 'text',
    patterns: [/employee(?:['’]s)?\s+(?:first\s+)?name/i],
  },
  {
    id: 'w2-employer-ein',
    form: 'W-2',
    boxLabel: 'Box b',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'Box b',
    category: 'identity',
    capture: 'ein',
    patterns: [/employer(?:'s)? identification number(?:\s*\(ein\))?\s*[:#–—-]?\s*/i, /\bb\s+employer/i],
  },
  {
    id: 'w2-box2',
    form: 'W-2',
    boxLabel: 'Box 2',
    fieldLabel: 'Federal Income Tax Withheld',
    lineNum: 'Box 2',
    category: 'withholding',
    patterns: [/box\s*2\b.{0,80}federal/i, /\b2\b.{0,24}federal income tax/i],
  },
  {
    id: 'w2-box3',
    form: 'W-2',
    boxLabel: 'Box 3',
    fieldLabel: 'Social Security Wages',
    lineNum: 'Box 3',
    category: 'wages',
    patterns: [/box\s*3\b.{0,80}social/i, /\b3\b.{0,24}social security wages/i],
  },
  {
    id: 'w2-box4',
    form: 'W-2',
    boxLabel: 'Box 4',
    fieldLabel: 'Social Security Tax Withheld (6.2%)',
    lineNum: 'Box 4',
    category: 'withholding',
    patterns: [/box\s*4\b.{0,80}social/i, /\b4\b.{0,24}social security tax/i],
  },
  {
    id: 'w2-box5',
    form: 'W-2',
    boxLabel: 'Box 5',
    fieldLabel: 'Medicare Wages and Tips',
    lineNum: 'Box 5',
    category: 'wages',
    patterns: [/box\s*5\b.{0,80}medicare/i, /\b5\b.{0,24}medicare wages/i, /medicare wages(?:\s+and\s+tips)?/i],
  },
  {
    id: 'w2-box6',
    form: 'W-2',
    boxLabel: 'Box 6',
    fieldLabel: 'Medicare Tax Withheld (1.45%)',
    lineNum: 'Box 6',
    category: 'withholding',
    patterns: [/box\s*6\b.{0,80}medicare/i, /\b6\b.{0,24}medicare tax/i],
  },
];

export const SCHEDULE_C_DEFS: IncomeFieldDef[] = [
  {
    id: 'ent1-name',
    form: 'Schedule C',
    boxLabel: 'Line C',
    fieldLabel: 'Business Name',
    lineNum: 'Line C',
    category: 'identity',
    capture: 'text',
    patterns: [/\bc\s+business name/i, /business name\.?\s+if no separate/i],
  },
  {
    id: 'ent1-ein',
    form: 'Schedule C',
    boxLabel: 'Line B',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'Line B',
    category: 'identity',
    capture: 'ein',
    patterns: [/\bb\s+employer(?:['’]s)? (?:id|identification)/i, /employer(?:['’]s)? identification number/i],
  },
  {
    id: 'ent1-net',
    form: 'Schedule C',
    boxLabel: 'Line 31',
    fieldLabel: 'Net Profit or Loss (Line 31)',
    lineNum: 'Line 31',
    category: 'income',
    patterns: [/line\s*31\b.{0,80}(net profit|loss)/i, /net profit or loss.{0,40}\d/i],
  },
  {
    id: 'ent1-dep',
    form: 'Schedule C',
    boxLabel: 'Line 13',
    fieldLabel: 'Depreciation Expense (Line 13)',
    lineNum: 'Line 13',
    category: 'addback',
    patterns: [/line\s*13\b.{0,80}depreciation/i, /line\s*13\b/i],
  },
  {
    id: 'ent1-miles',
    form: 'Schedule C',
    boxLabel: 'Line 44a',
    fieldLabel: 'Business Miles Driven (Line 44a)',
    lineNum: 'Line 44a',
    category: 'mileage',
    patterns: [/line\s*44a\b.{0,80}(miles|add-?back)/i, /business miles.{0,40}\d/i],
  },
  {
    id: 'ent1-depletion',
    form: 'Schedule C',
    boxLabel: 'Line 12',
    fieldLabel: 'Depletion (Line 12)',
    lineNum: 'Line 12',
    category: 'addback',
    patterns: [/line\s*12\b.{0,80}depletion/i, /\b12\b\s+depletion/i],
  },
  {
    id: 'ent1-meals',
    form: 'Schedule C',
    boxLabel: 'Line 24b',
    fieldLabel: 'Meals Exclusion (Line 24b)',
    lineNum: 'Line 24b',
    category: 'addback',
    patterns: [/line\s*24b\b.{0,80}meals/i, /deductible meals/i],
  },
  {
    id: 'ent1-home',
    form: 'Schedule C',
    boxLabel: 'Line 30',
    fieldLabel: 'Business Use of Home (Line 30)',
    lineNum: 'Line 30',
    category: 'addback',
    patterns: [/line\s*30\b.{0,80}home/i, /business use of your home/i],
  },
  {
    id: 'ent1-other-income',
    form: 'Schedule C',
    boxLabel: 'Line 6',
    fieldLabel: 'Other Income (Line 6)',
    lineNum: 'Line 6',
    category: 'income',
    patterns: [/line\s*6\b.{0,80}other income/i, /other income, including federal/i],
  },
  {
    id: 'ent1-amort',
    form: 'Schedule C',
    boxLabel: 'Line 27a',
    fieldLabel: 'Amortization / Casualty (Line 27a)',
    lineNum: 'Line 27a',
    category: 'addback',
    patterns: [/line\s*27a\b.{0,80}other expenses/i, /amortization/i],
  },
];

export const SCHEDULE_B_DEFS: IncomeFieldDef[] = [
  {
    id: 'schedule-b-interest',
    form: 'Schedule B',
    boxLabel: 'Part I · Line 4',
    fieldLabel: 'Taxable Interest Income',
    lineNum: 'Line 4',
    category: 'asset',
    patterns: [/line\s*4\b.{0,80}(?:taxable\s+)?interest/i, /total\s+interest.{0,40}\d/i],
  },
  {
    id: 'schedule-b-dividends',
    form: 'Schedule B',
    boxLabel: 'Part II · Line 6',
    fieldLabel: 'Ordinary Dividend Income',
    lineNum: 'Line 6',
    category: 'asset',
    patterns: [/line\s*6\b.{0,80}(?:ordinary\s+)?dividends?/i, /total\s+ordinary\s+dividends?.{0,40}\d/i],
  },
];

export const SCHEDULE_D_DEFS: IncomeFieldDef[] = [
  {
    id: 'schedule-d-capital-gain-loss',
    form: 'Schedule D',
    boxLabel: 'Line 16',
    fieldLabel: 'Net Long/Short-Term Capital Gain or Loss',
    lineNum: 'Line 16',
    category: 'asset',
    patterns: [/line\s*16\b.{0,80}(?:capital\s+)?gain|line\s*16\b.{0,80}loss/i, /combine lines 7 and 15.{0,60}\d/i],
  },
];

export const SCHEDULE_F_DEFS: IncomeFieldDef[] = [
  {
    id: 'schedule-f-name',
    form: 'Schedule F',
    boxLabel: 'Line C',
    fieldLabel: 'Farm Name',
    lineNum: 'Line C',
    category: 'identity',
    capture: 'text',
    patterns: [/\bc\s+farm name/i, /farm name/i],
  },
  {
    id: 'schedule-f-ein',
    form: 'Schedule F',
    boxLabel: 'EIN',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'EIN',
    category: 'identity',
    capture: 'ein',
    patterns: [/\bb\s+employer(?:['’]s)? (?:id|identification)/i, /employer(?:['’]s)? identification number/i],
  },
  {
    id: 'schedule-f-net',
    form: 'Schedule F',
    boxLabel: 'Line 34',
    fieldLabel: 'Net Farm Profit or Loss',
    lineNum: 'Line 34',
    category: 'farm',
    patterns: [/line\s*34\b.{0,80}net farm profit|net farm profit or loss.{0,40}\d/i],
  },
  {
    id: 'schedule-f-coop-ccc',
    form: 'Schedule F',
    boxLabel: 'Lines 3, 4, 6',
    fieldLabel: 'Cooperative / CCC Payments',
    lineNum: 'Lines 3, 4, 6',
    category: 'farm',
    patterns: [/(?:cooperative distributions|commodity credit corporation|ccc loans?).{0,60}\d/i],
  },
  {
    id: 'schedule-f-other',
    form: 'Schedule F',
    boxLabel: 'Lines 5c & 8',
    fieldLabel: 'Other Farm Income',
    lineNum: 'Lines 5c & 8',
    category: 'farm',
    patterns: [/(?:line\s*(?:5c|8)\b.{0,60})?other income.{0,40}\d/i],
  },
  {
    id: 'schedule-f-depreciation',
    form: 'Schedule F',
    boxLabel: 'Line 14',
    fieldLabel: 'Depreciation',
    lineNum: 'Line 14',
    category: 'addback',
    patterns: [/line\s*14\b.{0,80}depreciation|depreciation and section 179.{0,40}\d/i],
  },
  {
    id: 'schedule-f-other-expense',
    form: 'Schedule F',
    boxLabel: 'Line 32',
    fieldLabel: 'Other Expenses / Form 1084 Add-Back Support',
    lineNum: 'Line 32',
    category: 'addback',
    patterns: [/line\s*32\b.{0,80}other expenses|other expenses.{0,40}\d/i],
  },
  {
    id: 'schedule-f-home',
    form: 'Schedule F',
    boxLabel: 'Line 32',
    fieldLabel: 'Business Use of Home',
    lineNum: 'Line 32',
    category: 'addback',
    patterns: [/business use of your home/i],
  },
  {
    id: 'schedule-f-amort',
    form: 'Schedule F',
    boxLabel: 'Add-back',
    fieldLabel: 'Amortization / Casualty / Depletion',
    lineNum: 'Add-back',
    category: 'addback',
    patterns: [/\bamortization\b/i, /\bcasualty\b/i],
  },
];

/**
 * Full Schedule E Page 1 capture set for the Form 1084 rental worksheet:
 * property identity (address, type, fair rental days) plus every line item
 * used in the calculation (L3, L9, L12, L16, L18, L19 HOA, L20).
 */
export const SCHEDULE_E_DEFS: IncomeFieldDef[] = [
  {
    id: 'ent2-address',
    form: 'Schedule E',
    boxLabel: 'Line 1a',
    fieldLabel: 'Property Address (Line 1a)',
    lineNum: 'Line 1a',
    category: 'property',
    capture: 'text',
    patterns: [/(?:line\s*)?1a\b.{0,60}(physical\s+)?address/i, /physical address of each property/i],
  },
  {
    id: 'ent2-type',
    form: 'Schedule E',
    boxLabel: 'Line 1b',
    fieldLabel: 'Type of Property (Line 1b)',
    lineNum: 'Line 1b',
    category: 'property',
    capture: 'integer',
    patterns: [/(?:line\s*)?1b\b.{0,60}type of property/i, /type of property.{0,40}\d/i],
  },
  {
    id: 'ent2-days',
    form: 'Schedule E',
    boxLabel: 'Line 2',
    fieldLabel: 'Fair Rental Days (Line 2)',
    lineNum: 'Line 2',
    category: 'property',
    capture: 'integer',
    patterns: [/(?:line\s*)?2\b.{0,60}fair rental days/i, /fair rental days.{0,40}\d/i],
  },
  {
    id: 'ent2-rent',
    form: 'Schedule E',
    boxLabel: 'Line 3',
    fieldLabel: 'Rents Received (Line 3)',
    lineNum: 'Line 3',
    category: 'rental',
    patterns: [/line\s*3\b.{0,80}rents?\s+received/i, /rents?\s+received.{0,40}\d/i],
  },
  {
    id: 'ent2-ins',
    form: 'Schedule E',
    boxLabel: 'Line 9',
    fieldLabel: 'Insurance (Line 9)',
    lineNum: 'Line 9',
    category: 'addback',
    patterns: [/line\s*9\b.{0,60}insurance/i, /\b9\b\s+insurance.{0,40}\d/i, /\binsurance\b.{0,40}\d/i],
  },
  {
    id: 'ent2-int',
    form: 'Schedule E',
    boxLabel: 'Line 12',
    fieldLabel: 'Mortgage Interest (Line 12)',
    lineNum: 'Line 12',
    category: 'addback',
    patterns: [/line\s*12\b.{0,80}mortgage interest/i, /mortgage interest paid to banks.{0,40}\d/i, /\b12\b\s+mortgage interest/i],
  },
  {
    id: 'ent2-tax',
    form: 'Schedule E',
    boxLabel: 'Line 16',
    fieldLabel: 'Taxes (Line 16)',
    lineNum: 'Line 16',
    category: 'addback',
    patterns: [/line\s*16\b.{0,60}taxes/i, /\b16\b\s+taxes.{0,40}\d/i],
  },
  {
    id: 'ent2-dep',
    form: 'Schedule E',
    boxLabel: 'Line 18',
    fieldLabel: 'Rental Depreciation (Line 18)',
    lineNum: 'Line 18',
    category: 'addback',
    patterns: [/line\s*18\b.{0,80}depreciation/i, /rental depreciation.{0,40}\d/i, /\b18\b\s+depreciation/i],
  },
  {
    id: 'ent2-hoa',
    form: 'Schedule E',
    boxLabel: 'Line 19',
    fieldLabel: 'HOA / Association Dues (Line 19)',
    lineNum: 'Line 19',
    category: 'addback',
    // HOA rarely has its own labeled line — search the whole return for HOA /
    // homeowners-association wording (usually itemized under Line 19 "Other")
    // so it can be associated back to the property's Schedule E page.
    patterns: [
      /line\s*19\b.{0,80}(hoa|homeowners?|association)/i,
      /\bhoa\b(?:\s+(dues|fees))?.{0,40}\d/i,
      /homeowners?\s+association(?:\s+(dues|fees))?.{0,40}\d/i,
      /association\s+(dues|fees).{0,40}\d/i,
    ],
  },
  {
    id: 'ent2-exp',
    form: 'Schedule E',
    boxLabel: 'Line 20',
    fieldLabel: 'Total Expenses (Line 20)',
    lineNum: 'Line 20',
    category: 'rental',
    patterns: [/line\s*20\b.{0,80}(total )?expenses/i, /total expenses.{0,40}\d/i],
  },
  {
    id: 'ent2-net',
    form: 'Schedule E',
    boxLabel: 'Line 21',
    fieldLabel: 'Net Income or (Loss) (Line 21)',
    lineNum: 'Line 21',
    category: 'rental',
    patterns: [/line\s*21\b.{0,80}(net income|total)/i, /net income or \(loss\).{0,40}\d/i, /\b21\b\s+total.{0,40}\d/i],
  },
];

/**
 * Schedule K-1 (Form 1120-S) capture set: income boxes 1–3, distributions
 * (Box 16 code D), and the shareholder's END-of-year stock ownership percentage.
 */
export const SCORP_DEFS: IncomeFieldDef[] = [
  {
    id: 'scorp-name',
    form: 'Form 1120-S',
    boxLabel: 'Box B',
    fieldLabel: "Corporation's Name",
    lineNum: 'Box B',
    category: 'identity',
    capture: 'text',
    patterns: [/corporation(?:['’]s)? name/i],
  },
  {
    id: 'scorp-ein',
    form: 'Form 1120-S',
    boxLabel: 'Box A',
    fieldLabel: "Corporation's EIN",
    lineNum: 'Box A',
    category: 'identity',
    capture: 'ein',
    patterns: [/corporation(?:['’]s)? employer identification number/i],
  },
  {
    id: 'scorp-ord',
    form: 'Form 1120-S',
    boxLabel: 'Box 1',
    fieldLabel: 'Ordinary Business Income',
    lineNum: 'Box 1',
    category: 'income',
    patterns: [/ordinary business income/i, /box\s*1\b.{0,40}ordinary/i],
  },
  {
    id: 'scorp-rre',
    form: 'Form 1120-S',
    boxLabel: 'Box 2',
    fieldLabel: 'Net Rental Real Estate Income',
    lineNum: 'Box 2',
    category: 'income',
    patterns: [/net rental real estate/i, /box\s*2\b.{0,40}rental/i],
  },
  {
    id: 'scorp-onr',
    form: 'Form 1120-S',
    boxLabel: 'Box 3',
    fieldLabel: 'Other Net Rental Income',
    lineNum: 'Box 3',
    category: 'income',
    patterns: [/other net rental income/i, /box\s*3\b.{0,40}rental/i],
  },
  {
    id: 'scorp-dist',
    form: 'Form 1120-S',
    boxLabel: 'Box 16D',
    fieldLabel: 'Distributions (Box 16 Code D)',
    lineNum: 'Box 16D',
    category: 'income',
    patterns: [/box\s*16\b.{0,60}(distribution|code\s*d)/i, /\bdistributions?\b.{0,40}\d/i],
  },
  {
    id: 'scorp-own-pct',
    form: 'Form 1120-S',
    boxLabel: 'Item',
    fieldLabel: 'End-of-Year Stock Ownership %',
    lineNum: 'Ownership %',
    category: 'income',
    capture: 'percent',
    patterns: [/percentage of stock ownership/i, /current year allocation percentage/i, /stock ownership.{0,40}%/i],
  },
  {
    id: 'scorp-179',
    form: 'Form 1120-S',
    boxLabel: 'Box 11',
    fieldLabel: 'Section 179 Deduction',
    lineNum: 'Box 11',
    category: 'addback',
    patterns: [/section\s*179\s+deduction/i, /box\s*11\b.{0,40}section\s*179/i],
  },
  {
    id: 'scorp-depletion',
    form: 'Form 1120-S',
    boxLabel: 'Box 15c',
    fieldLabel: 'Depletion',
    lineNum: 'Box 15c',
    category: 'addback',
    patterns: [/\bdepletion\b/i],
  },
  {
    id: 'scorp-meals',
    form: 'Form 1120-S',
    boxLabel: 'M-1',
    fieldLabel: 'Non-Deductible Meals',
    lineNum: 'M-1',
    category: 'addback',
    patterns: [/travel and entertainment/i, /meals and entertainment/i],
  },
];

/**
 * Schedule K-1 (Form 1065) capture set: income boxes 1–4, distributions (Box 19
 * code A), and BOTH Item J end-of-year percentages — Freddie Mac qualifies on the
 * ending PROFIT %, FNMA on the ending CAPITAL %. Beginning-of-year figures are
 * never used; the percent capture takes the last (Ending column) value on the line.
 */
export const PARTNERSHIP_DEFS: IncomeFieldDef[] = [
  {
    id: 'pt-name',
    form: 'Form 1065',
    boxLabel: 'Box B',
    fieldLabel: "Partnership's Name",
    lineNum: 'Box B',
    category: 'identity',
    capture: 'text',
    patterns: [/partnership(?:['’]s)? name/i],
  },
  {
    id: 'pt-ein',
    form: 'Form 1065',
    boxLabel: 'Box A',
    fieldLabel: "Partnership's EIN",
    lineNum: 'Box A',
    category: 'identity',
    capture: 'ein',
    patterns: [/partnership(?:['’]s)? employer identification number/i],
  },
  {
    id: 'pt-ord',
    form: 'Form 1065',
    boxLabel: 'Box 1',
    fieldLabel: 'Ordinary Business Income',
    lineNum: 'Box 1',
    category: 'income',
    patterns: [/ordinary business income/i, /box\s*1\b.{0,40}ordinary/i],
  },
  {
    id: 'pt-rre',
    form: 'Form 1065',
    boxLabel: 'Box 2',
    fieldLabel: 'Net Rental Real Estate Income',
    lineNum: 'Box 2',
    category: 'income',
    patterns: [/net rental real estate/i, /box\s*2\b.{0,40}rental/i],
  },
  {
    id: 'pt-onr',
    form: 'Form 1065',
    boxLabel: 'Box 3',
    fieldLabel: 'Other Net Rental Income',
    lineNum: 'Box 3',
    category: 'income',
    patterns: [/other net rental income/i, /box\s*3\b.{0,40}rental/i],
  },
  {
    id: 'pt-gp',
    form: 'Form 1065',
    boxLabel: 'Box 4',
    fieldLabel: 'Guaranteed Payments',
    lineNum: 'Box 4',
    category: 'income',
    patterns: [/guaranteed payments?/i, /box\s*4\b.{0,40}guaranteed/i],
  },
  {
    id: 'pt-dist',
    form: 'Form 1065',
    boxLabel: 'Box 19A',
    fieldLabel: 'Distributions (Box 19 Code A)',
    lineNum: 'Box 19A',
    category: 'income',
    patterns: [/box\s*19\b.{0,60}(distribution|code\s*a)/i, /\bdistributions?\b.{0,40}\d/i],
  },
  {
    id: 'pt-profit-pct',
    form: 'Form 1065',
    boxLabel: 'Item J',
    fieldLabel: 'End-of-Year Profit % (Freddie Mac)',
    lineNum: 'Item J · Profit',
    category: 'income',
    capture: 'percent',
    patterns: [/item\s*j.{0,80}profit/i, /profit\s*(?:share|interest)?.{0,40}%/i, /ending.{0,20}profit.{0,20}%/i],
  },
  {
    id: 'pt-capital-pct',
    form: 'Form 1065',
    boxLabel: 'Item J',
    fieldLabel: 'End-of-Year Capital % (FNMA)',
    lineNum: 'Item J · Capital',
    category: 'income',
    capture: 'percent',
    patterns: [/item\s*j.{0,80}capital/i, /capital\s*(?:account|share)?.{0,40}%/i, /ending.{0,20}capital.{0,20}%/i],
  },
  {
    id: 'pt-179',
    form: 'Form 1065',
    boxLabel: 'Box 12',
    fieldLabel: 'Section 179 Deduction',
    lineNum: 'Box 12',
    category: 'addback',
    patterns: [/section\s*179\s+deduction/i, /box\s*12\b.{0,40}section\s*179/i],
  },
  {
    id: 'pt-depletion',
    form: 'Form 1065',
    boxLabel: 'Box 17',
    fieldLabel: 'Depletion',
    lineNum: 'Box 17',
    category: 'addback',
    patterns: [/\bdepletion\b/i],
  },
  {
    id: 'pt-meals',
    form: 'Form 1065',
    boxLabel: 'M-1',
    fieldLabel: 'Non-Deductible Meals',
    lineNum: 'M-1',
    category: 'addback',
    patterns: [/travel and entertainment/i, /meals and entertainment/i],
  },
];

export const PAYSTUB_DEFS: IncomeFieldDef[] = [
  {
    id: 'ps-employer-name',
    form: 'Paystub',
    boxLabel: 'Employer',
    fieldLabel: 'Employer Name',
    lineNum: 'Employer',
    category: 'identity',
    capture: 'text',
    patterns: [/employer(?:['’]s)?(?:\s+name)?\s*[:#–—-]?\s*/i, /company\s*[:#–—-]?\s*/i],
  },
  {
    id: 'ps-employee-name',
    form: 'Paystub',
    boxLabel: 'Employee',
    fieldLabel: 'Employee Name',
    lineNum: 'Employee',
    category: 'identity',
    capture: 'text',
    patterns: [/employee(?:['’]s)?\s+name\s*[:#–—-]?\s*/i, /employee\s*[:#–—-]\s*/i],
  },
  {
    id: 'ps-pay-frequency',
    form: 'Paystub',
    boxLabel: 'Frequency',
    fieldLabel: 'Pay Frequency',
    lineNum: 'Frequency',
    category: 'identity',
    capture: 'text',
    patterns: [/pay\s+frequency\s*[:#–—-]?\s*/i],
  },
  {
    id: 'ps-hourly-rate',
    form: 'Paystub',
    boxLabel: 'Rate',
    fieldLabel: 'Hourly Rate of Pay',
    lineNum: 'Rate',
    category: 'wages',
    patterns: [/hourly\s+(rate|pay)/i, /rate\s+of\s+pay/i, /base\s+rate/i],
  },
  {
    id: 'ps-hours-week',
    form: 'Paystub',
    boxLabel: 'Hours',
    fieldLabel: 'Standard Weekly Hours',
    lineNum: 'Hours',
    category: 'wages',
    patterns: [/hr\/wk|hours?\s*\/\s*wk|weekly\s+hours/i],
  },
  {
    id: 'ps-current-base',
    form: 'Paystub',
    boxLabel: 'Current',
    fieldLabel: 'Current Period Base Pay',
    lineNum: 'Current',
    category: 'wages',
    patterns: [/current\s+(period|earnings|pay)\s+(?:base|regular)/i, /this\s+period\s+(?:base|regular|pay)/i],
  },
  {
    id: 'ps-base-ytd',
    form: 'Paystub',
    boxLabel: 'YTD',
    fieldLabel: 'Base Wages YTD',
    lineNum: 'YTD',
    category: 'wages',
    patterns: [/ytd\s+(base|regular)\b/i, /(base|regular)\s+wages?\s+ytd/i, /year[- ]to[- ]date\s+(base|regular)/i],
  },
  {
    id: 'ps-bonus-ytd',
    form: 'Paystub',
    boxLabel: 'Bonus YTD',
    fieldLabel: 'Bonus Income YTD',
    lineNum: 'Bonus',
    category: 'wages',
    patterns: [/bonus.{0,20}ytd|ytd.{0,20}bonus/i],
  },
  {
    id: 'ps-ot-ytd',
    form: 'Paystub',
    boxLabel: 'OT YTD',
    fieldLabel: 'Overtime Income YTD',
    lineNum: 'OT',
    category: 'wages',
    patterns: [/overtime.{0,20}ytd|ytd.{0,20}overtime/i],
  },
  {
    id: 'ps-tips-ytd',
    form: 'Paystub',
    boxLabel: 'Tips YTD',
    fieldLabel: 'Tips YTD',
    lineNum: 'Tips',
    category: 'wages',
    patterns: [/\btips?\b.{0,20}ytd|ytd.{0,20}\btips?\b/i],
  },
  {
    id: 'ps-commission-ytd',
    form: 'Paystub',
    boxLabel: 'Commission YTD',
    fieldLabel: 'Commission YTD',
    lineNum: 'Commission',
    category: 'wages',
    patterns: [/commission.{0,20}ytd|ytd.{0,20}commission/i],
  },
  {
    id: 'ps-rsu-ytd',
    form: 'Paystub',
    boxLabel: 'RSU YTD',
    fieldLabel: 'RSU / Stock Award YTD',
    lineNum: 'RSU',
    category: 'wages',
    patterns: [/\brsu\b|restricted\s+stock|stock\s+unit|stock\s+award/i],
  },
];

export const WVOE_DEFS: IncomeFieldDef[] = [
  {
    id: 'wvoe-base',
    form: 'WVOE',
    boxLabel: 'Base',
    fieldLabel: 'WVOE Base Pay',
    lineNum: 'Base',
    category: 'wages',
    patterns: [/base\s+pay/i, /current\s+base/i],
  },
  {
    id: 'wvoe-bonus',
    form: 'WVOE',
    boxLabel: 'Bonus',
    fieldLabel: 'WVOE Bonus History',
    lineNum: 'Bonus',
    category: 'wages',
    patterns: [/bonus/i, /commission/i],
  },
  {
    id: 'wvoe-ot',
    form: 'WVOE',
    boxLabel: 'OT',
    fieldLabel: 'WVOE Overtime History',
    lineNum: 'OT',
    category: 'wages',
    patterns: [/overtime/i],
  },
];

export const FORM_1120_DEFS: IncomeFieldDef[] = [
  {
    id: 'c1120-name',
    form: 'Form 1120',
    boxLabel: 'Name',
    fieldLabel: 'Corporation Name',
    lineNum: 'Name',
    category: 'identity',
    capture: 'text',
    patterns: [/name of corporation/i, /legal name of corporation/i],
  },
  {
    id: 'c1120-ein',
    form: 'Form 1120',
    boxLabel: 'EIN',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'EIN',
    category: 'identity',
    capture: 'ein',
    patterns: [/employer identification number/i],
  },
  {
    id: 'c1120-taxable',
    form: 'Form 1120',
    boxLabel: 'Line 30',
    fieldLabel: 'Taxable Income',
    lineNum: 'Line 30',
    category: 'income',
    patterns: [/taxable income/i],
  },
  {
    id: 'c1120-tax',
    form: 'Form 1120',
    boxLabel: 'Line 31',
    fieldLabel: 'Total Tax',
    lineNum: 'Line 31',
    category: 'income',
    patterns: [/total tax/i],
  },
  {
    id: 'c1120-dep',
    form: 'Form 1120',
    boxLabel: 'Line 20',
    fieldLabel: 'Depreciation',
    lineNum: 'Line 20',
    category: 'addback',
    patterns: [/line\s*20\b.{0,80}depreciation/i, /\b20\b\s+depreciation/i],
  },
  {
    id: 'c1120-depletion',
    form: 'Form 1120',
    boxLabel: 'Line 21',
    fieldLabel: 'Depletion',
    lineNum: 'Line 21',
    category: 'addback',
    patterns: [/line\s*21\b.{0,80}depletion/i, /\b21\b\s+depletion/i],
  },
  {
    id: 'c1120-amort',
    form: 'Form 1120',
    boxLabel: 'Line 26',
    fieldLabel: 'Amortization',
    lineNum: 'Line 26',
    category: 'addback',
    patterns: [/line\s*26\b.{0,80}other deductions/i, /\bamortization\b/i],
  },
  {
    id: 'c1120-meals',
    form: 'Form 1120',
    boxLabel: 'M-1',
    fieldLabel: 'Non-Deductible Meals',
    lineNum: 'M-1',
    category: 'addback',
    patterns: [/travel and entertainment/i, /meals and entertainment/i],
  },
  {
    id: 'c1120-nol',
    form: 'Form 1120',
    boxLabel: 'Line 29b',
    fieldLabel: 'NOL / Special Deductions',
    lineNum: 'Line 29b',
    category: 'addback',
    patterns: [/line\s*29b\b.{0,80}special deductions/i, /net operating loss/i],
  },
];

export const FORM_1040_DEFS: IncomeFieldDef[] = [
  {
    id: 'f1040-wages',
    form: 'Form 1040',
    boxLabel: 'Line 1z',
    fieldLabel: 'Wages, Salaries, Tips',
    lineNum: 'Line 1z',
    category: 'wages',
    patterns: [/1z\s+add lines 1a through 1h/i, /wages, salaries, tips/i],
  },
  {
    id: 'f1040-ss-total',
    form: 'Form 1040',
    boxLabel: 'Line 6a',
    fieldLabel: 'Social Security Benefits',
    lineNum: 'Line 6a',
    category: 'income',
    patterns: [/social security benefits/i],
  },
  {
    id: 'f1040-ss-taxable',
    form: 'Form 1040',
    boxLabel: 'Line 6b',
    fieldLabel: 'Taxable Social Security',
    lineNum: 'Line 6b',
    category: 'income',
    patterns: [/line\s*6b\b.{0,80}taxable/i],
  },
  {
    id: 'f1040-ira-total',
    form: 'Form 1040',
    boxLabel: 'Line 4a',
    fieldLabel: 'IRA Distributions',
    lineNum: 'Line 4a',
    category: 'income',
    patterns: [/IRA distributions/i],
  },
  {
    id: 'f1040-ira-taxable',
    form: 'Form 1040',
    boxLabel: 'Line 4b',
    fieldLabel: 'Taxable IRA Distributions',
    lineNum: 'Line 4b',
    category: 'income',
    patterns: [/line\s*4b\b.{0,80}taxable/i],
  },
  {
    id: 'f1040-pensions-total',
    form: 'Form 1040',
    boxLabel: 'Line 5a',
    fieldLabel: 'Pensions and Annuities',
    lineNum: 'Line 5a',
    category: 'income',
    patterns: [/pensions and annuities/i],
  },
  {
    id: 'f1040-pensions-taxable',
    form: 'Form 1040',
    boxLabel: 'Line 5b',
    fieldLabel: 'Taxable Pensions',
    lineNum: 'Line 5b',
    category: 'income',
    patterns: [/line\s*5b\b.{0,80}taxable/i],
  },
];

export const FORM_8825_DEFS: IncomeFieldDef[] = [
  {
    id: 'form-8825-name',
    form: 'Form 8825',
    boxLabel: 'Name',
    fieldLabel: 'Partnership or S Corporation Name',
    lineNum: 'Name',
    category: 'identity',
    capture: 'text',
    patterns: [/name of partnership or s corporation/i, /name of partnership/i, /name of s corporation/i],
  },
  {
    id: 'form-8825-ein',
    form: 'Form 8825',
    boxLabel: 'EIN',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'EIN',
    category: 'identity',
    capture: 'ein',
    patterns: [/employer identification number/i],
  },
  {
    id: 'form-8825-dep',
    form: 'Form 8825',
    boxLabel: 'Line 14',
    fieldLabel: 'Form 8825 Depreciation (Line 14)',
    lineNum: 'Line 14',
    category: 'addback',
    capture: 'money_last',
    patterns: [/line\s*14\b.{0,80}depreciation/i, /\b14\b\s+depreciation/i, /form\s+8825.{0,40}depreciation/i],
  },
  {
    id: 'form-8825-rents',
    form: 'Form 8825',
    boxLabel: 'Line 2',
    fieldLabel: 'Form 8825 Gross Rents (Line 2)',
    lineNum: 'Line 2',
    category: 'rental',
    capture: 'money_last',
    patterns: [/line\s*2\b.{0,80}gross rents/i, /gross rents/i],
  },
  {
    id: 'form-8825-total-exp',
    form: 'Form 8825',
    boxLabel: 'Line 16',
    fieldLabel: 'Form 8825 Total Expenses (Line 16)',
    lineNum: 'Line 16',
    category: 'rental',
    capture: 'money_last',
    patterns: [/line\s*16\b.{0,80}total expenses/i, /\b16\b\s+total expenses/i],
  },
  {
    id: 'form-8825-net',
    form: 'Form 8825',
    boxLabel: 'Line 21',
    fieldLabel: 'Form 8825 Net Income or Loss (Line 21)',
    lineNum: 'Line 21',
    category: 'rental',
    capture: 'money_last',
    patterns: [/line\s*21\b.{0,80}net income/i, /net income \(loss\)/i],
  },
];

export const FORM_4562_DEFS: IncomeFieldDef[] = [
  {
    id: 'form-4562-179',
    form: 'Form 1120-S',
    boxLabel: 'Line 12',
    fieldLabel: 'Form 4562 Section 179',
    lineNum: 'Line 12',
    category: 'addback',
    patterns: [/section\s*179\s+expense deduction/i, /line\s*12\b.{0,80}section\s*179/i],
  },
  {
    id: 'form-4562-dep',
    form: 'Form 1120-S',
    boxLabel: 'Line 22',
    fieldLabel: 'Form 4562 Depreciation',
    lineNum: 'Line 22',
    category: 'addback',
    patterns: [/total depreciation/i, /line\s*22\b.{0,80}depreciation/i],
  },
];

export const SCHEDULE_L_DEFS: IncomeFieldDef[] = [
  // money_last is column (d), the end-of-year balance. The first amount on the row is column (b).
  {
    id: 'sch-l-cash',
    form: 'Form 1120-S',
    boxLabel: 'Line 1',
    fieldLabel: 'Cash (End of Year)',
    lineNum: 'Line 1d',
    category: 'asset',
    capture: 'money_last',
    patterns: [/schedule\s*l.{0,40}\bcash\b/i, /\b1\b\s+cash\b/i],
  },
  {
    id: 'sch-l-ar',
    form: 'Form 1120-S',
    boxLabel: 'Line 2a',
    fieldLabel: 'Accounts Receivable (End of Year)',
    lineNum: 'Line 2a',
    category: 'asset',
    capture: 'money_last',
    patterns: [/trade\s+notes\s+and\s+accounts\s+receivable/i, /accounts\s+receivable/i],
  },
  {
    id: 'sch-l-securities',
    form: 'Form 1120-S',
    boxLabel: 'Line 4',
    fieldLabel: 'Tax-Exempt Securities (End of Year)',
    lineNum: 'Line 4',
    category: 'asset',
    capture: 'money_last',
    patterns: [/tax-exempt\s+securities/i],
  },
  {
    id: 'sch-l-ap',
    form: 'Form 1120-S',
    boxLabel: 'Line 16',
    fieldLabel: 'Accounts Payable (End of Year)',
    lineNum: 'Line 16',
    category: 'asset',
    capture: 'money_last',
    patterns: [/accounts\s+payable/i],
  },
  {
    id: 'sch-l-notes',
    form: 'Form 1120-S',
    boxLabel: 'Line 17',
    fieldLabel: 'Mortgages and notes payable in less than 1 year (End of Year)',
    lineNum: 'Line 17',
    category: 'asset',
    capture: 'money_last',
    patterns: [/payable in less than 1 year/i, /less than 1 year/i],
  },
  {
    id: 'sch-l-other-current',
    form: 'Form 1120-S',
    boxLabel: 'Line 18',
    fieldLabel: 'Other Current Liabilities (End of Year)',
    lineNum: 'Line 18',
    category: 'asset',
    capture: 'money_last',
    patterns: [/other\s+current\s+liabilities/i],
  },
  {
    id: 'sch-l-current-liabilities',
    form: 'Form 1120-S',
    boxLabel: 'Line 18',
    fieldLabel: 'Total Current Liabilities (End of Year)',
    lineNum: 'Line 18d',
    category: 'asset',
    capture: 'money_last',
    patterns: [/total\s+current\s+liabilities/i],
  },
];

export const INCOME_FIELD_DEFS: IncomeFieldDef[] = [
  ...W2_FIELD_DEFS,
  ...PAYSTUB_DEFS,
  ...WVOE_DEFS,
  ...SCHEDULE_B_DEFS,
  ...SCHEDULE_C_DEFS,
  ...SCHEDULE_D_DEFS,
  ...SCHEDULE_E_DEFS,
  ...SCHEDULE_F_DEFS,
  ...SCORP_DEFS,
  ...PARTNERSHIP_DEFS,
  ...FORM_1120_DEFS,
  ...FORM_1040_DEFS,
  ...FORM_8825_DEFS,
  ...FORM_4562_DEFS,
  ...SCHEDULE_L_DEFS,
];

type LineCluster = {
  y: number;
  items: { word: ParseWord; index: number }[];
  text: string;
};

function clusterLines(words: ParseWord[]): LineCluster[] {
  const items = words
    .map((word, index) => ({ word, index }))
    .sort((a, b) => a.word.y - b.word.y || a.word.x - b.word.x);
  const lines: LineCluster[] = [];
  const yTol = 0.014;

  for (const item of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(item.word.y - last.y) <= yTol) {
      last.items.push(item);
    } else {
      lines.push({ y: item.word.y, items: [item], text: '' });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.word.x - b.word.x);
    line.text = line.items
      .map((item) => item.word.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return lines;
}

function formatMoney(numeric: number): string {
  return `$${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Schedule E Line 1b property-type codes (IRS instructions) */
const PROPERTY_TYPE_CODES: Record<number, string> = {
  1: 'Single Family Residence',
  2: 'Multi-Family Residence',
  3: 'Vacation/Short-Term Rental',
  4: 'Commercial',
  5: 'Land',
  6: 'Royalties',
  7: 'Self-Rental',
  8: 'Other',
};

/**
 * The words before the first wide horizontal gap. A pay stub header puts the
 * company name, the address block and "Pay End Date" side by side, and OCR
 * clusters them into one line.
 */
function leadingCell(line: LineCluster, gap = 0.035): LineCluster {
  const items = [...line.items].sort((a, b) => a.word.x - b.word.x);
  let end = 1;
  while (end < items.length && items[end].word.x - (items[end - 1].word.x + items[end - 1].word.w) < gap) end += 1;
  const cell = items.slice(0, end);
  return { y: line.y, items: cell, text: cell.map((item) => item.word.text).join(' ') };
}

function lineBox(line: LineCluster): { box: MappedIncomeField['box']; wordIndex: number } | null {
  const first = line.items[0]?.word;
  const last = line.items[line.items.length - 1]?.word;
  if (!first || !last) return null;
  return {
    wordIndex: line.items[0].index,
    box: {
      x: first.x,
      y: Math.min(...line.items.map((item) => item.word.y)),
      w: Math.max(last.x + last.w - first.x, 0.06),
      h: Math.max(...line.items.map((item) => item.word.h), 0.012),
    },
  };
}

function amountBox(line: LineCluster, moneyMatch: RegExpMatchArray): { box: MappedIncomeField['box']; wordIndex: number } | null {
  const token = moneyMatch[0];
  const tokenIndex = moneyMatch.index ?? line.text.indexOf(token);
  const compactToken = token.replace(/\s/g, '');
  const containing =
    line.items.find((item) => item.word.text.replace(/\s/g, '').includes(compactToken)) ||
    line.items.find((item) => MONEY.test(item.word.text));
  if (containing) {
    const word = containing.word;
    const inner = word.text.indexOf(token);
    if (inner >= 0 && word.text.length > token.length + 4) {
      const start = inner / word.text.length;
      const width = token.length / word.text.length;
      return {
        wordIndex: containing.index,
        box: {
          x: word.x + word.w * start,
          y: word.y,
          w: Math.max(word.w * width, 0.04),
          h: Math.max(word.h, 0.012),
        },
      };
    }
    return {
      wordIndex: containing.index,
      box: { x: word.x, y: word.y, w: Math.max(word.w, 0.04), h: Math.max(word.h, 0.012) },
    };
  }

  const first = line.items[0]?.word;
  const last = line.items[line.items.length - 1]?.word;
  if (!first || !last) return null;
  const lineLeft = first.x;
  const lineRight = last.x + last.w;
  const lineWidth = Math.max(lineRight - lineLeft, 0.04);
  const ratio = line.text.length > 0 ? tokenIndex / line.text.length : 0.7;
  const tokenRatio = line.text.length > 0 ? token.length / line.text.length : 0.18;
  return {
    wordIndex: line.items[line.items.length - 1].index,
    box: {
      x: lineLeft + lineWidth * ratio,
      y: Math.min(...line.items.map((item) => item.word.y)),
      w: Math.max(lineWidth * tokenRatio, 0.06),
      h: Math.max(...line.items.map((item) => item.word.h), 0.012),
    },
  };
}

function pageTextBlob(page: ParsePage): string {
  return `${page.formIds.join(' ')} ${(page.words ?? []).map((word) => word.text).join(' ')}`;
}

function pagePrefers(page: ParsePage, form: IncomeForm): boolean {
  const words = pageTextBlob(page).toLowerCase();
  const blob = page.formIds.join(' ').toLowerCase();
  if (form === 'W-2') {
    const folded = words.replace(/[^a-z0-9]+/g, '');
    const wageLabels = ['medicarewages', 'socialsecuritywages', 'wagestips', 'federalincometax'].filter((needle) =>
      folded.includes(needle),
    ).length;
    if (
      wageLabels < 2 &&
      /notice to employee|instructions for employee|this w-2 is acceptable for filing/i.test(words)
    ) {
      const amounts = words.match(/\d{1,3}(?:,\d{3})+\.\d{2}|\d{4,}\.\d{2}/g) ?? [];
      if (amounts.length < 2) return false;
    }
    return wageLabels >= 2 || /\bw-?2\b|wage and tax statement|medicare wages/.test(words) || folded.includes('medicarewages');
  }
  if (form === 'Paystub') return /paystub|pay stub|earnings statement|payroll/.test(words) && !/\bw-?2\b|wage and tax statement/.test(words);
  if (form === 'WVOE') return /wvoe|verification of employment/.test(blob);
  if (form === 'Schedule B') return /schedule\s*b/.test(blob);
  if (form === 'Schedule C') return /schedule\s*c/.test(blob);
  if (form === 'Schedule D') return /schedule\s*d/.test(blob);
  if (form === 'Schedule E') return /schedule\s*e/.test(blob);
  if (form === 'Schedule F') return /schedule\s*f/.test(blob);
  if (form === 'Form 1120-S') return /1120-?s|form 4562|schedule l/.test(blob);
  if (form === 'Form 1065') return /1065/.test(blob);
  if (form === 'Form 1120') return /1120 \(c-corporation|c-corporation return/.test(blob);
  if (form === 'Form 1040') return /1040/.test(blob);
  if (form === 'Form 8825') return /8825/.test(blob);
  return false;
}

function pagesForScheduleL(
  pageLines: Array<{ page: ParsePage; lines: LineCluster[] }>,
): Array<{ page: ParsePage; lines: LineCluster[] }> {
  return pageLines.filter(({ page }) =>
    /schedule\s*l|1120-?s|\b1065\b|form\s*1120\b|c-corporation/i.test(page.formIds.join(' ')),
  );
}

const TAX_RETURN_PAGE_HEADER =
  /\bForm\s+(?:1040|1065|1120|1125|4562|4797|8825)[A-Z-]*\s*\(\s*(?:19|20)\d{2}\s*\)|\bSchedule\s+[A-Z0-9-]+\s*\(\s*Form\s+(?:1040|1065|1120)/i;

/**
 * Inner pages of a return (1065 page 2, Schedule K, statements) carry no form
 * title the splitter recognises, so they arrive unclassified. Their running
 * header still names the return, and they are never a wage document.
 */
function isTaxReturnPage(page: ParsePage): boolean {
  return TAX_RETURN_PAGE_HEADER.test(pageTextBlob(page));
}

function isUnclassifiedWagePage(page: ParsePage): boolean {
  return page.formIds.length === 0 && !isTaxReturnPage(page);
}

/** Browser print header/footer ("9/18/26, 5:48 PM", "download (615×498)", "file:///…"). */
const PRINT_CHROME_LINE =
  /^\s*\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}|\b(?:file|https?|about|blob):\/|\(\s*\d{2,5}\s*[×x]\s*\d{2,5}\s*\)/i;

const LOW_RESOLUTION_NOTE: ReviewNote = {
  severity: 'warning',
  message:
    'The source is a low-resolution image (under 150 DPI), so these values were read by OCR from blurred print. Check each against the document, or request the original PDF.',
};

const PAYSTUB_EVIDENCE = /\b(?:gross|net)\s+pay\b|\bpay\s+(?:period|date)\b|\bcheck\s+date\b|\bytd\b|year[- ]to[- ]date|\bearnings\b/i;

function pagesForDef(
  pageLines: Array<{ page: ParsePage; lines: LineCluster[] }>,
  form: IncomeForm,
): Array<{ page: ParsePage; lines: LineCluster[] }> {
  const preferred = pageLines.filter(({ page }) => pagePrefers(page, form));
  if (preferred.length) return preferred;
  if (form === 'W-2' || form === 'Paystub' || form === 'WVOE') {
    return pageLines.filter(({ page }) => isUnclassifiedWagePage(page));
  }
  return [];
}

function moneyMatches(text: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(MONEY.source, 'g'))].filter((match) => match[1]);
}

function estimatedMatchX(line: LineCluster, pattern: RegExp): number {
  const match = line.text.match(pattern);
  const first = line.items[0]?.word;
  const last = line.items[line.items.length - 1]?.word;
  if (!first || !last) return 0;
  const width = Math.max(last.x + last.w - first.x, 0.04);
  if (!match || match.index == null) return first.x;
  return first.x + width * (match.index / Math.max(line.text.length, 1));
}

function moneyOnOrNear(lines: LineCluster[], lineIndex: number, takeLast = false): { line: LineCluster; match: RegExpMatchArray } | null {
  const line = lines[lineIndex];
  const sameLine = takeLast ? moneyMatches(line.text).pop() : line.text.match(MONEY);
  if (sameLine && sameLine[1]) return { line, match: sameLine as RegExpMatchArray };
  const y0 = line.y;
  const labelRight = line.items[line.items.length - 1]?.word;
  for (let index = lineIndex; index < Math.min(lineIndex + 4, lines.length); index += 1) {
    const candidate = lines[index];
    if (Math.abs(candidate.y - y0) > 0.04) continue;
    const match = takeLast ? moneyMatches(candidate.text).pop() : candidate.text.match(MONEY);
    if (!match || !match[1]) continue;
    const amount = candidate.items.find((item) => MONEY.test(item.word.text))?.word;
    if (labelRight && amount && amount.x + amount.w < labelRight.x) continue;
    return { line: candidate, match: match as RegExpMatchArray };
  }
  return null;
}

/** Prefer the amount in the same form box (right of / below the label), not the first dollar on the row. */
function moneyInColumn(
  lines: LineCluster[],
  lineIndex: number,
  columnX: number,
  columnWidth = 0.28,
): { line: LineCluster; match: RegExpMatchArray } | null {
  const y0 = lines[lineIndex].y;
  const minX = columnX - 0.02;
  const maxX = columnX + columnWidth;
  for (let index = lineIndex; index < Math.min(lineIndex + 6, lines.length); index += 1) {
    const candidate = lines[index];
    if (candidate.y + 0.002 < y0) continue;
    if (candidate.y - y0 > 0.06) continue;
    for (const match of moneyMatches(candidate.text)) {
      const located = amountBox(candidate, match as RegExpMatchArray);
      if (!located) continue;
      const mid = located.box.x + located.box.w / 2;
      if (mid < minX || mid > maxX) continue;
      return { line: candidate, match: match as RegExpMatchArray };
    }
  }
  return null;
}

const EIN_TOKEN = /(\d{2}-\d{7}|\d{9})/;

function einOnOrNear(lines: LineCluster[], lineIndex: number, columnX: number): { value: string; line: LineCluster; match: RegExpMatchArray } | null {
  const y0 = lines[lineIndex].y;
  for (let index = lineIndex; index < Math.min(lineIndex + 5, lines.length); index += 1) {
    const candidate = lines[index];
    if (candidate.y + 0.002 < y0) continue;
    if (candidate.y - y0 > 0.09) continue;
    const match = candidate.text.match(EIN_TOKEN);
    if (!match) continue;
    const located = amountBox(candidate, match);
    const mid = located ? located.box.x + located.box.w / 2 : columnX;
    if (Math.abs(mid - columnX) > 0.35 && index !== lineIndex) continue;
    const raw = match[1];
    const value = raw.includes('-') ? raw : `${raw.slice(0, 2)}-${raw.slice(2)}`;
    return { value, line: candidate, match };
  }
  return null;
}

function paystubRowAmounts(line: LineCluster): number[] {
  return moneyMatches(line.text).map((match) => parseMoneyValue(match[1]));
}

function assignPaystubAmounts(
  amounts: number[],
  matches: RegExpMatchArray[],
  label: string,
  kind: PaystubRowKind,
  hoursBeforeRate = false,
): Partial<Record<'rate' | 'hours' | 'current' | 'ytd', { numeric: number; match: RegExpMatchArray }>> {
  const slot = (index: number) => ({ numeric: amounts[index], match: matches[index] as RegExpMatchArray });
  if (amounts.length >= 4) {
    return hoursBeforeRate
      ? { hours: slot(0), rate: slot(1), current: slot(2), ytd: slot(3) }
      : { rate: slot(0), hours: slot(1), current: slot(2), ytd: slot(3) };
  }
  if (amounts.length === 3 && amounts[0] < 200 && amounts[1] >= 200) {
    return { rate: slot(0), current: slot(1), ytd: slot(2) };
  }
  if (amounts.length === 3 && amounts[0] < 200 && amounts[1] < 200) {
    return hoursBeforeRate
      ? { hours: slot(0), rate: slot(1), current: slot(2) }
      : { rate: slot(0), hours: slot(1), current: slot(2) };
  }
  if (amounts.length >= 2) return { current: slot(0), ytd: slot(amounts.length - 1) };
  if (amounts.length === 1) {
    if (kind !== 'regular' || /ytd|year[- ]to[- ]date/i.test(label)) return { ytd: slot(0) };
    return { current: slot(0) };
  }
  return {};
}

function fieldsFromPaystubTable(
  pageLines: Array<{ page: ParsePage; lines: LineCluster[] }>,
  claimed: Set<string> = new Set(),
): MappedIncomeField[] {
  const found: MappedIncomeField[] = [];
  const paystubPages = pageLines.filter(
    ({ page }) => pagePrefers(page, 'Paystub') || (isUnclassifiedWagePage(page) && PAYSTUB_EVIDENCE.test(pageTextBlob(page))),
  );
  for (const { page, lines } of paystubPages) {
    const entityId = formEntityId('Paystub', page.index);
    const pageText = lines.map((line) => line.text).join('\n');
    const paysPerYear = paystubPaysPerYear(pageText);
    const frequency = paystubFrequencyType(pageText);
    const hoursBeforeRate = paystubHoursBeforeRate(pageText);
    const hasGross = /\bgross\b/i.test(pageText);
    const push = (defId: string, numeric: number, line: LineCluster, match?: RegExpMatchArray, value?: string) => {
      if (value == null && !Number.isFinite(numeric)) return;
      if (claimed.has(`${page.index}:${defId}`)) return;
      if (found.some((field) => field.sourceFieldId === defId && field.pageIndex === page.index)) return;
      const def = PAYSTUB_DEFS.find((item) => item.id === defId);
      if (!def) return;
      const located = match ? amountBox(line, match) : lineBox(line);
      if (!located) return;
      const isFirst = !found.some((field) => field.sourceFieldId === def.id);
      found.push({
        id: isFirst ? def.id : `${def.id}--${entityId}`,
        entityId,
        sourceFieldId: def.id,
        form: def.form,
        boxLabel: def.boxLabel,
        fieldLabel: def.fieldLabel,
        lineNum: def.lineNum,
        category: def.category,
        value: value ?? formatMoney(numeric),
        numericValue: numeric,
        pageIndex: page.index,
        wordIndex: located.wordIndex,
        box: located.box,
      });
    };
    const addMoney = (defId: string, numeric: number, line: LineCluster, match?: RegExpMatchArray) => {
      if (!Number.isFinite(numeric)) return;
      if (claimed.has(`${page.index}:${defId}`)) return;
      const existing = found.find((field) => field.sourceFieldId === defId && field.pageIndex === page.index);
      if (existing) {
        existing.numericValue += numeric;
        existing.value = formatMoney(existing.numericValue);
        return;
      }
      push(defId, numeric, line, match);
    };
    if (!/employer(?:['’]s)?(?:\s+name)?\s*[:#]/i.test(pageText)) {
      const header = lines
        .filter((line) => !PRINT_CHROME_LINE.test(line.text))
        .map((line) => leadingCell(line))
        .find((cell) => {
          const text = cell.text.trim();
          return (
            text.length >= 3 &&
            text.length <= 80 &&
            !/earnings statement|pay\s*stub|pay statement|pay advice|payroll|employee|pay period|advice/i.test(text) &&
            !MONEY.test(text)
          );
        });
      if (header) push('ps-employer-name', 0, header, undefined, header.text.trim());
    }
    if (frequency) {
      const freqLine =
        lines.find((line) =>
          /pay\s+frequency|semi[- ]?month|bi[- ]?week|\bweekly\b|\bmonthly\b|period\s+start|period\s+end|\d{1,2}\/\d{1,2}\/\d{2,4}/i.test(
            line.text,
          ),
        ) ?? lines[0];
      if (freqLine) push('ps-pay-frequency', 0, freqLine, undefined, frequency);
    }
    let periodHours = 0;
    let periodHoursLine: LineCluster | undefined;
    let periodHoursMatch: RegExpMatchArray | undefined;
    for (const line of lines) {
      const amounts = paystubRowAmounts(line);
      const matches = moneyMatches(line.text);
      const label = line.text.replace(new RegExp(MONEY.source, 'g'), '').replace(/\s+/g, ' ').trim();
      const hrs = line.text.match(/(\d+(?:\.\d+)?)\s*hr\/?\s*wk/i);
      if (hrs) push('ps-hours-week', Number(hrs[1]), line);
      const employer = line.text.match(/employer(?:['’]s)?(?:\s+name)?\s*[:#–—-]?\s+(.+)/i);
      if (employer?.[1]) {
        const name = employer[1].replace(/\s+/g, ' ').trim();
        if (name.length >= 2) push('ps-employer-name', 0, line, undefined, name);
      }
      const employee =
        line.text.match(/employee(?:['’]s)?\s+name\s*[:#–—-]?\s+(.+)/i) ??
        line.text.match(/\bemployee\s*[:#–—-]\s+(.+)/i) ??
        line.text.match(/\bemployee\s+(?!id\b|taxes\b)([A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+)?)(?=\s+(?:pay|ssn|department|id)\b|\s*$)/i);
      if (employee?.[1]) {
        const name = employee[1].replace(/\s+/g, ' ').trim();
        if (name.length >= 2 && !/^(?:taxes|id)\b/i.test(name)) push('ps-employee-name', 0, line, undefined, name);
      }
      const kind = paystubRowKind(label);
      if (!kind || !amounts.length) continue;
      const slots = assignPaystubAmounts(amounts, matches, label, kind, hoursBeforeRate);
      if (kind === 'regular') {
        if (slots.rate && isPrimaryRateRow(label)) {
          push('ps-hourly-rate', slots.rate.numeric, line, slots.rate.match);
        }
        if (slots.current) addMoney('ps-current-base', slots.current.numeric, line, slots.current.match);
        if (slots.ytd) addMoney('ps-base-ytd', slots.ytd.numeric, line, slots.ytd.match);
        if (slots.hours) {
          periodHours += slots.hours.numeric;
          periodHoursLine = line;
          periodHoursMatch = slots.hours.match;
        }
      } else if (slots.ytd) {
        const sourceId = PAYSTUB_YTD_FIELD_BY_KIND[kind];
        if (sourceId) addMoney(sourceId, slots.ytd.numeric, line, slots.ytd.match);
      }
    }
    if (
      periodHoursLine &&
      !found.some((field) => field.sourceFieldId === 'ps-hours-week' && field.pageIndex === page.index)
    ) {
      const weekly = weeklyHoursFromPeriod(periodHours, paysPerYear);
      if (weekly != null) push('ps-hours-week', weekly, periodHoursLine, periodHoursMatch);
    }
    if (!found.some((field) => field.sourceFieldId === 'ps-base-ytd' && field.pageIndex === page.index) && !hasGross) {
      for (const line of lines) {
        if (!/year[- ]to[- ]date|\bytd\b/i.test(line.text)) continue;
        const matches = moneyMatches(line.text);
        const last = matches[matches.length - 1];
        if (!last) continue;
        push('ps-base-ytd', parseMoneyValue(last[1]), line, last as RegExpMatchArray);
        break;
      }
    }
  }
  return found;
}

function formEntityId(form: IncomeForm, pageIndex: number): string {
  return `${form.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-p${pageIndex}`;
}

function parseMoneyValue(raw: string): number {
  const normalized = raw.replace(/[$,\s]/g, '');
  if (normalized.startsWith('(') && normalized.endsWith(')')) {
    return -Number(normalized.slice(1, -1));
  }
  return Number(normalized);
}

const GRID_LINE_TO_DEF: Record<string, string> = {
  '3': 'ent2-rent',
  '9': 'ent2-ins',
  '12': 'ent2-int',
  '16': 'ent2-tax',
  '18': 'ent2-dep',
  '19': 'ent2-hoa',
  '20': 'ent2-exp',
  '21': 'ent2-net',
};

export const RENTAL_YEAR_KEY_TO_SOURCE: Record<string, string> = {
  rentsReceived: 'ent2-rent',
  insurance: 'ent2-ins',
  mortgageInterest: 'ent2-int',
  taxes: 'ent2-tax',
  depreciation: 'ent2-dep',
  hoaDues: 'ent2-hoa',
  totalExpenses: 'ent2-exp',
  netIncomeLoss: 'ent2-net',
  fairRentalDays: 'ent2-days',
};

const EMPTY_BOX: OverlayBox = { x: 0, y: 0, w: 0, h: 0 };

export function scheduleEEntityId(pageIndex: number, column: string): string {
  return `schedule-e-p${pageIndex}-${String(column).toLowerCase()}`;
}

function extractEmitsSource(prop: ScheduleEPropertyExtract, sourceFieldId: string): boolean {
  if (sourceFieldId === 'ent2-address') return Boolean(prop.address);
  if (sourceFieldId === 'ent2-type') return Boolean(prop.propertyType);
  if (sourceFieldId === 'ent2-days') return Boolean(prop.fairRentalDays);
  const line = Object.entries(GRID_LINE_TO_DEF).find(([, id]) => id === sourceFieldId)?.[0];
  if (!line) return false;
  const amount = prop.financials?.[line];
  return amount != null && !(amount === 0 && line !== '21');
}

export function scheduleEGridFieldId(
  extracts: ScheduleEPropertyExtract[],
  pageIndex: number,
  column: string,
  sourceFieldId: string,
): string {
  const entityId = scheduleEEntityId(pageIndex, column);
  const first = extracts.find((prop) => extractEmitsSource(prop, sourceFieldId));
  if (first && first.pageIndex === pageIndex && first.column === column) return sourceFieldId;
  return `${sourceFieldId}--${entityId}`;
}

function overlayBoxFor(prop: ScheduleEPropertyExtract, sourceFieldId: string): OverlayBox {
  const boxes = prop.boxes;
  if (!boxes) return EMPTY_BOX;
  if (sourceFieldId === 'ent2-address') return boxes.address ?? EMPTY_BOX;
  if (sourceFieldId === 'ent2-type') return boxes.type ?? EMPTY_BOX;
  if (sourceFieldId === 'ent2-days') return boxes.days ?? EMPTY_BOX;
  const line = Object.entries(GRID_LINE_TO_DEF).find(([, id]) => id === sourceFieldId)?.[0];
  return (line ? boxes.financials?.[line] : undefined) ?? EMPTY_BOX;
}

function fieldsFromScheduleEGrid(extracts: ScheduleEPropertyExtract[]): MappedIncomeField[] {
  const found: MappedIncomeField[] = [];
  for (const prop of extracts) {
    const entityId = scheduleEEntityId(prop.pageIndex, prop.column);
    const push = (
      sourceFieldId: string,
      boxLabel: string,
      fieldLabel: string,
      lineNum: string,
      category: MappedIncomeField['category'],
      value: string,
      numericValue: number,
    ) => {
      found.push({
        id: scheduleEGridFieldId(extracts, prop.pageIndex, prop.column, sourceFieldId),
        entityId,
        sourceFieldId,
        form: 'Schedule E',
        boxLabel,
        fieldLabel,
        lineNum,
        category,
        value,
        numericValue,
        pageIndex: prop.pageIndex,
        wordIndex: 0,
        box: overlayBoxFor(prop, sourceFieldId),
      });
    };
    if (prop.address) {
      push('ent2-address', 'Line 1a', 'Property Address (Line 1a)', 'Line 1a', 'property', prop.address, 0);
    }
    if (prop.propertyType) {
      const typeCode = Number((prop.propertyType.match(/[1-8]/) || [])[0]);
      push(
        'ent2-type',
        'Line 1b',
        'Type of Property (Line 1b)',
        'Line 1b',
        'property',
        PROPERTY_TYPE_CODES[typeCode] ? `${typeCode} — ${PROPERTY_TYPE_CODES[typeCode]}` : prop.propertyType,
        Number.isFinite(typeCode) ? typeCode : 0,
      );
    }
    if (prop.fairRentalDays) {
      push('ent2-days', 'Line 2', 'Fair Rental Days (Line 2)', 'Line 2', 'property', String(prop.fairRentalDays), prop.fairRentalDays);
    }
    for (const [line, sourceId] of Object.entries(GRID_LINE_TO_DEF)) {
      const def = SCHEDULE_E_DEFS.find((item) => item.id === sourceId);
      const amount = prop.financials[line];
      if (!def || amount == null || (amount === 0 && line !== '21')) continue;
      push(sourceId, def.boxLabel, def.fieldLabel, def.lineNum, def.category, formatMoney(amount), amount);
    }
  }
  return found;
}

function fieldsFromFormExtracts(extracts: ParseResponse['formExtracts']): MappedIncomeField[] {
  const found: MappedIncomeField[] = [];
  for (const extract of extracts ?? []) {
    const entityId = extract.entityId || `${extract.form.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-p${extract.pageIndex}`;
    const isFirst = !found.some((field) => field.sourceFieldId === extract.sourceFieldId);
    found.push({
      id: isFirst ? extract.sourceFieldId : `${extract.sourceFieldId}--${entityId}`,
      entityId,
      sourceFieldId: extract.sourceFieldId,
      form: extract.form,
      boxLabel: extract.boxLabel,
      fieldLabel: extract.fieldLabel,
      lineNum: extract.lineNum,
      category: extract.category,
      value: extract.value,
      numericValue: extract.numericValue,
      pageIndex: extract.pageIndex,
      wordIndex: 0,
      box: extract.box,
      componentBoxes: extract.componentBoxes,
      componentCells: extract.componentCells,
      reviewNotes: extract.reviewNotes,
    });
  }
  return found;
}

/**
 * Collect the parser's review notes for a page, de-duplicated by message.
 *
 * Notes are page-level but ride on every field extracted from that page, so
 * the same text arrives once per field.
 */
export function reviewNotesForPage(
  fields: MappedIncomeField[],
  pageIndex?: number,
): ReviewNote[] {
  const seen = new Map<string, ReviewNote>();
  for (const field of fields) {
    if (pageIndex != null && field.pageIndex !== pageIndex) continue;
    for (const note of field.reviewNotes ?? []) {
      if (!seen.has(note.message)) seen.set(note.message, note);
    }
  }
  // Warnings first: they mean a value was excluded or could not be trusted.
  return [...seen.values()].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1,
  );
}

function plausibleW2Wage(value: number | undefined): boolean {
  if (value == null || !Number.isFinite(value) || value < 100 || value > 10_000_000) return false;
  return true;
}

function isW2LabelName(value: string): boolean {
  const folded = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (
    folded.includes('employersname') ||
    folded.includes('employersaddress') ||
    folded.includes('addressandzip') ||
    folded.includes('wageandtaxstatement')
  );
}

function keepGridWage(value: number | undefined, fourUp: boolean): boolean {
  if (!plausibleW2Wage(value)) return false;
  // Four-up sheets used to clip a year or a box number into the wage column.
  // A whole-dollar Medicare wage such as 26484.00 is still a real Box 5.
  if (fourUp && Number.isInteger(value)) {
    const amount = value ?? 0;
    if (amount < 1_000 || (amount >= 1_990 && amount <= 2_035)) return false;
  }
  return true;
}

function isFourUpW2(blob: string): boolean {
  return /copy\s*b/i.test(blob) && /copy\s*c/i.test(blob);
}

function w2Overlay(extract: W2BoxExtract, key: keyof NonNullable<W2BoxExtract['boxes']>): MappedIncomeField['box'] {
  const box = extract.boxes?.[key];
  if (!box) return { x: 0.58, y: 0.42, w: 0.1, h: 0.025 };
  if (box.w > 0.18 || box.h > 0.05) {
    return {
      x: key === 'employer_name' ? box.x : box.x + Math.max(0, box.w - 0.08),
      y: box.y,
      w: Math.min(box.w, key === 'employer_name' ? 0.12 : 0.08),
      h: Math.min(box.h, key === 'employer_name' ? 0.028 : 0.018),
    };
  }
  return box;
}

function fieldsFromW2Grid(extracts: W2BoxExtract[], fourUp = false): MappedIncomeField[] {
  const found: MappedIncomeField[] = [];
  extracts.forEach((extract, index) => {
    const entityId = formEntityId('W-2', extract.pageIndex) + (index ? `-g${index}` : '');
    const push = (boxKey: keyof NonNullable<W2BoxExtract['boxes']>, defId: string, value: string, numeric: number) => {
      const def = W2_FIELD_DEFS.find((item) => item.id === defId);
      if (!def) return;
      const isFirst = !found.some((field) => field.sourceFieldId === defId);
      found.push({
        id: isFirst ? defId : `${defId}--${entityId}`,
        entityId,
        sourceFieldId: defId,
        form: def.form,
        boxLabel: def.boxLabel,
        fieldLabel: def.fieldLabel,
        lineNum: def.lineNum,
        category: def.category,
        value,
        numericValue: numeric,
        pageIndex: extract.pageIndex,
        wordIndex: 0,
        box: w2Overlay(extract, boxKey),
      });
    };
    if (extract.employerName && /[A-Za-z]{3,}/.test(extract.employerName) && !isW2LabelName(extract.employerName)) {
      push('employer_name', 'w2-employer-name', extract.employerName, 0);
    }
    if (extract.ein) push('employer_ein', 'w2-employer-ein', extract.ein, 0);
    if (extract.box2) push('box2', 'w2-box2', formatMoney(extract.box2), extract.box2);
    if (extract.box3) push('box3', 'w2-box3', formatMoney(extract.box3), extract.box3);
    if (extract.box4) push('box4', 'w2-box4', formatMoney(extract.box4), extract.box4);
    if (keepGridWage(extract.box5, fourUp)) push('box5', 'w2-box5', formatMoney(extract.box5), extract.box5);
    if (extract.box6) push('box6', 'w2-box6', formatMoney(extract.box6), extract.box6);
  });
  return found;
}

export function mapIncomeFields(result: ParseResponse): MappedIncomeField[] {
  const gridFields = fieldsFromScheduleEGrid(result.scheduleEProperties ?? []);
  const fourUp = (result.pages ?? []).some((page) => isFourUpW2(pageTextBlob(page)));
  const w2GridFields = fieldsFromW2Grid(result.w2Extracts ?? [], fourUp);
  const gridHasBox5 = w2GridFields.some(
    (field) => field.sourceFieldId === 'w2-box5' && keepGridWage(field.numericValue, fourUp),
  );
  const extractFields = fieldsFromFormExtracts(result.formExtracts).filter(
    (field) => !(gridHasBox5 && field.form === 'W-2' && field.sourceFieldId !== 'w2-employee-name'),
  );
  const pageLines = result.pages.map((page) => ({ page, lines: clusterLines(page.words) }));
  const claimed = new Set(
    [...gridFields, ...w2GridFields, ...extractFields].map((field) => `${field.pageIndex}:${field.sourceFieldId}`),
  );
  const found: MappedIncomeField[] = [
    ...gridFields,
    ...w2GridFields,
    ...extractFields,
    ...fieldsFromPaystubTable(pageLines, claimed),
  ];
  for (const field of found) claimed.add(`${field.pageIndex}:${field.sourceFieldId}`);

  for (const def of INCOME_FIELD_DEFS) {
    if (gridFields.length && def.form === 'Schedule E') continue;
    if (gridHasBox5 && def.form === 'W-2') continue;
    if (def.id === 'ps-hours-week') continue;
    const ordered = def.id.startsWith('sch-l-') ? pagesForScheduleL(pageLines) : pagesForDef(pageLines, def.form);
    if (!ordered.length) continue;
    const allowMultipleEntities = ordered.some(({ page }) => pagePrefers(page, def.form));

    for (const { page, lines } of ordered) {
      if (claimed.has(`${page.index}:${def.id}`)) continue;
      let mappedOnPage = false;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const matchedPattern = def.patterns.find((pattern) => pattern.test(line.text));
        if (!matchedPattern) continue;

        const capture = def.capture ?? 'money';
        let value: string;
        let numeric: number;
        let located: { box: MappedIncomeField['box']; wordIndex: number } | null;

        if (capture === 'money' || capture === 'money_last') {
          if (capture === 'money_last') {
            const matches = moneyMatches(line.text);
            const last = matches[matches.length - 1];
            if (!last) continue;
            numeric = parseMoneyValue(last[1]);
            if (!Number.isFinite(numeric)) continue;
            located = amountBox(line, last);
            value = formatMoney(numeric);
          } else {
            const columnX = estimatedMatchX(line, matchedPattern);
            const foundMoney =
              moneyInColumn(lines, lineIndex, columnX) ??
              moneyOnOrNear(lines, lineIndex, def.id === 'ps-base-ytd');
            if (!foundMoney) continue;
            numeric = parseMoneyValue(foundMoney.match[1]);
            if (!Number.isFinite(numeric)) continue;
            located = amountBox(foundMoney.line, foundMoney.match);
            value = formatMoney(numeric);
          }
        } else if (capture === 'ein') {
          const columnX = estimatedMatchX(line, matchedPattern);
          const foundEin = einOnOrNear(lines, lineIndex, columnX);
          if (!foundEin) continue;
          numeric = 0;
          located = amountBox(foundEin.line, foundEin.match) ?? lineBox(foundEin.line);
          value = foundEin.value;
        } else if (capture === 'integer') {
          const intMatch = line.text.match(TRAILING_INT);
          if (!intMatch) continue;
          numeric = Number(intMatch[1].replace(/,/g, ''));
          if (!Number.isFinite(numeric)) continue;
          located = amountBox(line, intMatch);
          value =
            def.id === 'ent2-type' && PROPERTY_TYPE_CODES[numeric]
              ? `${numeric} — ${PROPERTY_TYPE_CODES[numeric]}`
              : numeric.toLocaleString('en-US');
        } else if (capture === 'percent') {
          // Take the LAST percentage on the line — K-1 Item J lists Beginning
          // then Ending columns, and only the end-of-year figure qualifies.
          const percentMatches = [...line.text.matchAll(PERCENT)];
          if (percentMatches.length === 0) continue;
          const lastMatch = percentMatches[percentMatches.length - 1];
          numeric = Number(lastMatch[1]);
          if (!Number.isFinite(numeric) || numeric > 100) continue;
          located = amountBox(line, lastMatch as RegExpMatchArray);
          value = `${numeric}% (ending)`;
        } else {
          // text capture: everything after the matched label on the line
          const labelMatch = line.text.match(matchedPattern);
          let rest = line.text
            .slice((labelMatch?.index ?? 0) + (labelMatch?.[0].length ?? 0))
            .replace(/^[\s:,.()–—-]+/, '')
            .replace(/^(?:address(?:,?\s*city)?(?:,?\s*state)?(?:,?\s*and\s+zip\s*code)?)\s*/i, '')
            .replace(/\s+(?:[a-z]\s+)?(?:control number|employee(?:['’]s)? first name|employee(?:['’]s)? address).*$/i, '')
            .replace(/^[a-z]$/i, '')
            .replace(/^(?:,?\s*)?(?:address(?:\s*,?\s*and\s+zip\s*code)?|and zip code)\s*$/i, '')
            .trim();
          const chrome = !rest || rest.length < 3 || /^(?:[a-z]\s+)?(?:control number|employee|address|and zip)/i.test(rest) || /\be\s+employee/i.test(rest);
          if (chrome) {
            const below = lines[lineIndex + 1];
            const columnX = estimatedMatchX(line, matchedPattern);
            const belowText = below
              ? below.items
                  .filter((item) => item.word.x < columnX + 0.45)
                  .map((item) => item.word.text)
                  .join(' ')
                  .trim()
              : '';
            if (
              below &&
              below.y - line.y < 0.08 &&
              belowText &&
              !/^(?:[a-z]\s+)?(?:control|employee|wages|federal)/i.test(belowText)
            ) {
              rest = belowText.split(/\s{2,}|,\s+\d{5}/)[0].trim();
              located = lineBox(below);
            } else {
              continue;
            }
          } else {
            rest = rest.split(/\s{2,}|,\s+\d{5}/)[0].trim();
            located = lineBox(line);
          }
          if (!rest) continue;
          numeric = 0;
          value = rest;
        }

        if (!located) continue;
        const entityId = formEntityId(def.form, page.index);
        const isFirstDefinitionOccurrence = !found.some((field) => field.sourceFieldId === def.id);
        found.push({
          id: isFirstDefinitionOccurrence ? def.id : `${def.id}--${entityId}`,
          entityId,
          sourceFieldId: def.id,
          form: def.form,
          boxLabel: def.boxLabel,
          fieldLabel: def.fieldLabel,
          lineNum: def.lineNum,
          category: def.category,
          value,
          numericValue: numeric,
          pageIndex: page.index,
          wordIndex: located.wordIndex,
          box: located.box,
        });
        mappedOnPage = true;
        break;
      }
      if (mappedOnPage && !allowMultipleEntities) break;
    }
  }

  const lowResolutionPages = new Set(
    (result.pages ?? []).filter((page) => page.flags?.includes('low_resolution_image')).map((page) => page.index),
  );
  if (lowResolutionPages.size) {
    for (const field of found) {
      if (!lowResolutionPages.has(field.pageIndex)) continue;
      if (field.reviewNotes?.some((note) => note.message === LOW_RESOLUTION_NOTE.message)) continue;
      field.reviewNotes = [...(field.reviewNotes ?? []), LOW_RESOLUTION_NOTE];
    }
  }

  return found;
}

export function fieldsOnPage(fields: MappedIncomeField[], pageIndex: number): MappedIncomeField[] {
  return fields.filter((field) => field.pageIndex === pageIndex);
}
