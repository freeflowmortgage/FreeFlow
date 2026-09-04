import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText, CheckCircle, AlertCircle, TrendingUp, Compass, 
  ChevronRight, ArrowLeft, ShieldCheck, HelpCircle, Eye, 
  ExternalLink, Layers, RefreshCw, Trash2, ToggleLeft, ToggleRight,
  Database, Info, AlertTriangle, CheckCircle2, Share2, Lock, 
  User, Key, Globe, AlertOctagon, ShieldAlert, Cpu, FileDown, Upload, Loader2
} from 'lucide-react';
import type { LiveParseSession } from '../parseTypes';
import { pageLooksLikeW2, pageLooksSelfEmployed } from '../parseTypes';
import { mapIncomeFields } from '../incomeFieldMap';
import PdfPagePreview from './PdfPagePreview';

const DEMO_LOAN_ID = 'e1f82f80-df4f-4d56-a97e-12829a34b2cf';

type SplitViewSource = 'demo' | 'live';

// Interfaces for W-2 Extraction and Underwriting Fraud audits
interface W2OcrField {
  id: string;
  boxLabel: string;
  fieldLabel: string;
  value: string;
  numericValue: number;
  expectedValue?: number;
  isDiscrepancy: boolean;
  boxCoordinates: { x: number; y: number; width: number; height: number };
  isFlagged?: boolean;
  overrideValue?: string;
}

interface TaxEntity {
  id: string;
  entityName: string;
  entityType: 'SCHEDULE_C' | 'SCHEDULE_E_PART_1' | 'SCHEDULE_E_PART_2' | 'FORM_8825';
  proprietorOrOwner: string;
  annualNetIncome: number;
  isExcluded: boolean;
  isMultiFamilySubjectToFha?: boolean; // Added for v7 FHA Multi-Family support
  ein?: string;
  crossReferenceStatus?: 'MATCHED' | 'MISSING_RETURNS' | 'NOT_APPLICABLE';
  fields: {
    id: string;
    label: string;
    value: string;
    numericValue: number;
    schedule: string;
    page: number;
    lineNum: string;
    boxCoordinates: { x: number; y: number; width: number; height: number };
    explanation: string;
    category: string;
    overrideValue?: string;
    isFlagged?: boolean;
  }[];
}

