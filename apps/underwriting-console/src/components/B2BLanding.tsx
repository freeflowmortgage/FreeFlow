import {
  ArrowUpRight,
  Building2,
  Calculator,
  CheckCircle2,
  Landmark,
  Lock,
  MessageSquare,
  ScanSearch,
  ShieldCheck,
  Users,
} from 'lucide-react';
import BrandLogo from './BrandLogo';
import FreeFlowMascot from './FreeFlowMascot';
import type { ConsoleView } from '../appTypes';

const PRODUCTS: {
  id: string;
  kicker: string;
  title: string;
  line: string;
  points: string[];
  view: ConsoleView;
  demoHash: string;
  testId: string;
  icon: typeof Calculator;
}[] = [
  {
    id: 'income',
    kicker: 'Credit and income',
    title: 'Income intelligence',
    line: 'W-2, paystubs, Form 1040, Schedule E rentals, and Fannie Mae 1084 — mapped to the boxes underwriters actually use.',
    points: ['W-2 boxes 1–6 with withholding math', 'Schedule C / E / K-1 add-backs and PITIA netting', 'Dual-monitor split view for UW + QA desks'],
    view: 'split',
    demoHash: 'demo-income',
    testId: 'enter-workspace',
    icon: Calculator,
  },
  {
    id: '1003',
    kicker: 'Origination',
    title: 'AI 1003',
    line: 'Voice URLA with FreeFlow, our friendly cottage intake specialist. Brokers capture a MISMO-ready 1003 in the borrower’s language — speech-first on mobile.',
    points: ['English, Spanish, Vietnamese, Chinese, Korean', 'Live FNMA 1003 / Freddie 65 panel', 'Export a session for Encompass'],
    view: 'intake',
    demoHash: 'demo-1003',
    testId: 'service-1003',
    icon: MessageSquare,
  },
  {
    id: 'appraisal',
    kicker: 'Collateral',
    title: 'Appraisal review',
    line: 'URAR 1004 and 1004MC QA for credit executives who still sign the file. Tap a finding, land on the form.',
    points: ['Subject, comps, and condition checkpoints', 'Page-accurate highlight boxes', 'FHA / VA case alignment'],
    view: 'appraisal',
    demoHash: 'demo-appraisal',
    testId: 'service-appraisal',
    icon: Building2,
  },
];

const OUTCOMES: { metric: string; label: string }[] = [
  { metric: 'Minutes, not days', label: 'from PDF upload to defensible 1084 cash flow' },
  { metric: 'One click', label: 'from any figure back to the source box on the page' },
  { metric: 'Zero retention', label: 'borrower documents never persist on FreeFlow servers' },
  { metric: '5 languages', label: 'AI 1003 intake with live MISMO-ready output' },
];

const AUDIENCES = [
  {
    icon: Landmark,
    title: 'Banks and credit unions',
    copy: 'Standardize 1084 cash flow, W-2 fraud checks, and appraisal exceptions across desks — without sending tax PDFs to a third-party cloud.',
  },
  {
    icon: Users,
    title: 'Mortgage executives',
    copy: 'See cycle time in the file, not a slide. Mapped data points, audit history, and Encompass-ready output your secondary team can defend.',
  },
  {
    icon: ScanSearch,
    title: 'Brokers and originators',
    copy: 'Open a 1003 with FreeFlow, keep the borrower on the phone, and hand credit a complete URLA instead of a voicemail full of missing fields.',
  },
];

