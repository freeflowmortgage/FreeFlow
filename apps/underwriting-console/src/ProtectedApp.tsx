import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConsoleView } from './appTypes';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';
import Conversational1003 from './components/Conversational1003';
import AppraisalReviewWorkspace from './components/AppraisalReviewWorkspace';
import SplitDocPane from './components/SplitDocPane';
import UnderwriterSplitViewDemo from './components/UnderwriterSplitViewDemo';
import PdfCoordinateCanvas, { type SpatialCoordinates } from './components/PdfCoordinateCanvas';
import { portalClient } from './api/portalClient';
import { EncompassHostError, type EncompassHostBridge } from './encompass-host/bridge';
import { loadConsoleRuntimeConfiguration, resolveEncompassHostBridge } from './encompass-host/runtimeHost';
import { consoleRuntime } from './runtimeMode';
import {
  applyRequirementValue,
  deriveProtectedWorkflowState,
  readEvidenceFields,
  type ConsoleContext,
  type MetadataRequirement,
} from './protectedWorkflow';
import {
  protectedWorkspaceContext,
  protectedWorkspaceDocuments,
  type ProtectedLocalDocument,
} from './protectedWorkspace';
import { findDuplicate } from './livePacket';
import { describeProtectedError } from './protectedErrorMessage';
import type { LiveDocument, ParseResponse } from './parseTypes';
import {
  PUBLIC_DEMO_DOCUMENT_PREFIX,
  appWorkspaceHref,
  isPublicIncomeDemoHash,
  isSalesLandingHost,
  isSoftwareEntryHost,
} from './salesHost';

const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const EMPLOYMENT_ROLES = ['CURRENT', 'CONCURRENT', 'PRIOR', 'PRIMARY', 'SECONDARY'] as const;
const PAY_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'] as const;
const BASE_METHODS = ['hourly', 'period', 'ytd', 'prior'] as const;
const WORKFLOW_STEPS = ['NO_LOAN_CONTEXT', 'BOUND', 'DOCUMENT_UPLOADED', 'EXTRACTED', 'REVIEW_REQUIRED', 'READY_TO_CALCULATE', 'CALCULATED', 'APPROVED', 'READY_TO_WRITE', 'WRITTEN'] as const;

type LocalDocument = ProtectedLocalDocument & Readonly<{ id: string; url: string }>;
type IncomeSurface = 'WORKSPACE' | 'AUTHORITATIVE';
type StandaloneLoanRequest = Readonly<{
  schemaVersion: 'freeflow-standalone-loan-v1';
  loanProgram: 'CONVENTIONAL' | 'FHA' | 'VA';
  borrowers: readonly { borrowerKey: string; role: 'PRIMARY' | 'CO_BORROWER' }[];
}>;

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function ProtectedApp() {
  if (window.location.hash === '#split-doc') return <SplitDocPane />;

  return <ProtectedWorkflowApp />;
}

