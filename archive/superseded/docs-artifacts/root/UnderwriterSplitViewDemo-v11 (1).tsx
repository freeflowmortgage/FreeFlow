'use client';

import React, { useState, useMemo } from 'react';
import { 
  Building, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  MapPin, 
  DollarSign, 
  ArrowRight, 
  CheckSquare, 
  Square,
  ClipboardList,
  Home,
  Info,
  Layers,
  Wrench,
  UserCheck,
  FilePlus2,
  Trash2,
  TrendingDown,
  Percent,
  FileText,
  Hammer,
  FileSpreadsheet,
  RefreshCw,
  Settings2,
  Eye,
  Activity,
  AlertCircle,
  Calendar,
  AlertOctagon,
  Search,
  Sparkles,
  Link,
  Lock,
  UserX
} from 'lucide-react';

// TS Type Signatures for clean data structures
interface OCRField {
  id: string;
  category: 'METADATA' | 'EARNINGS' | 'DEDUCTIONS' | 'SCHL_BALANCE_SHEET';
  label: string;
  value: string;
  numericValue: number;
  isDiscrepancy: boolean;
  boxCoordinates: { x: number; y: number; width: number; height: number; page: number };
}

interface PrevEmployerW2 {
  employerName: string;
  ein: string;
  year: number;
  box1Wages: number;
  box12Bonus: number;
  box14Overtime: number;
}

