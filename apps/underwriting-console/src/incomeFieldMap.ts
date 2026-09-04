import type { MappedIncomeField, ParsePage, ParseResponse, ParseWord } from './parseTypes';

export type IncomeForm = 'W-2' | 'Paystub' | 'WVOE' | 'Schedule B' | 'Schedule C' | 'Schedule D' | 'Schedule E' | 'Schedule F' | 'Form 1040' | 'Form 1120-S' | 'Form 1065' | 'Form 1120';

export type IncomeFieldDef = {
  id: string;
  form: IncomeForm;
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: 'wages' | 'withholding' | 'income' | 'addback' | 'mileage' | 'rental' | 'property' | 'identity' | 'asset' | 'farm';
  patterns: RegExp[];
  /** How the value is extracted from a matched line. Defaults to 'money'. */
  capture?: 'money' | 'integer' | 'text' | 'percent';
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
    patterns: [/employer(?:'s)? name(?:, address and zip code)?\s*[:#–—-]?\s*/i],
  },
  {
    id: 'w2-employer-ein',
    form: 'W-2',
    boxLabel: 'Box b',
    fieldLabel: 'Employer Identification Number (EIN)',
    lineNum: 'Box b',
    category: 'identity',
    capture: 'text',
    patterns: [/employer(?:'s)? identification number(?:\s*\(ein\))?\s*[:#–—-]?\s*/i],
  },
  {
    id: 'w2-box1',
    form: 'W-2',
    boxLabel: 'Box 1',
    fieldLabel: 'Wages, Tips, Other Comp',
    lineNum: 'Box 1',
    category: 'wages',
    patterns: [/box\s*1\b.{0,80}wages/i, /\b1\b.{0,24}wages.{0,40}tips/i],
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
    patterns: [/box\s*5\b.{0,80}medicare/i, /\b5\b.{0,24}medicare wages/i],
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
];

/**
 * Schedule K-1 (Form 1065) capture set: income boxes 1–4, distributions (Box 19
 * code A), and BOTH Item J end-of-year percentages — Freddie Mac qualifies on the
 * ending PROFIT %, FNMA on the ending CAPITAL %. Beginning-of-year figures are
 * never used; the percent capture takes the last (Ending column) value on the line.
 */
export const PARTNERSHIP_DEFS: IncomeFieldDef[] = [
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
    patterns: [/\bprofit\b.{0,60}%/i],
  },
  {
    id: 'pt-capital-pct',
    form: 'Form 1065',
    boxLabel: 'Item J',
    fieldLabel: 'End-of-Year Capital % (FNMA)',
    lineNum: 'Item J · Capital',
    category: 'income',
    capture: 'percent',
    patterns: [/\bcapital\b.{0,60}%/i],
  },
];

export const PAYSTUB_DEFS: IncomeFieldDef[] = [
  {
    id: 'ps-hourly-rate',
    form: 'Paystub',
    boxLabel: 'Rate',
    fieldLabel: 'Hourly Rate of Pay',
    lineNum: 'Rate',
    category: 'wages',
    patterns: [/hourly\s+(rate|pay)/i, /rate\s+of\s+pay/i],
  },
  {
    id: 'ps-current-base',
    form: 'Paystub',
    boxLabel: 'Current',
    fieldLabel: 'Current Period Base Pay',
    lineNum: 'Current',
    category: 'wages',
    patterns: [/current\s+(period|earnings|pay)/i, /this\s+period/i],
  },
  {
    id: 'ps-base-ytd',
    form: 'Paystub',
    boxLabel: 'YTD',
    fieldLabel: 'Base Wages YTD',
    lineNum: 'YTD',
    category: 'wages',
    patterns: [/year[- ]to[- ]date/i, /\bytd\b.{0,20}(base|gross|wages)/i],
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
  const containing = line.items.find((item) => item.word.text.includes(token.replace(/\s/g, '')) || MONEY.test(item.word.text));
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

function pagePrefers(page: ParsePage, form: IncomeForm): boolean {
  const blob = page.formIds.join(' ').toLowerCase();
  if (form === 'W-2') return /w-?2/.test(blob);
  if (form === 'Schedule B') return /schedule\s*b/.test(blob);
  if (form === 'Schedule C') return /schedule\s*c/.test(blob);
  if (form === 'Schedule D') return /schedule\s*d/.test(blob);
  if (form === 'Schedule E') return /schedule\s*e/.test(blob);
  if (form === 'Schedule F') return /schedule\s*f/.test(blob);
  if (form === 'Form 1120-S') return /1120-?s/.test(blob);
  if (form === 'Form 1065') return /1065/.test(blob);
  return /1040/.test(blob);
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

export function mapIncomeFields(result: ParseResponse): MappedIncomeField[] {
  if (result.incomeFields?.length) {
    return result.incomeFields;
  }

  const found: MappedIncomeField[] = [];
  const pageLines = result.pages.map((page) => ({ page, lines: clusterLines(page.words) }));

  for (const def of INCOME_FIELD_DEFS) {
    const preferred = pageLines.filter(({ page }) => pagePrefers(page, def.form));
    const ordered = preferred.length > 0 ? preferred : pageLines;
    const allowMultipleEntities = preferred.length > 0;

    for (const { page, lines } of ordered) {
      let mappedOnPage = false;
      for (const line of lines) {
        const matchedPattern = def.patterns.find((pattern) => pattern.test(line.text));
        if (!matchedPattern) continue;

        const capture = def.capture ?? 'money';
        let value: string;
        let numeric: number;
        let located: { box: MappedIncomeField['box']; wordIndex: number } | null;

        if (capture === 'money') {
          const moneyMatch = line.text.match(MONEY);
          if (!moneyMatch) continue;
          numeric = parseMoneyValue(moneyMatch[1]);
          if (!Number.isFinite(numeric)) continue;
          located = amountBox(line, moneyMatch);
          value = formatMoney(numeric);
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
          const rest = line.text
            .slice((labelMatch?.index ?? 0) + (labelMatch?.[0].length ?? 0))
            .replace(/^[\s:,.()–—-]+/, '')
            .trim();
          if (!rest) continue;
          numeric = 0;
          located = lineBox(line);
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

  return found;
}

export function fieldsOnPage(fields: MappedIncomeField[], pageIndex: number): MappedIncomeField[] {
  return fields.filter((field) => field.pageIndex === pageIndex);
}
