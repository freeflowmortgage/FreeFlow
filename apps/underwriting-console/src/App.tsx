import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, History, ToggleRight, FileSearch, Building, MessageSquare } from 'lucide-react';
import UnderwriterSplitViewDemo from './components/UnderwriterSplitViewDemo';
import AuditTrailTable from './components/AuditTrailTable';
import UsdaDistributionToggle from './components/UsdaDistributionToggle';
import ParserLab from './components/ParserLab';
import AppraisalReviewWorkspace from './components/AppraisalReviewWorkspace';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';
import LegalPage from './components/LegalPage';
import { noticeFor } from './legal/notices';
import { legalSlugFromHash } from './legalRoute';
import Conversational1003 from './components/Conversational1003';
import SplitDocPane from './components/SplitDocPane';
import AppraisalDocPane from './components/AppraisalDocPane';
import type { ConsoleView, LegalSlug, SourceMode, Surface } from './appTypes';
import type { LiveDocument } from './parseTypes';
import { postParsePdf } from '@console-document-loader';
import { findDuplicate } from './livePacket';
import { consoleRuntime } from './runtimeMode';

const NAV: { id: ConsoleView; label: string; icon: typeof ShieldCheck }[] = [
  { id: 'split', label: 'Income', icon: ShieldCheck },
  { id: 'intake', label: 'AI 1003', icon: MessageSquare },
  { id: 'appraisal', label: 'Appraisal', icon: Building },
  { id: 'parser', label: 'Parser', icon: FileSearch },
  { id: 'audit', label: 'Audit', icon: History },
  { id: 'usda', label: 'USDA', icon: ToggleRight },
];

