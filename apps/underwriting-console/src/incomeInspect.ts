import { pageLooksLikeScheduleERentals } from './parseTypes';

const STEM: Array<[string, string]> = [
  ['ent1-net', 'schc-l31'],
  ['ent1-dep', 'schc-l13'],
  ['ent1-home', 'schc-l30'],
  ['ent1-miles', 'schc-l44a'],
  ['ent1-meals', 'schc-l24b'],
  ['scorp-ord', 'scorp-ord'],
  ['scorp-rre', 'scorp-rre'],
  ['scorp-onr', 'scorp-onr'],
  ['scorp-dist', 'scorp-dist'],
  ['scorp-return-4797', 'scorp-4797'],
  ['scorp-return-other', 'scorp-oi'],
  ['scorp-return-dep', 'scorp-dep'],
  ['scorp-return-depletion', 'scorp-depl'],
  ['scorp-return-meals', 'scorp-meals'],
  ['pt-ord', 'k1-ord'],
  ['pt-rre', 'k1-rre'],
  ['pt-onr', 'k1-onr'],
  ['pt-gp', 'k1-gp'],
  ['pt-dist', 'k1-dist'],
  ['pt-return-4797', 'k1-4797'],
  ['pt-return-other', 'k1-oi'],
  ['pt-return-dep', 'k1-dep'],
  ['pt-return-depletion', 'k1-depl'],
  ['pt-return-meals', 'k1-meals'],
  ['form-8825-dep', 'k1-dep8825'],
  ['form-8825-dep', 'scorp-dep8825'],
  ['pt-profit-pct', 'k1-profit-pct'],
  ['c1120-taxable', 'ccorp-ti'],
  ['c1120-tax', 'ccorp-tax'],
  ['schedule-f-net', 'farm-net'],
  ['schedule-f-depreciation', 'farm-dep'],
  ['schedule-b-interest', 'asset-interestIncome'],
  ['schedule-b-dividends', 'asset-dividendIncome'],
  ['schedule-d-capital-gain-loss', 'asset-capitalGainsNetLoss'],
  ['ent2-address', 'rental-address'],
  ['ent2-type', 'rental-propertyType'],
  ['ent2-rent', 'rental-rentsReceived'],
  ['ent2-ins', 'rental-insurance'],
  ['ent2-int', 'rental-mortgageInterest'],
  ['ent2-tax', 'rental-taxes'],
  ['ent2-dep', 'rental-depreciation'],
  ['ent2-hoa', 'rental-hoaDues'],
  ['ent2-exp', 'rental-totalExpenses'],
  ['ent2-net', 'rental-netIncomeLoss'],
  ['ent2-days', 'rental-fairRentalDays'],
];

function stem(id: string): string {
  return id.replace(/--.*$/, '').replace(/-y[12]$/, '').replace(/-year[12]$/, '');
}

function yearSuffix(id: string): 'y1' | 'y2' {
  if (/-y2|-year2|--.*p1\b/i.test(id)) return 'y2';
  return 'y1';
}

export function inspectFamily(id: string): string[] {
  const raw = id.replace(/--.*$/, '');
  const s = stem(raw);
  const pair = STEM.find(
    ([mapper, qa]) =>
      mapper === s
      || qa === s
      || raw === mapper
      || raw === qa
      || raw.startsWith(`${qa}-`)
      || raw.startsWith(`${mapper}-`)
      || s.startsWith(`${qa}-`)
      || s.startsWith(`${mapper}-`),
  );
  if (!pair) return [id, raw, s];
  const y = yearSuffix(id);
  return [id, raw, pair[0], pair[1], `${pair[1]}-${y}`, `${pair[0]}-${y}`];
}

export function fieldSelected(selectedId: string | null, qaId: string): boolean {
  if (!selectedId) return false;
  const a = inspectFamily(selectedId);
  const b = inspectFamily(qaId);
  return a.some((id) => b.includes(id));
}

export function tabForMappedForm(form: string): string | null {
  if (form === 'W-2' || form === 'Paystub' || form === 'WVOE') return 'PAYSTUB_RECONCILIATION';
  if (form === 'Schedule C') return 'SCHEDULE_C';
  if (form === 'Form 1120-S') return 'SCORP';
  if (form === 'Form 1065') return 'PARTNERSHIP';
  if (form === 'Form 1120') return 'CCORP';
  if (form === 'Schedule F') return 'SCHEDULE_F';
  if (form === 'Schedule B' || form === 'Schedule D') return 'ASSET_INCOME';
  if (form === 'Form 1040') return 'RETIREMENT';
  if (form === 'Schedule E') return 'SCHEDULE_E';
  return null;
}

const TAB_PAGE_PATTERNS: Record<string, RegExp[]> = {
  PAYSTUB_RECONCILIATION: [/\bW-2\b/i, /Wage and Tax Statement/i, /Paystub/i, /WVOE/i, /Verification of Employment/i],
  SCHEDULE_C: [/Schedule C/i],
  SCORP: [/Form 1120S \(S-Corporation/i, /Schedule K-1 \(1120/i],
  CCORP: [/Form 1120 \(C-Corporation/i],
  PARTNERSHIP: [/Form 1065 \(Partnership/i, /Schedule K-1 \(1065\)/i],
  SCHEDULE_F: [/Schedule F/i],
  ASSET_INCOME: [/Schedule B/i, /Schedule D/i],
  RETIREMENT: [/Form 1040 \(Individual Return\)/i],
  SCHEDULE_E: [/Schedule E/i],
};

export function pagesForIncomeTab(
  tab: string,
  pages: Array<{ index: number; formIds: string[]; words?: Array<{ text: string }> }>,
  mappedFields: Array<{ form: string; pageIndex: number }>,
): number[] {
  if (tab === 'ENCOMPASS_SYNC') return pages.map((page) => page.index);
  const patterns = TAB_PAGE_PATTERNS[tab] ?? [];
  const fromPages = pages
    .filter((page) => {
      const blob = page.formIds.join(' ');
      if (tab === 'PAYSTUB_RECONCILIATION' && /1040|Schedule [BCDEF]/i.test(blob) && !/\bW-2\b|Paystub|WVOE/i.test(blob)) {
        return false;
      }
      if (tab === 'SCHEDULE_E') {
        if (pageLooksLikeScheduleERentals(page)) return true;
        if (/Page 2 - K-1s|Part III Trusts/i.test(blob) && !/Page 1 - Rentals/i.test(blob)) return false;
      }
      return patterns.some((pattern) => pattern.test(blob));
    })
    .map((page) => page.index);
  const fromFields = mappedFields
    .filter((field) => tabForMappedForm(field.form) === tab)
    .map((field) => field.pageIndex);
  return [...new Set([...fromPages, ...fromFields])].sort((a, b) => a - b);
}
