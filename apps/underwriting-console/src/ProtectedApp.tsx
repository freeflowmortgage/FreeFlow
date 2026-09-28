import { useEffect, useState } from 'react';
import type { ConsoleView } from './appTypes';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';
import { PortalApiError, portalClient } from './api/portalClient';
import { browserEncompassHostBridge, EncompassHostError } from './encompass-host/bridge';
import { consoleRuntime } from './runtimeMode';

const unavailableActions = [
  ['Load live PDF', 'Available when the portal supplies the tenant-scoped loan and attachment context.'],
  ['Review extraction', 'Available when the portal supplies authoritative extraction and metadata-review state.'],
  ['Calculate income', 'Available when the portal supplies the authoritative extraction selection.'],
  ['Approve & Sync eFolder', 'Available when the portal supplies the reviewed calculation and approval context.'],
] as const;

export default function ProtectedApp() {
  const [requestedView, setRequestedView] = useState<ConsoleView | null>(null);
  const [contextState, setContextState] = useState<{ loan: { id: string; version: number; borrowerName: string | null }; approval: { id: string; current: boolean } | null; extractions: unknown[] } | null>(null);
  const [hostLoanGuid, setHostLoanGuid] = useState<string | null>(null);
  const [hostWriteState, setHostWriteState] = useState<'IDLE' | 'WRITING' | 'SUCCEEDED' | 'FAILED'>('IDLE');
  const [contextError, setContextError] = useState<string | null>(null);
  useEffect(() => {
    if (consoleRuntime.hosted) {
      const bridge = browserEncompassHostBridge();
      void bridge.activeLoan().then(async (host) => {
        // The host GUID is not tenant authority; the authenticated portal
        // resolves it inside the membership's tenant-scoped transaction.
        const launch = await portalClient.launchEncompassHost(host.loanGuid);
        const value: any = await portalClient.getConsoleContext(launch.loanId);
        setHostLoanGuid(host.loanGuid);
        setContextState(value);
      }).catch((error: unknown) => setContextError(error instanceof EncompassHostError ? error.message : 'Encompass host context could not be loaded.'));
      return;
    }
    const loanId = new URLSearchParams(window.location.search).get('loanId');
    if (!loanId) return;
    void portalClient.getConsoleContext(loanId).then((value: any) => setContextState(value)).catch((error: unknown) => {
      setContextError(error instanceof PortalApiError && error.status === 404 ? 'The requested loan is unavailable.' : 'Loan context could not be loaded.');
    });
  }, []);
  const writeApprovedResult = async () => {
    if (!contextState?.approval?.current || !hostLoanGuid) return;
    setHostWriteState('WRITING');
    let authorization: Awaited<ReturnType<typeof portalClient.authorizeHostWrite>> | null = null;
    try {
      authorization = await portalClient.authorizeHostWrite(contextState.loan.id, { approvalEventId: contextState.approval.id, expectedLoanVersion: contextState.loan.version }, crypto.randomUUID());
      if (authorization.status === 'SUCCEEDED') { setHostWriteState('SUCCEEDED'); return; }
      if (authorization.encompassLoanGuid !== hostLoanGuid) throw new EncompassHostError('ENCOMPASS_LOAN_CONTEXT_CHANGED', 'The active Encompass loan no longer matches this FreeFlow workflow.');
      await browserEncompassHostBridge().writeApprovedResult(hostLoanGuid, authorization.fields);
      await portalClient.completeHostWrite(authorization.writeId, { fieldMapHash: authorization.fieldMapHash, outcome: 'SUCCEEDED' }, crypto.randomUUID());
      setHostWriteState('SUCCEEDED');
    } catch {
      if (authorization) await portalClient.completeHostWrite(authorization.writeId, { fieldMapHash: authorization.fieldMapHash, outcome: 'FAILED' }, crypto.randomUUID()).catch(() => undefined);
      setHostWriteState('FAILED');
    }
  };
  if (!requestedView) return <B2BLanding onOpenService={setRequestedView} />;
  return (
    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3"><BrandLogo compact /><span className="text-sm font-bold text-slate-900">Income</span></div>
          <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Protected</span>
        </div>
        <div className="grid gap-4 p-6 md:grid-cols-2">
          {unavailableActions.map(([label, reason]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <button type="button" disabled className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-500" title={reason}>{label}</button>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{reason}</p>
            </div>
          ))}
        </div>
        {consoleRuntime.hosted && contextState?.approval?.current ? (
          <div className="border-t border-slate-200 px-6 py-4">
            <button type="button" disabled={hostWriteState === 'WRITING' || hostWriteState === 'SUCCEEDED'} onClick={() => void writeApprovedResult()} className="rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50">
              {hostWriteState === 'WRITING' ? 'Writing approved result…' : hostWriteState === 'SUCCEEDED' ? 'Approved result written' : 'Write approved result to Encompass'}
            </button>
            {hostWriteState === 'FAILED' ? <p className="mt-2 text-xs text-red-700">The hosted write was not confirmed. Reload the active loan before retrying.</p> : null}
          </div>
        ) : null}
        <p className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          {contextState ? `Authoritative context loaded${contextState.loan.borrowerName ? ` for ${contextState.loan.borrowerName}` : ''} · version ${contextState.loan.version}.` : contextError ?? 'Open this workspace from the protected portal with an authorized loan context. Synthetic documents and local demo scenarios are not available in this mode.'}
        </p>
      </div>
    </main>
  );
}
