import { ArrowLeft, FileText, ShieldCheck, Scale } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { COMPANY, LAST_UPDATED, NOTICES, noticeFor, type Block, type Notice } from '../legal/notices';
import type { LegalSlug } from '../appTypes';

const ICONS: Record<LegalSlug, typeof Scale> = {
  legal: Scale,
  terms: FileText,
  privacy: ShieldCheck,
};

/** Renders a table cell as a link when the notice points at another hash route. */
function Cell({ text }: { text: string }) {
  if (text.startsWith('#')) {
    return (
      <a href={text} className="font-semibold text-emerald-700 underline decoration-emerald-300 hover:text-emerald-800">
        {text}
      </a>
    );
  }
  return <>{text}</>;
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === 'p') {
    return <p className="text-sm leading-relaxed text-slate-700">{block.text}</p>;
  }
  if (block.kind === 'ul') {
    return (
      <ul className="flex flex-col gap-2 pl-5 text-sm leading-relaxed text-slate-700">
        {block.items.map((item) => (
          <li key={item} className="list-disc">
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'callout') {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-xs font-black uppercase tracking-wider text-emerald-800">{block.title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-emerald-950">{block.text}</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {block.head.map((heading) => (
              <th key={heading} className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-500">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join('|')} className="border-t border-slate-200 align-top">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={`px-3 py-2.5 leading-relaxed ${index === 0 ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                >
                  <Cell text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Contents({ notice }: { notice: Notice }) {
  return (
    <nav aria-label="On this page" className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">On this page</p>
      <ol className="mt-3 flex flex-col gap-2">
        {notice.sections.map((section) => (
          <li key={section.id}>
            <a href={`#${notice.slug}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(section.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }} className="text-left text-xs font-semibold text-slate-600 hover:text-emerald-700">
              {section.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function LegalPage({ slug, onHome }: { slug: LegalSlug; onHome: () => void }) {
  const notice = noticeFor(slug);
  const Icon = ICONS[slug];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <BrandLogo compact onClick={onHome} />
          <nav className="flex items-center gap-1">
            {NOTICES.map((item) => (
              <a
                key={item.slug}
                href={`#${item.slug}`}
                aria-current={item.slug === slug ? 'page' : undefined}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  item.slug === slug ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {item.navLabel}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <button
          type="button"
          onClick={onHome}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to site
        </button>

        <div className="mt-6 flex items-start gap-4">
          <span className="rounded-xl bg-emerald-50 p-3 text-emerald-700 ring-1 ring-emerald-200">
            <Icon className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">{notice.kicker}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900">{notice.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600">{notice.summary}</p>
            <p className="mt-3 text-xs font-semibold text-slate-500">Last updated {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[16rem_1fr] lg:items-start">
          <div className="lg:sticky lg:top-6">
            <Contents notice={notice} />
          </div>

          <article className="flex flex-col gap-10">
            {notice.sections.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-6">
                <h2 className="text-lg font-extrabold tracking-tight text-slate-900">{section.heading}</h2>
                <div className="mt-4 flex flex-col gap-4">
                  {section.blocks.map((block, index) => (
                    <BlockView key={index} block={block} />
                  ))}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-bold text-white">{COMPANY.legalName}</p>
          <nav className="flex flex-wrap items-center gap-4 text-xs">
            {NOTICES.map((item) => (
              <a key={item.slug} href={`#${item.slug}`} className="font-semibold text-slate-400 hover:text-white">
                {item.navLabel}
              </a>
            ))}
            <a href={`mailto:${COMPANY.legalEmail}`} className="font-semibold text-slate-400 hover:text-white">
              {COMPANY.legalEmail}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
