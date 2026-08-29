import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw, 
  HelpCircle, Calendar, FileText, Ban, ArrowRight, Check
} from 'lucide-react';
import { Decimal } from 'decimal.js';

// ────────────────────────────────────────────────────────────────────────
// TYPES & INTERFACES (Aligned with calculateForm1084Income.ts / v9)
// ────────────────────────────────────────────────────────────────────────

interface Form1040Distribution {
  id: string;
  year: number;
  sourceName: string; // e.g., "Fidelity IRA Account"
  totalDistribution: number;
  taxableAmount: number;
  isRecurring: boolean; // Managed by Underwriter Toggle
}

interface UsdaCalculationResult {
  repaymentIncomeMonthly: number;    // DTI (Note Borrowers Only)
  annualHouseholdIncome: number;     // Eligibility Cap (No Add-Backs, Capped FT Students)
  adjustedAnnualIncome: number;      // Household minus standard deductions
  isEligible: boolean;
  warnings: string[];
  conditions: { title: string; docType: string; description: string }[];
}

export default function UsdaDistributionToggle() {
  // 1. DOCKER HANDSHAKE SIMULATION STATES
  const [loanGuid] = useState<string>("8b7e91a0-cf42-4b2a-89bc-98fd8b725c1d");
  const [activeAgency] = useState<string>("USDA-RHS");
  const [countyMedianLimit] = useState<number>(115000); // Standard county limit

  // 2. EXTRACTED DATA STATE (Form 1040 OCR Outputs in volatile tmpfs RAM)
  const [distributions, setDistributions] = useState<Form1040Distribution[]>([
    {
      id: "dist-1",
      year: 2025,
      sourceName: "Traditional IRA Distribution (Form 1040, Line 4b)",
      totalDistribution: 15000,
      taxableAmount: 12000,
      isRecurring: true // Included by default under strict USDA Safeguards
    },
    {
      id: "dist-2",
      year: 2024,
      sourceName: "Pension Distribution (Form 1040, Line 5b)",
      totalDistribution: 8400,
      taxableAmount: 8400,
      isRecurring: true
    }
  ]);

  // Other Household Income baseline for eligibility calculation
  const [householdBaseEarnings] = useState<number>(92000); // Base salaries of occupants

  // 3. MUTATION HANDLER: Toggle Distribution Recurrency Status
  const handleToggleRecurrency = (id: string) => {
    setDistributions(prev => 
      prev.map(dist => 
        dist.id === id ? { ...dist, isRecurring: !dist.isRecurring } : dist
      )
    );
  };

  // 4. REAL-TIME DUAL-TRACK USDA RULES ENGINE (useMemo for maximum performance)
  const calculation: UsdaCalculationResult = useMemo(() => {
    let repaymentAnnualTotal = new Decimal(0);
    let eligibilityAnnualTotal = new Decimal(householdBaseEarnings);
    const warnings: string[] = [];
    const conditions: { title: string; docType: string; description: string }[] = [];

    // Process each extracted distribution
    distributions.forEach(dist => {
      const total = new Decimal(dist.totalDistribution);
      const taxable = new Decimal(dist.taxableAmount);
      const exempt = Decimal.max(0, total.sub(taxable));

      // A. REPAYMENT TRACK (Only count if verified recurring & belongs to primary note borrower)
      if (dist.isRecurring) {
        // USDA/GSE allows 1.25x gross-up of tax-exempt portions
        const qualifyingAnnual = taxable.add(exempt.mul(1.25));
        repaymentAnnualTotal = repaymentAnnualTotal.add(qualifyingAnnual);
      }

      // B. ELIGIBILITY TRACK (Strict USDA Chapter 9 & PN 657 Guidelines)
      if (dist.isRecurring) {
        // Recurring distributions are fully included in Household Eligibility Cap
        eligibilityAnnualTotal = eligibilityAnnualTotal.add(total);
      } else {
        // Non-recurring / Irregular lump sums are strictly excluded from Eligibility
        warnings.push(
          `Excluded non-recurring distribution of $${total.toLocaleString()} (${dist.sourceName}) from USDA Annual Household Income.`
        );

        // Auto-generate verification condition for underwriter compliance
        conditions.push({
          title: "IRA Non-Recurring Distribution Verification",
          docType: "RETIREMENT_ACCOUNT_STMT_SHOWING_BAL_AND_ONE_TIME_WITHDRAWAL",
          description: `The underwriter has excluded the $${total.toLocaleString()} distribution from USDA household income. Obtain the latest retirement ledger showing the balance and proving this was an irregular, non-scheduled withdrawal.`
        });
      }
    });

    // USDA Household Deductions (e.g. $480 standard dependent deduction simulator)
    const standardUSDAHouseholdDeductions = new Decimal(480);
    const adjustedEligibility = Decimal.max(0, eligibilityAnnualTotal.sub(standardUSDAHouseholdDeductions));
    const isEligible = adjustedEligibility.lte(countyMedianLimit);

    return {
      repaymentIncomeMonthly: repaymentAnnualTotal.div(12).toDecimalPlaces(2).toNumber(),
      annualHouseholdIncome: eligibilityAnnualTotal.toDecimalPlaces(2).toNumber(),
      adjustedAnnualIncome: adjustedEligibility.toDecimalPlaces(2).toNumber(),
      isEligible,
      warnings,
      conditions
    };
  }, [distributions, householdBaseEarnings, countyMedianLimit]);

  return (
    <div className="bg-slate-950 text-slate-100 p-6 rounded-2xl border border-slate-900 font-sans max-w-4xl mx-auto space-y-6 shadow-2xl">
      
      {/* HEADER LOGO PANEL */}
      <div className="flex justify-between items-center border-b border-slate-900 pb-4">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="font-sans font-black text-white text-sm tracking-tight block">FREEFLOW</span>
            <span className="text-[9px] text-slate-400 uppercase tracking-widest leading-none block font-mono">USDA Dual-Track Module</span>
          </div>
        </div>
        <div className="text-right font-mono text-[10px]">
          <span className="text-slate-500">LOS SYNC: </span>
          <span className="text-emerald-400 font-bold">ACTIVE ({activeAgency})</span>
          <div className="text-[9px] text-slate-600">GUID: {loanGuid}</div>
        </div>
      </div>

      {/* COMPLIANCE INTRO */}
      <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-900/60 text-xs text-slate-400 leading-relaxed">
        <span className="font-bold text-white uppercase tracking-wider block mb-1">USDA HB-1-3555 CHAPTER 9 COMPLIANCE SHIELD</span>
        Standard guidelines mandate including 100% of retirement distributions in the Annual Household Eligibility Cap unless the distribution is verified by the underwriter as an irregular, non-recurring lump-sum. Toggle the status below to dynamically audit and sync the loan file.
      </div>

      {/* DUAL DISPLAY CARDS: REPAYMENT VS ELIGIBILITY */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Track 1: Repayment Income */}
        <div className="p-5 bg-slate-900/20 border border-slate-900 rounded-xl relative space-y-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Track 1: Repayment Income (DTI)</span>
          <span className="text-3xl font-black text-white block">
            ${calculation.repaymentIncomeMonthly.toLocaleString()}<span className="text-xs font-normal text-slate-500"> / mo</span>
          </span>
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Note Borrowers only. Includes 1.25x gross-up of tax-exempt portions of regular distributions. Used to calculate final underwriting Qualifying DTI.
          </p>
        </div>

        {/* Track 2: Eligibility Income */}
        <div className={`p-5 border rounded-xl relative space-y-2 transition-all ${
          calculation.isEligible 
            ? 'bg-emerald-950/10 border-emerald-500/20 shadow-lg shadow-emerald-500/5' 
            : 'bg-rose-950/10 border-rose-500/20 shadow-lg shadow-rose-500/5'
        }`}>
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Track 2: Household Eligibility</span>
            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
              calculation.isEligible 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}>
              {calculation.isEligible ? 'Program Eligible' : 'Over-Income Limit'}
            </span>
          </div>
          <span className={`text-3xl font-black block ${calculation.isEligible ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${calculation.adjustedAnnualIncome.toLocaleString()}<span className="text-xs font-normal text-slate-500"> / yr</span>
          </span>
          <div className="text-[9px] text-slate-400 space-y-0.5 font-mono">
            <div>Median Limit: ${countyMedianLimit.toLocaleString()} / yr</div>
            <div>Raw Income: ${calculation.annualHouseholdIncome.toLocaleString()} | USDA Ded: $480</div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE FORM FIELD SECTION */}
      <div className="space-y-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Extracted Income & Verification Toggles</span>
        
        <div className="space-y-2.5">
          {distributions.map((dist) => (
            <div 
              key={dist.id} 
              className={`p-4 bg-slate-900/30 rounded-xl border transition-all duration-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${
                dist.isRecurring ? 'border-slate-900' : 'border-indigo-500/20 bg-indigo-500/5'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-white">{dist.sourceName}</span>
                  <span className="text-[10px] font-mono text-slate-500">Tax Year: {dist.year}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Total Distribution: <span className="text-white font-semibold">${dist.totalDistribution.toLocaleString()}</span> 
                  <span className="mx-2 text-slate-600">|</span> 
                  Taxable Amount: <span className="text-white font-semibold">${dist.taxableAmount.toLocaleString()}</span>
                </div>
              </div>

              {/* TOGGLE BUTTON */}
              <button
                onClick={() => handleToggleRecurrency(dist.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all duration-200 flex items-center space-x-1 border ${
                  dist.isRecurring
                    ? 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-850'
                    : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-sm shadow-indigo-500/10'
                }`}
              >
                {!dist.isRecurring && <Check className="w-3.5 h-3.5 mr-0.5" />}
                <span>{dist.isRecurring ? "Exempt as Non-Recurring" : "Excluded (Lump-Sum)"}</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* WARNINGS & DYNAMIC CHECKLIST CONDITIONS GENERATED */}
      {calculation.conditions.length > 0 && (
        <div className="border-t border-slate-900 pt-5 space-y-3">
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider block">Programmatically Generated Checklist Conditions</span>
          
          <div className="space-y-2.5">
            {calculation.conditions.map((cond, idx) => (
              <div key={idx} className="p-4 bg-slate-900/10 border border-slate-900 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-white">
                  <FileText className="w-4 h-4 text-indigo-400" />
                  <span>{cond.title}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">{cond.description}</p>
                <div className="inline-flex items-center space-x-1.5 px-2 py-0.5 bg-slate-900 text-[9px] font-mono font-bold text-slate-400 rounded border border-slate-850">
                  <span>REQUIRED DOC:</span>
                  <span className="text-indigo-400">{cond.docType}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
