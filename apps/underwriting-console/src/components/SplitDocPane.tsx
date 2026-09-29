import { useEffect, useRef, useState } from 'react';
import { Layers, MonitorX } from 'lucide-react';
import { DemoDocumentCanvas, InspectNote } from './selfEmployedIncome';
import PdfDocumentViewer from './PdfDocumentViewer';
import { SPLIT_DOC_CHANNEL, type DocPaneSnapshot, type SplitDocMessage } from '../splitDocSync';

/**
 * Full-window document canvas for dual-monitor underwriting / QA review.
 * Opened by the main workspace via "Dual monitor" — receives live state
 * snapshots over a BroadcastChannel and sends interaction events back, so
 * both windows stay in sync (field highlights, year switches, PDF paging).
 */
export default function SplitDocPane() {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [snapshot, setSnapshot] = useState<DocPaneSnapshot | null>(null);
  // Stable File reference: each snapshot carries a fresh structured-clone of the
  // File, but pdf.js should only re-parse when the underlying document changes.
  const stableFileRef = useRef<{ key: string; file: File } | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel(SPLIT_DOC_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent<SplitDocMessage>) => {
      const msg = event.data;
      if (msg.type === 'snapshot') {
        if (msg.snapshot.live) {
          // The workspace only attaches the File when it changes; keep the last one otherwise
          const incoming = msg.snapshot.live.file;
          if (incoming) {
            const key = `${incoming.name}-${incoming.size}-${incoming.lastModified}`;
            if (stableFileRef.current?.key !== key) stableFileRef.current = { key, file: incoming };
          }
        } else {
          stableFileRef.current = null;
        }
        setSnapshot(msg.snapshot);
      }
      if (msg.type === 'close-doc') window.close();
    };

    channel.postMessage({ type: 'doc-ready' } satisfies SplitDocMessage);

    const onUnload = () => channel.postMessage({ type: 'doc-closed' } satisfies SplitDocMessage);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const send = (msg: SplitDocMessage) => channelRef.current?.postMessage(msg);

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-800">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-indigo-600" />
          <div>
            <h1 className="text-sm font-extrabold text-slate-900">Document Canvas · Dual-Monitor Pane</h1>
            <p className="text-[11px] text-slate-500">
              {snapshot
                ? `Loan ${snapshot.loanId} · ${snapshot.borrowerName} · synced with the main workspace window`
                : 'Waiting for the main workspace window…'}
            </p>
          </div>
        </div>
        {snapshot && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase text-emerald-800">
            Live sync
          </span>
        )}
      </header>

      <main className="mx-auto max-w-4xl p-5">
        {!snapshot ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
            <MonitorX className="h-10 w-10" />
            <p className="text-sm font-semibold">
              No workspace connected. Open the Income workspace and click “Dual monitor”.
            </p>
          </div>
        ) : snapshot.mode === 'live' && snapshot.live ? (
          stableFileRef.current ? (
            <PdfDocumentViewer
              file={stableFileRef.current.file}
              pageIndex={snapshot.live.pageIndex}
              pageCount={snapshot.live.pageCount}
              fields={snapshot.live.fields}
              selectedFieldId={snapshot.selectedId}
              highlight={snapshot.live.highlight ?? null}
              onSelectField={(id) => send({ type: 'select-field', id })}
              onPageChange={(index) => send({ type: 'page-change', index })}
            />
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
              The live PDF ({snapshot.live.fileName}) could not be transferred to this window. Keep the PDF in the
              main window, or reload it there to retry.
            </div>
          )
        ) : (
          <div className="space-y-3">
            <DemoDocumentCanvas
              tab={snapshot.activeTab}
              yearIndex={snapshot.yearIndex}
              onYearIndex={(index) => send({ type: 'year-index', index })}
              twoYear={snapshot.twoYear}
              selectedId={snapshot.selectedId}
              onSelect={(id) => send({ type: 'select-field', id })}
              schC={snapshot.schC}
              corp={snapshot.corp}
              scheduleL={snapshot.scheduleL}
              showLiquidity={snapshot.showLiquidity}
              paystub={snapshot.paystub}
              fillHeight
            />
            <InspectNote />
          </div>
        )}
      </main>
    </div>
  );
}
