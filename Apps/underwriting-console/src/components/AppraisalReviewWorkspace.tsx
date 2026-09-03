import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Eye, ShieldAlert } from 'lucide-react';
import { PdfCoordinateCanvas } from './PdfCoordinateCanvas';
import { usePdfViewer, type SpatialCoordinates } from '../hooks/usePdfViewer';

type Severity = 'info' | 'warning' | 'error';
type Program = 'CONV' | 'FHA' | 'VA';
type ConditionKind = 'REPAIR' | 'INSPECTION' | 'ADMIN' | 'REDFLAG';

type Finding = {
  code: string;
  label: string;
  extracted: string;
  why: string;
  severity: Severity;
  pageIndex: number;
  box: SpatialCoordinates['box'];
  programs: Program[];
};

type NovItem = {
  id: string;
  label: string;
  detail: string;
  status: 'fail' | 'pass' | 'na';
  authority: string;
  inspectCode?: string;
};

type Condition = {
  id: string;
  kind: ConditionKind;
  text: string;
  authority: string;
  programs: Program[];
};

const URAR_PDF = '/fixtures/urar-1004.pdf';
const BLANK_URAR_PDF = '/fixtures/urar-1004.pdf?blank=true';

const SUBJECT = {
  loanId: 'LN-2026-9043',
  borrower: 'Sarah K. Vance',
  address: '742 Whispering Pines Dr, Austin TX 78745',
  value: 425000,
  gla: 1850,
  yearBuilt: 1974,
  caseNumber: '451-904322-B',
  appraiser: 'Robert J. Miller, TX A-1084',
};

const COMPS = [
  {
    name: 'Subject',
    address: '742 Whispering Pines Dr',
    gla: 1850,
    price: 425000,
    prox: '—',
    net: '—',
    gross: '—',
    lines: [] as string[],
    flag: false,
  },
  {
    name: 'Comp 1',
    address: '142 Maplewood Ave',
    gla: 1900,
    price: 425000,
    prox: '0.45 mi',
    net: '+$15,000',
    gross: '5.9%',
    lines: ['GLA +$5,000', 'Bath +$10,000', 'Garage +$10,000'],
    flag: false,
  },
  {
    name: 'Comp 2',
    address: '98 Oak Ridge Rd, West Lake Hills',
    gla: 1780,
    price: 410000,
    prox: '1.20 mi',
    net: '−$8,000',
    gross: '11.7%',
    lines: ['Location −$18,000', 'GLA −$30,000'],
    flag: true,
  },
  {
    name: 'Comp 3',
    address: '33 Clover Lane',
    gla: 1840,
    price: 435000,
    prox: '0.80 mi',
    net: '+$2,000',
    gross: '2.8%',
    lines: ['Age/condition +$2,000', 'Deck +$10,000'],
    flag: false,
  },
];

const FINDINGS: Finding[] = [
  {
    code: 'URAR_SUBJECT_CONTRACT',
    label: 'Subject / contract',
    extracted: '742 Whispering Pines · Purchase $425,000 · seller not owner of record',
    why: 'Page 1 contract section. Chain of title is incomplete for an FHA purchase.',
    severity: 'warning',
    pageIndex: 0,
    box: [12, 18, 76, 5],
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    code: 'URAR_NEIGHBORHOOD_TRENDS',
    label: 'Neighborhood vs 1004MC',
    extracted: 'URAR = STABLE · 1004MC medians −5.7% over three periods',
    why: 'GSE cross-form conflict. Appraiser must reconcile the addendum with page 1.',
    severity: 'error',
    pageIndex: 0,
    box: [12, 35, 76, 8],
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    code: 'URAR_COMP_1_ADJUSTMENT',
    label: 'Comp 1 net adjustment',
    extracted: '+$15,000 net · 5.9% gross on $425,000',
    why: 'Primary comparable. Within GSE net/gross review bands.',
    severity: 'info',
    pageIndex: 1,
    box: [35, 22, 15, 4],
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    code: 'URAR_PHYSICAL_REPAIRS',
    label: 'Physical repairs',
    extracted: 'Peeling paint · year built 1974',
    why: 'HUD 4000.1 / VA MPR: pre-1978 chipping paint requires lead-safe scrape, prime, and repaint.',
    severity: 'error',
    pageIndex: 1,
    box: [12, 55, 76, 6],
    programs: ['FHA', 'VA'],
  },
  {
    code: 'URAR_CRAWLSPACE_ACC_VIOLATION',
    label: 'Crawlspace access',
    extracted: 'Crawlspace not accessed · attic hatch only · utilities off',
    why: 'FHA / VA require a head-and-shoulders view of attic and crawlspace with utilities on.',
    severity: 'error',
    pageIndex: 2,
    box: [15, 60, 70, 5],
    programs: ['FHA', 'VA'],
  },
];