export const UnderwriterSplitViewDemo: React.FC = () => {
  // 1. Navigation & View States
  const [activeTab, setActiveTab] = useState<'PAYSTUB_RECONCILIATION' | 'W2_CONTINUITY' | 'FORM_1084' | 'ENCOMPASS_SYNC'>('PAYSTUB_RECONCILIATION');
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);
  const [activePdfPage, setActivePdfPage] = useState<number>(1);

  // 2. Variable Continuity & Job Transition States
  const [mergePreviousEmployerVariable, setMergePreviousEmployerVariable] = useState<boolean>(true);
  const [monthsAtCurrentJob, setMonthsAtCurrentJob] = useState<number>(8); // August 15 paystub represents 8 elapsed months
  const [monthsAtPreviousJob, setMonthsAtPreviousJob] = useState<number>(16); // Remainder of the 24-month verification window

  // Previous Job Variable History
  const [prevEmployerW2, setPrevEmployerW2] = useState<PrevEmployerW2>({
    employerName: 'Digital Solutions Corp',
    ein: '94-87654321',
    year: 2025,
    box1Wages: 78500,
    box12Bonus: 18000,     // Previous bonus history
    box14Overtime: 6000     // Previous overtime history
  });

  // Current paystub raw values inside mock state
  const [currentHourlyRate, setCurrentHourlyRate] = useState<number>(45.00);
  const [currentWeeklyHours, setCurrentWeeklyHours] = useState<number>(40);
  const [currentPeriodBasePay, setCurrentPeriodBasePay] = useState<number>(3600.00); // Semi-monthly gross base
  const [currentBaseYtd, setCurrentBaseYtd] = useState<number>(54000.00); // 8 months elapsed (Wage deficit trigger!)
  const [currentBonusYtd, setCurrentBonusYtd] = useState<number>(12500.00);
  const [currentOtYtd, setCurrentOtYtd] = useState<number>(4200.00);

  // 3. Form 1084 (Schedule C) & Schedule L (S-Corp) State variables
  const [schCLine31NetProfit, setSchCLine31NetProfit] = useState<number>(115000.00);
  const [schCLine13Depreciation, setSchCLine13Depreciation] = useState<number>(8500.00);
  const [schCLine30HomeUse, setSchCLine30HomeUse] = useState<number>(2400.00);
  const [schCLine44aMileage, setSchCLine44aMileage] = useState<number>(4500); // Miles driven
  const [schCLine44aMileageRate, setSchCLine44aMileageRate] = useState<number>(0.26); // Depreciation portion of standard mileage rate (cents)
  const [schCMealsExclusion, setSchCMealsExclusion] = useState<number>(1800.00); // Non-deductible meals offset

  // S-Corp (1120S) Balance Sheet (Schedule L) Liquidity Variables
  const [sCorpShareholderPct, setSCorpShareholderPct] = useState<number>(35.00); // Ownership percentage
  const [schLCashEnding, setSchLCashEnding] = useState<number>(125000.00);
  const [schLTradeReceivablesEnding, setSchLTradeReceivablesEnding] = useState<number>(25000.00);
  const [schLBadDebtAllowanceEnding, setSchLBadDebtAllowanceEnding] = useState<number>(2500.00);
  const [schLTaxExemptSecuritiesEnding, setSchLTaxExemptSecuritiesEnding] = useState<number>(5000.00);
  const [schLOtherCurrentAssetsEnding, setSchLOtherCurrentAssetsEnding] = useState<number>(15000.00);

  const [schLAccountsPayableEnding, setSchLAccountsPayableEnding] = useState<number>(60000.00);
  const [schLMortgagesNotesLess1YrEnding, setSchLMortgagesNotesLess1YrEnding] = useState<number>(30000.00);
  const [schLOtherCurrentLiabilitiesEnding, setSchLOtherCurrentLiabilitiesEnding] = useState<number>(10000.00);

  // Borrower Core Metadata Reference
  const borrowerMetadata = {
    loanId: 'LN-2026-88042',
    borrowerName: 'Sarah K. Vance',
    currentEmployer: 'Apex Technology Partners LLC',
    employmentStartDate: '2025-12-15', // Less than 12 months at current job!
    loanProgram: 'CONVENTIONAL',
  };

  // 4. Dynamic Spatial Fields Definitions (For Interactive Highlights)
  const fieldCoordinatesMapping = useMemo<OCRField[]>(() => [
    // Paystub Metadata Fields (Page 1)
    { id: 'ps-emp-name', category: 'METADATA', label: 'Employer Name', value: borrowerMetadata.currentEmployer, numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 10, y: 5, width: 40, height: 3, page: 1 } },
    { id: 'ps-ee-name', category: 'METADATA', label: 'Employee Name', value: borrowerMetadata.borrowerName, numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 50, y: 5, width: 40, height: 3, page: 1 } },
    { id: 'ps-period', category: 'METADATA', label: 'Pay Period', value: '2026-08-01 to 2026-08-15', numericValue: 0, isDiscrepancy: false, boxCoordinates: { x: 10, y: 12, width: 40, height: 3, page: 1 } },
    { id: 'ps-frequency', category: 'METADATA', label: 'Pay Frequency', value: 'Semi-Monthly (24 Pays/Yr)', numericValue: 24, isDiscrepancy: false, boxCoordinates: { x: 10, y: 15, width: 40, height: 3, page: 1 } },
    
    // Earnings Statement Fields (Page 1)
    { id: 'ps-hourly-rate', category: 'EARNINGS', label: 'Hourly Pay Rate', value: `$${currentHourlyRate.toFixed(2)}/hr`, numericValue: currentHourlyRate, isDiscrepancy: false, boxCoordinates: { x: 10, y: 22, width: 40, height: 3, page: 1 } },
    { id: 'ps-hours-week', category: 'EARNINGS', label: 'Standard Weekly Hours', value: `${currentWeeklyHours} hrs`, numericValue: currentWeeklyHours, isDiscrepancy: false, boxCoordinates: { x: 50, y: 22, width: 40, height: 3, page: 1 } },
    { id: 'ps-current-base', category: 'EARNINGS', label: 'Current Period Base Pay', value: `$${currentPeriodBasePay.toLocaleString()}`, numericValue: currentPeriodBasePay, isDiscrepancy: false, boxCoordinates: { x: 10, y: 25, width: 40, height: 3, page: 1 } },
    { id: 'ps-base-ytd', category: 'EARNINGS', label: 'Base Wages YTD', value: `$${currentBaseYtd.toLocaleString()}`, numericValue: currentBaseYtd, isDiscrepancy: true, boxCoordinates: { x: 10, y: 28, width: 40, height: 3, page: 1 } },
    { id: 'ps-bonus-ytd', category: 'EARNINGS', label: 'Bonus Income YTD', value: `$${currentBonusYtd.toLocaleString()}`, numericValue: currentBonusYtd, isDiscrepancy: false, boxCoordinates: { x: 50, y: 28, width: 40, height: 3, page: 1 } },
    { id: 'ps-ot-ytd', category: 'EARNINGS', label: 'Overtime Income YTD', value: `$${currentOtYtd.toLocaleString()}`, numericValue: currentOtYtd, isDiscrepancy: false, boxCoordinates: { x: 10, y: 31, width: 40, height: 3, page: 1 } },

    // Schedule L Assets & Liabilities (Page 2)
    { id: 'schl-cash', category: 'SCHL_BALANCE_SHEET', label: 'Schedule L Ending Cash (L1)', value: `$${schLCashEnding.toLocaleString()}`, numericValue: schLCashEnding, isDiscrepancy: false, boxCoordinates: { x: 12, y: 10, width: 35, height: 3, page: 2 } },
    { id: 'schl-receivables', category: 'SCHL_BALANCE_SHEET', label: 'Ending Trade Receivables (L2a)', value: `$${schLTradeReceivablesEnding.toLocaleString()}`, numericValue: schLTradeReceivablesEnding, isDiscrepancy: false, boxCoordinates: { x: 12, y: 14, width: 35, height: 3, page: 2 } },
    { id: 'schl-debt', category: 'SCHL_BALANCE_SHEET', label: 'Accounts Payable (L15)', value: `$${schLAccountsPayableEnding.toLocaleString()}`, numericValue: schLAccountsPayableEnding, isDiscrepancy: false, boxCoordinates: { x: 52, y: 10, width: 35, height: 3, page: 2 } },
    { id: 'schl-notes-short', category: 'SCHL_BALANCE_SHEET', label: 'Short-Term Mortgages (L16)', value: `$${schLMortgagesNotesLess1YrEnding.toLocaleString()}`, numericValue: schLMortgagesNotesLess1YrEnding, isDiscrepancy: false, boxCoordinates: { x: 52, y: 14, width: 35, height: 3, page: 2 } }
  ], [
    currentHourlyRate, 
    currentWeeklyHours, 
    currentPeriodBasePay, 
    currentBaseYtd, 
    currentBonusYtd, 
    currentOtYtd, 
    schLCashEnding, 
    schLTradeReceivablesEnding, 
    schLAccountsPayableEnding, 
    schLMortgagesNotesLess1YrEnding
  ]);

  // ==================== 5. COMPLEX CALCULATORS & MATHEMATICAL MODELS ====================

  // A. 4-Way Base Wage Reconciliation [cite: 177]
  const baseWageReconciliation = useMemo(() => {
    const hourlyMethod = (currentHourlyRate * currentWeeklyHours * 52) / 12; // Standard Hourly Pay Rate Method
    const periodAnnualizedMethod = (currentPeriodBasePay * 24) / 12; // Semi-monthly Pay Period Annualized Method
    const ytdAverageMethod = currentBaseYtd / 7.5; // August 15 represents 7.5 elapsed months of the year
    const priorYearW2Average = 85000 / 12; // Static baseline reference

    return {
      hourlyMethod,
      periodAnnualizedMethod,
      ytdAverageMethod,
      priorYearW2Average,
      maxVariancePct: Math.abs(((hourlyMethod - ytdAverageMethod) / hourlyMethod) * 100)
    };
  }, [currentHourlyRate, currentWeeklyHours, currentPeriodBasePay, currentBaseYtd]);

  // B. Variable Income Rolling & Continuity (Job Transition Adapter) [cite: 177]
  const variableContinuityCalculations = useMemo(() => {
    // Current Job Bonus + Overtime YTD [cite: 177]
    const currentBonusOtTotal = currentBonusYtd + currentOtYtd;
    const currentMonthlyVariableAvg = currentBonusOtTotal / monthsAtCurrentJob;

    // Previous Job W-2 Bonus + Overtime [cite: 177]
    const previousBonusOtTotal = prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime;
    const previousMonthlyVariableAvg = previousBonusOtTotal / 12; // Standard 12-month average for complete prior tax year

    // 24-Month Weighted Rolling Variable Average [cite: 177]
    const aggregatedVariableTotal = mergePreviousEmployerVariable
      ? currentBonusOtTotal + previousBonusOtTotal
      : currentBonusOtTotal;

    const totalRollingMonths = mergePreviousEmployerVariable
      ? monthsAtCurrentJob + 12 // Current months + complete prior W-2 year
      : monthsAtCurrentJob;

    const qualifyingRollingVariableAvg = aggregatedVariableTotal / totalRollingMonths;

    return {
      currentMonthlyVariableAvg,
      previousMonthlyVariableAvg,
      qualifyingRollingVariableAvg,
      aggregatedVariableTotal,
      totalRollingMonths
    };
  }, [currentBonusYtd, currentOtYtd, monthsAtCurrentJob, mergePreviousEmployerVariable, prevEmployerW2]);

  // C. Schedule L (Balance Sheet) Corporate Solvency [cite: 11]
  const scheduleLLiquidity = useMemo(() => {
    // Current (Liquid) Assets [cite: 11]
    const currentAssets = 
      schLCashEnding + 
      (schLTradeReceivablesEnding - schLBadDebtAllowanceEnding) + 
      schLTaxExemptSecuritiesEnding + 
      schLOtherCurrentAssetsEnding;

    // Current Liabilities [cite: 11]
    const currentLiabilities = 
      schLAccountsPayableEnding + 
      schLMortgagesNotesLess1YrEnding + 
      schLOtherCurrentLiabilitiesEnding;

    // Corporate Quick Ratio (Assets / Liabilities) [cite: 11]
    const quickRatio = currentLiabilities > 0 ? (currentAssets / currentLiabilities) : 999.99;
    const passesLiquidity = quickRatio >= 1.0; // Fannie Mae guideline threshold [cite: 11]

    return {
      currentAssets,
      currentLiabilities,
      quickRatio,
      passesLiquidity
    };
  }, [
    schLCashEnding, 
    schLTradeReceivablesEnding, 
    schLBadDebtAllowanceEnding, 
    schLTaxExemptSecuritiesEnding, 
    schLOtherCurrentAssetsEnding,
    schLAccountsPayableEnding,
    schLMortgagesNotesLess1YrEnding,
    schLOtherCurrentLiabilitiesEnding
  ]);

  // D. Fannie Mae Form 1084 Line-by-Line Schedule C Cash Flow [cite: 71, 119]
  const form1084CashFlow = useMemo(() => {
    // Sole Proprietorship Adjustments [cite: 71, 119]
    const baseProfit = schCLine31NetProfit; // Net Profit or Loss (Line 31) [cite: 119]
    const depreciationAdd = schCLine13Depreciation; // Non-cash Depreciation (Line 13) [cite: 121, 122]
    const homeUseAdd = schCLine30HomeUse; // Business Use of Home (Line 30) [cite: 122]
    
    // Mileage Depreciation Offset [cite: 122]
    const mileageDepreciationAdd = schCLine44aMileage * schCLine44aMileageRate; // Line 44a business miles depreciation credit [cite: 122]
    
    // Meals Offset [cite: 72]
    const mealsReduction = schCMealsExclusion; // Subtract non-deductible meals [cite: 72]

    const totalAnnualCashFlow = baseProfit + depreciationAdd + homeUseAdd + mileageDepreciationAdd - mealsReduction;
    
    // If corporate liquidity fails, override corporate portion to $0.00 [cite: 11]
    const qualifyingMonthlySelfEmployed = totalAnnualCashFlow / 12;
    const sCorpShareholderDraw = scheduleLLiquidity.passesLiquidity ? (120000 * (sCorpShareholderPct / 100)) / 12 : 0;

    return {
      totalAnnualCashFlow,
      qualifyingMonthlySelfEmployed,
      mileageDepreciationAdd,
      sCorpShareholderDraw,
      finalTotalQualifyingMonthly: qualifyingMonthlySelfEmployed + sCorpShareholderDraw
    };
  }, [
    schCLine31NetProfit, 
    schCLine13Depreciation, 
    schCLine30HomeUse, 
    schCLine44aMileage, 
    schCLine44aMileageRate, 
    schCMealsExclusion,
    scheduleLLiquidity,
    sCorpShareholderPct
  ]);

  // Core Orchestrated Warnings
  const activeIncomeWarnings = useMemo(() => {
    const list: { id: string; type: 'ERROR' | 'WARNING'; message: string }[] = [];

    // Job tenure warning
    if (monthsAtCurrentJob < 12) {
      list.push({
        id: 'TENURE_WARN',
        type: 'WARNING',
        message: `Borrower job tenure is under 12 months (${monthsAtCurrentJob} months calculated). Variable income must have documented previous employer continuity.`
      });
    }

    // Wage Deficit discrepancy
    if (currentBaseYtd < 50000.00) {
      list.push({
        id: 'WAGE_DEFICIT_WARN',
        type: 'ERROR',
        message: 'Critical Wage Deficit: Extracted YTD Base Wages are lower than expected for a Semi-Monthly payroll processed in mid-August.'
      });
    }

    // Corporate Liquidity Deficit
    if (!scheduleLLiquidity.passesLiquidity) {
      list.push({
        id: 'LIQUIDITY_FAIL_ERR',
        type: 'ERROR',
        message: `Schedule L Liquidity Failure: Calculated Quick Ratio (${scheduleLLiquidity.quickRatio.toFixed(2)}) is below the GSE 1.0 threshold. Corporate distributions excluded.`
      });
    }

    // Base wage variance
    if (baseWageReconciliation.maxVariancePct > 10.0) {
      list.push({
        id: 'WAGE_VARIANCE_WARN',
        type: 'WARNING',
        message: `Wage Variance Alert: Current hourly annualization ($${baseWageReconciliation.hourlyMethod.toFixed(2)}) differs from the YTD monthly average ($${baseWageReconciliation.ytdAverageMethod.toFixed(2)}) by ${baseWageReconciliation.maxVariancePct.toFixed(1)}%.`
      });
    }

    return list;
  }, [monthsAtCurrentJob, currentBaseYtd, scheduleLLiquidity, baseWageReconciliation]);

  // ==================== 6. INTERACTIVE ACTIONS ====================

  const handleInspectField = (fieldId: string) => {
    const target = fieldCoordinatesMapping.find(f => f.id === fieldId);
    if (target) {
      setHighlightFieldId(fieldId);
      setActivePdfPage(target.boxCoordinates.page);
    }
  };

  const handleExportSync = () => {
    alert(`Payload Locked & Transmitted to Encompass eFolder successfully!\n\nStandard Fields Mapped:\n- Field 110 (Schedule C Monthly Base): $${form1084CashFlow.qualifyingMonthlySelfEmployed.toFixed(2)}\n- Field 111 (S-Corp Distributions): $${form1084CashFlow.sCorpShareholderDraw.toFixed(2)}\n- Field 108 (Secondary Wage/Other Base): $${baseWageReconciliation.periodAnnualizedMethod.toFixed(2)}`);
  };

  return (
    <div className="mx-auto max-w-7xl p-6 font-sans space-y-6 text-slate-800 bg-slate-50 min-h-screen">
      
      {/* ==================== 1. COMPREHENSIVE WORKSPACE HEADER ==================== */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between rounded-xl border border-slate-200 bg-white p-6 shadow-sm gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-indigo-600" />
              B2B Professional Income Verification Workspace
            </h1>
            <span className="rounded-full bg-indigo-100 text-indigo-800 px-3 py-1 text-xs font-bold uppercase">
              DE-SARC / Enterprise Underwriter Core
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Loan ID: <strong className="text-slate-700">{borrowerMetadata.loanId}</strong></span>
            <span>Borrower: <strong className="text-slate-700">{borrowerMetadata.borrowerName}</strong></span>
            <span>Current Job: <strong className="text-slate-700">{borrowerMetadata.currentEmployer} (Hired: {borrowerMetadata.employmentStartDate})</strong></span>
          </p>
        </div>

        {/* Sync status and lock buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleExportSync}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition shadow-lg"
          >
            Lock & Sync Encompass eFolder <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ==================== 2. SPLIT SCREEN CONTROL GRID ==================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* ==================== LEFT PANEL: PDF COORDINATES VISUAL CANVAS ==================== */}
        <div className="xl:col-span-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-indigo-600" />
                <h2 className="font-extrabold text-slate-900 text-sm">PDF Coordinate Canvas View</h2>
              </div>
              <span className="rounded bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                Page {activePdfPage} of 2
              </span>
            </div>

            {/* Simulated Coordinate PDF Grid Layout */}
            <div className="relative rounded-lg border border-slate-300 bg-slate-900 h-96 w-full overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 bg-white opacity-5 p-4 font-mono text-[7px] leading-tight select-none pointer-events-none text-white">
                {Array.from({ length: 45 }).map((_, i) => (
                  <div key={i} className="whitespace-nowrap">
                    SECURE IN-MEMORY DOCUMENT STREAM -- RAM SCRATCH ACTIVE -- TRANSIT PROTOCOL mTLS...
                  </div>
                ))}
              </div>

              {/* PDF Background representation (W-2 on page 1, Balance sheet on page 2) */}
              <div className="absolute inset-0 p-4 flex flex-col justify-between">
                <div className="bg-slate-800/80 rounded border border-slate-700 p-3 text-center text-slate-400 font-mono text-[9px]">
                  {activePdfPage === 1 ? (
                    <span>[MOCK PDF CANVAS PAGE 1: BASE PAYSTUB & YTD DATA]</span>
                  ) : (
                    <span>[MOCK PDF CANVAS PAGE 2: S-CORP CORPORATE BALANCE SHEET SCHEDULE L]</span>
                  )}
                </div>

                {/* Highlight Overlay representing the clicked OCRField coordinates */}
                {highlightFieldId && (() => {
                  const currentField = fieldCoordinatesMapping.find(f => f.id === highlightFieldId);
                  if (currentField && currentField.boxCoordinates.page === activePdfPage) {
                    const coords = currentField.boxCoordinates;
                    return (
                      <div 
                        className="absolute rounded border-2 border-dashed border-amber-400 bg-amber-400/20 shadow-lg flex items-center justify-center text-[9px] font-extrabold text-white animate-pulse"
                        style={{
                          left: `${coords.x}%`,
                          top: `${coords.y}%`,
                          width: `${coords.width}%`,
                          height: `${coords.height}%`
                        }}
                      >
                        {currentField.label}
                      </div>
                    );
                  }
                  return null;
                })()}

                <div className="text-center text-slate-500 text-[8px] font-semibold tracking-wide">
                  SECURE ZERO-RETENTION RAM STORAGE HARDENED PORTAL
                </div>
              </div>
            </div>

            <div className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5">
              <Info className="h-4 w-4 text-indigo-600 flex-shrink-0 mt-0.5" />
              <span>Click the <strong>👁️ Inspect Highlight</strong> buttons in the checklists to auto-scroll the canvas and highlight the verified coordinates.</span>
            </div>
          </div>

          {/* Core Licensing Profile Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-1.5 text-sm">
              <UserCheck className="h-4.5 w-4.5 text-emerald-500" />
              Employer Verification Profile
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Target Employer Name</span>
                <span className="font-bold text-slate-800">{borrowerMetadata.currentEmployer}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Employment Start Date</span>
                <span className="font-bold text-slate-800">{borrowerMetadata.employmentStartDate} ({monthsAtCurrentJob} mos elapsed)</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">USDA Eligibility Zone</span>
                <span className="font-bold text-slate-800">Zone-A Conventional Standard</span>
              </div>
            </div>
          </div>
        </div>

        {/* ==================== RIGHT PANEL: TAB-DRIVEN CALCULATION ENGINES ==================== */}
        <div className="xl:col-span-8 space-y-6">
          
          {/* Main Workspace Navigation Tab Array */}
          <div className="flex flex-wrap border-b border-slate-200 bg-white rounded-lg p-1.5 shadow-sm gap-1">
            <button
              onClick={() => { setActiveTab('PAYSTUB_RECONCILIATION'); setActivePdfPage(1); }}
              className={`flex-1 min-w-[150px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'PAYSTUB_RECONCILIATION' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              Base Reconciliation
            </button>
            <button
              onClick={() => { setActiveTab('W2_CONTINUITY'); setActivePdfPage(1); }}
              className={`flex-1 min-w-[150px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'W2_CONTINUITY' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Calendar className="h-4 w-4" />
              Variable & Job Continuity
            </button>
            <button
              onClick={() => { setActiveTab('FORM_1084'); setActivePdfPage(2); }}
              className={`flex-1 min-w-[150px] flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold uppercase rounded-md transition-all ${
                activeTab === 'FORM_1084' 
                  ? 'bg-slate-900 text-white shadow-md' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Form 1084 & Schedule L
            </button>
          </div>

          {/* ==================== TAB 1: 4-WAY BASE WAGE RECONCILIATION ==================== */}
          {activeTab === 'PAYSTUB_RECONCILIATION' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">4-Way Base Wage Reconciliation</h3>
                  <p className="text-xs text-slate-400 mt-1">Cross-references paystub hourly pay rates against annualized parameters and YTD balances</p>
                </div>
                <span className="text-xs font-bold uppercase text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Verified Base: $3,600.00 / Semi-Monthly
                </span>
              </div>

              {/* Core interactive variable modification boxes */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Hourly Rate of Pay</label>
                  <input
                    type="number"
                    value={currentHourlyRate}
                    onChange={(e) => setCurrentHourlyRate(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-hourly-rate')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Standard Weekly Hours</label>
                  <input
                    type="number"
                    value={currentWeeklyHours}
                    onChange={(e) => setCurrentWeeklyHours(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-hours-week')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Current Period Base Pay</label>
                  <input
                    type="number"
                    value={currentPeriodBasePay}
                    onChange={(e) => setCurrentPeriodBasePay(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <button onClick={() => handleInspectField('ps-current-base')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Base Wages YTD</label>
                  <input
                    type="number"
                    value={currentBaseYtd}
                    onChange={(e) => setCurrentBaseYtd(Number(e.target.value))}
                    className={`w-full rounded border p-2 font-semibold focus:outline-none focus:border-indigo-500 ${
                      currentBaseYtd < 50000 ? 'border-rose-300 bg-rose-50' : 'border-slate-300'
                    }`}
                  />
                  <button onClick={() => handleInspectField('ps-base-ytd')} className="text-[10px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                    <Eye className="h-3 w-3" /> Inspect Coordinates
                  </button>
                </div>
              </div>

              {/* 4-Way Reconciliation Display */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">1. Hourly Rate Method</span>
                  <span className="text-[10px] text-slate-500 block leading-tight">Formula: (Hourly Rate × Hours × 52) / 12</span>
                  <span className="text-lg font-black text-slate-800 block mt-1">${baseWageReconciliation.hourlyMethod.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">2. Period Annualized</span>
                  <span className="text-[10px] text-slate-500 block leading-tight">Formula: (Current Gross × 24) / 12</span>
                  <span className="text-lg font-black text-slate-800 block mt-1">${baseWageReconciliation.periodAnnualizedMethod.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">3. YTD Average Monthly</span>
                  <span className="text-[10px] text-slate-500 block leading-tight">Formula: YTD Base / 7.5 mos elapsed</span>
                  <span className="text-lg font-black text-slate-800 block mt-1">${baseWageReconciliation.ytdAverageMethod.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4 space-y-1">
                  <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold block">4. Prior Year W-2</span>
                  <span className="text-[10px] text-slate-500 block leading-tight">Formula: 2025 W-2 Box 1 / 12</span>
                  <span className="text-lg font-black text-slate-800 block mt-1">${baseWageReconciliation.priorYearW2Average.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>
              </div>

              {/* Critical Wage Deficit Alert Panel */}
              {currentBaseYtd < 50000.00 && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-rose-800">
                  <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase block tracking-wider text-rose-950">Critical Wage Deficit Highlighted</span>
                    The YTD base wage of ${currentBaseYtd.toLocaleString()} is significantly lower than expected for a semi-monthly payroll schedule processed in mid-August (expected base wage ~ $54,000.00). Check if the borrower recently changed compensation, had unpaid leave, or was hired mid-year.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== TAB 2: VARIABLE & JOB CONTINUITY PORTAL ==================== */}
          {activeTab === 'W2_CONTINUITY' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Variable Income Continuity & Rolling Average</h3>
                  <p className="text-xs text-slate-400 mt-1">Aggregates short-term variable earnings across job transitions when similar compensation history exists</p>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                  <button 
                    onClick={() => setMergePreviousEmployerVariable(!mergePreviousEmployerVariable)} 
                    className="focus:outline-none"
                  >
                    {mergePreviousEmployerVariable ? <CheckSquare className="h-4.5 w-4.5 text-indigo-600" /> : <Square className="h-4.5 w-4.5 text-slate-300" />}
                  </button>
                  <span className="text-[10px] font-extrabold text-indigo-950 uppercase">Merge Prior Job History (24-Mo Rolling)</span>
                </div>
              </div>

              {/* Tenure configuration inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Months at Current Job (Hire Date: Dec 2025)</label>
                  <input
                    type="number"
                    value={monthsAtCurrentJob}
                    onChange={(e) => setMonthsAtCurrentJob(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-[9px] text-slate-400 block mt-1">Less than 12 months at current job mandates prior job variable history.</span>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 uppercase mb-1">Months at Previous Job (Rolling Window)</label>
                  <input
                    type="number"
                    value={monthsAtPreviousJob}
                    onChange={(e) => setMonthsAtPreviousJob(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                    disabled={!mergePreviousEmployerVariable}
                  />
                  <span className="text-[9px] text-slate-400 block mt-1">Number of rolling months required to complete the qualifying window.</span>
                </div>
              </div>

              {/* Side-by-Side Job Variable Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Current Job variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Activity className="h-4 w-4 text-indigo-500" />
                    Current Job YTD Variable Extractions
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Bonus Income YTD</label>
                      <input
                        type="number"
                        value={currentBonusYtd}
                        onChange={(e) => setCurrentBonusYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Overtime Income YTD</label>
                      <input
                        type="number"
                        value={currentOtYtd}
                        onChange={(e) => setCurrentOtYtd(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded p-3 text-xs flex justify-between items-center">
                    <span className="font-semibold text-slate-500">Current Monthly Variable Avg:</span>
                    <span className="font-black text-slate-800">${variableContinuityCalculations.currentMonthlyVariableAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                  </div>
                </div>

                {/* Prior Job Variable inputs */}
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5 border-b pb-1">
                    <Link className="h-4 w-4 text-indigo-500" />
                    Prior Job 2025 W-2 Variable Extractions
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Box 12 Bonus History</label>
                      <input
                        type="number"
                        value={prevEmployerW2.box12Bonus}
                        onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box12Bonus: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                        disabled={!mergePreviousEmployerVariable}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Box 14 Overtime History</label>
                      <input
                        type="number"
                        value={prevEmployerW2.box14Overtime}
                        onChange={(e) => setPrevEmployerW2({ ...prevEmployerW2, box14Overtime: Number(e.target.value) })}
                        className="w-full rounded border border-slate-300 p-2 font-semibold focus:outline-none"
                        disabled={!mergePreviousEmployerVariable}
                      />
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded p-3 text-xs flex justify-between items-center">
                    <span className="font-semibold text-slate-500">Prior Monthly Variable Avg:</span>
                    <span className={`font-black text-slate-800 ${!mergePreviousEmployerVariable ? 'opacity-40' : ''}`}>
                      ${variableContinuityCalculations.previousMonthlyVariableAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo
                    </span>
                  </div>
                </div>
              </div>

              {/* Master Combined Qualifying Variable Output */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-5 flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                  <h4 className="font-black text-slate-900 text-sm">Combined Qualifying Variable Average</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {mergePreviousEmployerVariable 
                      ? `Calculated as: ($${currentBonusYtd.toLocaleString()} Base YTD Bonus/OT + $${(prevEmployerW2.box12Bonus + prevEmployerW2.box14Overtime).toLocaleString()} 2025 W-2 Bonus/OT) / 20 Months`
                      : `Calculated over current tenure only: ($${currentBonusYtd.toLocaleString()} Bonus + $${currentOtYtd.toLocaleString()} OT) / ${monthsAtCurrentJob} Months`
                    }
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-extrabold text-indigo-600 block uppercase">Qualifying Variable Monthly</span>
                  <span className="text-2xl font-black text-indigo-900 block mt-0.5">
                    ${variableContinuityCalculations.qualifyingRollingVariableAvg.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ==================== TAB 3: FORM 1084 & SCHEDULE L LIQUIDITY ==================== */}
          {activeTab === 'FORM_1084' && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
              
              {/* Section Header */}
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Fannie Mae Form 1084 Cash Flow Grid</h3>
                  <p className="text-xs text-slate-400 mt-1">Line-for-line sole proprietor tax adjustments and partnership distribution reviews</p>
                </div>
                <span className="text-xs font-bold uppercase text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full">
                  Total Self-Employment Cash Flow: ${form1084CashFlow.finalTotalQualifyingMonthly.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo
                </span>
              </div>

              {/* Line-for-Line Form 1084 Calculations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                
                {/* Left Side: Schedule C Parameters */}
                <div className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
                  <h4 className="font-extrabold text-slate-800 uppercase tracking-wider border-b pb-1">Schedule C Net Cash Flow</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-slate-500">Line 31: Net Profit or Loss</label>
                      <input
                        type="number"
                        value={schCLine31NetProfit}
                        onChange={(e) => setSchCLine31NetProfit(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 p-1.5 text-right font-bold"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-slate-500">Line 13: Non-Cash Depreciation</label>
                      <input
                        type="number"
                        value={schCLine13Depreciation}
                        onChange={(e) => setSchCLine13Depreciation(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 p-1.5 text-right font-bold"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-slate-500">Line 30: Business Use of Home</label>
                      <input
                        type="number"
                        value={schCLine30HomeUse}
                        onChange={(e) => setSchCLine30HomeUse(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 p-1.5 text-right font-bold"
                      />
                    </div>
                    <div className="flex justify-between items-center">
                      <label className="text-slate-500">Line 44a: Mileage Depreciation Offset ({schCLine44aMileage} miles)</label>
                      <input
                        type="number"
                        value={schCLine44aMileage}
                        onChange={(e) => setSchCLine44aMileage(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 p-1.5 text-right font-bold"
                      />
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-200 pt-2 text-rose-700">
                      <label className="font-bold">Less: Non-Deductible Meals Exclusion</label>
                      <input
                        type="number"
                        value={schCMealsExclusion}
                        onChange={(e) => setSchCMealsExclusion(Number(e.target.value))}
                        className="w-28 rounded border border-rose-300 bg-rose-50 p-1.5 text-right font-bold text-rose-800"
                      />
                    </div>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between items-center font-black text-slate-900">
                    <span>Qualifying Monthly Self-Employed:</span>
                    <span>${form1084CashFlow.qualifyingMonthlySelfEmployed.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                  </div>
                </div>

                {/* Right Side: Schedule L Balance Sheet & Liquidity Checker */}
                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                    <div className="flex justify-between items-center border-b pb-1.5">
                      <h4 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider">Schedule L Balance Sheet Ingestion</h4>
                      <span className={`text-[9px] font-extrabold uppercase px-2.5 py-1 rounded ${
                        scheduleLLiquidity.passesLiquidity ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {scheduleLLiquidity.passesLiquidity ? 'Liquidity Passed' : 'Liquidity Failed (Income $0.00)'}
                      </span>
                    </div>

                    {/* Balance sheet values */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Ending Cash Balance (L1)</label>
                        <input
                          type="number"
                          value={schLCashEnding}
                          onChange={(e) => setSchLCashEnding(Number(e.target.value))}
                          className="w-full rounded border border-slate-300 p-1.5 font-bold"
                        />
                        <button onClick={() => handleInspectField('schl-cash')} className="text-[9px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                          <Eye className="h-3 w-3" /> Inspect Coordinates
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Ending Receivables (L2a)</label>
                        <input
                          type="number"
                          value={schLTradeReceivablesEnding}
                          onChange={(e) => setSchLTradeReceivablesEnding(Number(e.target.value))}
                          className="w-full rounded border border-slate-300 p-1.5 font-bold"
                        />
                        <button onClick={() => handleInspectField('schl-receivables')} className="text-[9px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                          <Eye className="h-3 w-3" /> Inspect Coordinates
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Accounts Payable (L15)</label>
                        <input
                          type="number"
                          value={schLAccountsPayableEnding}
                          onChange={(e) => setSchLAccountsPayableEnding(Number(e.target.value))}
                          className="w-full rounded border border-slate-300 p-1.5 font-bold"
                        />
                        <button onClick={() => handleInspectField('schl-debt')} className="text-[9px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                          <Eye className="h-3 w-3" /> Inspect Coordinates
                        </button>
                      </div>

                      <div>
                        <label className="block text-[10px] font-extrabold text-slate-400 uppercase mb-1">Short-Term Mortgages (L16)</label>
                        <input
                          type="number"
                          value={schLMortgagesNotesLess1YrEnding}
                          onChange={(e) => setSchLMortgagesNotesLess1YrEnding(Number(e.target.value))}
                          className="w-full rounded border border-slate-300 p-1.5 font-bold"
                        />
                        <button onClick={() => handleInspectField('schl-notes-short')} className="text-[9px] text-indigo-500 hover:underline mt-1 flex items-center gap-1">
                          <Eye className="h-3 w-3" /> Inspect Coordinates
                        </button>
                      </div>
                    </div>

                    {/* Quick ratio math output */}
                    <div className="bg-slate-50 rounded p-3 text-xs flex justify-between items-center border">
                      <div>
                        <span className="font-bold text-slate-600 block">Computed Quick Solvency Ratio:</span>
                        <span className="text-[9px] text-slate-400">Formula: Liquid Assets / Liabilities</span>
                      </div>
                      <span className={`text-lg font-black ${scheduleLLiquidity.passesLiquidity ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {scheduleLLiquidity.quickRatio.toFixed(2)}
                      </span>
                    </div>

                    {/* S-Corp Shareholder qualifications based on liquidity checks */}
                    <div className="flex justify-between items-center text-xs border-t pt-2.5">
                      <div>
                        <span className="font-bold text-slate-700">Shareholder Qualifying Dividends:</span>
                        <span className="text-[9px] text-slate-400 block">S-Corp Net Distributions factored by {sCorpShareholderPct}% ownership</span>
                      </div>
                      <span className={`font-black text-slate-800 ${!scheduleLLiquidity.passesLiquidity ? 'line-through text-slate-400' : ''}`}>
                        ${form1084CashFlow.sCorpShareholderDraw.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Liquidity Failure Warning Box */}
              {!scheduleLLiquidity.passesLiquidity && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex gap-3 text-xs leading-relaxed text-rose-800">
                  <UserX className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase block tracking-wider text-rose-950">Fannie Mae Corporate Liquidity Breach</span>
                    The S-Corporation balance sheet failed the short-term solvency test (Quick Ratio under 1.0). In accordance with Fannie Mae Form 1084 guidelines, corporate profits are strictly excluded from the qualifying income calculation as the business cannot support capital withdrawals.
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* ==================== TAB 4: ENCOMPASS SYNC INTERFACE ==================== */}
          {activeTab === 'ENCOMPASS_SYNC' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6">
              <div className="border-b pb-3">
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                  <Lock className="h-5 w-5 text-indigo-600" />
                  Authorize & Commit Encompass REST Sync
                </h3>
                <p className="text-xs text-slate-400 mt-1">Locks and writes back processed values to configured Encompass fields</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-4 bg-slate-50 border rounded-lg">
                  <span className="text-[10px] font-black uppercase text-slate-400">Encompass Field 110</span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">Sole Proprietor Base Income</span>
                  <span className="text-lg font-black text-indigo-700 block mt-1">${form1084CashFlow.qualifyingMonthlySelfEmployed.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>

                <div className="p-4 bg-slate-50 border rounded-lg">
                  <span className="text-[10px] font-black uppercase text-slate-400">Encompass Field 111</span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">S-Corporation Net Draws</span>
                  <span className="text-lg font-black text-indigo-700 block mt-1">${form1084CashFlow.sCorpShareholderDraw.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>

                <div className="p-4 bg-slate-50 border rounded-lg">
                  <span className="text-[10px] font-black uppercase text-slate-400">Encompass Field 108</span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">Hourly Base Wage Average</span>
                  <span className="text-lg font-black text-indigo-700 block mt-1">${baseWageReconciliation.periodAnnualizedMethod.toLocaleString(undefined, {minimumFractionDigits: 2})}/mo</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center justify-between bg-slate-900 text-white p-5 rounded-xl border border-slate-800 gap-4">
                <div>
                  <h4 className="font-bold text-sm">Lock, Release & Sync Final NOV</h4>
                  <p className="text-xs text-slate-400 mt-1">Commits {activeIncomeWarnings.length} outstanding variables directly as prior-to-approval milestones.</p>
                </div>
                <button
                  onClick={handleExportSync}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 text-xs font-bold uppercase tracking-wider transition shadow-lg self-end"
                >
                  Sign & Sync Encompass eFolder <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ==================== SYSTEM-WIDE EXCEPTIONS LOG (BOTTOM GRID) ==================== */}
          {activeIncomeWarnings.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                <h3 className="font-extrabold text-rose-900 text-sm">Active Underwriting Compliance Warnings ({activeIncomeWarnings.length})</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                {activeIncomeWarnings.map((alert) => (
                  <div key={alert.id} className="flex gap-2.5 bg-white p-3 rounded-lg border border-rose-100 text-xs shadow-sm">
                    <span className={`px-2 py-0.5 rounded text-[8px] font-extrabold uppercase self-start ${
                      alert.type === 'ERROR' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {alert.type}
                    </span>
                    <p className="text-slate-700 leading-relaxed font-semibold">
                      <strong className="text-slate-900">{alert.id}:</strong> {alert.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default UnderwriterSplitViewDemo;
