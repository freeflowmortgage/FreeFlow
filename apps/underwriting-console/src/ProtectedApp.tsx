import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConsoleView } from './appTypes';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';
import PdfCoordinateCanvas, { type SpatialCoordinates } from './components/PdfCoordinateCanvas';
import { PortalApiError, portalClient } from './api/portalClient';
import { EncompassHostError, type EncompassHostBridge } from './encompass-host/bridge';
import { loadConsoleRuntimeConfiguration, resolveEncompassHostBridge } from './encompass-host/runtimeHost';
import { consoleRuntime } from './runtimeMode';
import {
  deriveProtectedWorkflowState,
  readEvidenceFields,
  type ConsoleContext,
  type MetadataRequirement,
} from './protectedWorkflow';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const EMPLOYMENT_ROLES = ['CURRENT', 'CONCURRENT', 'PRIOR', 'PRIMARY', 'SECONDARY'] as const;
const WORKFLOW_STEPS = ['NO_LOAN_CONTEXT', 'BOUND', 'DOCUMENT_UPLOADED', 'EXTRACTED', 'REVIEW_REQUIRED', 'READY_TO_CALCULATE', 'CALCULATED', 'APPROVED', 'READY_TO_WRITE', 'WRITTEN'] as const;

type LocalDocument = Readonly<{ file: File; url: string; attachmentId: string | null }>;

