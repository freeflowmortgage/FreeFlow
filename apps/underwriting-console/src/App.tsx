import { useEffect, useState } from 'react';
import { ShieldCheck, History, ToggleRight, FileSearch, Building, MessageSquare } from 'lucide-react';
import UnderwriterSplitViewDemo from './components/UnderwriterSplitViewDemo';
import AuditTrailTable from './components/AuditTrailTable';
import UsdaDistributionToggle from './components/UsdaDistributionToggle';
import ParserLab from './components/ParserLab';
import AppraisalReviewWorkspace from './components/AppraisalReviewWorkspace';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';
import Conversational1003 from './components/Conversational1003';
import type { ConsoleView, SourceMode, Surface } from './appTypes';
import type { LiveParseSession, ParseResponse } from './parseTypes';

const NAV: { id: ConsoleView; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'split', label: 'Income', icon: ShieldCheck },
  { id: 'intake', label: 'AI 1003', icon: MessageSquare },
  { id: 'appraisal', label: 'Appraisal', icon: Building },
  { id: 'parser', label: 'Parser', icon: FileSearch },
  { id: 'audit', label: 'Audit', icon: History },
  { id: 'usda', label: 'USDA', icon: ToggleRight },
];

function parseHash(): { surface: Surface; view: ConsoleView } {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === 'appraisal') return { surface: 'workspace', view: 'appraisal' };
  if (hash === '1003' || hash === 'intake') return { surface: 'workspace', view: 'intake' };
  if (hash === 'parser') return { surface: 'workspace', view: 'parser' };
  if (hash === 'audit') return { surface: 'workspace', view: 'audit' };
  if (hash === 'usda') return { surface: 'workspace', view: 'usda' };
  if (hash === 'workspace' || hash === 'console' || hash === 'split' || hash === 'income') {
    return { surface: 'workspace', view: 'split' };
  }
  return { surface: 'landing', view: 'split' };
}

function hashFor(view: ConsoleView): string {
  if (view === 'split') return 'workspace';
  if (view === 'intake') return '1003';
  return view;
}

export default function App() {
  const initial = parseHash();
  const [surface, setSurface] = useState<Surface>(initial.surface);
  const [view, setView] = useState<ConsoleView>(initial.view);
  const [session, setSession] = useState<LiveParseSession | null>(null);
  const [source, setSource] = useState<SourceMode>('demo');
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.title = surface === 'landing' ? 'FreeFlow Mortgage Solutions' : 'FreeFlow';
  }, [surface]);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setSurface(next.surface);
      setView(next.view);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const enterWorkspace = (nextView: ConsoleView = 'split') => {
    setView(nextView);
    setSurface('workspace');
    window.location.hash = hashFor(nextView);
  };

  const backToSite = () => {
    setSurface('landing');
    window.location.hash = '';
  };

  const parsePdf = async (file: File) => {
    setParseBusy(true);
    setParseError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/parse', { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) {
        const detail = payload.detail;
        const message = typeof detail === 'string' ? detail : JSON.stringify(detail || payload);
        throw new Error(message || `Parser returned ${response.status}`);
      }
      setSession({ file, fileName: file.name, result: payload as ParseResponse });
      setSource('live');
      enterWorkspace('split');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setParseBusy(false);
    }
  };

  if (surface === 'landing') {
    return <B2BLanding onOpenService={enterWorkspace} />;
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <BrandLogo compact onClick={backToSite} />
          <nav className="flex flex-wrap gap-1.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => enterWorkspace(item.id)}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
        {view === 'split' && (
          <div className="h-[calc(100vh-7rem)] min-h-[780px]">
            <UnderwriterSplitViewDemo
              liveSession={session}
              source={source}
              parseBusy={parseBusy}
              parseError={parseError}
              onParseFile={(file) => void parsePdf(file)}
              onUseDemo={() => setSource('demo')}
              onUseLive={() => session && setSource('live')}
            />
          </div>
        )}
        {view === 'intake' && (
          <div className="h-[calc(100vh-7rem)] min-h-[780px]">
            <Conversational1003 />
          </div>
        )}
        {view === 'audit' && <AuditTrailTable />}
        {view === 'usda' && <UsdaDistributionToggle />}
        {view === 'parser' && <ParserLab />}
        {view === 'appraisal' && <AppraisalReviewWorkspace />}
      </main>
    </div>
  );
}
