import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PlusCircle, ShieldCheck, Trash2 } from 'lucide-react';
import {
  processUsdaStandaloneCalculationV2,
  type UsdaEngineResult,
  type UsdaHouseholdMember,
  type UsdaSelfEmploymentInput,
} from '@mortgage-pos/mortgage-engine';

type HouseholdRow = Omit<UsdaHouseholdMember, 'isBorrower' | 'isSpouse' | 'selfEmployment'> & {
  id: string;
};

export default function UsdaDistributionToggle({
  embedded = false,
  loanId = 'LN-2026-88042',
  borrowerName = 'Sarah K. Vance',
  borrowerEarnedIncomeMonthly = 7660,
  borrowerSelfEmployment = [],
  onCalculation,
}: {
  embedded?: boolean;
  loanId?: string;
  borrowerName?: string;
  borrowerEarnedIncomeMonthly?: number;
  borrowerSelfEmployment?: UsdaSelfEmploymentInput[];
  onCalculation?: (result: UsdaEngineResult) => void;
}) {
  const [countyIncomeLimit, setCountyIncomeLimit] = useState(115000);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdRow[]>([
    {
      id: 'member-jordan',
      name: 'Jordan Vance',
      age: 20,
      isFullTimeStudent: true,
      earnedIncomeMonthly: 1200,
      unearnedIncomeMonthly: 0,
    },
  ]);

  const calculation = useMemo(() => {
    const result = processUsdaStandaloneCalculationV2({
      loanId,
      countyMedianIncomeLimit: countyIncomeLimit,
      householdMembers: [
        {
          name: borrowerName,
          age: 38,
          isBorrower: true,
          isSpouse: false,
          isFullTimeStudent: false,
          earnedIncomeMonthly: borrowerEarnedIncomeMonthly,
          unearnedIncomeMonthly: 0,
          selfEmploymentBusinesses: borrowerSelfEmployment,
        },
        ...householdMembers.map(({ id: _id, ...member }) => ({
          ...member,
          isBorrower: false,
          isSpouse: false,
        })),
      ],
      bankTransactions: [],
    });
    onCalculation?.(result);
    return result;
  }, [
    loanId,
    countyIncomeLimit,
    borrowerName,
    borrowerEarnedIncomeMonthly,
    borrowerSelfEmployment,
    householdMembers,
    onCalculation,
  ]);

  const patchMember = (id: string, patch: Partial<HouseholdRow>) =>
    setHouseholdMembers((members) => members.map((member) => member.id === id ? { ...member, ...patch } : member));

  const addMember = () => {
    const id = crypto.randomUUID();
    setHouseholdMembers((members) => [...members, {
      id,
      name: `Household member ${members.length + 1}`,
      age: 18,
      isFullTimeStudent: false,
      earnedIncomeMonthly: 0,
      unearnedIncomeMonthly: 0,
    }]);
  };

  return (
    <section className={`${embedded ? '' : 'mx-auto max-w-5xl'} space-y-5 rounded-2xl border border-emerald-300 bg-white p-5 shadow-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-emerald-950">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            USDA Rural Development · Dual-Track Income
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Income-service inputs only. AI 1003 data is not read or imported.
          </p>
        </div>
        <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">
          County household income limit
          <input
            type="number"
            value={countyIncomeLimit}
            onChange={(event) => setCountyIncomeLimit(Number(event.target.value))}
            className="ml-2 w-32 rounded border border-slate-300 px-2 py-1.5 text-right font-mono text-xs text-slate-900"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Repayment income · DTI" value={`${money(calculation.repaymentIncomeMonthly)}/mo`} />
        <Metric label="Annual household income" value={`${money(calculation.annualHouseholdIncome)}/yr`} />
        <div className={`rounded-xl border p-4 ${calculation.isEligibleByIncome ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Adjusted eligibility income</p>
          <p className="mt-1 text-xl font-black text-slate-950">{money(calculation.adjustedAnnualIncome)}/yr</p>
          <p className={`mt-1 flex items-center gap-1 text-[10px] font-black uppercase ${calculation.isEligibleByIncome ? 'text-emerald-700' : 'text-rose-700'}`}>
            {calculation.isEligibleByIncome ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {calculation.isEligibleByIncome ? 'Within income limit' : 'Over income limit'}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">Household members</h3>
            <p className="mt-1 text-[11px] text-slate-500">Entered directly in the income tool for USDA eligibility only.</p>
          </div>
          <button type="button" onClick={addMember} className="flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-[10px] font-black uppercase text-emerald-700">
            <PlusCircle className="h-3.5 w-3.5" />
            Add member
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {householdMembers.map((member) => (
            <div key={member.id} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[1.4fr_.6fr_1fr_1fr_auto]">
              <Input label="Name" value={member.name} onChange={(value) => patchMember(member.id, { name: value })} />
              <Input label="Age" type="number" value={member.age} onChange={(value) => patchMember(member.id, { age: Number(value) })} />
              <Input label="Earned / mo" type="number" value={member.earnedIncomeMonthly} onChange={(value) => patchMember(member.id, { earnedIncomeMonthly: Number(value) })} />
              <Input label="Unearned / mo" type="number" value={member.unearnedIncomeMonthly} onChange={(value) => patchMember(member.id, { unearnedIncomeMonthly: Number(value) })} />
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-1 pb-1.5 text-[9px] font-black uppercase text-slate-500">
                  <input
                    type="checkbox"
                    checked={member.isFullTimeStudent}
                    onChange={(event) => patchMember(member.id, { isFullTimeStudent: event.target.checked })}
                  />
                  Student
                </label>
                <button type="button" onClick={() => setHouseholdMembers((members) => members.filter((row) => row.id !== member.id))} className="mb-0.5 rounded p-1.5 text-rose-500 hover:bg-rose-50" aria-label={`Remove ${member.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {householdMembers.length === 0 ? <p className="text-xs text-slate-500">No additional household members entered.</p> : null}
        </div>
      </div>

      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-950">
        <strong>USDA rules active:</strong> repayment income includes eligible borrower business add-backs; household eligibility uses all household members and excludes those add-backs. Adult full-time student earned income is capped at $500 annually, and minor earned income is excluded.
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
    </div>
  );
}

function Input({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string | number;
  type?: 'text' | 'number';
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-slate-900"
      />
    </label>
  );
}

function money(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