const NOV_CHECKLIST: NovItem[] = [
  {
    id: 'nov-title',
    label: 'Seller is owner of record',
    detail: 'Contract seller is not the deed holder. Chain of title required before NOV.',
    status: 'fail',
    authority: 'VA PAM 26-7',
    inspectCode: 'URAR_SUBJECT_CONTRACT',
  },
  {
    id: 'nov-lead',
    label: 'Lead-safe paint (pre-1978)',
    detail: 'Built 1974. Peeling/chipping paint on eaves and trim.',
    status: 'fail',
    authority: 'VA Ch. 12 MPR',
    inspectCode: 'URAR_PHYSICAL_REPAIRS',
  },
  {
    id: 'nov-crawl',
    label: 'Crawlspace head-and-shoulders',
    detail: 'Access blocked. Not inspected.',
    status: 'fail',
    authority: 'VA Ch. 12 MPR',
    inspectCode: 'URAR_CRAWLSPACE_ACC_VIOLATION',
  },
  {
    id: 'nov-attic',
    label: 'Attic head-and-shoulders',
    detail: 'Viewed from hatch only — not a head-and-shoulders inspection.',
    status: 'fail',
    authority: 'VA Ch. 12 MPR',
    inspectCode: 'URAR_CRAWLSPACE_ACC_VIOLATION',
  },
  {
    id: 'nov-utils',
    label: 'Utilities on at inspection',
    detail: 'Water, electric, and gas were off.',
    status: 'fail',
    authority: 'VA Ch. 12 MPR',
  },
  {
    id: 'nov-wdi',
    label: 'Wood-destroying insect certificate',
    detail: 'No WDI / termite clearance in the file.',
    status: 'fail',
    authority: 'VA PAM 26-7',
  },
  {
    id: 'nov-heat',
    label: 'Heating maintains 50°F',
    detail: 'Heating system noted as adequate for living areas.',
    status: 'pass',
    authority: 'VA Ch. 12 MPR',
  },
  {
    id: 'nov-well',
    label: 'Private well potability',
    detail: 'Public water/sewer. Well test not required.',
    status: 'na',
    authority: 'VA PAM 26-7',
  },
  {
    id: 'nov-mc',
    label: '1004MC vs neighborhood trend',
    detail: 'URAR STABLE vs 1004MC −5.7% declining medians.',
    status: 'fail',
    authority: 'GSE / VA SAR',
    inspectCode: 'URAR_NEIGHBORHOOD_TRENDS',
  },
];

