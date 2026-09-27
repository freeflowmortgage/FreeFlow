import { useState } from 'react';
import type { ConsoleView } from './appTypes';
import B2BLanding from './components/B2BLanding';
import BrandLogo from './components/BrandLogo';

const unavailableActions = [
  ['Load live PDF', 'Available when the portal supplies the tenant-scoped loan and attachment context.'],
  ['Review extraction', 'Available when the portal supplies authoritative extraction and metadata-review state.'],
  ['Calculate income', 'Available when the portal supplies the authoritative extraction selection.'],
  ['Approve & Sync eFolder', 'Available when the portal supplies the reviewed calculation and approval context.'],
] as const;

export default function ProtectedApp() {
  const [requestedView, setRequestedView] = useState<ConsoleView | null>(null);
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
        <p className="border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          Select a loan from the protected portal workflow to load authoritative review data. Synthetic documents and local demo scenarios are not available in this mode.
        </p>
      </div>
    </main>
  );
}