function ProtectedWorkflowApp() {
  const initialParams = new URLSearchParams(window.location.search);
  const initialWorkspace = window.location.pathname.startsWith('/workspace');
  const initialIncomeDemo = initialWorkspace && initialParams.get('demo') === 'income';
  const requestedProduct = initialParams.get('product');
  const initialView: ConsoleView = requestedProduct === 'intake' || requestedProduct === 'appraisal' ? requestedProduct : 'split';
  const [requestedView, setRequestedView] = useState<ConsoleView | null>(initialIncomeDemo || initialWorkspace ? initialView : null);
  const incomeDemo = initialIncomeDemo;
  const salesLanding = isSalesLandingHost(window.location.hostname);
  const softwareEntry = isSoftwareEntryHost(window.location.hostname);
  const [publicIncomeDemo, setPublicIncomeDemo] = useState(() => isPublicIncomeDemoHash(window.location.hash));
  const [syntheticProductDemosEnabled, setSyntheticProductDemosEnabled] = useState(false);
  const [contextState, setContextState] = useState<ConsoleContext | null>(null);
  const [hostBridge, setHostBridge] = useState<EncompassHostBridge | null>(null);
  const [hostLoanGuid, setHostLoanGuid] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<MetadataRequirement[] | null>(null);
  const [reviewValues, setReviewValues] = useState<Record<string, string>>({});
  const [localDocuments, setLocalDocuments] = useState<LocalDocument[]>([]);
  const localDocumentsRef = useRef<LocalDocument[]>([]);
  const [activeLocalDocumentId, setActiveLocalDocumentId] = useState<string | null>(null);
  const [incomeSurface, setIncomeSurface] = useState<IncomeSurface>('WORKSPACE');
  const [selectedEvidence, setSelectedEvidence] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [zoomScale, setZoomScale] = useState(1);
  const [busy, setBusy] = useState<'UPLOAD' | 'PULL' | 'REVIEW' | 'CALCULATE' | 'APPROVE' | null>(null);
  const [calculationWarnings, setCalculationWarnings] = useState<string[]>([]);
  const [contextError, setContextError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshContext = useCallback(async (loanId: string) => {
    const value = await portalClient.getConsoleContext(loanId) as ConsoleContext;
    setContextState(value);
    return value;
  }, []);

  useEffect(() => {
    const onHash = () => setPublicIncomeDemo(isPublicIncomeDemoHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (incomeDemo || publicIncomeDemo || !requestedView) return;
    let cancelled = false;
    void (async () => {
      try {
        if (requestedView !== 'split') {
          const configuration = await loadConsoleRuntimeConfiguration();
          if (!cancelled) setSyntheticProductDemosEnabled(configuration.syntheticProductDemos?.enabled === true);
          return;
        }
        if (consoleRuntime.hosted) {
          const configuration = await loadConsoleRuntimeConfiguration();
          setSyntheticProductDemosEnabled(configuration.syntheticProductDemos?.enabled === true);
          const bridge = resolveEncompassHostBridge(configuration);
          const host = await bridge.activeLoan();
          const launch = await portalClient.launchEncompassHost(host.loanGuid, configuration.testHost.borrowers);
          if (cancelled) return;
          setHostBridge(bridge);
          setHostLoanGuid(host.loanGuid);
          await refreshContext(launch.loanId);
          return;
        }
        const loanId = new URLSearchParams(window.location.search).get('loanId');
        if (!loanId) {
          if (!cancelled) setContextError(null);
          return;
        }
        await refreshContext(loanId);
      } catch (error) {
        if (!cancelled) setContextError(describeError(error, 'Loan context could not be loaded.'));
      }
    })();
    return () => { cancelled = true; };
  }, [refreshContext, incomeDemo, publicIncomeDemo, requestedView]);

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

  localDocumentsRef.current = localDocuments;
  useEffect(() => () => {
    for (const document of localDocumentsRef.current) URL.revokeObjectURL(document.url);
  }, []);

  const localDocument = localDocuments.find((item) => item.id === activeLocalDocumentId) ?? localDocuments[0] ?? null;

  const activeExtraction = useMemo(() => {
    const active = contextState?.extractions.filter((item) => item.status === 'ACTIVE') ?? [];
    if (!active.length) return null;
    if (localDocument && !localDocument.attachmentId) return null;
    if (localDocument?.attachmentId) return active.find((item) => item.attachmentId === localDocument.attachmentId) ?? null;
    return active[0];
  }, [contextState, localDocument?.id, localDocument?.attachmentId]);
  const evidence = useMemo(() => readEvidenceFields(activeExtraction?.evidence), [activeExtraction]);
  const activeHighlight: SpatialCoordinates | null = evidence[selectedEvidence]
    ? { pageIndex: evidence[selectedEvidence].pageIndex, box: evidence[selectedEvidence].box }
    : null;
  const workflowState = deriveProtectedWorkflowState(contextState, requirements, Boolean(hostBridge && hostLoanGuid));
  const currentStep = Math.max(0, WORKFLOW_STEPS.indexOf(workflowState as typeof WORKFLOW_STEPS[number]));
  const workspaceDocuments = useMemo(
    () => protectedWorkspaceDocuments(contextState, localDocuments),
    [contextState, localDocuments],
  );
  const workspaceContext = useMemo(() => protectedWorkspaceContext(contextState), [contextState]);

  const selectDocuments = (files: readonly File[]) => {
    setActionError(null);
    if (!files.length) return;
    const invalid = files.find((file) => file.type !== 'application/pdf');
    if (invalid) { setActionError(`${invalid.name}: only PDF documents are supported.`); return; }
    const oversized = files.find((file) => file.size > MAX_DOCUMENT_BYTES);
    if (oversized) { setActionError(`${oversized.name}: the document exceeds the 40 MiB limit.`); return; }
    const next = files.map((file): LocalDocument => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), attachmentId: null }));
    setLocalDocuments((current) => [...current, ...next]);
    setActiveLocalDocumentId(next[0]?.id ?? null);
    setCurrentPage(1); setPageCount(1); setSelectedEvidence(0);
  };

  const pullHostedDocuments = async () => {
    if (!contextState) return;
    await runAction('PULL', async () => {
      const listing = await portalClient.getEncompassAttachments(contextState.loan.id);
      const attachmentIds = listing.attachments.filter((item) => item.status === 'SELECTABLE').map((item) => item.id);
      if (!attachmentIds.length) throw new Error('No hosted documents are available to pull.');
      await portalClient.createDocumentPull(contextState.loan.id, {
        expectedLoanVersion: contextState.loan.version,
        attachmentIds,
        selectionBindingHash: listing.selectionBindingHash,
      }, crypto.randomUUID());
      await refreshContext(contextState.loan.id);
    }, 'The hosted documents could not be pulled.');
  };

  const uploadDocuments = async (files?: readonly File[]) => {
    if (!contextState) return;
    let selected = localDocuments.filter((item) => item.attachmentId === null);
    if (files?.length) {
      const invalid = files.find((file) => file.type !== 'application/pdf' || file.size > MAX_DOCUMENT_BYTES);
      if (invalid) { setActionError(`${invalid.name}: use a PDF up to 40 MiB.`); return; }
      const next = files.map((file): LocalDocument => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), attachmentId: null }));
      selected = next;
      setLocalDocuments((current) => [...current, ...next]);
      setActiveLocalDocumentId(next[0]?.id ?? null);
    }
    if (!selected.length) return;
    await runAction('UPLOAD', async () => {
      for (const document of selected) {
        const uploaded = await portalClient.uploadIncomeDocument(contextState.loan.id, document.file);
        setLocalDocuments((current) => current.map((item) => item.id === document.id ? { ...item, attachmentId: uploaded.attachmentId } : item));
        await refreshContext(contextState.loan.id);
      }
    }, 'The PDF could not be uploaded or processed.');
  };

  const submitReview = async (extractionId: string) => {
    if (!contextState || !requirements) return;
    const requested = requirements.filter((item) => item.extractionId === extractionId);
    if (!requested.length || requested.some((item) => item.field === 'requiredParserField' || item.field === 'unsupportedCalculation')) return;
    const byEntity = new Map<string, Record<string, string | number | boolean>>();
    for (const requirement of requested) {
      const value = reviewValues[requirementKey(requirement)]?.trim();
      if (!value) { setActionError(`Review ${requirement.form} ${requirement.field} before continuing.`); return; }
      const assignment = byEntity.get(requirement.entityId) ?? { entityId: requirement.entityId };
      applyRequirementValue(assignment, requirement.field, value);
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
      const calculated = await portalClient.calculateIncome({ loanId: contextState.loan.id, extractionIds }) as { extractionWarnings?: string[] };
      setCalculationWarnings(calculated.extractionWarnings ?? []);
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

  const runAction = async (operation: NonNullable<typeof busy>, action: () => Promise<void>, fallback: string, onFailure?: () => Promise<void>) => {
    setBusy(operation); setActionError(null);
    try { await action(); }
    catch (error) { await onFailure?.(); setActionError(describeError(error, fallback)); }
    finally { setBusy(null); }
  };

  const backToProducts = () => {
    window.location.assign('/');
  };
  const leavePublicDemo = () => {
    if (window.location.hash) window.location.hash = '';
    else setPublicIncomeDemo(false);
  };
  if (softwareEntry && !publicIncomeDemo && window.location.pathname === '/') {
    window.location.replace('/workspace');
    return null;
  }
  if (!window.location.pathname.startsWith('/workspace') && publicIncomeDemo) {
    return <ProtectedIncomeDemo fixtureDocumentPrefix={PUBLIC_DEMO_DOCUMENT_PREFIX} onBack={leavePublicDemo} />;
  }
  if (!requestedView) {
    return (
      <B2BLanding
        onOpenService={(view) => window.location.assign(salesLanding ? appWorkspaceHref(view) : `/workspace?product=${view}`)}
        protectedMode
        salesEntry={salesLanding}
        workspaceHref={salesLanding ? appWorkspaceHref : undefined}
      />
    );
  }
  if (requestedView === 'split' && incomeDemo) {
    return <ProtectedIncomeDemo onBack={backToProducts} />;
  }
  if (requestedView === 'intake' || requestedView === 'appraisal') {
    return (
      <ProtectedProductDemo
        view={requestedView}
        enabled={syntheticProductDemosEnabled}
        onBack={() => setRequestedView(null)}
      />
    );
  }
  if (requestedView !== 'split') return <ProtectedProductUnavailable onBack={() => setRequestedView(null)} />;
  const requestedLoanId = new URLSearchParams(window.location.search).get('loanId');
  if (!consoleRuntime.hosted && !contextState && !requestedLoanId && !contextError) {
    return <StandaloneLoanIntake onBack={backToProducts} onCreated={async (loanId) => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('loanId', loanId);
      nextUrl.searchParams.set('product', 'split');
      window.history.replaceState(null, '', nextUrl);
      await refreshContext(loanId);
    }} />;
  }
  const canCalculate = Boolean(contextState && requirements?.length === 0 && contextState.extractions.some((item) => item.status === 'ACTIVE'));
  const canApprove = Boolean(contextState?.calculation?.current && !contextState.approval?.current);

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6" data-testid="protected-workflow">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3"><BrandLogo compact /><div><span className="text-sm font-bold text-slate-900">Income</span><p className="text-[11px] text-slate-500">Authoritative protected workflow</p></div></div>
          <div className="flex items-center gap-2">
            <button data-testid="back-to-products" type="button" onClick={backToProducts} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-emerald-400 hover:text-emerald-700">Back to products</button>
            <button data-testid="logout" type="button" onClick={() => window.location.assign('/logout')} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-red-300 hover:text-red-700">Logout</button>
            <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Protected</span>
            <span data-testid="workflow-state" className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-bold text-white">{workflowState.replace(/_/g, ' ')}</span>
          </div>
        </header>

        <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
          <ol className="flex flex-wrap gap-2" aria-label="Workflow progress">
            {WORKFLOW_STEPS.map((step, index) => <li key={step} className={`rounded px-2 py-1 text-[10px] font-bold ${index <= currentStep ? 'bg-emerald-100 text-emerald-800' : 'bg-white text-slate-400'}`}>{step.replace(/_/g, ' ')}</li>)}
          </ol>
        </div>

        {(contextError || actionError) ? <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">{actionError ?? contextError}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex rounded-lg border border-slate-200 p-1" aria-label="Income view">
            <button data-testid="income-workspace-tab" type="button" onClick={() => setIncomeSurface('WORKSPACE')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${incomeSurface === 'WORKSPACE' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>1. Upload &amp; review</button>
            <button data-testid="authoritative-workflow-tab" type="button" onClick={() => setIncomeSurface('AUTHORITATIVE')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${incomeSurface === 'AUTHORITATIVE' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>2. Submit &amp; approve</button>
          </div>
          <p className="text-xs text-slate-500">Documents stay available in this browser session; persisted calculations and approvals remain server-authoritative.</p>
        </div>

        {incomeSurface === 'WORKSPACE' ? (
          workspaceContext ? (
            <section className="h-[calc(100vh-13rem)] min-h-[780px] p-4" data-testid="authenticated-income-workspace">
              <UnderwriterSplitViewDemo
                source="live"
                liveDocuments={workspaceDocuments}
                parseBusy={busy === 'UPLOAD'}
                parseError={actionError}
                onParseFiles={(files) => void uploadDocuments(files)}
                protectedContext={workspaceContext}
                onOpenAuthoritativeWorkflow={() => setIncomeSurface('AUTHORITATIVE')}
              />
            </section>
          ) : (
            <section className="grid min-h-[620px] place-items-center bg-slate-50 p-6" data-testid="workspace-loading">
              <p className="text-sm font-medium text-slate-600">{contextError ? 'An authorized loan context is required.' : 'Loading the authorized loan workspace…'}</p>
            </section>
          )
        ) : (
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
              <input data-testid="protected-pdf-input" className="mt-3 block w-full text-xs" type="file" accept="application/pdf" multiple onChange={(event) => { selectDocuments(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button data-testid="upload-pdf" type="button" disabled={!contextState || !localDocuments.some((item) => item.attachmentId === null) || busy !== null} onClick={() => void uploadDocuments()} className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'UPLOAD' ? 'Uploading...' : 'Upload and extract'}</button>
                {consoleRuntime.hosted ? <button data-testid="pull-documents" type="button" disabled={!contextState || busy !== null} onClick={() => void pullHostedDocuments()} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 disabled:opacity-40">{busy === 'PULL' ? 'Pulling...' : 'Pull hosted documents'}</button> : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">PDF only, up to 40 MiB. Hosted pull sends attachment ids only. Raw document bytes are not placed on the queue.</p>
              {localDocuments.length > 1 ? <div className="mt-3 flex flex-wrap gap-1">{localDocuments.map((document) => <button key={document.id} type="button" onClick={() => { setActiveLocalDocumentId(document.id); setCurrentPage(1); setSelectedEvidence(0); }} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${localDocument?.id === document.id ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>{document.file.name}</button>)}</div> : null}
              {(contextState?.borrowers?.length ?? 0) > 0 ? <ol data-testid="borrower-roster" className="mt-3 space-y-1 text-xs text-slate-700">{contextState!.borrowers!.map((borrower) => <li key={borrower.borrowerKey}>{borrower.role === 'PRIMARY' ? 'Primary' : 'Co-borrower'} {borrower.borrowerKey}</li>)}</ol> : null}
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
                const calculationBlocked = items.some((item) => item.field === 'requiredParserField' || item.field === 'unsupportedCalculation');
                return <div key={extractionId} className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">{items.map((item) => <ReviewField key={requirementKey(item)} item={item} borrowers={contextState?.borrowers ?? []} value={reviewValues[requirementKey(item)] ?? ''} onChange={(value) => setReviewValues((values) => ({ ...values, [requirementKey(item)]: value }))} />)}<button type="button" disabled={calculationBlocked || busy !== null} onClick={() => void submitReview(extractionId)} className="mt-1 rounded bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'REVIEW' ? 'Saving...' : 'Confirm reviewed metadata'}</button></div>;
              })}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-sm font-bold text-slate-900">4. Calculation and approval</h2>
              <div className="mt-3 flex flex-wrap gap-2"><button data-testid="calculate-income" type="button" disabled={!canCalculate || busy !== null || Boolean(contextState?.calculation?.current)} onClick={() => void calculate()} className="rounded bg-indigo-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'CALCULATE' ? 'Calculating...' : 'Calculate'}</button><button data-testid="approve-income" type="button" disabled={!canApprove || busy !== null} onClick={() => void approve()} className="rounded bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40">{busy === 'APPROVE' ? 'Approving...' : contextState?.approval?.current ? 'Approved' : 'Approve'}</button></div>
              {contextState?.calculation ? <div className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-700"><p data-testid="combined-income"><strong>Qualifying monthly income:</strong> {formatCurrency(contextState.calculation.qualifyingMonthlyIncome)}</p>{(contextState.calculation.borrowerIncome ?? []).map((line) => <p key={line.borrowerKey} data-testid={`borrower-income-${line.borrowerKey}`}><strong>{line.role === 'PRIMARY' ? 'Primary' : 'Co-borrower'} {line.borrowerKey}:</strong> {formatCurrency(line.qualifyingMonthlyIncome)}</p>)}<p><strong>Trend:</strong> {contextState.calculation.trendingResult}</p><p><strong>Years:</strong> {contextState.calculation.yearsAnalyzed.join(', ')}</p>{calculationWarnings.length ? <ul className="mt-2 list-disc pl-4 text-amber-800">{calculationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}{!contextState.calculation.current && !contextState.approval?.current ? <p className="mt-1 font-medium text-red-700">This calculation is stale. Recalculate before approval.</p> : null}</div> : null}
              {contextState?.approval?.current ? <div data-testid="approved-income-exports" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-900">Approved calculation downloads</p><div className="mt-2 flex flex-wrap gap-2"><a data-testid="download-approved-json" download href={portalClient.approvedIncomeExportUrl(contextState.loan.id, 'json')} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">JSON</a><a data-testid="download-approved-mismo" download href={portalClient.approvedIncomeExportUrl(contextState.loan.id, 'mismo')} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">MISMO XML</a><a data-testid="download-approved-summary" download href={portalClient.approvedIncomeExportUrl(contextState.loan.id, 'summary')} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">Summary PDF</a></div><p className="mt-2 text-[11px] text-emerald-900">All three files come from the same approved snapshot. MISMO uses the declared FreeFlow 3.4 implementation profile; official MISMO XSD validation is not performed because the official schema bundle is not included.</p></div> : null}
            </div>

            {consoleRuntime.hosted ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><h2 className="text-sm font-bold text-slate-900">5. Encompass host write</h2><p className="mt-2 text-xs text-amber-900">Hosted writeback is disabled until FreeFlow can independently verify every written field server-side. Existing client-reported completion records are not treated as certified readback.</p><button data-testid="write-host" type="button" disabled className="mt-3 rounded bg-slate-500 px-3.5 py-2 text-xs font-bold text-white opacity-60">Writeback unavailable</button></div> : null}
          </section>
        </div>
        )}

        <footer className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">{contextState ? `Loan ${contextState.loan.id} / version ${contextState.loan.version} / ${contextState.loan.program}${contextState.loan.borrowerName ? ` / ${contextState.loan.borrowerName}` : ''}` : contextError ?? 'Loading authoritative context...'}</footer>
      </div>
    </main>
  );
}

function StandaloneLoanIntake({ onCreated, onBack }: {
  onCreated: (loanId: string) => Promise<void>;
  onBack: () => void;
}) {
  const [loanProgram, setLoanProgram] = useState<StandaloneLoanRequest['loanProgram']>('CONVENTIONAL');
  const [borrowerCount, setBorrowerCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingSubmission = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const submit = async (payload: StandaloneLoanRequest) => {
    setBusy(true); setError(null);
    const fingerprint = JSON.stringify(payload);
    const idempotencyKey = pendingSubmission.current?.fingerprint === fingerprint
      ? pendingSubmission.current.idempotencyKey
      : crypto.randomUUID();
    pendingSubmission.current = { fingerprint, idempotencyKey };
    try {
      const created = await portalClient.createStandaloneLoan(payload, idempotencyKey);
      await onCreated(created.loanId);
      pendingSubmission.current = null;
    } catch (cause) {
      setError(describeError(cause, 'The standalone loan could not be created.'));
    } finally {
      setBusy(false);
    }
  };
  const manualPayload = (): StandaloneLoanRequest => ({
    schemaVersion: 'freeflow-standalone-loan-v1',
    loanProgram,
    borrowers: Array.from({ length: borrowerCount }, (_, ordinal) => ({
      borrowerKey: `borrower-${ordinal + 1}`,
      role: ordinal === 0 ? 'PRIMARY' : 'CO_BORROWER',
    })),
  });
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 16 * 1024 || (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json')) {
      setError('Use a FreeFlow standalone JSON file up to 16 KiB.');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as StandaloneLoanRequest;
      await submit(parsed);
    } catch (cause) {
      if (cause instanceof SyntaxError) setError('The standalone loan file is not valid JSON.');
      else throw cause;
    }
  };

  return <main className="mx-auto max-w-3xl px-6 py-12" data-testid="standalone-loan-intake"><div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between gap-3"><div><BrandLogo compact /><h1 className="mt-4 text-xl font-bold text-slate-950">Start a standalone income analysis</h1><p className="mt-2 text-sm text-slate-600">No Encompass, ICE, or external LOS connection is required.</p></div><button type="button" onClick={onBack} className="rounded border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Back</button></div>{error ? <div role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}<form className="mt-6 grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(manualPayload()); }}><label className="text-sm font-medium text-slate-800">Loan program<select data-testid="standalone-program" value={loanProgram} onChange={(event) => setLoanProgram(event.target.value as StandaloneLoanRequest['loanProgram'])} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"><option value="CONVENTIONAL">Conventional</option><option value="FHA">FHA</option><option value="VA">VA</option></select></label><label className="text-sm font-medium text-slate-800">Borrowers<select data-testid="standalone-borrower-count" value={borrowerCount} onChange={(event) => setBorrowerCount(Number(event.target.value))} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2">{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count}</option>)}</select></label><button data-testid="create-standalone-loan" type="submit" disabled={busy} className="rounded bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Creating...' : 'Create loan'}</button></form><div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or import a supported file<span className="h-px flex-1 bg-slate-200" /></div><label className="block text-sm font-medium text-slate-800">FreeFlow standalone JSON v1<input data-testid="import-standalone-loan" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} className="mt-2 block w-full text-xs" /></label><p className="mt-3 text-xs text-slate-500">The versioned file contains only loan program and stable borrower slots. Add supporting PDFs after the tenant-authorized loan is created.</p></div></main>;
}

function ProtectedIncomeDemo({ onBack, fixtureDocumentPrefix = '/fixtures/docs' }: { onBack: () => void; fixtureDocumentPrefix?: string }) {
  const [documents, setDocuments] = useState<LiveDocument[]>([]);
  const documentsRef = useRef<LiveDocument[]>([]);
  const [showLive, setShowLive] = useState(false);
  const [parseBusy, setParseBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const parsePdfs = async (files: File[]) => {
    if (!files.length) return;
    setParseBusy(true);
    setParseError(null);
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          errors.push(`${file.name} is not a PDF.`);
          continue;
        }
        if (file.size > MAX_DOCUMENT_BYTES) {
          errors.push(`${file.name} exceeds the 40 MiB limit.`);
          continue;
        }
        try {
          const [sha256, result] = await Promise.all([
            sha256File(file),
            portalClient.previewIncomeDocument(file) as Promise<ParseResponse>,
          ]);
          const duplicate = findDuplicate(documentsRef.current, { sha256, fileName: file.name, result });
          if (duplicate) {
            errors.push(duplicate.reason);
            continue;
          }
          const next: LiveDocument = { id: crypto.randomUUID(), sha256, file, fileName: file.name, result };
          documentsRef.current = [...documentsRef.current, next];
          setDocuments(documentsRef.current);
          setShowLive(true);
        } catch (error) {
          errors.push(describeError(error, `Unable to process ${file.name}.`));
        }
      }
    } finally {
      setParseBusy(false);
      if (errors.length) setParseError([...new Set(errors)].join(' Â· '));
    }
  };

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6" data-testid="protected-income-demo">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-indigo-950">Income Intelligence · original synthetic demonstration</p>
          <p className="text-xs text-indigo-800">Comparison mode only. Your PDFs are parsed in memory for page-and-box review; they are not persisted, assigned to a borrower, approved, or sent to the connector or Encompass.</p>
        </div>
        <button data-testid="demo-back-to-products" type="button" onClick={onBack} className="rounded border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-900">Back to products</button>
      </div>
      <div className="h-[calc(100vh-8rem)] min-h-[780px]">
        <UnderwriterSplitViewDemo
          source={showLive && documents.length ? 'live' : 'demo'}
          liveDocuments={documents}
          parseBusy={parseBusy}
          parseError={parseError}
          onParseFiles={(files) => void parsePdfs(files)}
          onUseDemo={() => setShowLive(false)}
          onUseLive={() => setShowLive(true)}
          fixtureDocumentPrefix={fixtureDocumentPrefix}
        />
      </div>
    </main>
  );
}

function ProtectedProductDemo({ view, enabled, onBack }: { view: 'intake' | 'appraisal'; enabled: boolean; onBack: () => void }) {
  if (!enabled) return <ProtectedProductUnavailable onBack={onBack} />;
  const title = view === 'intake' ? 'AI 1003' : 'Appraisal Review';
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-5 md:px-6" data-testid="protected-product-demo">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-amber-950">{title} · synthetic freeflow-dev demonstration</p>
          <p className="text-xs text-amber-800">Use synthetic data only. No lender, CRM, ICE, or Encompass delivery occurs from this surface.</p>
        </div>
        <button type="button" onClick={onBack} className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900">Back to products</button>
      </div>
      {view === 'intake' ? <Conversational1003 syntheticDemo /> : <AppraisalReviewWorkspace syntheticDemo />}
    </main>
  );
}

function ProtectedProductUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16" data-testid="protected-product-unavailable">
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
        <h1 className="text-lg font-bold">This protected product demo is not enabled.</h1>
        <p className="mt-2 text-sm">The environment must explicitly enable the synthetic freeflow-dev demo. No fallback workflow or external delivery was attempted.</p>
        <button type="button" onClick={onBack} className="mt-4 rounded bg-amber-900 px-4 py-2 text-xs font-bold text-white">Back to products</button>
      </div>
    </main>
  );
}