const CONDITIONS: Condition[] = [
  {
    id: 'lead',
    kind: 'REPAIR',
    text: 'Scrape, prime, and repaint peeling pre-1978 paint under lead-safe practices. Discard scrapings before reinspection.',
    authority: 'HUD 4000.1 / VA Ch. 12',
    programs: ['FHA', 'VA'],
  },
  {
    id: 'reinspect',
    kind: 'INSPECTION',
    text: 'Reinspect: head-and-shoulders attic and crawlspace with water, electric, and gas on.',
    authority: 'HUD 4000.1 / VA Ch. 12',
    programs: ['FHA', 'VA'],
  },
  {
    id: 'flip90',
    kind: 'ADMIN',
    text: 'FHA 90-day flip: seller acquired 07/15/2026, contract 08/01/2026 — ineligible unless an exception applies.',
    authority: 'HUD 4000.1',
    programs: ['FHA'],
  },
  {
    id: 'ccde',
    kind: 'ADMIN',
    text: 'Complete and sign HUD-92800.5B Conditional Commitment / Direct Endorsement (CCDE). Appraised value on the CCDE must match $425,000.',
    authority: 'HUD 92800.5B',
    programs: ['FHA'],
  },
  {
    id: 'narms',
    kind: 'ADMIN',
    text: 'Non-arm’s length family sale. FHA max LTV restricted to 85% unless an owner-occupant exception is documented.',
    authority: 'HUD 4000.1',
    programs: ['FHA'],
  },
  {
    id: 'title',
    kind: 'ADMIN',
    text: 'Seller on the contract is not the owner of record. Provide a complete chain of title before insuring.',
    authority: 'HUD 4000.1 / GSE',
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    id: 'solar',
    kind: 'ADMIN',
    text: 'Leased rooftop solar cannot contribute to value. Remove the contributory adjustment and include the lease payment in DTI.',
    authority: 'HUD 4000.1 / GSE',
    programs: ['CONV', 'FHA'],
  },
  {
    id: 'wdi',
    kind: 'INSPECTION',
    text: 'NOV: provide a Wood-Destroying Insect (WDI) certificate showing no active infestation.',
    authority: 'VA PAM 26-7',
    programs: ['VA'],
  },
  {
    id: 'mc',
    kind: 'ADMIN',
    text: 'Reconcile 1004MC declining medians (−5.7%) with the STABLE neighborhood check on page 1.',
    authority: 'GSE Selling Guide',
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    id: 'comp2',
    kind: 'ADMIN',
    text: 'Comp 2 gross adjustment 11.7% exceeds the 10% GSE review band; 1.20 mi proximity. Weight Comp 1 as the primary indicator.',
    authority: 'GSE Selling Guide',
    programs: ['CONV', 'FHA', 'VA'],
  },
  {
    id: 'mold',
    kind: 'REDFLAG',
    text: 'Commentary: mold / dampness in crawlspace and utility closet — obtain a trade certification before insuring or issuing the NOV.',
    authority: 'HUD 4000.1 / VA Ch. 12',
    programs: ['CONV', 'FHA', 'VA'],
  },
];