export default function ProtectedApp() {
  const [requestedView, setRequestedView] = useState<ConsoleView | null>(null);
  const [contextState, setContextState] = useState<ConsoleContext | null>(null);
  const [hostBridge, setHostBridge] = useState<EncompassHostBridge | null>(null);
  const [hostLoanGuid, setHostLoanGuid] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<MetadataRequirement[] | null>(null);
  const [reviewValues, setReviewValues] = useState<Record<string, string>>({});
  const [localDocument, setLocalDocument] = useState<LocalDocument | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoomScale, setZoomScale] = useState(1);
  const [busy, setBusy] = useState<'UPLOAD' | 'REVIEW' | 'CALCULATE' | 'APPROVE' | 'WRITE' | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshContext = useCallback(async (loanId: string) => {
    const value = await portalClient.getConsoleContext(loanId) as ConsoleContext;
    setContextState(value);
    return value;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (consoleRuntime.hosted) {
          const configuration = await loadConsoleRuntimeConfiguration();
          const bridge = resolveEncompassHostBridge(configuration);
          const host = await bridge.activeLoan();
          const launch = await portalClient.launchEncompassHost(host.loanGuid);
          if (cancelled) return;
          setHostBridge(bridge);
          setHostLoanGuid(host.loanGuid);
          await refreshContext(launch.loanId);
          return;
        }
        const loanId = new URLSearchParams(window.location.search).get('loanId');
        if (!loanId) throw new Error('Open this workspace with an authorized loan context.');
        await refreshContext(loanId);
      } catch (error) {
        if (!cancelled) setContextError(describeError(error, 'Loan context could not be loaded.'));
      }
    })();
    return () => { cancelled = true; };
  }, [refreshContext]);

  useEffect(() => {
    let cancelled = false;
    if (!contextState) { setRequirements(null); return () => { cancelled = true; }; }
    const active = contextState.extractions.filter((item) => item.status === 'ACTIVE');
    if (!active.length) { setRequirements([]); return () => { cancelled = true; }; }
    setRequirements(null);
    void Promise.all(active.map((item) => portalClient.getMetadataRequirements(contextState.loan.id, item.id)))
      .then((responses) => { if (!cancelled) setRequirements(responses.flatMap((item) => item.requirements)); })
      .catch((error) => { if (!cancelled) setActionError(describeError(error, 'Metadata requirements could not be loaded.')); });
    return () => { cancelled = true; };
  }, [contextState?.loan.id, contextState?.loan.version]);

  useEffect(() => () => { if (localDocument) URL.revokeObjectURL(localDocument.url); }, [localDocument]);

  const activeExtraction = useMemo(() => {
    const active = contextState?.extractions.filter((item) => item.status === 'ACTIVE') ?? [];
    if (!active.length) return null;
    if (localDocument?.attachmentId) return active.find((item) => item.attachmentId === localDocument.attachmentId) ?? active[0];
    return active[0];
  }, [contextState, localDocument?.attachmentId]);
  const evidence = useMemo(() => readEvidenceFields(activeExtraction?.evidence), [activeExtraction]);
  const activeHighlight: SpatialCoordinates | null = evidence[selectedEvidence]
    ? { pageIndex: evidence[selectedEvidence].pageIndex, box: evidence[selectedEvidence].box }
    : null;
  const workflowState = deriveProtectedWorkflowState(contextState, requirements, Boolean(hostBridge && hostLoanGuid));
  const currentStep = Math.max(0, WORKFLOW_STEPS.indexOf(workflowState as typeof WORKFLOW_STEPS[number]));

  const selectDocument = (file: File | undefined) => {
    setActionError(null);
    if (!file) return;
    if (file.type !== 'application/pdf') { setActionError('Only PDF documents are supported.'); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setActionError('The document exceeds the 40 MiB limit.'); return; }
    const next = { file, url: URL.createObjectURL(file), attachmentId: null };
    setLocalDocument((previous) => { if (previous) URL.revokeObjectURL(previous.url); return next; });
    setCurrentPage(1); setPageCount(1); setSelectedEvidence(0);
  };

  const uploadDocument = async () => {
    if (!contextState || !localDocument) return;
    await runAction('UPLOAD', async () => {
      const uploaded = await portalClient.uploadIncomeDocument(contextState.loan.id, localDocument.file);
      setLocalDocument((current) => current ? { ...current, attachmentId: uploaded.attachmentId } : current);
      await refreshContext(contextState.loan.id);
    }, 'The PDF could not be uploaded or processed.');
  };

  const submitReview = async (extractionId: string) => {
    if (!contextState || !requirements) return;
    const requested = requirements.filter((item) => item.extractionId === extractionId);
    if (!requested.length || requested.some((item) => item.field === 'requiredParserField')) return;
    const byEntity = new Map<string, Record<string, string | number>>();
    for (const requirement of requested) {
      const value = reviewValues[requirementKey(requirement)]?.trim();
      if (!value) { setActionError(`Review ${requirement.form} ${requirement.field} before continuing.`); return; }
      const assignment = byEntity.get(requirement.entityId) ?? { entityId: requirement.entityId };
      assignment[requirement.field] = requirement.field === 'employmentRole' ? value : Number(value);
      byEntity.set(requirement.entityId, assignment);
    }
    const extraction = contextState.extractions.find((item) => item.id === extractionId);
    await runAction('REVIEW', async () => {
      await portalClient.submitMetadataReview(contextState.loan.id, extractionId, {
        expectedLoanVersion: contextState.loan.version,
        expectedMetadataVersion: extraction?.metadataReview?.metadataVersion ?? 0,
        source: 'DOCUMENT_VISUAL_REVIEW', reasonCode: 'DOCUMENT_METADATA_CONFIRMED', reasonNarrative: null,
        assignments: Array.from(byEntity.values()),
      }, crypto.randomUUID());
      await refreshContext(contextState.loan.id);
    }, 'The metadata review could not be saved.');
  };

  const calculate = async () => {
    if (!contextState) return;
    const extractionIds = contextState.extractions.filter((item) => item.status === 'ACTIVE').map((item) => item.id);
    await runAction('CALCULATE', async () => {
      await portalClient.calculateIncome({ loanId: contextState.loan.id, extractionIds });
      await refreshContext(contextState.loan.id);
    }, 'The authoritative calculation could not be completed.');
  };

  const approve = async () => {
    if (!contextState?.calculation?.current) return;
    await runAction('APPROVE', async () => {
      await portalClient.approveIncome(contextState.loan.id, {
        calculationId: contextState.calculation!.id,
        expectedLoanVersion: contextState.loan.version,
        action: 'INCOME_APPROVED', reasonCode: 'UNDERWRITER_CONFIRMED', reasonNarrative: null,
        overrideQualifyingMonthlyIncome: null,
      }, crypto.randomUUID());
      await refreshContext(contextState.loan.id);
    }, 'The current calculation could not be approved.');
  };

  const writeApprovedResult = async () => {
    if (!contextState?.approval?.current || !hostLoanGuid || !hostBridge) return;
    let authorization: Awaited<ReturnType<typeof portalClient.authorizeHostWrite>> | null = null;
    await runAction('WRITE', async () => {
      authorization = await portalClient.authorizeHostWrite(contextState.loan.id, {
        approvalEventId: contextState.approval!.id, expectedLoanVersion: contextState.loan.version,
      }, crypto.randomUUID());
      if (authorization.status !== 'SUCCEEDED') {
        if (authorization.encompassLoanGuid !== hostLoanGuid) throw new EncompassHostError('ENCOMPASS_LOAN_CONTEXT_CHANGED', 'The active host loan no longer matches this workflow.');
        await hostBridge.writeApprovedResult(hostLoanGuid, authorization.fields);
        await portalClient.completeHostWrite(authorization.writeId, { fieldMapHash: authorization.fieldMapHash, outcome: 'SUCCEEDED' }, crypto.randomUUID());
      }
      await refreshContext(contextState.loan.id);
    }, 'The host write was not durably confirmed.', async () => {
      if (authorization && authorization.status === 'AUTHORIZED') {
        await portalClient.completeHostWrite(authorization.writeId, { fieldMapHash: authorization.fieldMapHash, outcome: 'FAILED' }, crypto.randomUUID()).catch(() => undefined);
      }
    });
  };

  const runAction = async (operation: NonNullable<typeof busy>, action: () => Promise<void>, fallback: string, onFailure?: () => Promise<void>) => {
    setBusy(operation); setActionError(null);
    try { await action(); }
    catch (error) { await onFailure?.(); setActionError(describeError(error, fallback)); }
    finally { setBusy(null); }
  };

  if (!requestedView) return <B2BLanding onOpenService={setRequestedView} protectedMode />;
  const canCalculate = Boolean(contextState && requirements?.length === 0 && contextState.extractions.some((item) => item.status === 'ACTIVE'));
  const canApprove = Boolean(contextState?.calculation?.current && !contextState.approval?.current);
  const failedCurrentWrite = contextState?.hostWrite?.status === 'FAILED' && contextState.hostWrite.approvalEventId === contextState.approval?.id;
  const canWrite = Boolean(consoleRuntime.hosted && contextState?.approval?.current && hostBridge && hostLoanGuid && !failedCurrentWrite);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6" data-testid="protected-workflow">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3"><BrandLogo compact /><div><span className="text-sm font-bold text-slate-900">Income</span><p className="text-[11px] text-slate-500">Authoritative protected workflow</p></div></div>
          <div className="flex items-center gap-2"><span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Protected</span><span data-testid="workflow-state" className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{workflowState.replace(/_/g, ' ')}</span></div>
        </header>

        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <ol className="flex flex-wrap gap-2" aria-label="Workflow progress">
            {WORKFLOW_STEPS.map((step, index) => <li key={step} className={`rounded px-2 py-1 text-[10px] font-bold ${index <= currentStep ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400'}`}>{step.replace(/_/g, ' ')}</li>)}
          </ol>
        </div>

        {(contextError || actionError) ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">{actionError ?? contextError}</div> : null}

        <div className="grid min-h-[720px] gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
          <section className="border-b border-slate-200 bg-slate-100 p-4 lg:border-b-0 lg:border-r">
            {localDocument ? (
              <PdfCoordinateCanvas currentPage={currentPage} zoomScale={zoomScale} activeHighlight={activeHighlight} totalPages={pageCount}
                onNextPage={() => setCurrentPage((value) => Math.min(pageCount, value + 1))} onPrevPage={() => setCurrentPage((value) => Math.max(1, value - 1))}
                onZoomIn={() => setZoomScale((value) => Math.min(2, value + 0.1))} onZoomOut={() => setZoomScale((value) => Math.max(0.5, value - 0.1))} onResetZoom={() => setZoomScale(1)}
                documentUrl={localDocument.url} documentCategory={contextState?.attachments.find((item) => item.attachmentId === localDocument.attachmentId)?.category}
                mappedBoxes={evidence.map((item) => ({ pageIndex: item.pageIndex, box: item.box }))} allowFallbackMock={false} onPageCount={(pages) => { setPageCount(pages); setCurrentPage((value) => Math.min(value, pages)); }} />
            ) : (
              <div className="grid h-full min-h-[680px] place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                <div><p className="font-bold text-slate-700">Current-session source document</p><p className="mt-2 max-w-md">Choose a synthetic PDF to view it here. Raw bytes remain in browser memory and are not recovered from backend storage.</p></div>
              </div>
            )}
          </section>

          <section className="space-y-5 overflow-y-auto p-5">
            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">1. Source document</h2>
              <input data-testid="protected-pdf-input" className="mt-3 block w-full text-xs" type="file" accept="application/pdf" onChange={(event) => selectDocument(event.target.files?.[0])} />
              <button data-testid="upload-pdf" type="button" disabled={!contextState || !localDocument || busy !== null || localDocument.attachmentId !== null} onClick={() => void uploadDocument()} className="mt-3 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'UPLOAD' ? 'Uploading...' : localDocument?.attachmentId ? 'Uploaded' : 'Upload and extract'}</button>
              <p className="mt-2 text-xs text-slate-500">PDF only, up to 40 MiB. Processing uses the protected production upload endpoint.</p>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-900">2. Persisted extraction evidence</h2><span className="text-xs text-slate-500">{evidence.length} coordinates</span></div>
              {activeExtraction ? <p className="mt-1 text-xs text-slate-500">Parser {activeExtraction.parserVersion} / source version {activeExtraction.sourceDocumentVersion}</p> : null}
              {evidence.length ? <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto">{evidence.map((item, index) => <button key={`${item.pageIndex}-${item.field}-${index}`} type="button" onClick={() => { setSelectedEvidence(index); setCurrentPage(item.pageIndex + 1); }} className={`rounded border px-3 py-2 text-left text-xs ${selectedEvidence === index ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`}><strong>{item.field}</strong><span className="ml-2 text-slate-400">page {item.pageIndex + 1} / {item.collection}</span></button>)}</div> : <p className="mt-3 text-xs text-slate-500">No persisted coordinate evidence is available yet.</p>}
              {activeExtraction?.warnings.length ? <ul className="mt-3 list-disc pl-5 text-xs text-amber-800">{activeExtraction.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">3. Metadata review</h2>
              {requirements === null ? <p className="mt-2 text-xs text-slate-500">Loading authoritative review requirements...</p> : requirements.length === 0 ? <p className="mt-2 text-xs font-medium text-emerald-700">No outstanding metadata review.</p> : null}
              {Array.from(new Set((requirements ?? []).map((item) => item.extractionId))).map((extractionId) => {
                const items = requirements!.filter((item) => item.extractionId === extractionId);
                const parserBlocked = items.some((item) => item.field === 'requiredParserField');
                return <div key={extractionId} className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">{items.map((item) => <label key={requirementKey(item)} className="mb-2 block text-xs font-medium text-slate-700">{item.form} / {item.entityId} / {item.field}{item.field === 'employmentRole' ? <select value={reviewValues[requirementKey(item)] ?? ''} onChange={(event) => setReviewValues((values) => ({ ...values, [requirementKey(item)]: event.target.value }))} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"><option value="">Select reviewed role</option>{EMPLOYMENT_ROLES.map((role) => <option key={role}>{role}</option>)}</select> : item.field === 'requiredParserField' ? <span className="mt-1 block rounded bg-red-50 p-2 text-red-700">The persisted extraction lacks a required parser field and cannot be repaired in the browser.</span> : <input type="number" min={item.field === 'taxYear' ? 1990 : 0} max={item.field === 'taxYear' ? 2100 : 100} value={reviewValues[requirementKey(item)] ?? ''} onChange={(event) => setReviewValues((values) => ({ ...values, [requirementKey(item)]: event.target.value }))} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2" />}</label>)}<button type="button" disabled={parserBlocked || busy !== null} onClick={() => void submitReview(extractionId)} className="mt-1 rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'REVIEW' ? 'Saving...' : 'Confirm reviewed metadata'}</button></div>;
              })}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">4. Calculation and approval</h2>
              <div className="mt-3 flex flex-wrap gap-2"><button data-testid="calculate-income" type="button" disabled={!canCalculate || busy !== null || Boolean(contextState?.calculation?.current)} onClick={() => void calculate()} className="rounded bg-indigo-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'CALCULATE' ? 'Calculating...' : 'Calculate'}</button><button data-testid="approve-income" type="button" disabled={!canApprove || busy !== null} onClick={() => void approve()} className="rounded bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'APPROVE' ? 'Approving...' : contextState?.approval?.current ? 'Approved' : 'Approve'}</button></div>
              {contextState?.calculation ? <div className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-700"><p><strong>Qualifying monthly income:</strong> {formatCurrency(contextState.calculation.qualifyingMonthlyIncome)}</p><p><strong>Trend:</strong> {contextState.calculation.trendingResult}</p><p><strong>Years:</strong> {contextState.calculation.yearsAnalyzed.join(', ')}</p>{!contextState.calculation.current && !contextState.approval?.current ? <p className="mt-1 font-medium text-red-700">This calculation is stale. Recalculate before approval.</p> : null}</div> : null}
            </div>

            {consoleRuntime.hosted ? <div className="rounded-lg border border-slate-200 p-4"><h2 className="text-sm font-bold text-slate-900">5. Encompass host write</h2><p className="mt-2 text-xs text-slate-500">Explicitly writes only the backend-approved field map, then calculates, commits, and reads back the approval marker.</p><button data-testid="write-host" type="button" disabled={!canWrite || busy !== null || contextState?.hostWrite?.status === 'SUCCEEDED'} onClick={() => void writeApprovedResult()} className="mt-3 rounded bg-emerald-800 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'WRITE' ? 'Writing...' : contextState?.hostWrite?.status === 'SUCCEEDED' ? 'Durably written' : 'Write approved result'}</button>{failedCurrentWrite ? <p className="mt-2 text-xs font-medium text-red-700">The prior host write failed. A new approval is required before retrying.</p> : null}</div> : null}
          </section>
        </div>

        <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">{contextState ? `Loan ${contextState.loan.id} / version ${contextState.loan.version} / ${contextState.loan.program}${contextState.loan.borrowerName ? ` / ${contextState.loan.borrowerName}` : ''}` : contextError ?? 'Loading authoritative context...'}</footer>
      </div>
    </main>
  );
}

function requirementKey(value: MetadataRequirement): string { return `${value.extractionId}:${value.entityId}:${value.field}`; }
function describeError(error: unknown, fallback: string): string {
  if (error instanceof PortalApiError || error instanceof EncompassHostError) return `${error.message} (${error.code})`;
  return error instanceof Error && error.message ? error.message : fallback;
}
function formatCurrency(value: string | number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'Unavailable';
}
