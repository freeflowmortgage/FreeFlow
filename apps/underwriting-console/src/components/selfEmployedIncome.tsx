import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

export const MILEAGE_DEP_RATE = 0.3;

export type SchCYear = {
  year: number;
  line31: number;
  line13: number;
  line30: number;
  line44aMiles: number;
  line24bMeals: number;
};

export type CorpYear = {
  year: number;
  ordinaryIncome: number;        // K-1 Box 1
  netRentalRealEstate: number;   // K-1 Box 2
  otherNetRental: number;        // K-1 Box 3
  depreciation: number;
  depletion: number;
  mealsM1: number;
  guaranteedPayments: number;    // K-1 Box 4 (1065 only)
  otherNoncash: number;
  w2Wages: number;
  distributions: number;         // K-1 Box 19A (1065) / Box 16D (1120-S)
};

export type ScheduleL = {
  cash: number;
  receivables: number;
  allowance: number;
  taxExempt: number;
  otherCurrentAssets: number;
  accountsPayable: number;
  notesLt1Yr: number;
  otherCurrentLiab: number;
};

export type YtdPnl = {
  received: boolean;
  throughDate: string;
  netProfit: number;
  depreciation: number;
  otherAddbacks: number;
};

export const EMPTY_PNL: YtdPnl = {
  received: false,
  throughDate: '',
  netProfit: 0,
  depreciation: 0,
  otherAddbacks: 0,
};

export type CCorpYear = {
  year: number;
  taxableIncome: number;
  totalTaxPaid: number;
  depreciation: number;
  depletion: number;
  amortization: number;
  mealsM1: number;
  nol: number;
  w2Wages: number;
  dividends: number;
};

export function cCorpBusinessAnnual(row: CCorpYear, ownershipPct: number, liquidityPassed: boolean) {
  const w2AndDiv = row.w2Wages + row.dividends;
  if (ownershipPct < 25 || !liquidityPassed) return w2AndDiv;
  const share =
    (row.taxableIncome - row.totalTaxPaid + row.depreciation + row.depletion + row.amortization - row.mealsM1 + row.nol) *
    (ownershipPct / 100);
  return share + w2AndDiv;
}

export function pnlAnnual(pnl: YtdPnl) {
  if (!pnl.received) return 0;
  return pnl.netProfit + pnl.depreciation + pnl.otherAddbacks;
}