export default function AppraisalReviewWorkspace() {
  const [program, setProgram] = useState<Program>('FHA');
  const [useBlankForm, setUseBlankForm] = useState(false);
  const {
    currentPage,
    zoomScale,
    activeHighlight,
    totalPages,
    nextPage,
    prevPage,
    zoomIn,
    zoomOut,
    resetZoom,
    triggerHighlight,
    clearHighlight,
  } = usePdfViewer(3);

  const visibleFindings = useMemo(
    () => FINDINGS.filter((finding) => finding.programs.includes(program)),
    [program],
  );
  const conditions = useMemo(
    () => CONDITIONS.filter((item) => item.programs.includes(program)),
    [program],
  );
  const mappedBoxes = visibleFindings.map((finding) => ({ pageIndex: finding.pageIndex, box: finding.box }));
  const errors = visibleFindings.filter((finding) => finding.severity === 'error').length;
  const warnings = visibleFindings.filter((finding) => finding.severity === 'warning').length;
  const novFails = NOV_CHECKLIST.filter((item) => item.status === 'fail').length;

  function inspect(code: string) {
    const finding = FINDINGS.find((item) => item.code === code);
    if (!finding) return;
    triggerHighlight({ pageIndex: finding.pageIndex, box: finding.box });
  }

  const header =
    program === 'VA'
      ? { kicker: 'VA SAR / LAPP', title: 'Notice of Value', sub: 'NOV checklist → sales comps → red flags & conditions' }
      : program === 'FHA'
        ? { kicker: 'FHA HUD 4000.1', title: 'CCDE / 92800.5B review', sub: 'Mapped findings write HUD-92800.5B conditions' }
        : { kicker: 'GSE collateral', title: 'URAR 1004 review', sub: 'CU net/gross bands · 1004MC · commentary flags' };

  return (
    <div
      data-testid="appraisal-workspace"
      className="flex h-[calc(100vh-8.5rem)] min-h-[780px] w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900"
    >
      <div className="flex h-full w-[46%] min-w-0 flex-col border-r border-slate-200 bg-slate-50">
        <PdfCoordinateCanvas
          currentPage={currentPage}
          zoomScale={zoomScale}
          activeHighlight={activeHighlight}
          totalPages={totalPages}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          documentCategory="APPRAISAL_1004"
          documentType="URAR"
          documentUrl={useBlankForm ? BLANK_URAR_PDF : URAR_PDF}
          mappedBoxes={useBlankForm ? [] : mappedBoxes}
        />
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-white">
        <header className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-700">{header.kicker}</p>
              <h2 className="mt-1 text-lg font-bold text-slate-950">{header.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{header.sub}</p>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setUseBlankForm(!useBlankForm)}
                className={`mr-2 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase ${
                  useBlankForm ? 'bg-indigo-600 text-white' : 'text-indigo-600 hover:text-indigo-800'
                }`}
              >
                {useBlankForm ? 'Using Blank Form' : 'Use Blank Form'}
              </button>
              {(['CONV', 'FHA', 'VA'] as Program[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setProgram(item)}
                  className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase ${
                    program === item ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {item === 'CONV' ? 'Conv' : item === 'VA' ? 'VA NOV' : 'FHA'}
                </button>
              ))}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <Meta label="Loan" value={useBlankForm ? '—' : SUBJECT.loanId} />
            <Meta label="Borrower" value={useBlankForm ? '—' : SUBJECT.borrower} />
            <Meta label="Appraised" value={useBlankForm ? '—' : `$${SUBJECT.value.toLocaleString()}`} />
            <Meta label="Case" value={useBlankForm ? '—' : SUBJECT.caseNumber} />
          </dl>
          <p className="mt-3 text-xs text-slate-600">
            {useBlankForm ? 'No subject data loaded' : `${SUBJECT.address} · ${SUBJECT.gla.toLocaleString()} sf · built ${SUBJECT.yearBuilt} · ${SUBJECT.appraiser}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
            <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-800">
              {useBlankForm ? '0 exceptions' : program === 'VA' ? `${novFails} NOV items open` : `${errors} exceptions`}
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{useBlankForm ? '0' : warnings} title / contract flags</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Native PDF mapped</span>
          </div>
        </header>

        <div className="space-y-6 px-6 py-5">
          {program === 'VA' ? (
            <NovChecklist items={useBlankForm ? [] : NOV_CHECKLIST} onInspect={inspect} />
          ) : (
            <FindingsList findings={useBlankForm ? [] : visibleFindings} activeHighlight={activeHighlight} onInspect={inspect} />
          )}

          {!useBlankForm && <SalesCompAnalysis />}

          {program === 'FHA' ? (
            <ConditionsPanel
              title="Writes to HUD-92800.5B (CCDE)"
              intro="Each mapped finding below becomes a Conditional Commitment item the DE underwriter would lock."
              conditions={useBlankForm ? [] : conditions}
            />
          ) : program === 'VA' ? (
            <ConditionsPanel
              title="Red flags & NOV conditions"
              intro="Failed MPR items and commentary keywords prefill the Notice of Value. Clear the checklist before lock & sync."
              conditions={useBlankForm ? [] : conditions}
              nov
            />
          ) : (
            <ConditionsPanel
              title="Conditions this file would write"
              intro="GSE CU / 1004MC and commentary flags for the underwriter."
              conditions={useBlankForm ? [] : conditions}
            />
          )}

          <button
            type="button"
            data-testid="clear-highlight"
            onClick={clearHighlight}
            className="rounded border border-slate-200 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 hover:text-slate-900"
          >
            Clear highlight
          </button>
        </div>
      </div>
    </div>
  );
}

function FindingsList({
  findings,
  activeHighlight,
  onInspect,
}: {
  findings: Finding[];
  activeHighlight: SpatialCoordinates | null;
  onInspect: (code: string) => void;
}) {
  return (
    <section>
      <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Mapped findings — tap to land on the PDF</h3>
      <p className="mt-1 text-xs text-slate-500">Native URAR 1004. Engine boxed the data points, not every OCR token.</p>
      <ul className="mt-3 space-y-2">
        {findings.map((finding) => {
          const active =
            activeHighlight?.pageIndex === finding.pageIndex &&
            activeHighlight.box.join(',') === finding.box.join(',');
          return (
            <li key={finding.code}>
              <button
                type="button"
                data-testid={`inspect-${finding.code}`}
                onClick={() => onInspect(finding.code)}
                className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                  active ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span>
                  <span className="flex items-center gap-2">
                    <SeverityIcon severity={finding.severity} />
                    <span className="text-xs font-bold text-slate-950">{finding.label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-slate-700">{finding.extracted}</span>
                  <span className="mt-1 block text-[11px] text-slate-500">{finding.why}</span>
                </span>
                <Eye className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NovChecklist({ items, onInspect }: { items: NovItem[]; onInspect: (code: string) => void }) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-indigo-600">
        <ClipboardList className="h-3.5 w-3.5" />
        VA Notice of Value — MPR checklist
      </h3>
      <p className="mt-1 text-xs text-slate-500">VA Pamphlet 26-7 Chapter 12. Tap an open item to land on the mapped PDF field.</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={!item.inspectCode}
              data-testid={item.inspectCode && items.filter((row) => row.inspectCode === item.inspectCode)[0]?.id === item.id ? `inspect-${item.inspectCode}` : undefined}
              onClick={() => item.inspectCode && onInspect(item.inspectCode)}
              className={`flex w-full items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-left ${
                item.status === 'fail'
                  ? 'border-rose-200 bg-rose-50/70'
                  : item.status === 'pass'
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-slate-200 bg-slate-50'
              } ${item.inspectCode ? 'hover:border-slate-400' : ''}`}
            >
              <span>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                      item.status === 'fail'
                        ? 'bg-rose-200 text-rose-900'
                        : item.status === 'pass'
                          ? 'bg-emerald-200 text-emerald-900'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {item.status === 'fail' ? 'Open' : item.status === 'pass' ? 'Met' : 'N/A'}
                  </span>
                  <span className="text-xs font-bold text-slate-950">{item.label}</span>
                </span>
                <span className="mt-1 block text-xs text-slate-700">{item.detail}</span>
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.authority}</span>
              </span>
              {item.inspectCode ? <Eye className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SalesCompAnalysis() {
  return (
    <section>
      <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">Sales comparison — adjustment analysis</h3>
      <p className="mt-1 text-xs text-slate-500">Net/gross bands and line items extracted from page 2 of the URAR.</p>
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2">Unit</th>
              <th>Price</th>
              <th>GLA</th>
              <th>Prox</th>
              <th>Net / gross</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {COMPS.map((comp) => (
              <tr key={comp.name} className={comp.flag ? 'bg-rose-50' : ''}>
                <td className="px-3 py-2">
                  <p className="font-bold text-slate-950">{comp.name}</p>
                  <p className="text-[10px] text-slate-500">{comp.address}</p>
                  {comp.lines.length ? (
                    <p className="mt-1 text-[10px] text-slate-500">{comp.lines.join(' · ')}</p>
                  ) : null}
                </td>
                <td className="font-mono">${comp.price.toLocaleString()}</td>
                <td>{comp.gla.toLocaleString()}</td>
                <td className={comp.prox === '1.20 mi' ? 'font-bold text-rose-700' : ''}>{comp.prox}</td>
                <td className={comp.flag ? 'font-bold text-rose-700' : 'text-slate-700'}>
                  {comp.net} / {comp.gross}
                  {comp.flag ? <span className="ml-1 text-[9px] uppercase">Flag</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConditionsPanel({
  title,
  intro,
  conditions,
  nov = false,
}: {
  title: string;
  intro: string;
  conditions: Condition[];
  nov?: boolean;
}) {
  return (
    <section className={`rounded-xl border p-4 ${nov ? 'border-indigo-200 bg-indigo-50/50' : 'border-rose-200 bg-rose-50/70'}`}>
      <h3 className={`flex items-center gap-2 text-xs font-bold ${nov ? 'text-indigo-950' : 'text-rose-950'}`}>
        <ShieldAlert className="h-4 w-4" />
        {title}
      </h3>
      <p className={`mt-1 text-[11px] ${nov ? 'text-indigo-800' : 'text-rose-800'}`}>{intro}</p>
      <ul className="mt-3 space-y-2">
        {conditions.map((item) => (
          <li key={item.id} className="rounded-lg border border-white/80 bg-white px-3 py-2 text-xs text-slate-800">
            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-600">
              {item.kind}
            </span>
            {item.text}
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.authority}</span>
          </li>
        ))}
      </ul>
      {nov ? (
        <p className="mt-3 text-[11px] font-semibold text-indigo-900">Lock, release & sync final NOV to Encompass eFolder —  {conditions.length} outstanding items.</p>
      ) : null}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: Severity }) {
  if (severity === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />;
  if (severity === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
}
