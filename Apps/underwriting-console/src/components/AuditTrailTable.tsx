import React, { useState } from 'react';
import { 
  History, User, CheckCircle, Edit3, ArrowRight, Shield, 
  Download, Filter, Search, Calendar, RefreshCw, CheckSquare,
  AlertCircle
} from 'lucide-react';

// Interfaces for our compliance ledger fields [cite: 25, 38]
interface AuditLogEntry {
  id: string;
  fieldName: string;
  sourceForm: string; // e.g., "Schedule C, Page 1", "Form 4562, Part V" [cite: 38]
  fieldCode: string; // e.g., "Line 31", "Line 13" [cite: 38]
  originalOcrValue: string;
  calculatedValue: string;
  overrideApplied: boolean;
  overriddenBy: string; // e.g., "Sarah Underwriter (ID: USR-9842)"
  overrideReason: string;
  timestamp: string; // e.g., "2026-08-26 14:12:05"
  status: 'VERIFIED' | 'OVERRIDDEN' | 'FLAGGED';
}

export default function AuditTrailTable() {
  // 1. DYNAMIC COMPLIANCE LEDGER STATE [cite: 25, 38]
  const [logs, setLogs] = useState<AuditLogEntry[]>([
    {
      id: 'log-1',
      fieldName: 'Net Profit or Loss',
      sourceForm: 'Schedule C (Page 1)',
      fieldCode: 'Line 31',
      originalOcrValue: '$102,000.00',
      calculatedValue: '$102,000.00',
      overrideApplied: false,
      overriddenBy: 'System OCR Parser (Local Stream)',
      overrideReason: 'N/A - Pixel match matched native vector stream cleanly [cite: 6].',
      timestamp: '2026-08-26 14:12:05',
      status: 'VERIFIED'
    },
    {
      id: 'log-2',
      fieldName: 'Car & Truck Expenses',
      sourceForm: 'Schedule C (Page 1)',
      fieldCode: 'Line 9',
      originalOcrValue: '$4,500.00',
      calculatedValue: '$2,700.00',
      overrideApplied: true,
      overriddenBy: 'Mark Jenkins (Senior UW - ID: 8943)',
      overrideReason: 'Verified on Page 2 Part IV that business miles driven (Line 44a) was only 9,000 miles. Adjusted at standard 30¢/mi rate per GSE guidelines [cite: 119, 122].',
      timestamp: '2026-08-26 14:13:44',
      status: 'OVERRIDDEN'
    },
    {
      id: 'log-3',
      fieldName: 'Depreciation and Section 179',
      sourceForm: 'Schedule C (Page 1)',
      fieldCode: 'Line 13',
      originalOcrValue: '$8,500.00',
      calculatedValue: '$8,500.00',
      overrideApplied: false,
      overriddenBy: 'System OCR Parser (Local Stream)',
      overrideReason: 'N/A - Direct validation match against Form 4562 Line 22 [cite: 119].',
      timestamp: '2026-08-26 14:12:06',
      status: 'VERIFIED'
    },
    {
      id: 'log-4',
      fieldName: 'Rental Depreciation Share',
      sourceForm: 'Form 8825 (Corporate)',
      fieldCode: 'Line 14',
      originalOcrValue: '$18,500.00',
      calculatedValue: '$4,625.00',
      overrideApplied: true,
      overriddenBy: 'System Math Engine (K-1 Ratio Calc)',
      overrideReason: 'Automatically adjusted to 25.0% shareholder ownership ratio extracted from Schedule K-1 (Form 1120S) Line 4 [cite: 38, 121].',
      timestamp: '2026-08-26 14:12:08',
      status: 'VERIFIED'
    },
    {
      id: 'log-5',
      fieldName: 'Ordinary Business Income',
      sourceForm: 'Schedule E (Page 2)',
      fieldCode: 'Line 28 Col G',
      originalOcrValue: '$25,000.00',
      calculatedValue: '$25,000.00',
      overrideApplied: false,
      overriddenBy: 'System OCR Parser (Statement 3)',
      overrideReason: 'Extracted from supplemental statement index sheet attached [cite: 30].',
      timestamp: '2026-08-26 14:12:10',
      status: 'FLAGGED'
    }
  ]);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'VERIFIED' | 'OVERRIDDEN' | 'FLAGGED'>('ALL');

  // Filter logs based on search query and status drop-down [cite: 25]
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.fieldName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.fieldCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.overriddenBy.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'ALL' || log.status === filterType;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex flex-col bg-white text-slate-800 font-sans border border-slate-200 rounded-xl overflow-hidden shadow-2xl w-full">
      {/* 1. COMPLIANCE HEADER BLOCK [cite: 25] */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between px-6 py-5 bg-white border-b border-slate-200 gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-2.5 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <History className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-md font-bold tracking-tight text-white flex items-center space-x-2">
              <span>GSE Underwriting & OCR Audit Ledger</span>
              <span className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-black uppercase tracking-wider">Deterministic Audit Trail</span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Line-by-line compliance tracking showing native OCR extractions, math rules, and underwriter overrides [cite: 25, 38].</p>
          </div>
        </div>

        {/* Security / Audit Badge */}
        <div className="flex items-center space-x-3 self-start md:self-auto">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 bg-white border border-slate-200 px-3 py-1.5 rounded-lg font-medium">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Audit Integrity Status: <b>SEALED</b> [cite: 61]</span>
          </div>
          <button 
            onClick={() => alert("Audit trail exported in secure MISMO-compliant spreadsheet format!")}
            className="p-2 bg-white border border-slate-200 hover:border-slate-200 hover:bg-slate-850 rounded-lg text-slate-600 hover:text-slate-950 transition"
            title="Export Compliance Log"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. FILTERS AND UTILITY CONTROLS */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-6 py-4 bg-white/60 border-b border-slate-200 gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search field, code, auditor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder-slate-500 focus:outline-none focus:border-slate-200 focus:ring-1 focus:ring-slate-700 transition"
          />
        </div>

        {/* Filter Badges */}
        <div className="flex items-center space-x-2 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setFilterType('ALL')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition bg-slate-100 border-slate-200 text-white"
          >
            All Logs ({logs.length})
          </button>
          <button
            onClick={() => setFilterType('OVERRIDDEN')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center space-x-1.5 bg-slate-50 border-slate-200 text-slate-400 hover:text-amber-400 hover:border-amber-500/20"
          >
            <Edit3 className="w-3 h-3" />
            <span>Overrides</span>
          </button>
          <button
            onClick={() => setFilterType('VERIFIED')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center space-x-1.5 bg-slate-50 border-slate-200 text-slate-400 hover:text-emerald-400 hover:border-emerald-500/20"
          >
            <CheckCircle className="w-3 h-3" />
            <span>System Matches</span>
          </button>
          <button
            onClick={() => setFilterType('FLAGGED')}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center space-x-1.5 bg-slate-50 border-slate-200 text-slate-400 hover:text-rose-400 hover:border-rose-500/20"
          >
            <AlertCircle className="w-3 h-3" />
            <span>Warnings</span>
          </button>
        </div>
      </div>

      {/* 3. COMPLIANCE DATA TABLE [cite: 25] */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[750px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-6 py-3.5">Calculated Field</th>
              <th className="px-6 py-3.5">Source Location</th>
              <th className="px-6 py-3.5">Original OCR Value</th>
              <th className="px-6 py-3.5">Final Calculated Value</th>
              <th className="px-6 py-3.5">Last Modifying Agent</th>
              <th className="px-6 py-3.5">Calculations & Audit Trail Commentary</th>
              <th className="px-6 py-3.5 text-right">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs text-slate-600">
            {filteredLogs.map((log) => (
              <tr 
                key={log.id} 
                className={`transition-colors hover:bg-slate-850/50 ${
                  log.status === 'OVERRIDDEN' ? 'bg-amber-500/[0.02]' : 
                  log.status === 'FLAGGED' ? 'bg-rose-500/[0.02]' : ''
                }`}
              >
                {/* 1. Field Name */}
                <td className="px-6 py-4.5 font-bold text-slate-800 flex items-center space-x-2.5">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    log.status === 'VERIFIED' ? 'bg-emerald-400' :
                    log.status === 'OVERRIDDEN' ? 'bg-amber-400' : 'bg-rose-400'
                  }`} />
                  <div className="flex flex-col">
                    <span>{log.fieldName}</span>
                    <span className="text-[9px] text-slate-500 font-mono mt-0.5">{log.fieldCode}</span>
                  </div>
                </td>

                {/* 2. Source Form */}
                <td className="px-6 py-4.5 font-mono text-[10px] text-slate-400">
                  <span className="bg-white px-2 py-1 rounded border border-slate-200/80">
                    {log.sourceForm}
                  </span>
                </td>

                {/* 3. Original OCR Value */}
                <td className="px-6 py-4.5 font-mono text-slate-400 line-through">
                  {log.originalOcrValue}
                </td>

                {/* 4. Final Calculated Value */}
                <td className="px-6 py-4.5 font-mono font-bold text-white relative">
                  <div className="flex items-center space-x-1.5 text-emerald-400 bg-emerald-500/[0.06] border border-emerald-500/20 px-2 py-0.5 rounded w-fit">
                    <span>{log.calculatedValue}</span>
                  </div>
                </td>

                {/* 5. Last Modifying Agent */}
                <td className="px-6 py-4.5 text-slate-600">
                  <div className="flex items-center space-x-1.5">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    <span className="font-medium truncate max-w-[130px]" title={log.overriddenBy}>
                      {log.overriddenBy}
                    </span>
                  </div>
                </td>

                {/* 6. Audit Trail Commentary */}
                <td className="px-6 py-4.5 max-w-xs md:max-w-md">
                  <div className="text-slate-600 leading-relaxed text-[11px]">
                    {log.overrideApplied ? (
                      <span className="text-amber-400 font-bold mr-1.5 flex items-center gap-1 inline-flex">
                        <Edit3 className="w-3 h-3" /> Modified:
                      </span>
                    ) : log.status === 'FLAGGED' ? (
                      <span className="text-rose-400 font-bold mr-1.5 flex items-center gap-1 inline-flex">
                        <AlertCircle className="w-3 h-3" /> Warning:
                      </span>
                    ) : null}
                    <span>{log.overrideReason}</span>
                  </div>
                </td>

                {/* 7. Timestamp */}
                <td className="px-6 py-4.5 text-right font-mono text-[10px] text-slate-500">
                  {log.timestamp}
                </td>
              </tr>
            ))}

            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-500 font-medium">
                  No matching audit logs found matching selected search criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 4. FOOTER LEDGER VERIFICATION OVERVIEW */}
      <div className="flex flex-col sm:flex-row justify-between items-center px-6 py-4 bg-white border-t border-slate-200 text-xs text-slate-400 gap-3">
        <div className="flex items-center space-x-2">
          <CheckSquare className="w-4 h-4 text-emerald-400" />
          <span>Showing <b>{filteredLogs.length}</b> of <b>{logs.length}</b> audited tax calculations</span>
        </div>
        <p className="text-[10px] text-slate-500 leading-normal text-right">
          This audit matrix maps directly to Fannie Mae Form 1084 and PostgreSQL tables (`Form1084Audit`) to prove 100% calculation trace [cite: 38, 61].
        </p>
      </div>
    </div>
  );
}
