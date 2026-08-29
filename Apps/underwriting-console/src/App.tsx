import { useState } from 'react';
import { ShieldCheck, History, ToggleRight, FileSearch } from 'lucide-react';
import UnderwriterSplitViewDemoV7 from './components/UnderwriterSplitViewDemo-v7';
import AuditTrailTable from './components/AuditTrailTable';
import UsdaDistributionToggle from './components/UsdaDistributionToggle';
import ParserLab from './components/ParserLab';

type ConsoleView = 'split' | 'audit' | 'usda' | 'parser';

const NAV: { id: ConsoleView; label: string; hint: string; icon: typeof ShieldCheck }[] = [
  { id: 'split', label: 'Split View', hint: 'W-2 & Form 1084 workspace', icon: ShieldCheck },
  { id: 'audit', label: 'Audit Ledger', hint: 'OCR and override trail', icon: History },
  { id: 'usda', label: 'USDA Dual-Track', hint: 'Recurring distribution toggles', icon: ToggleRight },
  { id: 'parser', label: 'Parser Lab', hint: 'Live in-memory PDF parse', icon: FileSearch },
];

export default function App() {
  const [view, setView] = useState<ConsoleView>('split');

  return (
    <div className="min-h-full bg-slate-950 bg-radial-hero text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-400">FreeFlow</p>
            <h1 className="text-lg font-bold tracking-tight text-white">Underwriting Console</h1>
            <p className="text-xs text-slate-400">Local demo — split-screen QA, audit ledger, USDA eligibility</p>
          </div>
          <nav className="flex flex-wrap gap-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>
                    <span className="block text-xs font-bold">{item.label}</span>
                    <span className="block text-[10px] font-normal text-slate-500">{item.hint}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
        {view === 'split' && (
          <div className="h-[calc(100vh-8.5rem)] min-h-[780px]">
            <UnderwriterSplitViewDemoV7 />
          </div>
        )}
        {view === 'audit' && <AuditTrailTable />}
        {view === 'usda' && <UsdaDistributionToggle />}
        {view === 'parser' && <ParserLab />}
      </main>
    </div>
  );
}