function ReviewField({ item, borrowers, value, onChange }: { item: MetadataRequirement; borrowers: readonly { borrowerKey: string; role: 'PRIMARY' | 'CO_BORROWER' }[]; value: string; onChange: (value: string) => void }) {
  const selectClass = 'mt-1 block w-full rounded border border-slate-300 bg-white p-2';
  return <label className="mb-2 block text-xs font-medium text-slate-700">{item.form} / {item.entityId} / {item.field}{item.field === 'employmentRole' ? <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}><option value="">Select reviewed role</option>{EMPLOYMENT_ROLES.map((role) => <option key={role}>{role}</option>)}</select> : item.field === 'borrowerAssignment' ? <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}><option value="">Assign borrower</option>{borrowers.map((borrower) => <option key={borrower.borrowerKey} value={borrower.borrowerKey}>{borrower.role === 'PRIMARY' ? 'Primary' : 'Co-borrower'} {borrower.borrowerKey}</option>)}</select> : item.field === 'assetElection' ? <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}><option value="">Asset election</option><option value="INCLUDE">Include in qualifying income</option><option value="EXCLUDE">Exclude from qualifying income</option></select> : item.field === 'payFrequency' ? <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}><option value="">Pay frequency</option>{PAY_FREQUENCIES.map((frequency) => <option key={frequency}>{frequency}</option>)}</select> : item.field === 'baseIncomeMethod' ? <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}><option value="">Base method</option>{BASE_METHODS.map((method) => <option key={method}>{method}</option>)}</select> : item.field === 'requiredParserField' ? <span className="mt-1 block rounded bg-red-50 p-2 text-red-700">The persisted extraction lacks a required parser field and cannot be repaired in the browser.</span> : item.field === 'unsupportedCalculation' ? <span className="mt-1 block rounded bg-amber-50 p-2 text-amber-800">This document was extracted for review, but it is not yet an authoritative calculation input. The controlled-pilot calculation remains blocked for this extraction.</span> : <input type="number" step={item.field === 'elapsedMonths' ? '0.1' : '1'} min={item.field === 'taxYear' ? 1990 : 0} max={item.field === 'taxYear' ? 2100 : item.field === 'elapsedMonths' ? 12 : 100} value={value} onChange={(event) => onChange(event.target.value)} className={selectClass} />}</label>;
}

function requirementKey(value: MetadataRequirement): string { return `${value.extractionId}:${value.entityId}:${value.field}`; }
function describeError(error: unknown, fallback: string): string {
  return describeProtectedError(error, fallback);
}
function formatCurrency(value: string | number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : 'Unavailable';
}