export function ProfitLossBlock({
  pnl,
  onChange,
  loanProgram,
}: {
  pnl: YtdPnl;
  onChange: (next: YtdPnl) => void;
  loanProgram: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA';
}) {
  const government = loanProgram === 'FHA' || loanProgram === 'VA' || loanProgram === 'USDA';
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Year-to-date profit &amp; loss</h4>
          <p className="text-[11px] text-slate-500">
            {government
              ? 'Required if the file is dated April 1 or later, or the most recent tax year is not yet filed.'
              : 'P&L is not required for Conventional. Fill this block when a statement is received.'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={pnl.received}
            onChange={(event) => onChange({ ...pnl, received: event.target.checked })}
          />
          P&amp;L received
        </label>
      </div>
      {pnl.received ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <label className="text-[10px] font-extrabold uppercase text-slate-500">
            Through date
            <input
              type="date"
              value={pnl.throughDate}
              onChange={(event) => onChange({ ...pnl, throughDate: event.target.value })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="text-[10px] font-extrabold uppercase text-slate-500">
            Net profit / (loss)
            <input
              type="number"
              value={pnl.netProfit}
              onChange={(event) => onChange({ ...pnl, netProfit: Number(event.target.value) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="text-[10px] font-extrabold uppercase text-slate-500">
            Depreciation add-back
            <input
              type="number"
              value={pnl.depreciation}
              onChange={(event) => onChange({ ...pnl, depreciation: Number(event.target.value) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
          <label className="text-[10px] font-extrabold uppercase text-slate-500">
            Other add-backs
            <input
              type="number"
              value={pnl.otherAddbacks}
              onChange={(event) => onChange({ ...pnl, otherAddbacks: Number(event.target.value) })}
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm text-slate-900"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

export type FacsimileLine = {
  id: string;
  line: string;
  label: string;
  value: string;
};

export function usd(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function schCAnnual(row: SchCYear) {
  return row.line31 + row.line13 + row.line30 + row.line44aMiles * MILEAGE_DEP_RATE + row.line24bMeals;
}

export function corpBusinessAnnual(row: CorpYear, ownershipPct: number) {
  const business =
    row.ordinaryIncome +
    row.netRentalRealEstate +
    row.otherNetRental +
    row.depreciation +
    row.depletion +
    row.mealsM1 +
    row.otherNoncash +
    row.guaranteedPayments;
  return business * (ownershipPct / 100);
}

/**
 * Under-25% ownership: borrower is not self-employed. Usable income is limited to
 * the K-1 income boxes (1, 2, 3 and guaranteed payments) with NO business-level
 * non-cash add-backs, capped at actual distributions received when distributions
 * are documented (> 0).
 */
export function corpMinorityAnnual(row: CorpYear, ownershipPct: number) {
  const k1Income =
    (row.ordinaryIncome + row.netRentalRealEstate + row.otherNetRental + row.guaranteedPayments) *
    (ownershipPct / 100);
  const capped = row.distributions > 0 ? Math.min(k1Income, row.distributions) : k1Income;
  return { k1Income, capped, wasCapped: row.distributions > 0 && k1Income > row.distributions };
}

export function monthlyFromYears(year1: number, year2: number, twoYears: boolean) {
  if (!twoYears) return year1 / 12;
  return (year1 + year2) / 24;
}

export function declining(year1: number, year2: number) {
  if (year2 <= 0) return false;
  return (year2 - year1) / year2 >= 0.2;
}

export function scheduleLQuickRatio(sheet: ScheduleL) {
  const assets =
    sheet.cash + (sheet.receivables - sheet.allowance) + sheet.taxExempt + sheet.otherCurrentAssets;
  const liabilities = sheet.accountsPayable + sheet.notesLt1Yr + sheet.otherCurrentLiab;
  const quickRatio = liabilities > 0 ? assets / liabilities : 999;
  return { assets, liabilities, quickRatio, passes: quickRatio >= 1 };
}

export function LineRow({
  line,
  label,
  hint,
  value,
  selected,
  onSelect,
  onChange,
}: {
  line: string;
  label: string;
  hint?: string;
  value: number;
  selected?: boolean;
  onSelect: () => void;
  onChange: (next: number) => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        selected ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-[4.5rem] shrink-0 text-left font-mono text-[10px] font-black uppercase text-slate-500"
      >
        {line}
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-800">
        {label}
        {hint ? <span className="ml-1 font-normal text-slate-400">· {hint}</span> : null}
      </button>
      <input
        type="number"
        value={value}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right font-mono text-sm font-bold text-slate-950 outline-none focus:border-emerald-500"
      />
    </div>
  );
}

export function YearStack({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div>
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">{title}</h4>
        {subtitle ? <p className="text-[10px] text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function FacsimileSheet({
  form,
  year,
  entity,
  lines,
  selectedId,
  onSelect,
  fillHeight = false,
}: {
  form: string;
  year: number;
  entity: string;
  lines: FacsimileLine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Expand to the viewport height (popped-out dual-monitor document pane) */
  fillHeight?: boolean;
}) {
  return (
    <div className={`${fillHeight ? 'h-[calc(100vh-170px)]' : 'h-[540px]'} overflow-auto rounded-lg border border-slate-300 bg-[#f8f6f1] p-4 shadow-inner`}>
      <div className="min-h-full rounded border-2 border-slate-900 bg-white p-4 text-slate-900">
        <div className="mb-3 flex items-start justify-between border-b-2 border-slate-900 pb-2">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Department of the Treasury — Internal Revenue Service</p>
            <h3 className="text-sm font-black tracking-tight">{form}</h3>
            <p className="text-[10px] text-slate-600">{entity}</p>
          </div>
          <span className="font-mono text-lg font-black">{year}</span>
        </div>
        <div className="space-y-2">
          {lines.map((item) => {
            const selected = selectedId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-center justify-between rounded border px-2.5 py-2 text-left ${
                  selected
                    ? 'border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/40'
                    : 'border-slate-200 hover:border-slate-400'
                }`}
              >
                <span className="pr-3">
                  <span className="block font-mono text-[9px] font-black uppercase text-slate-500">{item.line}</span>
                  <span className="text-[11px] font-semibold text-slate-800">{item.label}</span>
                </span>
                <span className="font-mono text-sm font-black text-slate-950">{item.value}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[8px] uppercase tracking-widest text-slate-400">FreeFlow sandbox facsimile · click a box to highlight the working row</p>
      </div>
    </div>
  );
}

export function LiquidityBlock({
  sheet,
  onChange,
  selectedId,
  onSelect,
}: {
  sheet: ScheduleL;
  onChange: (next: ScheduleL) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ratio = scheduleLQuickRatio(sheet);
  const rows: Array<{ id: keyof ScheduleL; line: string; label: string }> = [
    { id: 'cash', line: 'L1', label: 'Cash' },
    { id: 'receivables', line: 'L2a', label: 'Trade notes / accounts receivable' },
    { id: 'allowance', line: 'L2b', label: 'Less allowance for bad debts' },
    { id: 'taxExempt', line: 'L4', label: 'Tax-exempt securities' },
    { id: 'otherCurrentAssets', line: 'L6', label: 'Other current assets' },
    { id: 'accountsPayable', line: 'L16', label: 'Accounts payable' },
    { id: 'notesLt1Yr', line: 'L17', label: 'Mortgages / notes payable in < 1 year' },
    { id: 'otherCurrentLiab', line: 'L18', label: 'Other current liabilities' },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">Schedule L liquidity (after the two-year analysis)</h4>
          <p className="text-[11px] text-slate-500">Fannie/Freddie: quick ratio must be ≥ 1.0 before business income (other than W-2 / guaranteed payments) can qualify.</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${
            ratio.passes ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
          }`}
        >
          {ratio.passes ? 'Passed' : 'Failed — business income $0'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {rows.map((row) => (
          <LineRow
            key={row.id}
            line={row.line}
            label={row.label}
            value={sheet[row.id]}
            selected={selectedId === `schl-${row.id}`}
            onSelect={() => onSelect(`schl-${row.id}`)}
            onChange={(next) => onChange({ ...sheet, [row.id]: next })}
          />
        ))}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-600">
          Quick ratio · {usd(ratio.assets)} assets / {usd(ratio.liabilities)} liabilities
        </span>
        <span className={`font-black ${ratio.passes ? 'text-emerald-700' : 'text-rose-700'}`}>{ratio.quickRatio.toFixed(2)}</span>
      </div>
    </div>
  );
}

export function TwoYearToggle({
  twoYears,
  onChange,
  caption,
}: {
  twoYears: boolean;
  onChange: (next: boolean) => void;
  caption?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${
          !twoYears ? 'bg-slate-900 text-white' : 'text-slate-500'
        }`}
      >
        1 year
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${
          twoYears ? 'bg-slate-900 text-white' : 'text-slate-500'
        }`}
      >
        2 years
      </button>
      {caption ? <span className="hidden text-[10px] text-slate-500 sm:inline">{caption}</span> : null}
    </div>
  );
}

export function QualifyingBar({
  y1,
  y2,
  twoYears,
  monthly,
  dropped,
}: {
  y1: number;
  y2: number;
  twoYears: boolean;
  monthly: number;
  dropped?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-4 text-xs">
        <span>
          <span className="font-bold text-slate-500">Year 1 cash flow </span>
          <span className="font-black text-slate-900">{usd(y1)}</span>
        </span>
        {twoYears ? (
          <span>
            <span className="font-bold text-slate-500">Year 2 cash flow </span>
            <span className="font-black text-slate-900">{usd(y2)}</span>
          </span>
        ) : null}
        {twoYears && declining(y1, y2) ? (
          <span className="font-bold text-amber-700">Declining — 24-month average used (warning only)</span>
        ) : null}
        {dropped ? <span className="font-bold text-rose-700">Business income excluded (liquidity)</span> : null}
      </div>
      <div className="text-right">
        <p className="text-[10px] font-black uppercase text-emerald-800">Qualifying monthly</p>
        <p className="text-xl font-black text-slate-950">{usd(monthly)}/mo</p>
      </div>
    </div>
  );
}

export type AvgOption = {
  id: string;
  label: string;
  monthly: number;
  formula: string;
};

export function seAvgOptions(
  y1: number,
  y2: number,
  twoYears: boolean,
  dropped?: boolean,
  restrictedMonthly = 0,
): AvgOption[] {
  const options: AvgOption[] = [
    { id: 'y1', label: 'Most recent year', monthly: y1 / 12, formula: 'Year 1 cash flow / 12' },
  ];
  if (twoYears) {
    options.push(
      { id: 'avg24', label: '24-month average', monthly: (y1 + y2) / 24, formula: '(Year 1 + Year 2) / 24' },
      { id: 'y2', label: 'Prior year', monthly: y2 / 12, formula: 'Year 2 cash flow / 12' },
      { id: 'lower', label: 'Lower of the two years', monthly: Math.min(y1, y2) / 12, formula: 'Min(Year 1, Year 2) / 12' },
    );
  }
  
  options.push({ id: 'not_used', label: 'Not used', monthly: 0, formula: 'Underwriter elected to exclude' });

  if (dropped) {
    return [
      {
        id: 'restricted',
        label: 'W-2 / guaranteed payments only',
        monthly: restrictedMonthly,
        formula: 'Business income excluded — liquidity failed',
      },
      ...options,
    ];
  }
  return options;
}

export function seRecommend(
  y1: number,
  y2: number,
  twoYears: boolean,
  dropped?: boolean,
  loanProgram?: 'CONVENTIONAL' | 'FHA' | 'VA' | 'USDA',
): { id: string; reason: string } {
  if (dropped) {
    return {
      id: 'restricted',
      reason:
        'Schedule L quick ratio is under 1.0. Guideline drops business income and keeps only officer W-2 or guaranteed payments.',
    };
  }
  if (!twoYears) {
    if (loanProgram === 'FHA' || loanProgram === 'VA' || loanProgram === 'USDA') {
      return {
        id: 'y1',
        reason:
          'One year on file. Request an additional year of returns and a year-to-date P&L if required (file dated April 1 or later, or the most recent tax year is not yet filed).',
      };
    }
    return {
      id: 'y1',
      reason:
        'One-year cash flow ÷ 12. If the business is under 5 years, request two years of returns.',
    };
  }
  if (declining(y1, y2)) {
    return {
      id: 'avg24',
      reason:
        'Two years in file — 24-month average (Year 1 + Year 2) ÷ 24. Income declined year over year; that is a warning only and does not switch the guideline pick to the lower year.',
    };
  }
  return {
    id: 'avg24',
    reason: 'Two years in file — 24-month average (Year 1 + Year 2) ÷ 24.',
  };
}

export function chosenMonthly(options: AvgOption[], selectedId: string | null, recommendedId: string) {
  const id = selectedId && options.some((option) => option.id === selectedId) ? selectedId : recommendedId;
  return options.find((option) => option.id === id) ?? options[0];
}

export function IncomeChoicePanel({
  options,
  recommendedId,
  reason,
  selectedId,
  onSelect,
}: {
  options: AvgOption[];
  recommendedId: string;
  reason: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const chosen = chosenMonthly(options, selectedId, recommendedId);
  const overridden = chosen.id !== recommendedId;
  const recommended = options.find((option) => option.id === recommendedId);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800">Final income used on this page</p>
          <p className="text-2xl font-black text-slate-950">{usd(chosen.monthly)}/mo</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">
            <span className="font-bold text-slate-900">{overridden ? 'UW override. ' : 'Guideline pick. '}</span>
            {overridden && recommended ? `Guideline still recommends ${recommended.label} (${usd(recommended.monthly)}/mo). ` : null}
            {reason}
          </p>
        </div>
        {overridden ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-[10px] font-black uppercase text-emerald-800"
          >
            Reset to guideline
          </button>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-800">Guideline</span>
        )}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Click a different average to use it on this file</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {options.map((option) => {
          const active = option.id === chosen.id;
          const rec = option.id === recommendedId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id === recommendedId ? null : option.id)}
              className={`rounded-lg border p-3 text-left ${
                active ? 'border-emerald-600 bg-white ring-2 ring-emerald-500/30' : 'border-slate-200 bg-white hover:border-slate-400'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase text-slate-500">{option.label}</span>
                {rec ? <span className="text-[9px] font-black uppercase text-emerald-700">Rec</span> : null}
              </span>
              <span className="mt-1 block font-mono text-lg font-black text-slate-950">{usd(option.monthly)}</span>
              <span className="text-[10px] text-slate-500">{option.formula}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function InspectNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
      Click a line label or the PDF box. Amount stays on the same row — type to override.
    </p>
  );
}

export function PaystubFacsimile({
  employer,
  borrower,
  hourly,
  hours,
  periodPay,
  ytd,
  selectedId,
  onSelect,
  fillHeight = false,
}: {
  employer: string;
  borrower: string;
  hourly: number;
  hours: number;
  periodPay: number;
  ytd: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  fillHeight?: boolean;
}) {
  const lines: FacsimileLine[] = [
    { id: 'ps-emp-name', line: 'Employer', label: 'Employer name', value: employer },
    { id: 'ps-ee-name', line: 'Employee', label: 'Employee name', value: borrower },
    { id: 'ps-hourly-rate', line: 'Rate', label: 'Hourly pay rate', value: `$${hourly.toFixed(2)}/hr` },
    { id: 'ps-hours-week', line: 'Hours', label: 'Standard weekly hours', value: `${hours} hrs` },
    { id: 'ps-current-base', line: 'Current', label: 'Period base pay', value: usd(periodPay) },
    { id: 'ps-base-ytd', line: 'YTD', label: 'Base wages year-to-date', value: usd(ytd) },
  ];
  return (
    <FacsimileSheet
      form="Earnings statement"
      year={2026}
      entity={`${employer} · pay period 08/01–08/15`}
      lines={lines}
      selectedId={selectedId}
      onSelect={onSelect}
      fillHeight={fillHeight}
    />
  );
}

export function SelfEmployedPanel({
  title,
  subtitle,
  twoYears,
  onTwoYears,
  twoYearCaption,
  extra,
  children,
  choiceOptions,
  recommendedId,
  reason,
  choiceId,
  onChoice,
}: {
  title: string;
  subtitle: string;
  twoYears: boolean;
  onTwoYears: (next: boolean) => void;
  twoYearCaption?: string;
  extra?: ReactNode;
  children: ReactNode;
  choiceOptions: AvgOption[];
  recommendedId: string;
  reason: string;
  choiceId: string | null;
  onChoice: (id: string | null) => void;
}) {
  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <TwoYearToggle twoYears={twoYears} onChange={onTwoYears} caption={twoYearCaption} />
        </div>
      </div>
      {children}
      <IncomeChoicePanel
        options={choiceOptions}
        recommendedId={recommendedId}
        reason={reason}
        selectedId={choiceId}
        onSelect={onChoice}
      />
    </div>
  );
}

export function SchCLines({
  row,
  yearKey,
  selectedId,
  onSelect,
  onChange,
}: {
  row: SchCYear;
  yearKey: 'y1' | 'y2';
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<SchCYear>) => void;
}) {
  const id = (key: string) => `schc-${key}-${yearKey}`;
  return (
    <>
      <LineRow line="L31" label="Net profit or loss" value={row.line31} selected={selectedId === id('l31')} onSelect={() => onSelect(id('l31'))} onChange={(n) => onChange({ line31: n })} />
      <LineRow line="L13" label="Depreciation" hint="add-back" value={row.line13} selected={selectedId === id('l13')} onSelect={() => onSelect(id('l13'))} onChange={(n) => onChange({ line13: n })} />
      <LineRow line="L30" label="Business use of home" hint="add-back" value={row.line30} selected={selectedId === id('l30')} onSelect={() => onSelect(id('l30'))} onChange={(n) => onChange({ line30: n })} />
      <LineRow line="L44a" label="Business miles" hint={`× $${MILEAGE_DEP_RATE.toFixed(2)} dep. portion`} value={row.line44aMiles} selected={selectedId === id('l44a')} onSelect={() => onSelect(id('l44a'))} onChange={(n) => onChange({ line44aMiles: n })} />
      <LineRow
        line="L24b"
        label="Meals"
        hint="deductible 50% on the return; 1084 add-back = this box"
        value={row.line24bMeals}
        selected={selectedId === id('l24b')}
        onSelect={() => onSelect(id('l24b'))}
        onChange={(n) => onChange({ line24bMeals: n })}
      />
    </>
  );
}

export function CorpLines({
  row,
  yearKey,
  kind,
  selectedId,
  onSelect,
  onChange,
}: {
  row: CorpYear;
  yearKey: 'y1' | 'y2';
  kind: 'scorp' | 'partnership';
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<CorpYear>) => void;
}) {
  const p = kind === 'scorp' ? 'scorp' : 'k1';
  const id = (key: string) => `${p}-${key}-${yearKey}`;
  return (
    <>
      <LineRow line="K-1 1" label="Ordinary business income" value={row.ordinaryIncome} selected={selectedId === id('ord')} onSelect={() => onSelect(id('ord'))} onChange={(n) => onChange({ ordinaryIncome: n })} />
      <LineRow line="K-1 2" label="Net rental real estate" value={row.netRentalRealEstate} selected={selectedId === id('rre')} onSelect={() => onSelect(id('rre'))} onChange={(n) => onChange({ netRentalRealEstate: n })} />
      <LineRow line="K-1 3" label="Other net rental income" value={row.otherNetRental} selected={selectedId === id('onr')} onSelect={() => onSelect(id('onr'))} onChange={(n) => onChange({ otherNetRental: n })} />
      {kind === 'partnership' ? (
        <LineRow line="K-1 4" label="Guaranteed payments" value={row.guaranteedPayments} selected={selectedId === id('gp')} onSelect={() => onSelect(id('gp'))} onChange={(n) => onChange({ guaranteedPayments: n })} />
      ) : (
        <LineRow line="W-2" label="Officer W-2 wages" hint="counts even if liquidity fails" value={row.w2Wages} selected={selectedId === id('w2')} onSelect={() => onSelect(id('w2'))} onChange={(n) => onChange({ w2Wages: n })} />
      )}
      <LineRow
        line={kind === 'partnership' ? 'K-1 19A' : 'K-1 16D'}
        label="Distributions received"
        hint="caps K-1 income unless stable history"
        value={row.distributions}
        selected={selectedId === id('dist')}
        onSelect={() => onSelect(id('dist'))}
        onChange={(n) => onChange({ distributions: n })}
      />
      <LineRow line="4562" label="Depreciation" hint="add-back × ownership (≥25% only)" value={row.depreciation} selected={selectedId === id('dep')} onSelect={() => onSelect(id('dep'))} onChange={(n) => onChange({ depreciation: n })} />
      <LineRow line="M-1" label="Non-deductible meals" hint="add-back" value={row.mealsM1} selected={selectedId === id('meals')} onSelect={() => onSelect(id('meals'))} onChange={(n) => onChange({ mealsM1: n })} />
      <LineRow line="Other" label="Other non-cash" value={row.otherNoncash} selected={selectedId === id('other')} onSelect={() => onSelect(id('other'))} onChange={(n) => onChange({ otherNoncash: n })} />
    </>
  );
}

export function CCorpLines({
  row,
  yearKey,
  selectedId,
  onSelect,
  onChange,
}: {
  row: CCorpYear;
  yearKey: 'y1' | 'y2';
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<CCorpYear>) => void;
}) {
  const id = (key: string) => `ccorp-${key}-${yearKey}`;
  return (
    <>
      <LineRow line="L28" label="Taxable income" value={row.taxableIncome} selected={selectedId === id('ti')} onSelect={() => onSelect(id('ti'))} onChange={(n) => onChange({ taxableIncome: n })} />
      <LineRow line="L31" label="Total tax" hint="subtract" value={row.totalTaxPaid} selected={selectedId === id('tax')} onSelect={() => onSelect(id('tax'))} onChange={(n) => onChange({ totalTaxPaid: n })} />
      <LineRow line="4562" label="Depreciation" hint="add-back" value={row.depreciation} selected={selectedId === id('dep')} onSelect={() => onSelect(id('dep'))} onChange={(n) => onChange({ depreciation: n })} />
      <LineRow line="M-1" label="Non-deductible meals" hint="add-back" value={row.mealsM1} selected={selectedId === id('meals')} onSelect={() => onSelect(id('meals'))} onChange={(n) => onChange({ mealsM1: n })} />
      <LineRow line="NOL" label="NOL / special deductions" value={row.nol} selected={selectedId === id('nol')} onSelect={() => onSelect(id('nol'))} onChange={(n) => onChange({ nol: n })} />
      <LineRow line="W-2" label="Officer W-2 wages" hint="counts even if liquidity fails" value={row.w2Wages} selected={selectedId === id('w2')} onSelect={() => onSelect(id('w2'))} onChange={(n) => onChange({ w2Wages: n })} />
      <LineRow line="1099" label="Borrower dividends" value={row.dividends} selected={selectedId === id('div')} onSelect={() => onSelect(id('div'))} onChange={(n) => onChange({ dividends: n })} />
    </>
  );
}

export function DemoDocumentCanvas({
  tab,
  yearIndex,
  onYearIndex,
  twoYear,
  selectedId,
  onSelect,
  schC,
  corp,
  scheduleL,
  showLiquidity,
  paystub,
  fillHeight = false,
}: {
  tab: string;
  yearIndex: 0 | 1;
  onYearIndex: (index: 0 | 1) => void;
  twoYear: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  schC: SchCYear;
  corp: CorpYear;
  scheduleL: ScheduleL;
  showLiquidity: boolean;
  paystub: {
    employer: string;
    borrower: string;
    hourly: number;
    hours: number;
    periodPay: number;
    ytd: number;
  };
  fillHeight?: boolean;
}) {
  const yk = yearIndex === 0 ? 'y1' : 'y2';
  const year = tab === 'SCHEDULE_C' ? schC.year : corp.year;
  const isWage = tab === 'PAYSTUB_RECONCILIATION' || tab === 'ENCOMPASS_SYNC';
  const isRental = tab === 'SCHEDULE_E';

  if (isWage) {
    return (
      <PaystubFacsimile
        employer={paystub.employer}
        borrower={paystub.borrower}
        hourly={paystub.hourly}
        hours={paystub.hours}
        periodPay={paystub.periodPay}
        ytd={paystub.ytd}
        selectedId={selectedId}
        onSelect={onSelect}
        fillHeight={fillHeight}
      />
    );
  }

  if (isRental) {
    const schedELines: FacsimileLine[] = [
      { id: `sche-addr-${yk}`, line: 'Line 1a', label: 'Physical address of property', value: '742 Evergreen Terrace' },
      { id: `sche-type-${yk}`, line: 'Line 1b', label: 'Type of property', value: '1 — Single Family' },
      { id: `sche-l2-${yk}`, line: 'Line 2', label: 'Fair rental days', value: '365' },
      { id: `sche-l3-${yk}`, line: 'Line 3', label: 'Rents received', value: usd(24000) },
      { id: `sche-l9-${yk}`, line: 'Line 9', label: 'Insurance (add-back)', value: usd(1200) },
      { id: `sche-l12-${yk}`, line: 'Line 12', label: 'Mortgage interest (add-back)', value: usd(4800) },
      { id: `sche-l16-${yk}`, line: 'Line 16', label: 'Taxes (add-back)', value: usd(2900) },
      { id: `sche-l18-${yk}`, line: 'Line 18', label: 'Depreciation (add-back)', value: usd(3500) },
      { id: `sche-l19-${yk}`, line: 'Line 19', label: 'Other — HOA dues (add-back if in PITIA)', value: usd(0) },
      { id: `sche-l20-${yk}`, line: 'Line 20', label: 'Total expenses', value: usd(14500) },
      { id: `sche-l21-${yk}`, line: 'Line 21', label: 'Net income / (loss)', value: usd(24000 - 14500) },
    ];
    return (
      <div className="space-y-2">
        {twoYear ? (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onYearIndex(0)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${yearIndex === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Year 1
            </button>
            <button
              type="button"
              onClick={() => onYearIndex(1)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${yearIndex === 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Year 2
            </button>
          </div>
        ) : null}
        <FacsimileSheet
          form="Schedule E (Form 1040) – Supplemental Income"
          year={yearIndex === 0 ? 2025 : 2024}
          entity="742 Evergreen Terrace, Springfield, IL · Rental"
          lines={schedELines}
          selectedId={selectedId}
          onSelect={onSelect}
          fillHeight={fillHeight}
        />
      </div>
    );
  }

  const schCLines: FacsimileLine[] = [
    { id: `schc-l31-${yk}`, line: 'Line 31', label: 'Net profit or loss', value: usd(schC.line31) },
    { id: `schc-l13-${yk}`, line: 'Line 13', label: 'Depreciation', value: usd(schC.line13) },
    { id: `schc-l30-${yk}`, line: 'Line 30', label: 'Business use of home', value: usd(schC.line30) },
    { id: `schc-l44a-${yk}`, line: 'Line 44a', label: `Business miles (${schC.line44aMiles.toLocaleString()})`, value: usd(schC.line44aMiles * MILEAGE_DEP_RATE) },
    { id: `schc-l24b-${yk}`, line: 'Line 24b', label: 'Meals (deductible 50%)', value: usd(schC.line24bMeals) },
  ];

  const corpPrefix = tab === 'PARTNERSHIP' ? 'k1' : 'scorp';
  const corpLines: FacsimileLine[] = [
    { id: `${corpPrefix}-ord-${yk}`, line: 'K-1 Box 1', label: 'Ordinary business income', value: usd(corp.ordinaryIncome) },
    { id: `${corpPrefix}-rre-${yk}`, line: 'K-1 Box 2', label: 'Net rental real estate', value: usd(corp.netRentalRealEstate) },
    { id: `${corpPrefix}-onr-${yk}`, line: 'K-1 Box 3', label: 'Other net rental income', value: usd(corp.otherNetRental) },
    tab === 'PARTNERSHIP'
      ? { id: `k1-gp-${yk}`, line: 'K-1 Box 4', label: 'Guaranteed payments', value: usd(corp.guaranteedPayments) }
      : { id: `scorp-w2-${yk}`, line: 'W-2', label: 'Officer wages', value: usd(corp.w2Wages) },
    { id: `${corpPrefix}-dist-${yk}`, line: tab === 'PARTNERSHIP' ? 'K-1 Box 19A' : 'K-1 Box 16D', label: 'Distributions', value: usd(corp.distributions) },
    { id: `${corpPrefix}-dep-${yk}`, line: 'Form 4562', label: 'Depreciation', value: usd(corp.depreciation) },
    { id: `${corpPrefix}-meals-${yk}`, line: 'M-1', label: 'Non-deductible meals', value: usd(corp.mealsM1) },
    { id: `schl-cash`, line: 'Sch L · L1', label: 'Cash', value: usd(scheduleL.cash) },
    { id: `schl-receivables`, line: 'Sch L · L2a', label: 'Receivables', value: usd(scheduleL.receivables) },
    { id: `schl-accountsPayable`, line: 'Sch L · L16', label: 'Accounts payable', value: usd(scheduleL.accountsPayable) },
  ];

  const lines = tab === 'SCHEDULE_C' ? schCLines : showLiquidity ? corpLines : corpLines.slice(0, 7);

  return (
    <div className="space-y-2">
      {twoYear ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onYearIndex(0)}
            className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${yearIndex === 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Year 1
          </button>
          <button
            type="button"
            onClick={() => onYearIndex(1)}
            className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase ${yearIndex === 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Year 2
          </button>
        </div>
      ) : null}
      <FacsimileSheet
        form={tab === 'SCHEDULE_C' ? 'Schedule C (Form 1040)' : tab === 'SCORP' ? 'Form 1120-S / Schedule K-1' : 'Form 1065 / Schedule K-1'}
        year={year}
        entity={tab === 'SCHEDULE_C' ? 'Venture Consulting LLC' : tab === 'SCORP' ? 'Apex Technology Partners LLC' : 'Pine Street Holdings LLP'}
        lines={lines}
        selectedId={selectedId}
        onSelect={onSelect}
        fillHeight={fillHeight}
      />
    </div>
  );
}


