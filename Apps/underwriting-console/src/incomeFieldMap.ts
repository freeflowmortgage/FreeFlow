import type { MappedIncomeField, ParsePage, ParseResponse, ParseWord } from './parseTypes';

export type IncomeForm = 'W-2' | 'Schedule C' | 'Schedule E' | 'Form 1040' | 'Form 1120-S' | 'Form 1065';

export type IncomeFieldDef = {
  id: string;
  form: IncomeForm;
  boxLabel: string;
  fieldLabel: string;
  lineNum: string;
  category: 'wages' | 'withholding' | 'income' | 'addback' | 'mileage' | 'rental';
  patterns: RegExp[];
};

const MONEY = /(?:\$\s*)?(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})/;

export const W2_FIELD_DEFS: IncomeFieldDef[] = [
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

export const SCHEDULE_E_DEFS: IncomeFieldDef[] = [
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
    id: 'ent2-dep',
    form: 'Schedule E',
    boxLabel: 'Line 18',
    fieldLabel: 'Rental Depreciation (Line 18)',
    lineNum: 'Line 18',
    category: 'addback',
    patterns: [/line\s*18\b.{0,80}depreciation/i, /rental depreciation.{0,40}\d/i],
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
];

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
];

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
];

export const INCOME_FIELD_DEFS: IncomeFieldDef[] = [...W2_FIELD_DEFS, ...SCHEDULE_C_DEFS, ...SCHEDULE_E_DEFS, ...SCORP_DEFS, ...PARTNERSHIP_DEFS];

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
  if (form === 'Schedule C') return /schedule\s*c/.test(blob);
  if (form === 'Schedule E') return /schedule\s*e/.test(blob);
  return /1040/.test(blob);
}

export function mapIncomeFields(result: ParseResponse): MappedIncomeField[] {
  if (result.incomeFields?.length) {
    return result.incomeFields;
  }

  const found = new Map<string, MappedIncomeField>();
  const pageLines = result.pages.map((page) => ({ page, lines: clusterLines(page.words) }));

  for (const def of INCOME_FIELD_DEFS) {
    const ordered = [
      ...pageLines.filter(({ page }) => pagePrefers(page, def.form)),
      ...pageLines.filter(({ page }) => !pagePrefers(page, def.form)),
    ];
    for (const { page, lines } of ordered) {
      if (found.has(def.id)) break;
      for (const line of lines) {
        if (!def.patterns.some((pattern) => pattern.test(line.text))) continue;
        const moneyMatch = line.text.match(MONEY);
        if (!moneyMatch) continue;
        const numeric = Number(moneyMatch[1].replace(/,/g, ''));
        if (!Number.isFinite(numeric)) continue;
        const located = amountBox(line, moneyMatch);
        if (!located) continue;
        found.set(def.id, {
          id: def.id,
          form: def.form,
          boxLabel: def.boxLabel,
          fieldLabel: def.fieldLabel,
          lineNum: def.lineNum,
          category: def.category,
          value: formatMoney(numeric),
          numericValue: numeric,
          pageIndex: page.index,
          wordIndex: located.wordIndex,
          box: located.box,
        });
        break;
      }
    }
  }

  return INCOME_FIELD_DEFS.map((def) => found.get(def.id)).filter((field): field is MappedIncomeField => Boolean(field));
}

export function fieldsOnPage(fields: MappedIncomeField[], pageIndex: number): MappedIncomeField[] {
  return fields.filter((field) => field.pageIndex === pageIndex);
}