export default function UnderwriterSplitViewDemoV7({
  liveSession = null,
  source = 'demo',
  parseBusy = false,
  parseError = null,
  onParseFile,
  onUseDemo,
  onUseLive,
}: {
  liveSession?: LiveParseSession | null;
  source?: SplitViewSource;
  parseBusy?: boolean;
  parseError?: string | null;
  onParseFile?: (file: File) => void;
  onUseDemo?: () => void;
  onUseLive?: () => void;
} = {}) {
  // 1. STATE FOR MULTI-ENTITY PORTFOLIOS
  const [activeTab, setActiveTab] = useState<'SELF_EMPLOYED' | 'W2_AUDITOR'>('W2_AUDITOR');
  const [activeEntIdx, setActiveEntIdx] = useState<number>(0);
  const [pdfPage, setPdfPage] = useState<number>(1);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState<boolean>(false);
  const [generatedShareLink, setGeneratedShareLink] = useState<string>('');
  const [isReadOnlyForSales, setIsReadOnlyForSales] = useState<boolean>(true);
  const [shareRole, setShareRole] = useState<'SALES_LO' | 'PROCESSOR'>('SALES_LO');

  // W-2 Fraud Audit State: Allows the user to simulate doctored/fake values
  const [isW2FraudSimulated, setIsW2FraudSimulated] = useState<boolean>(false);

  // Original, clean W-2 fields
  const cleanW2Fields: W2OcrField[] = [
    { id: 'w2-box1', boxLabel: 'Box 1', fieldLabel: 'Wages, Tips, Other Comp', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 15, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box2', boxLabel: 'Box 2', fieldLabel: 'Federal Income Tax Withheld', value: '$18,500.00', numericValue: 18500, boxCoordinates: { x: 50, y: 15, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box3', boxLabel: 'Box 3', fieldLabel: 'Social Security Wages', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 25, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box4', boxLabel: 'Box 4', fieldLabel: 'Social Security Tax Withheld (6.2%)', value: '$9,300.00', numericValue: 9300, expectedValue: 9300, boxCoordinates: { x: 50, y: 25, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box5', boxLabel: 'Box 5', fieldLabel: 'Medicare Wages and Tips', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 35, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box6', boxLabel: 'Box 6', fieldLabel: 'Medicare Tax Withheld (1.45%)', value: '$2,175.00', numericValue: 2175, expectedValue: 2175, boxCoordinates: { x: 50, y: 35, width: 35, height: 4 }, isDiscrepancy: false },
  ];

  // Doctored/mathematically inconsistent W-2 fields for demoing audit triggers
  const fraudW2Fields: W2OcrField[] = [
    { id: 'w2-box1', boxLabel: 'Box 1', fieldLabel: 'Wages, Tips, Other Comp', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 15, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box2', boxLabel: 'Box 2', fieldLabel: 'Federal Income Tax Withheld', value: '$0.00', numericValue: 0, boxCoordinates: { x: 50, y: 15, width: 35, height: 4 }, isDiscrepancy: true }, // Alert: Zero withholding on high wages
    { id: 'w2-box3', boxLabel: 'Box 3', fieldLabel: 'Social Security Wages', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 25, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box4', boxLabel: 'Box 4', fieldLabel: 'Social Security Tax Withheld (6.2%)', value: '$4,200.00', numericValue: 4200, expectedValue: 9300, boxCoordinates: { x: 50, y: 25, width: 35, height: 4 }, isDiscrepancy: true }, // Fraud alert mismatch
    { id: 'w2-box5', boxLabel: 'Box 5', fieldLabel: 'Medicare Wages and Tips', value: '$150,000.00', numericValue: 150000, boxCoordinates: { x: 10, y: 35, width: 35, height: 4 }, isDiscrepancy: false },
    { id: 'w2-box6', boxLabel: 'Box 6', fieldLabel: 'Medicare Tax Withheld (1.45%)', value: '$1,150.00', numericValue: 1150, expectedValue: 2175, boxCoordinates: { x: 50, y: 35, width: 35, height: 4 }, isDiscrepancy: true }, // Fraud alert mismatch
  ];

  const [w2Fields, setW2Fields] = useState<W2OcrField[]>(cleanW2Fields);
  const [selectedW2FieldId, setSelectedW2FieldId] = useState<string>('w2-box1');
  const [selectedSelfEmployedFieldId, setSelectedSelfEmployedFieldId] = useState<string>('ent1-net');
  const [livePageIndex, setLivePageIndex] = useState(0);

  const isLive = source === 'live' && liveSession !== null;

  useEffect(() => {
    if (!liveSession) return;
    const pages = liveSession.result.pages;
    const preferred =
      pages.find((page) => (activeTab === 'W2_AUDITOR' ? pageLooksLikeW2(page) : pageLooksSelfEmployed(page))) ??
      pages[0];
    setLivePageIndex(preferred?.index ?? 0);
  }, [liveSession?.result.transaction_id, activeTab]);

  const livePage = liveSession?.result.pages.find((page) => page.index === livePageIndex) ?? liveSession?.result.pages[0];
  const mappedFields = useMemo(
    () => (liveSession ? mapIncomeFields(liveSession.result) : []),
    [liveSession?.result.transaction_id],
  );
  const overlayFields = mappedFields.filter((field) =>
    activeTab === 'W2_AUDITOR' ? field.form === 'W-2' : field.form !== 'W-2',
  );
  const selectedMappedId = activeTab === 'W2_AUDITOR' ? selectedW2FieldId : selectedSelfEmployedFieldId;

  // Sync state with simulation trigger
  useEffect(() => {
    setW2Fields(isW2FraudSimulated ? fraudW2Fields : cleanW2Fields);
    setSelectedW2FieldId('w2-box1');
  }, [isW2FraudSimulated]);

  // 3. OVERRIDE AND FLAGGING HANDLERS FOR WORKBENCH DEMO
  const handleW2OverrideChange = (id: string, textVal: string) => {
    setW2Fields(prev => prev.map(f => {
      if (f.id === id) {
        const cleanedNum = parseFloat(textVal.replace(/[^0-9.]/g, '')) || 0;
        let isDiscrepancy = f.isDiscrepancy;
        
        // Dynamic re-validation based on typed overrides!
        if (id === 'w2-box4') {
          isDiscrepancy = Math.abs(cleanedNum - 9300) > 1;
        } else if (id === 'w2-box6') {
          isDiscrepancy = Math.abs(cleanedNum - 2175) > 1;
        } else if (id === 'w2-box2') {
          isDiscrepancy = cleanedNum === 0;
        }

        return {
          ...f,
          overrideValue: textVal,
          numericValue: textVal === '' ? (isW2FraudSimulated ? fraudW2Fields.find(x => x.id === id)!.numericValue : cleanW2Fields.find(x => x.id === id)!.numericValue) : cleanedNum,
          value: textVal === '' ? (isW2FraudSimulated ? fraudW2Fields.find(x => x.id === id)!.value : cleanW2Fields.find(x => x.id === id)!.value) : `$${cleanedNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          isDiscrepancy
        };
      }
      return f;
    }));
  };

  const handleW2FlagToggle = (id: string) => {
    setW2Fields(prev => prev.map(f => f.id === id ? { ...f, isFlagged: !f.isFlagged } : f));
  };

  const handleSelfEmployedOverrideChange = (entityId: string, fieldId: string, textVal: string) => {
    setEntities(prev => prev.map(ent => {
      if (ent.id === entityId) {
        return {
          ...ent,
          fields: ent.fields.map(f => {
            if (f.id === fieldId) {
              const cleanedNum = parseFloat(textVal.replace(/[^0-9.]/g, '')) || 0;
              return {
                ...f,
                overrideValue: textVal,
                numericValue: textVal === '' ? f.numericValue : cleanedNum,
                value: textVal === '' ? f.value : `$${cleanedNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              };
            }
            return f;
          })
        };
      }
      return ent;
    }));
  };

  const handleSelfEmployedFlagToggle = (entityId: string, fieldId: string) => {
    setEntities(prev => prev.map(ent => {
      if (ent.id === entityId) {
        return {
          ...ent,
          fields: ent.fields.map(f => f.id === fieldId ? { ...f, isFlagged: !f.isFlagged } : f)
        };
      }
      return ent;
    }));
  };


  // Self-employed data models with added FHA Multi-Family support in v7
  const [entities, setEntities] = useState<TaxEntity[]>([
    {
      id: 'entity-1',
      entityName: 'Venture Consulting LLC',
      entityType: 'SCHEDULE_C',
      proprietorOrOwner: 'John J. Business',
      annualNetIncome: 115000,
      isExcluded: false,
      ein: 'NOT_APPLICABLE',
      crossReferenceStatus: 'NOT_APPLICABLE',
      fields: [
        { id: 'ent1-net', label: 'Net Profit or Loss (Line 31)', value: '$102,000.00', numericValue: 102000, schedule: 'Schedule C', page: 1, lineNum: 'Line 31', boxCoordinates: { x: 10, y: 72, width: 80, height: 4 }, explanation: 'Standard Schedule C net income [cite: 119].', category: 'income' },
        { id: 'ent1-dep', label: 'Depreciation Expense (Line 13)', value: '$8,500.00', numericValue: 8500, schedule: 'Schedule C', page: 1, lineNum: 'Line 13', boxCoordinates: { x: 10, y: 44, width: 80, height: 4 }, explanation: 'Non-cash depreciation added back to cash flow [cite: 121, 122].', category: 'addback' },
        { id: 'ent1-miles', label: 'Business Miles Driven (Line 44a)', value: '15,000 Miles (Add-back: $4,500)', numericValue: 4500, schedule: 'Schedule C', page: 2, lineNum: 'Line 44a', boxCoordinates: { x: 10, y: 55, width: 80, height: 4 }, explanation: 'Business miles multiplied by standard depreciation rate (30¢/mi) [cite: 122].', category: 'mileage' }
      ]
    },
    {
      id: 'entity-2',
      entityName: '123 Pine St Rental Portfolio',
      entityType: 'SCHEDULE_E_PART_1',
      proprietorOrOwner: 'John J. Business',
      annualNetIncome: 15500,
      isExcluded: false,
      isMultiFamilySubjectToFha: false, // Default is false, toggleable by underwriter
      ein: 'NOT_APPLICABLE',
      crossReferenceStatus: 'NOT_APPLICABLE',
      fields: [
        { id: 'ent2-rent', label: 'Rents Received (Line 3)', value: '$24,000.00', numericValue: 24000, schedule: 'Schedule E', page: 3, lineNum: 'Line 3', boxCoordinates: { x: 10, y: 22, width: 80, height: 4 }, explanation: 'Gross rents collected from real estate assets [cite: 38].', category: 'rental' },
        { id: 'ent2-exp', label: 'Total Expenses (Line 20)', value: '$12,000.00', numericValue: -12000, schedule: 'Schedule E', page: 3, lineNum: 'Line 20', boxCoordinates: { x: 10, y: 48, width: 80, height: 4 }, explanation: 'Total operating expenses excluding PITIA [cite: 38].', category: 'rental' },
        { id: 'ent2-dep', label: 'Rental Depreciation (Line 18)', value: '$3,500.00', numericValue: 3500, schedule: 'Schedule E', page: 3, lineNum: 'Line 18', boxCoordinates: { x: 10, y: 40, width: 80, height: 4 }, explanation: 'Rental depreciation added back to cash flow under Form 1084 rules [cite: 38].', category: 'addback' }
      ]
    }
  ]);

  // 2. TOGGLE EXCLUSION HANDLER
  const handleToggleExclusion = (id: string) => {
    setEntities(prev => prev.map(ent => ent.id === id ? { ...ent, isExcluded: !ent.isExcluded } : ent));
  };

  // Toggle FHA Multi-Family Decline rule on and off dynamically (v7 integration)
  const handleToggleMultiFamilyFha = (id: string) => {
    setEntities(prev => prev.map(ent => 
      ent.id === id ? { ...ent, isMultiFamilySubjectToFha: !ent.isMultiFamilySubjectToFha } : ent
    ));
  };

  // 3. SECURE SHARE PORTAL TOKEN GENERATOR
  const handleGenerateShareLink = (e: React.FormEvent) => {
    e.preventDefault();
    const mockToken = `freeflow_share_token_${Math.random().toString(36).substring(2, 15)}`;
    const mockUrl = `https://app.freeflowmortgage.com/share/${mockToken}?role=${shareRole}`;
    setGeneratedShareLink(mockUrl);
  };

  // Check if active entity is Schedule E and has FHA toggle enabled
  const activeEntity = entities[activeEntIdx];
  const isFhaMultiFamilyActive = activeEntity.entityType === 'SCHEDULE_E_PART_1' && activeEntity.isMultiFamilySubjectToFha;

  return (
    <div className="flex flex-col h-full bg-white text-slate-800 font-sans border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      
      {/* 1. TOP HEADER STATUS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center px-6 py-4 bg-white border-b border-slate-200 gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-50 rounded-lg text-emerald-700 border border-emerald-100">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-950 flex items-center space-x-2">
              <span>Income</span>
              <span className="text-xs px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full font-medium">ZDR</span>
            </h1>
            <p className="text-xs text-slate-500">W-2, 1084, source PDF</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 self-stretch md:self-auto justify-end">
          <label className="px-3.5 py-2 bg-slate-100 hover:bg-slate-100 transition text-slate-700 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-200 cursor-pointer">
            {parseBusy ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Upload className="w-4 h-4 text-emerald-400" />}
            <span>{parseBusy ? 'Parsing…' : 'Load live PDF'}</span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={parseBusy}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) onParseFile?.(next);
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              window.open(`/api/underwrite/summary-pdf?loanId=${DEMO_LOAN_ID}`, '_blank');
            }}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 transition text-slate-800 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-200"
          >
            <FileDown className="w-4 h-4 text-emerald-400" />
            <span>Print 1084 Summary</span>
          </button>

          {/* SECURE SHARE PORTAL BUTTON */}
          <button
            onClick={() => {
              setGeneratedShareLink('');
              setIsShareModalOpen(true);
            }}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 transition text-slate-800 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-200"
          >
            <Share2 className="w-4 h-4 text-emerald-400" />
            <span>Generate Shared Link</span>
          </button>

          <button 
            onClick={() => {
              setIsVerifying(true);
              setTimeout(() => setIsVerifying(false), 800);
            }}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 transition text-slate-950 rounded-lg text-xs font-bold flex items-center space-x-1.5 shadow-lg shadow-emerald-500/10"
          >
            <CheckCircle className="w-4 h-4" />
            <span>{isVerifying ? 'Saving Audits...' : 'Approve & Sync eFolder'}</span>
          </button>
        </div>
      </div>

      {(liveSession || parseError) && (
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-slate-400">
            {parseError ? (
              <span className="text-rose-300">{parseError}</span>
            ) : isLive ? (
              <>
                Live file <span className="font-mono text-slate-700">{liveSession?.fileName}</span> — parser boxes on
                the left. Fixture 1084 math is paused.
              </>
            ) : (
              <>
                Demo fixture is showing. Live parse of <span className="font-mono text-slate-700">{liveSession?.fileName}</span> is
                still loaded.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!liveSession}
              onClick={onUseLive}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                isLive
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Use live parse
            </button>
            <button
              type="button"
              onClick={onUseDemo}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                !isLive
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Back to demo
            </button>
          </div>
        </div>
      )}

      {/* TABS SELECTOR (Self-Employed 1084 Portfolio vs W-2 Withholding Auditor) */}
      <div className="flex bg-white border-b border-slate-200 px-6">
        <button
          onClick={() => { setActiveTab('W2_AUDITOR'); setPdfPage(1); }}
          className={`px-4 py-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'W2_AUDITOR' 
              ? 'border-emerald-600 text-emerald-700' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>W-2</span>
        </button>
        <button
          onClick={() => { setActiveTab('SELF_EMPLOYED'); setPdfPage(1); }}
          className={`px-4 py-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'SELF_EMPLOYED' 
              ? 'border-emerald-600 text-emerald-700' 
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>1040</span>
        </button>
      </div>

      {/* 2. MAIN SPLITVIEW */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-[680px]">
        
                {/* LEFT COLUMN: Interactive Document Sandbox Simulator */}
        <div className="w-full lg:w-[50%] flex flex-col border-r border-slate-200 bg-white relative min-h-[480px]">

          {/* Header toolbar */}
          <div className="flex justify-between items-center px-4 py-2 border-b border-slate-200 bg-white">
            <span className="text-[11px] font-bold text-slate-400 flex items-center space-x-1.5">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {isLive
                  ? `Live PDF (${livePage?.formIds.join(', ') || 'unlabeled'})`
                  : `Interactive PDF Sandbox Viewer (Page ${pdfPage} of 4)`}
              </span>
            </span>
            {!isLive && (
              <div className="flex space-x-2">
                <button onClick={() => setPdfPage(prev => Math.max(1, prev - 1))} className="p-1 rounded bg-slate-100 hover:bg-slate-100 text-xs">◀</button>
                <button onClick={() => setPdfPage(prev => Math.min(4, prev + 1))} className="p-1 rounded bg-slate-100 hover:bg-slate-100 text-xs">▶</button>
              </div>
            )}
          </div>

          {/* Interactive Document Area */}
          <div className="flex-1 flex items-center justify-center p-8 bg-slate-50 relative overflow-auto">
            {isLive && liveSession ? (
              <PdfPagePreview
                file={liveSession.file}
                pageIndex={livePage?.index ?? livePageIndex}
                pageCount={liveSession.result.total_pages_scanned}
                fields={overlayFields}
                selectedFieldId={selectedMappedId}
                onSelectField={(id) => {
                  if (activeTab === 'W2_AUDITOR') setSelectedW2FieldId(id);
                  else setSelectedSelfEmployedFieldId(id);
                }}
                onPageChange={(index) => setLivePageIndex(index)}
              />
            ) : (
            <div className="w-[320px] sm:w-[420px] h-[520px] bg-white text-slate-900 rounded shadow-2xl relative border border-slate-200 p-6 flex flex-col justify-between overflow-hidden">
              
              {activeTab === 'W2_AUDITOR' ? (
                /* SIMULATED IRS FORM W-2 GRAPHIC PANEL */
                <div className="space-y-4 flex-1">
                  <div className="border-b-2 border-slate-900 pb-2 flex justify-between items-start">
                    <div>
                      <h4 className="text-md font-black tracking-tight leading-none text-slate-950">Form W-2 Wage Statement</h4>
                      <span className="text-[9px] text-slate-400 font-mono mt-1 block">Department of the Treasury—Internal Revenue Service</span>
                    </div>
                    <span className="text-lg font-black text-slate-900 font-mono">2026</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-[10px] text-left border-b pb-3">
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-slate-400 block font-bold">Box b | Employer EIN</span>
                      <span className="font-mono font-bold text-slate-900">12-3456789</span>
                    </div>
                    <div>
                      <span className="text-[8px] uppercase tracking-wider text-slate-400 block font-bold">Box e | Employee Name</span>
                      <span className="font-bold text-slate-900">Alex M. Morgan</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-left">
                    {w2Fields.map((field) => {
                      const selected = selectedW2FieldId === field.id;
                      return (
                        <button
                          key={field.id}
                          type="button"
                          onClick={() => setSelectedW2FieldId(field.id)}
                          className={`flex flex-col gap-1.5 rounded border p-1.5 text-left transition ${
                            selected
                              ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/40'
                              : field.isDiscrepancy
                                ? 'border-rose-300 bg-rose-50'
                                : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <span className="block text-[7px] font-bold leading-tight text-slate-500">
                            {field.boxLabel} {field.fieldLabel}
                          </span>
                          <span
                            data-testid={`w2-amount-${field.id}`}
                            className="self-start rounded px-1.5 py-0.5 font-mono text-[11px] font-black text-slate-950"
                          >
                            {field.value}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-2 border-t text-[8px] text-slate-400 leading-normal text-left">
                    *OCR Engine extracted and mapped all 6 core numerical fields successfully. Discrepancy validation scripts checked and highlighted above boxes.
                  </div>
                </div>
              ) : (
                /* SIMULATED SCHEDULE C/E TAX DOCUMENT GRAPHIC PANEL */
                <div className="space-y-4 flex-1">
                  <div className="border-b-2 border-slate-900 pb-2 flex justify-between items-start text-left">
                    <div>
                      <h4 className="text-sm font-black tracking-tight text-slate-950">
                        {activeEntIdx === 0 ? 'SCHEDULE C (Form 1040)' : 'SCHEDULE E (Form 1040)'}
                      </h4>
                      <span className="text-[8px] text-slate-400 mt-1 block">Internal Revenue Service (99)</span>
                    </div>
                    <span className="text-md font-black text-slate-900 font-mono">2025</span>
                  </div>

                  <div className="text-xs text-left p-3 bg-slate-50 border rounded space-y-2">
                    <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block">Tax Document Slicing Status</span>
                    <span className="text-[10px] font-bold text-slate-900 block flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>CPU Pre-Slicing Complete ($0.00 Cost)</span>
                    </span>
                    <p className="text-[9px] text-slate-500 leading-normal">
                      Local Python Slicing Engine scanned 150-page PDF, discarded 147 pages of noise, and extracted target schedules. [cite: 30, 111].
                    </p>
                  </div>

                  {activeEntIdx === 0 ? (
                    <>
                      <div className="p-3 border text-left rounded bg-slate-50/50">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block leading-none">Net Profit/Loss (Line 31)</span>
                        <span className="font-mono text-base font-black text-slate-900">$102,000.00</span>
                      </div>

                      <div className="p-3 border text-left rounded bg-slate-50/50">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block leading-none">Depreciation (Line 13)</span>
                        <span className="font-mono text-base font-black text-slate-900">$8,500.00</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Schedule E details shown to user */}
                      <div className="p-3 border text-left rounded bg-slate-50/50 relative">
                        {/* Red visual target box on rents collected if decline toggle is active */}
                        {isFhaMultiFamilyActive && (
                          <div className="absolute inset-0 border-2 border-rose-500 bg-rose-500/5 rounded animate-pulse" />
                        )}
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block leading-none">Rents Received (Line 3)</span>
                        <span className="font-mono text-base font-black text-slate-900">
                          {isFhaMultiFamilyActive ? '$15,500.00 (Declined -38.0%)' : '$24,000.00'}
                        </span>
                      </div>

                      <div className="p-3 border text-left rounded bg-slate-50/50">
                        <span className="text-[8px] uppercase tracking-wider text-slate-400 font-bold block leading-none">Rental Depreciation (Line 18)</span>
                        <span className="font-mono text-base font-black text-slate-900">$3,500.00</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Bottom Watermark */}
              <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-[8px] text-slate-400">
                <span className="uppercase font-bold tracking-widest text-slate-500 font-sans">FreeFlow Sandbox</span>
                <span className="font-mono">SHA256: e3b0c442...</span>
              </div>
            </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Ingestion Workbench */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto p-6 space-y-6">

          {isLive && liveSession ? (
            <LiveMappedFields
              fields={overlayFields}
              selectedId={selectedMappedId}
              onSelect={(id) => {
                if (activeTab === 'W2_AUDITOR') setSelectedW2FieldId(id);
                else setSelectedSelfEmployedFieldId(id);
              }}
            />
          ) : activeTab === 'W2_AUDITOR' ? (
            /* W-2 INGESTION WORKBENCH VIEW */
            <div className="space-y-6 text-left">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Form W-2 Box-by-Box Ingestion</h3>
                  <p className="text-[11px] text-slate-400">Verifying structured wage and withholding parameters against IRS formulas</p>
                </div>
                
                {/* Fraud Simulator Toggle */}
                <button
                  onClick={() => setIsW2FraudSimulated(!isW2FraudSimulated)}
                  className={`px-3 py-1.5 rounded text-[11px] font-black transition ${
                    isW2FraudSimulated 
                      ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400' 
                      : 'bg-slate-100 border border-slate-200 text-slate-600'
                  }`}
                >
                  {isW2FraudSimulated ? '⚠️ Fraud Demo Active' : 'Simulate Fraudulent W-2'}
                </button>
              </div>

              {/* FIELD ROWS: extracted amount + override on the same line */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Extracted boxes — amount and override on one line</span>
                <div className="space-y-2">
                  {w2Fields.map((field) => (
                    <div
                      key={field.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedW2FieldId(field.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setSelectedW2FieldId(field.id);
                      }}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left ${
                        selectedW2FieldId === field.id
                          ? 'border-emerald-400 bg-emerald-50'
                          : field.isDiscrepancy
                            ? 'border-rose-300 bg-rose-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <span className="w-14 shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{field.boxLabel}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{field.fieldLabel}</span>
                      {field.isDiscrepancy ? (
                        <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-rose-700">Math</span>
                      ) : null}
                      <span className="w-28 shrink-0 text-right font-mono text-sm font-bold text-slate-950">
                        {isW2FraudSimulated && !field.overrideValue
                          ? (fraudW2Fields.find((item) => item.id === field.id)?.value ?? field.value)
                          : field.overrideValue
                            ? field.value
                            : (cleanW2Fields.find((item) => item.id === field.id)?.value ?? field.value)}
                      </span>
                      <input
                        type="text"
                        value={field.overrideValue || ''}
                        placeholder="Override"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleW2OverrideChange(field.id, event.target.value)}
                        className="w-28 shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-sm text-slate-950 outline-none focus:border-emerald-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* AUTOMATED FRAUD AND RED FLAG ALERT PANEL */}
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">Active Fraud & Risk Audit Alerts</span>
                
                {isW2FraudSimulated ? (
                  <div className="space-y-3">
                    {/* Alert 1: Social Security Tax Mismatch */}
                    {w2Fields.find(f => f.id === 'w2-box4')?.isDiscrepancy && (
                      <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg flex items-start space-x-2 text-left">
                        <AlertOctagon className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] font-black text-rose-400 uppercase tracking-wider block">Critical Fraud Risk: Social Security Withholding Mismatch</span>
                          <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                            The extracted Social Security tax withheld in Box 4 ({w2Fields.find(f => f.id === 'w2-box4')?.value}) deviates from the statutory 6.2% withholding of Box 3 wages ($150,000.00 * 0.062 = $9,300.00). Document math is invalid and indicates a likely forged or altered W-2.
                          </p>
                          <div className="flex space-x-4 mt-1.5 font-mono text-[9px] text-rose-300/80">
                            <span>• Expected: $9,300.00</span>
                            <span>• Active Value: {w2Fields.find(f => f.id === 'w2-box4')?.value}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alert 2: Medicare Tax Withholding Mismatch */}
                    {w2Fields.find(f => f.id === 'w2-box6')?.isDiscrepancy && (
                      <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-lg flex items-start space-x-2 text-left">
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] font-black text-rose-400 uppercase tracking-wider block">Critical Fraud Risk: Medicare Withholding Mismatch</span>
                          <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                            Medicare withholding tax in Box 6 ({w2Fields.find(f => f.id === 'w2-box6')?.value}) does not align with the statutory 1.45% tax of Box 5 wages ($150,000.00 * 0.0145 = $2,175.00). Verification has been automatically blocked.
                          </p>
                          <div className="flex space-x-4 mt-1.5 font-mono text-[9px] text-rose-300/80">
                            <span>• Expected: $2,175.00</span>
                            <span>• Active Value: {w2Fields.find(f => f.id === 'w2-box6')?.value}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Alert 3: Self-Employment / No Tax Withheld */}
                    {w2Fields.find(f => f.id === 'w2-box2')?.isDiscrepancy && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg flex items-start space-x-2 text-left">
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="text-[10px] font-black text-amber-400 uppercase tracking-wider block">Self-Employment Risk: Zero Box 2 Tax Withheld</span>
                          <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                            Federal Income Tax Withheld (Box 2) is exactly {w2Fields.find(f => f.id === 'w2-box2')?.value} on a high salary of $150,000.00. Check if the borrower owns this company ("Alex Morgan Tech LLC") and verify if they are self-employed.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* If all overrides cleared the errors */}
                    {!w2Fields.find(f => f.id === 'w2-box4')?.isDiscrepancy && !w2Fields.find(f => f.id === 'w2-box6')?.isDiscrepancy && !w2Fields.find(f => f.id === 'w2-box2')?.isDiscrepancy && (
                      <div className="bg-emerald-500/10 border border-emerald-500/25 p-2.5 rounded-lg flex items-center space-x-3">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        <div>
                          <span className="text-[10px] font-bold text-emerald-400 block uppercase">All Withholding Audits Passed (Via Override)</span>
                          <span className="text-[10px] text-slate-600 block leading-snug">W-2 overrides successfully resolved all math discrepancies and fraud risk flags. No outstanding audit warnings exist.</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 p-2.5 rounded-lg flex items-center space-x-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 block uppercase">All Withholding Audits Passed</span>
                      <span className="text-[10px] text-slate-600 block leading-snug">W-2 tax percentages are 100% consistent with Box 3 (6.2%) and Box 5 (1.45%) wages. No fraud flags detected.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 text-left">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans flex items-center space-x-2">
                  <span>Fannie Mae Form 1084 & Schedule E Engines</span>
                  <span className="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full px-2 py-0.5">v7 Enforced</span>
                </h3>
                <p className="text-[11px] text-slate-400">Verifying extracted Schedule C/E figures and calculating depreciations [cite: 38, 122]</p>
              </div>

              {/* Entity tab toggles */}
              <div className="space-y-3">
                {entities.map((ent, idx) => (
                  <div 
                    key={ent.id}
                    className={`flex flex-col p-3 rounded-lg border transition ${
                      activeEntIdx === idx 
                        ? 'bg-white border-slate-200 text-white' 
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => { setActiveEntIdx(idx); setPdfPage(ent.fields[0].page); }}
                        className="flex-1 text-left flex flex-col min-w-0"
                      >
                        <div className="flex items-center space-x-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            ent.entityType === 'SCHEDULE_C' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                          }`}>
                            {ent.entityType === 'SCHEDULE_C' ? 'Sch C' : 'Sch E'}
                          </span>
                          <span className="text-xs font-bold truncate">{ent.entityName}</span>
                        </div>
                      </button>

                      {/* Exclude Toggle */}
                      <div className="flex items-center pl-2 border-l border-slate-200 space-x-2">
                        <button
                          onClick={() => handleToggleExclusion(ent.id)}
                          className={`px-2.5 py-1.5 rounded flex items-center space-x-1 transition text-[10px] font-bold ${
                            ent.isExcluded 
                              ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20' 
                              : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {ent.isExcluded ? <ToggleLeft className="h-4 w-4 text-rose-400" /> : <ToggleRight className="h-4 w-4 text-emerald-400" />}
                          <span>{ent.isExcluded ? 'Excluded' : 'Active'}</span>
                        </button>
                      </div>
                    </div>

                    {/* FHA Multi-Family Toggle (Only renders on Schedule E) */}
                    {ent.entityType === 'SCHEDULE_E_PART_1' && (
                      <div className="mt-3 pt-2.5 border-t border-slate-200 flex items-center justify-between bg-slate-50 p-2 rounded">
                        <div className="flex items-center space-x-1.5 text-slate-400">
                          <Info className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-[10px] font-medium">Is Multi-Family Subject Property (FHA HUD 4000.1)?</span>
                        </div>
                        <button
                          onClick={() => handleToggleMultiFamilyFha(ent.id)}
                          className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition ${
                            ent.isMultiFamilySubjectToFha
                              ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-400'
                              : 'bg-slate-100 border border-slate-200 text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          {ent.isMultiFamilySubjectToFha ? 'Enabled (Catastrophic Decline Checked)' : 'Disabled'}
                        </button>
                      </div>
                    )}

                  </div>
                ))}
              </div>

              {/* Active Entity Fields */}
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">Active Form Fields & coordinates</span>
                <div className="space-y-2">
                  {entities[activeEntIdx].fields.map((f) => {
                    // If FHA multi-family decline is active on entity-2, override shown UI calculations to $0.00
                    const isOverriddenByFhaDecline = isFhaMultiFamilyActive;
                    let displayValue = f.overrideValue ? f.value + " (Override)" : f.value;
                    if (isOverriddenByFhaDecline) {
                      displayValue = "$0.00 (Disqualified)";
                    }

                    return (
                      <button
                        key={f.id}
                        onClick={() => setSelectedSelfEmployedFieldId(f.id)}
                        className={`w-full p-3 rounded-lg border text-left flex justify-between items-center transition ${
                          selectedSelfEmployedFieldId === f.id
                            ? 'bg-white border-indigo-400 text-white'
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-50 text-slate-600'
                        }`}
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase bg-white px-2 py-0.5 rounded border border-slate-200">
                              {f.lineNum} ({f.schedule})
                            </span>
                            {f.isFlagged && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-bold uppercase">
                                Flagged
                              </span>
                            )}
                          </div>
                          <span className="text-xs block text-slate-700 mt-1.5 font-semibold">{f.label}</span>
                        </div>
                        <span className={`text-sm font-mono font-black ${isOverriddenByFhaDecline ? 'text-rose-400 line-through' : 'text-white'}`}>
                          {displayValue}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* SELF-EMPLOYED INTERACTIVE OVERRIDE WORKBENCH */}
              {entities[activeEntIdx].fields.find(f => f.id === selectedSelfEmployedFieldId) && (() => {
                const currentField = entities[activeEntIdx].fields.find(f => f.id === selectedSelfEmployedFieldId)!;
                const originalVal = entities[activeEntIdx].fields.find(f => f.id === selectedSelfEmployedFieldId)!.value;
                return (
                  <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-3 text-left">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                      <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Interactive Override & AI Learning Portal</span>
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">
                        {currentField.lineNum}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[9px] text-slate-400 uppercase font-black tracking-wider mb-1">OCR Extracted</label>
                        <div className="p-2 bg-white border border-slate-200 rounded font-mono text-slate-500 font-bold select-none cursor-not-allowed">
                          {currentField.value}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] text-indigo-400 uppercase font-black tracking-wider mb-1">Type Manual Override</label>
                        <input
                          type="text"
                          value={currentField.overrideValue || ''}
                          onChange={(e) => handleSelfEmployedOverrideChange(entities[activeEntIdx].id, currentField.id, e.target.value)}
                          placeholder="e.g. 5000.00"
                          className="w-full bg-white border border-slate-200 focus:border-indigo-400 rounded p-2 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center gap-2 pt-1 border-t border-slate-200/50">
                      <p className="text-[9px] text-slate-400 leading-normal max-w-[240px]">
                        *Provides direct ledger offsets inside Form 1084 and Schedule E. Keeps unalterable PostgreSQL logs.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleSelfEmployedFlagToggle(entities[activeEntIdx].id, currentField.id)}
                        className={`px-3 py-1.5 rounded text-[10px] font-black tracking-wide flex items-center gap-1 transition ${
                          currentField.isFlagged 
                            ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
                            : 'bg-slate-100 hover:bg-slate-750 border border-slate-200 text-slate-600'
                        }`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{currentField.isFlagged ? '✓ Extraction Flagged' : 'Flag for AI Learning'}</span>
                      </button>
                    </div>

                    {currentField.isFlagged && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded flex items-start space-x-2 text-[9px] text-slate-600 leading-normal">
                        <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>Audit Logged:</strong> Field mapped and submitted to model. Underwriter correction queued to automatically recalibrate localized NLP templates.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              
              {/* Dynamic Alerts for FHA Multi-Family Decline under v7 */}
              {isFhaMultiFamilyActive && (
                <div className="bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-lg flex items-start space-x-2">
                  <AlertOctagon className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div>
                    <span className="text-[10px] font-black text-rose-400 uppercase tracking-wider block">FHA HUD 4000.1 Compliance Breach: Multi-Family Income Disqualified</span>
                    <p className="text-[10px] text-slate-600 mt-1 font-sans leading-snug">
                      Subject property rental income has **declined catastrophically by 38.0%** year-over-year (Year 2: $25,000 → Year 1: $15,500). Under HUD 4000.1 rules, declines exceeding 20% trigger complete income disqualification.
                    </p>
                    <div className="mt-2 font-mono text-[10px] text-rose-300 flex space-x-2 bg-slate-50 p-2 rounded border border-rose-500/10">
                      <span>• Baseline: $0.00/mo (Locked)</span>
                      <span>• Deficit: -$791.67/mo loss</span>
                    </div>
                  </div>
                </div>
              )}

              
              {/* DYNAMIC DOCUMENT CHECKLIST BAR - Dynamic conditions loaded by v7 */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white text-left space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase block">Dynamic Underwriting eFolder Conditions</span>
                
                {isFhaMultiFamilyActive ? (
                  <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-600">
                    <Lock className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-rose-400 uppercase tracking-widest block">CHECKLIST ADDED: FHA Multi-Family Review</span>
                      Provide a certified **RENTAL_LEASE_LEDGER_PROOF_OF_CURRENT_STABLE_OCCUPANCY** detailing active leases and capital reserve bank logs to justify potential exception override [cite: 122].
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-600">
                    <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-emerald-400 uppercase tracking-widest block">All Conditions Cleared</span>
                      Subject properties meet default Fannie/Freddie stability indices. No outstanding verification logs required [cite: 38].
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      </div>

      {/* 3. SECURE SHARE MODAL (Enforces read-only limit for Sales/LOs) */}
      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl relative text-left">
            <button 
              onClick={() => setIsShareModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-900 text-sm font-bold bg-slate-100 px-2.5 py-1 rounded"
            >
              ✕
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-200 pb-3">
              <Share2 className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="font-bold text-white text-base">Secure Sharing & Access Portal</h3>
                <p className="text-[10px] text-slate-400">Generate temporary shared links with strict role constraints [cite: 62]</p>
              </div>
            </div>

            <form onSubmit={handleGenerateShareLink} className="mt-4 space-y-4 text-xs">
              
              {/* Access Role restriction */}
              <div className="space-y-1">
                <label className="block text-slate-600 font-bold uppercase tracking-wider">Access Role Restriction</label>
                <select
                  value={shareRole}
                  onChange={(e) => {
                    const selected = e.target.value as 'SALES_LO' | 'PROCESSOR';
                    setShareRole(selected);
                    setIsReadOnlyForSales(selected === 'SALES_LO');
                  }}
                  className="w-full bg-white border border-slate-200 rounded p-2 text-white focus:outline-none focus:border-emerald-400"
                >
                  <option value="SALES_LO">Loan Officer / Sales Representative (Strictly Read-Only)</option>
                  <option value="PROCESSOR">Loan Processor / Assistant (Edit Capabilities)</option>
                </select>
                <p className="text-[9px] text-slate-500 leading-normal mt-1">
                  *Sales/LO accounts are globally locked into a read-only environment to block unauthorized TRID compliance modifications.
                </p>
              </div>

              {/* Dynamic Warning Notification */}
              {isReadOnlyForSales && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-600">
                  <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black text-emerald-400 uppercase tracking-widest block">Read-Only Enforced</span>
                    The server-side security layer will intercept all POST, PUT, and DELETE commands on this share token, rendering input fields disabled.
                  </div>
                </div>
              )}

              {/* Recipient Details */}
              <div className="space-y-1">
                <label className="block text-slate-600 font-bold uppercase tracking-wider">Recipient Email (Optional)</label>
                <input
                  type="email"
                  placeholder="sales-rep@freeflowmortgage.com"
                  className="w-full bg-white border border-slate-200 rounded p-2 text-white focus:outline-none focus:border-emerald-400"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-emerald-500 text-slate-950 hover:bg-emerald-600 font-bold rounded-lg text-xs transition"
              >
                Generate Tokenized Link
              </button>

              {/* Tokenized Link Output */}
              {generatedShareLink && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <label className="block text-slate-600 font-bold uppercase tracking-wider">Secure Access Link</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedShareLink}
                      className="flex-1 bg-white border border-slate-200 rounded p-2 font-mono text-[10px] text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(generatedShareLink)}
                      className="px-3 bg-slate-100 hover:bg-slate-100 text-slate-700 rounded font-bold border border-slate-200 text-[10px]"
                    >
                      Copy
                    </button>
                  </div>
                  <span className="text-[9px] text-slate-500 block text-center font-mono">Token expires in exactly 7 days.</span>
                </div>
              )}

            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function LiveMappedFields({
  fields,
  selectedId,
  onSelect,
}: {
  fields: { id: string; boxLabel: string; fieldLabel: string; value: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2 text-left">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mapped boxes — amount on the same row</p>
      {fields.length === 0 ? (
        <p className="text-sm text-slate-500">No W-2 / Schedule C/E amount fields mapped on this file yet.</p>
      ) : (
        fields.map((field) => (
          <button
            key={field.id}
            type="button"
            onClick={() => onSelect(field.id)}
            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${
              selectedId === field.id ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'
            }`}
          >
            <span className="w-16 shrink-0 font-mono text-[10px] font-black uppercase text-slate-500">{field.boxLabel}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{field.fieldLabel}</span>
            <span className="w-28 shrink-0 text-right font-mono text-sm font-bold text-slate-950">{field.value}</span>
          </button>
        ))
      )}
    </div>
  );
}