export default function B2BLanding({
  onOpenService,
  onOpenIncomeDemo,
  protectedMode = false,
}: {
  onOpenService: (view: ConsoleView) => void;
  onOpenIncomeDemo?: () => void;
  protectedMode?: boolean;
}) {
  return (
    <div data-testid="b2b-landing" className="min-h-full bg-[#f4f7fb] text-slate-900" style={{ fontFamily: 'Manrope, Roboto, system-ui, sans-serif' }}>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <BrandLogo />
          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex">
            <a href="#products" className="hover:text-slate-950">
              Products
            </a>
            <a href="#platform" className="hover:text-slate-950">
              Platform
            </a>
            <a href="#ai-1003" className="hover:text-slate-950">
              AI 1003
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href="mailto:sales@freeflowmortgage.com?subject=FreeFlow%20walkthrough"
              className="hidden rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 md:inline-block"
            >
              Book a walkthrough
            </a>
            {protectedMode && onOpenIncomeDemo ? (
              <button
                type="button"
                data-testid="open-income-demo"
                onClick={onOpenIncomeDemo}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-emerald-400 hover:text-emerald-700"
              >
                View demo
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenService('split')}
              className="rounded-full bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 hover:from-emerald-700 hover:to-emerald-600"
            >
              Login
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(5,150,105,0.12),_transparent_42%),radial-gradient(circle_at_left,_rgba(15,23,42,0.06),_transparent_38%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">FreeFlow Mortgage Solutions</p>
            <h1 className="mt-4 max-w-xl text-4xl font-extrabold tracking-tight text-slate-950 md:text-6xl md:leading-[1.05]">
              Close more loans.
              <span className="block bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                Defend every number.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              FreeFlow turns tax returns, paystubs, and appraisals into agency-ready income and collateral decisions —
              with the source box one click away and zero borrower data retained. Built for banks, brokers, and the
              credit executives who sign the file.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="mailto:sales@freeflowmortgage.com?subject=FreeFlow%20walkthrough"
                className="rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 transition hover:shadow-emerald-600/50"
              >
                Book a 20-minute walkthrough
              </a>
              <button
                type="button"
                onClick={() => onOpenService('split')}
                className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 hover:border-emerald-400 hover:text-emerald-700"
              >
                {protectedMode ? 'Login to workspace' : 'Try the live demo'}
              </button>
              {protectedMode && onOpenIncomeDemo ? (
                <button
                  type="button"
                  onClick={onOpenIncomeDemo}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-6 py-3 text-sm font-bold text-indigo-800 hover:border-indigo-400"
                >
                  View Income demo ↗
                </button>
              ) : null}
            </div>
            <p className="mt-4 text-xs font-semibold text-slate-400">
              {protectedMode
                ? 'Authenticated tenant and loan context required'
                : 'No sandbox sign-up · every demo below runs in your browser right now'}
            </p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-4">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
                <FreeFlowMascot size={112} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700">AI specialist</p>
                <p className="text-xl font-extrabold tracking-tight text-slate-950">FreeFlow</p>
                <p className="mt-1 text-sm text-slate-500">Our friendly cottage guide for the AI 1003 — approachable for borrowers, precise for brokers.</p>
              </div>
            </div>
            <dl className="mt-8 grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-2xl bg-slate-50 p-4">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">LOS</dt>
                <dd className="mt-1 font-bold text-slate-900">Encompass-ready</dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Forms</dt>
                <dd className="mt-1 font-bold text-slate-900">1003 · 1084 · 1004</dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Data handling</dt>
                <dd className="mt-1 font-bold text-slate-900">In-memory ZDR</dd>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">QA</dt>
                <dd className="mt-1 font-bold text-slate-900">Mapped boxes only</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-3 px-6 py-4 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          <span>FNMA 1003 / Freddie 65</span>
          <span>Fannie Mae Form 1084</span>
          <span>URAR 1004 / 1004MC</span>
          <span>W-2 withholding audit</span>
          <span>Schedule C / E / K-1 cash flow</span>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pt-16">
        <div className="grid gap-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-emerald-50/60 p-8 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          {OUTCOMES.map((item) => (
            <div key={item.metric}>
              <p className="text-2xl font-extrabold tracking-tight text-emerald-700">{item.metric}</p>
              <p className="mt-1 text-sm leading-snug text-slate-600">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="products" className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Product suite</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">Three desks. One credit file.</h2>
          <p className="mt-3 text-slate-600">
            FreeFlow is not a generic OCR inbox. Each product maps the data points your policy already names — then
            shows the page, the box, and the math.
          </p>
        </div>
        <ul className="mt-12 grid gap-5 lg:grid-cols-3">
          {PRODUCTS.map((product) => {
            const Icon = product.icon;
            return (
              <li key={product.id} className="flex">
                <div className="group flex h-full w-full flex-col rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-[0_20px_50px_rgba(5,150,105,0.12)]">
                  <button
                    type="button"
                    data-testid={product.testId}
                    onClick={() => onOpenService(product.view)}
                    className="flex flex-1 flex-col text-left"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="mt-6 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">{product.kicker}</span>
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xl font-extrabold tracking-tight text-slate-950">{product.title}</span>
                      <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-emerald-600" />
                    </span>
                    <span className="mt-2 text-sm leading-relaxed text-slate-600">{product.line}</span>
                    <ul className="mt-5 space-y-2">
                      {product.points.map((point) => (
                        <li key={point} className="flex items-start gap-2 text-sm text-slate-700">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </button>
                  <div className="mt-6 flex items-center gap-3 border-t border-slate-100 pt-4">
                    <button
                      type="button"
                      onClick={() => onOpenService(product.view)}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                    >
                      {protectedMode ? 'Login to workspace' : 'Open in workspace'}
                    </button>
                    {protectedMode && product.id === 'income' && onOpenIncomeDemo ? (
                      <button
                        type="button"
                        data-testid="enter-income-demo"
                        onClick={onOpenIncomeDemo}
                        className="text-xs font-bold text-indigo-700 hover:underline"
                      >
                        View demo ↗
                      </button>
                    ) : null}
                    {!protectedMode ? <a
                      href={`#${product.demoHash}`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`${product.testId}-solo-demo`}
                      className="text-xs font-bold text-emerald-700 hover:underline"
                    >
                      Launch solo demo ↗
                    </a> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="ai-1003" className="bg-slate-950 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">AI 1003</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight md:text-4xl">Meet FreeFlow, your URLA specialist.</h2>
            <p className="mt-4 text-slate-300 leading-relaxed">
              FreeFlow is a cheerful little cottage with a voice — the branded intake guide for brokers who cannot
              afford a clumsy chatbot. It walks the borrower through occupancy, income, and liabilities while the live
              1003 fills on the right. On mobile it opens speech-first, so borrowers just talk.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-200">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                Conversational 1003, not a 30-page PDF dump
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                Designed for wholesale, correspondent, and retail origination desks
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                Session export for MISMO / Encompass handoff
              </li>
            </ul>
            <button
              type="button"
              onClick={() => onOpenService('intake')}
              className="mt-8 rounded-full bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              Start an AI 1003
            </button>
          </div>
          <div className="flex justify-center">
            <div className="rounded-[2rem] bg-white/5 p-6 ring-1 ring-white/10">
              <FreeFlowMascot size={340} className="max-h-[340px] w-auto" />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Who it is for</p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">Sold to the desk, not the demo day.</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-emerald-400">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-extrabold text-slate-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="platform" className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">How it works</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">From the PDF to the field ID.</h2>
            <ol className="mt-8 space-y-6">
              {[
                ['Ingest the source file', 'W-2, 1040, Schedule C/E, or URAR. Native text first; OCR only when the page is a scan.'],
                ['Map agency data points', 'The QA panel lights Box 1, Line 31, Line 13 — not every OCR token on the page.'],
                ['Override, audit, sync', 'Underwriters correct in place. The figure, the box, and the Encompass field stay tied together.'],
              ].map(([title, copy], index) => (
                <li key={title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-extrabold text-slate-950">{title}</p>
                    <p className="mt-1 text-sm text-slate-600">{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h3 className="text-lg font-extrabold text-slate-950">Built for regulated credit shops</h3>
            </div>
            <ul className="mt-6 space-y-4 text-sm text-slate-600">
              <li className="flex gap-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                Zero data retention on parse: bytes in RAM, coordinates and labels out. No sandwich PDF written to disk.
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                W-2 statutory checks (6.2% / 1.45%) and 1084 add-backs sit next to the source box.
              </li>
              <li className="flex gap-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                Appraisal findings jump the underwriter to the URAR page instead of a comments dump.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-8 py-14 text-center text-white shadow-[0_30px_80px_rgba(15,23,42,0.35)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.18),_transparent_55%)]" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">
              Put FreeFlow in front of your credit desk this week.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">
              A 20-minute walkthrough covers income, AI 1003, and appraisal review on your own scenarios — no data
              leaves the room.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="mailto:sales@freeflowmortgage.com?subject=FreeFlow%20walkthrough"
                className="rounded-full bg-emerald-500 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                Book a walkthrough
              </a>
              <button
                type="button"
                onClick={() => onOpenService('split')}
                className="rounded-full border border-white/25 bg-white/5 px-6 py-3 text-sm font-bold text-white hover:bg-white/10"
              >
                Explore the workspace
              </button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-lg font-extrabold text-white">FreeFlow Mortgage Solutions</p>
            <p className="mt-2 max-w-md text-sm text-slate-400">
              Income, origination, and collateral software for banks, mortgage executives, and brokers.
            </p>
          </div>
          <p className="text-xs text-slate-500">freeflowmortgage.com · freeflowmortgagesolutions.com</p>
        </div>
      </footer>
    </div>
  );
}