function parseHash(): { surface: Surface; view: ConsoleView; demo: boolean; legal: LegalSlug } {
  const hash = window.location.hash.replace(/^#/, '');

  const legal = legalSlugFromHash(hash);
  if (legal) {
    return { surface: 'legal', view: 'split', demo: false, legal };
  }

  // Standalone demo routes: one service, no workspace chrome (#demo-income, #demo-1003, …)
  if (hash.startsWith('demo-')) {
    const service = hash.slice('demo-'.length);
    const view: ConsoleView =
      service === 'income' || service === 'split'
        ? 'split'
        : service === '1003' || service === 'intake'
          ? 'intake'
          : service === 'appraisal'
            ? 'appraisal'
            : service === 'parser'
              ? 'parser'
              : service === 'audit'
                ? 'audit'
                : service === 'usda'
                  ? 'usda'
                  : 'split';
    return { surface: 'workspace', view, demo: true, legal: 'legal' };
  }

  if (hash === 'appraisal') return { surface: 'workspace', view: 'appraisal', demo: false, legal: 'legal' };
  if (hash === '1003' || hash === 'intake') return { surface: 'workspace', view: 'intake', demo: false, legal: 'legal' };
  if (hash === 'parser') return { surface: 'workspace', view: 'parser', demo: false, legal: 'legal' };
  if (hash === 'audit') return { surface: 'workspace', view: 'audit', demo: false, legal: 'legal' };
  if (hash === 'usda') return { surface: 'workspace', view: 'usda', demo: false, legal: 'legal' };
  if (hash === 'workspace' || hash === 'console' || hash === 'split' || hash === 'income') {
    return { surface: 'workspace', view: 'split', demo: false, legal: 'legal' };
  }
  return { surface: 'landing', view: 'split', demo: false, legal: 'legal' };
}

const DEMO_LABELS: Record<ConsoleView, string> = {
  split: 'Income Intelligence',
  intake: 'AI 1003',
  appraisal: 'Appraisal Review',
  parser: 'Parser Lab',
  audit: 'Audit Trail',
  usda: 'USDA Engine',
};

function hashFor(view: ConsoleView): string {
  if (view === 'split') return 'workspace';
  if (view === 'intake') return '1003';
  return view;
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export default function App() {
  // Dedicated popped-out document pane windows (dual-monitor mode)
  const [docPaneKind] = useState<'income' | 'appraisal' | null>(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === 'split-doc') return 'income';
    if (hash === 'appraisal-doc') return 'appraisal';
    return null;
  });
  const initial = parseHash();
  const [surface, setSurface] = useState<Surface>(initial.surface);
  const [view, setView] = useState<ConsoleView>(initial.view);
  const [demoMode, setDemoMode] = useState<boolean>(initial.demo);
  const [legalSlug, setLegalSlug] = useState<LegalSlug>(initial.legal);
  const [session, setSession] = useState<LiveDocument | null>(null);
  const [documents, setDocuments] = useState<LiveDocument[]>([]);
  const documentsRef = useRef<LiveDocument[]>([]);
  const [source, setSource] = useState<SourceMode>(consoleRuntime.demoEnabled ? 'demo' : 'live');
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.title =
      surface === 'landing'
        ? 'FreeFlow Mortgage Solutions'
        : surface === 'legal'
          ? `${noticeFor(legalSlug).title} · FreeFlow`
          : 'FreeFlow';
  }, [surface, legalSlug]);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setSurface(next.surface);
      setView(next.view);
      setDemoMode(next.demo);
      setLegalSlug(next.legal);
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

  const parsePdfs = async (list: File[]) => {
    if (!consoleRuntime.demoEnabled) {
      setParseError('Document processing is available through the protected loan workflow.');
      return;
    }
    if (!list.length) return;
    setParseBusy(true);
    setParseError(null);
    const errors: string[] = [];
    try {
      for (const file of list) {
        try {
          const [sha256, payload] = await Promise.all([sha256File(file), postParsePdf(file)]);
          if (payload.parser_engine === 'native-pdf') {
            errors.push(
              `The document parser is not running, so ${file.name} was read without OCR, the Schedule E grid or IRS templates. Start the parser and drop it again.`,
            );
          }
          const duplicate = findDuplicate(documentsRef.current, { sha256, fileName: file.name, result: payload });
          if (duplicate) {
            errors.push(duplicate.reason);
            continue;
          }
          const next: LiveDocument = {
            id: crypto.randomUUID(),
            sha256,
            file,
            fileName: file.name,
            result: payload,
          };
          documentsRef.current = [...documentsRef.current, next];
          setDocuments([...documentsRef.current]);
          setSession(next);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Failed to parse ${file.name}`);
        }
      }
      if (documentsRef.current.length) {
        setSource('live');
        enterWorkspace('split');
      }
      if (errors.length) setParseError([...new Set(errors)].join(' · '));
    } finally {
      setParseBusy(false);
    }
  };

  const parsePdf = async (file: File) => {
    await parsePdfs([file]);
  };

  if (docPaneKind === 'income') {
    return <SplitDocPane />;
  }
  if (docPaneKind === 'appraisal') {
    return <AppraisalDocPane />;
  }

  if (surface === 'legal') {
    return <LegalPage slug={legalSlug} onHome={backToSite} />;
  }

  if (surface === 'landing') {
    return <B2BLanding onOpenService={enterWorkspace} />;
  }

  if (consoleRuntime.protected && !session) {
    return (
      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Select a loan from the protected loan workflow to load authoritative review data.
        </div>
      </main>
    );
  }

  // Standalone demo mode: one service, minimal chrome, no workspace navigation
  if (demoMode) {
    return (
      <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
        <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-2.5 md:px-6">
            <div className="flex items-center gap-3">
              <BrandLogo compact />
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">
                Demo · {DEMO_LABELS[view]}
              </span>
            </div>
            <a
              href={`#${hashFor(view)}`}
              className="text-xs font-bold text-slate-500 hover:text-emerald-700"
            >
              Open full workspace →
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
          {view === 'split' && (
            <div className="h-[calc(100vh-6rem)] min-h-[780px]">
              <UnderwriterSplitViewDemo
                key={source}
                liveSession={session}
                liveDocuments={documents}
                source={source}
                parseBusy={parseBusy}
                parseError={parseError}
                onParseFile={(file) => void parsePdf(file)}
                onParseFiles={(files) => void parsePdfs(files)}
                onUseDemo={consoleRuntime.demoEnabled ? () => setSource('demo') : undefined}
                onUseLive={() => documents.length && setSource('live')}
              />
            </div>
          )}
          {view === 'intake' && (
            <div className="h-[calc(100vh-6rem)] min-h-[780px]">
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

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 shadow-[0_1px_20px_rgba(15,23,42,0.04)] backdrop-blur-xl">
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
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-md shadow-emerald-600/25'
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
              key={source}
              liveSession={session}
              liveDocuments={documents}
              source={source}
              parseBusy={parseBusy}
              parseError={parseError}
              onParseFile={(file) => void parsePdf(file)}
              onParseFiles={(files) => void parsePdfs(files)}
              onUseDemo={consoleRuntime.demoEnabled ? () => setSource('demo') : undefined}
              onUseLive={() => documents.length && setSource('live')}
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
