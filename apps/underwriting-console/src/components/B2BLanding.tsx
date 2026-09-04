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
  testId: string;
  icon: typeof Calculator;
}[] = [
  {
    id: 'income',
    kicker: 'Credit and income',
    title: 'Income intelligence',
    line: 'W-2, paystubs, Form 1040, and Fannie Mae 1084 — mapped to the boxes underwriters actually use.',
    points: ['W-2 boxes 1–6 with withholding math', 'Schedule C / E add-backs', 'Source PDF coordinates on every figure'],
    view: 'split',
    testId: 'enter-workspace',
    icon: Calculator,
  },
  {
    id: '1003',
    kicker: 'Origination',
    title: 'AI 1003',
    line: 'Voice URLA with FreeFlow, our house-robot intake specialist. Brokers capture a MISMO-ready 1003 in the borrower’s language.',
    points: ['English, Spanish, Vietnamese, Chinese, Korean', 'Live FNMA 1003 / Freddie 65 panel', 'Export a session for Encompass'],
    view: 'intake',
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
    testId: 'service-appraisal',
    icon: Building2,
  },
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
}: {
  onOpenService: (view: ConsoleView) => void;
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
          <button
            type="button"
            onClick={() => onOpenService('split')}
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Open workspace
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(5,150,105,0.12),_transparent_42%),radial-gradient(circle_at_left,_rgba(15,23,42,0.06),_transparent_38%)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">FreeFlow Mortgage Solutions</p>
            <h1 className="mt-4 max-w-xl text-4xl font-extrabold tracking-tight text-slate-950 md:text-6xl md:leading-[1.05]">
              Underwriting software built for the people who sign the loan.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Banks, brokers, and credit executives use FreeFlow to read the source file — W-2s, 1040s, and appraisals —
              map agency income fields, and deliver a 1003 that is ready for Encompass.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onOpenService('split')}
                className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                Review income files
              </button>
              <button
                type="button"
                onClick={() => onOpenService('intake')}
                className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:border-emerald-400"
              >
                Meet FreeFlow on the 1003
              </button>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-4">
              <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-slate-200">
                <FreeFlowMascot size={112} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700">AI specialist</p>
                <p className="text-xl font-extrabold tracking-tight text-slate-950">FreeFlow</p>
                <p className="mt-1 text-sm text-slate-500">House-robot intake mascot for the AI 1003. Professional, on-brand, and built for broker conversations.</p>
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
          <span>Schedule C / E cash flow</span>
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
              <li key={product.id}>
                <button
                  type="button"
                  data-testid={product.testId}
                  onClick={() => onOpenService(product.view)}
                  className="group flex h-full w-full flex-col rounded-3xl border border-slate-200 bg-white p-7 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-[0_20px_50px_rgba(5,150,105,0.12)]"
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
              FreeFlow is a house built as a cartoon robot — the branded intake voice for brokers who cannot afford a
              clumsy chatbot. It walks the borrower through occupancy, income, and liabilities while the live 1003
              fills on the right.
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
