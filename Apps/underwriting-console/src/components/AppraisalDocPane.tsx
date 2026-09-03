import { useEffect, useRef, useState } from 'react';
import { Building, MonitorX } from 'lucide-react';
import { PdfCoordinateCanvas } from './PdfCoordinateCanvas';
import { APPRAISAL_DOC_CHANNEL, type AppraisalDocMessage, type AppraisalDocSnapshot } from '../splitDocSync';

/**
 * Full-window appraisal (URAR) canvas for dual-monitor review. Opened from the
 * Appraisal workspace via "Dual monitor"; receives canvas state over a
 * BroadcastChannel and sends page/zoom navigation back to the main window.
 */
export default function AppraisalDocPane() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [snapshot, setSnapshot] = useState<AppraisalDocSnapshot | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(APPRAISAL_DOC_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<AppraisalDocMessage>) => {
      const msg = event.data;
      if (msg.type === 'snapshot') setSnapshot(msg.snapshot);
      if (msg.type === 'close-doc') window.close();
    };

    channel.postMessage({ type: 'doc-ready' } satisfies AppraisalDocMessage);

    const onUnload = () => channel.postMessage({ type: 'doc-closed' } satisfies AppraisalDocMessage);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const nav = (action: 'next' | 'prev' | 'zoom-in' | 'zoom-out' | 'zoom-reset') =>
    channelRef.current?.postMessage({ type: 'nav', action } satisfies AppraisalDocMessage);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 font-sans text-slate-800">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <Building className="h-5 w-5 text-emerald-600" />
          <div>
            <h1 className="text-sm font-extrabold text-slate-900">Appraisal Canvas · Dual-Monitor Pane</h1>
            <p className="text-[11px] text-slate-500">
              {snapshot
                ? `Loan ${snapshot.loanId} · ${snapshot.borrower} · ${snapshot.programLabel} · synced with the Appraisal workspace`
                : 'Waiting for the Appraisal workspace window…'}
            </p>
          </div>
        </div>
        {snapshot && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase text-emerald-800">
            Live sync
          </span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {!snapshot ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
            <MonitorX className="h-10 w-10" />
            <p className="text-sm font-semibold">
              No workspace connected. Open the Appraisal workspace and click “Dual monitor”.
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <PdfCoordinateCanvas
              currentPage={snapshot.currentPage}
              zoomScale={snapshot.zoomScale}
              activeHighlight={snapshot.activeHighlight}
              totalPages={snapshot.totalPages}
              onNextPage={() => nav('next')}
              onPrevPage={() => nav('prev')}
              onZoomIn={() => nav('zoom-in')}
              onZoomOut={() => nav('zoom-out')}
              onResetZoom={() => nav('zoom-reset')}
              documentCategory={snapshot.documentCategory}
              documentType={snapshot.documentType}
              documentUrl={snapshot.documentUrl}
              mappedBoxes={snapshot.mappedBoxes}
            />
          </div>
        )}
      </main>
    </div>
  );
}
