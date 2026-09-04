import React, { useState, useEffect } from 'react';
import { 
  FileText, CheckCircle, AlertCircle, TrendingUp, Compass, 
  ChevronRight, ArrowLeft, ShieldCheck, HelpCircle, Eye, 
  ExternalLink, Layers, RefreshCw, Trash2, ToggleLeft, ToggleRight,
  Database, Info, AlertTriangle, CheckCircle2, Share2, Lock, 
  User, Key, Globe, AlertOctagon, ShieldAlert, Cpu, FileDown
} from 'lucide-react';

const DEMO_LOAN_ID = 'e1f82f80-df4f-4d56-a97e-12829a34b2cf';

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
    isFlagged?: boolean;
    overrideValue?: string;
  }[];
}

export default function UnderwriterSplitViewDemoV7() {
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
  const [selectedW2FieldId, setSelectedW2FieldId] = useState<string>('w2-box4');
  const [selectedSelfEmployedFieldId, setSelectedSelfEmployedFieldId] = useState<string>('ent1-net');

  // Sync state with simulation trigger
  useEffect(() => {
    setW2Fields(isW2FraudSimulated ? fraudW2Fields : cleanW2Fields);
    setSelectedW2FieldId('w2-box4');
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
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 font-sans border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
      
      {/* 1. TOP HEADER STATUS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center px-6 py-4 bg-slate-950 border-b border-slate-800 gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center space-x-2">
              <span>FreeFlow B2B Underwriting Point-Solution Demo v9 | Flipped Workspace Layout (Underwriter-Optimized)</span>
              <span className="text-xs px-2.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-medium">ZDR Active</span>
            </h1>
            <p className="text-xs text-slate-400">Underwriting Withholding Fraud Auditor, Self-Employed Warnings, FHA Multi-Family & Secure Sharing [cite: 30, 33, 38]</p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3 self-stretch md:self-auto justify-end">
          <button
            type="button"
            onClick={() => {
              window.open(`/api/underwrite/summary-pdf?loanId=${DEMO_LOAN_ID}`, '_blank');
            }}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 transition text-slate-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-700"
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
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 transition text-slate-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 border border-slate-700"
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

      {/* TABS SELECTOR (Self-Employed 1084 Portfolio vs W-2 Withholding Auditor) */}
      <div className="flex bg-slate-950 border-b border-slate-800 px-6">
        <button
          onClick={() => { setActiveTab('W2_AUDITOR'); setPdfPage(1); }}
          className={`px-4 py-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'W2_AUDITOR' 
              ? 'border-emerald-400 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>W-2 Wage Ingestion & Fraud Auditor</span>
        </button>
        <button
          onClick={() => { setActiveTab('SELF_EMPLOYED'); setPdfPage(1); }}
          className={`px-4 py-3 text-xs font-bold transition border-b-2 flex items-center space-x-2 ${
            activeTab === 'SELF_EMPLOYED' 
              ? 'border-emerald-400 text-emerald-400' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Sole Proprietor & Real Estate (Form 1040)</span>
        </button>
      </div>

      {/* 2. MAIN SPLITVIEW */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-[680px]">
        
                {/* LEFT COLUMN: Interactive Document Sandbox Simulator */}
        <div className="w-full lg:w-[50%] flex flex-col border-r border-slate-800 bg-slate-950 relative min-h-[480px]">

          {/* Header toolbar */}
          <div className="flex justify-between items-center px-4 py-2 border-b border-slate-850 bg-slate-900/50">
            <span className="text-[11px] font-bold text-slate-400 flex items-center space-x-1.5">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              <span>Interactive PDF Sandbox Viewer (Page {pdfPage} of 4)</span>
            </span>
            <div className="flex space-x-2">
              <button onClick={() => setPdfPage(prev => Math.max(1, prev - 1))} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">◀</button>
              <button onClick={() => setPdfPage(prev => Math.min(4, prev + 1))} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">▶</button>
            </div>
          </div>

          {/* Interactive Document Area */}
          <div className="flex-1 flex items-center justify-center p-8 bg-slate-900/20 relative">
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

                  {/* Standard W-2 Box Layout Grid */}
                  <div className="grid grid-cols-2 gap-4 text-left relative">
                    
                    {/* Bounding box highlight that shifts based on selected ID */}
                    <div 
                      className={`absolute border-2 border-emerald-500 bg-emerald-500/10 rounded transition-all duration-300 ${
                        selectedW2FieldId === 'w2-box1' ? 'top-0 left-0 w-[48%] h-[36px]' :
                        selectedW2FieldId === 'w2-box2' ? 'top-0 left-[52%] w-[48%] h-[36px]' :
                        selectedW2FieldId === 'w2-box3' ? 'top-[44px] left-0 w-[48%] h-[36px]' :
                        selectedW2FieldId === 'w2-box4' ? 'top-[44px] left-[52%] w-[48%] h-[36px]' :
                        selectedW2FieldId === 'w2-box5' ? 'top-[88px] left-0 w-[48%] h-[36px]' :
                        'top-[88px] left-[52%] w-[48%] h-[36px]'
                      }`}
                    />

                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">1 Wages, tips, other comp</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">$150,000.00</span>
                    </div>
                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">2 Federal income tax withheld</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">{isW2FraudSimulated ? '$0.00' : '$18,500.00'}</span>
                    </div>
                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">3 Social security wages</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">$150,000.00</span>
                    </div>
                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">4 Social security tax withheld</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">{isW2FraudSimulated ? '$4,200.00' : '$9,300.00'}</span>
                    </div>
                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">5 Medicare wages and tips</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">$150,000.00</span>
                    </div>
                    <div className="p-1 border border-slate-100 rounded">
                      <span className="text-[7px] text-slate-400 block font-bold leading-none">6 Medicare tax withheld</span>
                      <span className="font-mono text-[11px] font-black text-slate-900">{isW2FraudSimulated ? '$1,150.00' : '$2,175.00'}</span>
                    </div>
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
          </div>
        </div>

        {/* RIGHT COLUMN: Ingestion Workbench */}
        <div className="flex-1 flex flex-col bg-slate-950/50 overflow-y-auto p-6 space-y-6">

          
          {activeTab === 'W2_AUDITOR' ? (
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
                      : 'bg-slate-800 border border-slate-700 text-slate-300'
                  }`}
                >
                  {isW2FraudSimulated ? '⚠️ Fraud Demo Active' : 'Simulate Fraudulent W-2'}
                </button>
              </div>

              {/* FIELD SELECTION GRID */}
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">Extracted W-2 Fields & coordinate triggers</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {w2Fields.map((field) => (
                    <button
                      key={field.id}
                      onClick={() => setSelectedW2FieldId(field.id)}
                      className={`p-3 rounded-lg border text-left flex flex-col justify-between transition ${
                        selectedW2FieldId === field.id 
                          ? 'bg-slate-900 border-emerald-400 text-white' 
                          : field.isDiscrepancy 
                            ? 'bg-rose-500/5 border-rose-500/30 text-rose-300'
                            : 'bg-slate-900/30 border-slate-800 hover:bg-slate-900/50 text-slate-300'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className="text-[10px] text-slate-400 font-black font-mono uppercase bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          {field.boxLabel}
                        </span>
                        {field.isDiscrepancy && (
                          <span className="text-[9px] px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded font-black uppercase">
                            Math Error
                          </span>
                        )}
                        {field.isFlagged && (
                          <span className="text-[9px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-black uppercase flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping"></span>
                            <span>Flagged</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-medium mt-2">{field.fieldLabel}</span>
                      <span className="text-sm font-mono font-black text-white mt-1">
                        {field.overrideValue ? field.value + " (Override)" : field.value}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* W-2 INTERACTIVE OVERRIDE WORKBENCH */}
              {w2Fields.find(f => f.id === selectedW2FieldId) && (() => {
                const currentField = w2Fields.find(f => f.id === selectedW2FieldId)!;
                const originalVal = isW2FraudSimulated 
                  ? (fraudW2Fields.find(x => x.id === selectedW2FieldId)?.value || '') 
                  : (cleanW2Fields.find(x => x.id === selectedW2FieldId)?.value || '');
                return (
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-3 text-left">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-[10px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Interactive Override & AI Learning Portal</span>
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850">
                        {currentField.boxLabel}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[9px] text-slate-400 uppercase font-black tracking-wider mb-1">OCR Extracted</label>
                        <div className="p-2 bg-slate-950 border border-slate-850 rounded font-mono text-slate-500 font-bold select-none cursor-not-allowed">
                          {originalVal}
                        </div>
                      </div>
                      <div>
                        <label className="block text-[9px] text-emerald-400 uppercase font-black tracking-wider mb-1">Type Manual Override</label>
                        <input
                          type="text"
                          value={currentField.overrideValue || ''}
                          onChange={(e) => handleW2OverrideChange(currentField.id, e.target.value)}
                          placeholder="e.g. 9300.00"
                          className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-400 rounded p-2 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500/20"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center gap-2 pt-1 border-t border-slate-850/50">
                      <p className="text-[9px] text-slate-400 leading-normal max-w-[240px]">
                        *Typing overrides here updates calculations and resolves auditing discrepancies on the fly.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleW2FlagToggle(currentField.id)}
                        className={`px-3 py-1.5 rounded text-[10px] font-black tracking-wide flex items-center gap-1 transition ${
                          currentField.isFlagged 
                            ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
                            : 'bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300'
                        }`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{currentField.isFlagged ? '✓ Extraction Flagged' : 'Flag for AI Learning'}</span>
                      </button>
                    </div>

                    {currentField.isFlagged && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded flex items-start space-x-2 text-[9px] text-slate-300 leading-normal">
                        <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong>Audit Logged:</strong> Coordinates flagged. Feedback is queued to correct the local OpenCV container binarization parameters for future uploads.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                          <p className="text-[10px] text-slate-300 mt-1 leading-snug">
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
                          <p className="text-[10px] text-slate-300 mt-1 leading-snug">
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
                          <p className="text-[10px] text-slate-300 mt-1 leading-snug">
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
                          <span className="text-[10px] text-slate-300 block leading-snug">W-2 overrides successfully resolved all math discrepancies and fraud risk flags. No outstanding audit warnings exist.</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/25 p-2.5 rounded-lg flex items-center space-x-3">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 block uppercase">All Withholding Audits Passed</span>
                      <span className="text-[10px] text-slate-300 block leading-snug">W-2 tax percentages are 100% consistent with Box 3 (6.2%) and Box 5 (1.45%) wages. No fraud flags detected.</span>
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
                        ? 'bg-slate-900 border-slate-700 text-white' 
                        : 'bg-slate-900/40 border-slate-850 hover:bg-slate-900/60 text-slate-300'
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
                      <div className="flex items-center pl-2 border-l border-slate-800 space-x-2">
                        <button
                          onClick={() => handleToggleExclusion(ent.id)}
                          className={`px-2.5 py-1.5 rounded flex items-center space-x-1 transition text-[10px] font-bold ${
                            ent.isExcluded 
                              ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20' 
                              : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                          }`}
                        >
                          {ent.isExcluded ? <ToggleLeft className="w-4.5 h-4.5 text-rose-400" /> : <ToggleRight className="w-4.5 h-4.5 text-emerald-400" />}\
                          <span>{ent.isExcluded ? 'Excluded' : 'Active'}</span>
                        </button>
                      </div>
                    </div>

                    {/* FHA Multi-Family Toggle (Only renders on Schedule E) */}
                    {ent.entityType === 'SCHEDULE_E_PART_1' && (
                      <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between bg-slate-950/30 p-2 rounded">
                        <div className="flex items-center space-x-1.5 text-slate-400">
                          <Info className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-[10px] font-medium">Is Multi-Family Subject Property (FHA HUD 4000.1)?</span>
                        </div>
                        <button
                          onClick={() => handleToggleMultiFamilyFha(ent.id)}
                          className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition ${
                            ent.isMultiFamilySubjectToFha
                              ? 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-400'
                              : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200'
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
                            ? 'bg-slate-900 border-indigo-400 text-white'
                            : 'bg-slate-900/30 border-slate-800 hover:bg-slate-900/50 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-bold text-slate-400 font-mono uppercase bg-slate-950 px-2 py-0.5 rounded border border-slate-850">
                              {f.lineNum} ({f.schedule})
                            </span>
                            {f.isFlagged && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded font-bold uppercase">
                                Flagged
                              </span>
                            )}
                          </div>
                          <span className="text-xs block text-slate-200 mt-1.5 font-semibold">{f.label}</span>
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
                  <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-3 text-left">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Interactive Override & AI Learning Portal</span>
                      </span>
                      <span className="text-[9px] text-slate-500 font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850">
                        {currentField.lineNum}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block text-[9px] text-slate-400 uppercase font-black tracking-wider mb-1">OCR Extracted</label>
                        <div className="p-2 bg-slate-950 border border-slate-850 rounded font-mono text-slate-500 font-bold select-none cursor-not-allowed">
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
                          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-400 rounded p-2 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center gap-2 pt-1 border-t border-slate-850/50">
                      <p className="text-[9px] text-slate-400 leading-normal max-w-[240px]">
                        *Provides direct ledger offsets inside Form 1084 and Schedule E. Keeps unalterable PostgreSQL logs.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleSelfEmployedFlagToggle(entities[activeEntIdx].id, currentField.id)}
                        className={`px-3 py-1.5 rounded text-[10px] font-black tracking-wide flex items-center gap-1 transition ${
                          currentField.isFlagged 
                            ? 'bg-amber-500/20 border border-amber-500/30 text-amber-400' 
                            : 'bg-slate-800 hover:bg-slate-750 border border-slate-700 text-slate-300'
                        }`}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>{currentField.isFlagged ? '✓ Extraction Flagged' : 'Flag for AI Learning'}</span>
                      </button>
                    </div>

                    {currentField.isFlagged && (
                      <div className="bg-amber-500/10 border border-amber-500/20 p-2 rounded flex items-start space-x-2 text-[9px] text-slate-300 leading-normal">
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
                    <p className="text-[10px] text-slate-300 mt-1 font-sans leading-snug">
                      Subject property rental income has **declined catastrophically by 38.0%** year-over-year (Year 2: $25,000 → Year 1: $15,500). Under HUD 4000.1 rules, declines exceeding 20% trigger complete income disqualification.
                    </p>
                    <div className="mt-2 font-mono text-[10px] text-rose-300 flex space-x-2 bg-slate-950/50 p-2 rounded border border-rose-500/10">
                      <span>• Baseline: $0.00/mo (Locked)</span>
                      <span>• Deficit: -$791.67/mo loss</span>
                    </div>
                  </div>
                </div>
              )}

              
              {/* DYNAMIC DOCUMENT CHECKLIST BAR - Dynamic conditions loaded by v7 */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-left space-y-3">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase block">Dynamic Underwriting eFolder Conditions</span>
                
                {isFhaMultiFamilyActive ? (
                  <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-300">
                    <Lock className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black text-rose-400 uppercase tracking-widest block">CHECKLIST ADDED: FHA Multi-Family Review</span>
                      Provide a certified **RENTAL_LEASE_LEDGER_PROOF_OF_CURRENT_STABLE_OCCUPANCY** detailing active leases and capital reserve bank logs to justify potential exception override [cite: 122].
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-300">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl relative text-left">
            <button 
              onClick={() => setIsShareModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 text-sm font-bold bg-slate-800 px-2.5 py-1 rounded"
            >
              ✕
            </button>

            <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
              <Share2 className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="font-bold text-white text-base">Secure Sharing & Access Portal</h3>
                <p className="text-[10px] text-slate-400">Generate temporary shared links with strict role constraints [cite: 62]</p>
              </div>
            </div>

            <form onSubmit={handleGenerateShareLink} className="mt-4 space-y-4 text-xs">
              
              {/* Access Role restriction */}
              <div className="space-y-1">
                <label className="block text-slate-300 font-bold uppercase tracking-wider">Access Role Restriction</label>
                <select
                  value={shareRole}
                  onChange={(e) => {
                    const selected = e.target.value as 'SALES_LO' | 'PROCESSOR';
                    setShareRole(selected);
                    setIsReadOnlyForSales(selected === 'SALES_LO');
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-emerald-400"
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
                <div className="bg-emerald-500/10 border border-emerald-500/20 p-3.5 rounded-lg flex items-start space-x-2 text-[10px] leading-normal text-slate-300">
                  <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black text-emerald-400 uppercase tracking-widest block">Read-Only Enforced</span>
                    The server-side security layer will intercept all POST, PUT, and DELETE commands on this share token, rendering input fields disabled.
                  </div>
                </div>
              )}

              {/* Recipient Details */}
              <div className="space-y-1">
                <label className="block text-slate-300 font-bold uppercase tracking-wider">Recipient Email (Optional)</label>
                <input
                  type="email"
                  placeholder="sales-rep@freeflowmortgage.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-emerald-400"
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
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <label className="block text-slate-300 font-bold uppercase tracking-wider">Secure Access Link</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedShareLink}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 font-mono text-[10px] text-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(generatedShareLink)}
                      className="px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-bold border border-slate-700 text-[10px]"
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
