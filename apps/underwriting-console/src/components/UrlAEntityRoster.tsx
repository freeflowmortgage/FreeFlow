import { useState } from 'react';
import { Building2, ChevronDown } from 'lucide-react';
import {
  discoveredSelectId,
  uniqueDiscoveredBusinesses,
  type LocateResult,
} from '../locateIncomeEntities';
import { rosterStatusLabel } from '../hydrateFromUrlA';

export default function UrlAEntityRoster({
  result,
  onSelect,
}: {
  result: LocateResult;
  onSelect?: (rosterId: string) => void;
}) {
  const discovered = uniqueDiscoveredBusinesses(result.discovered);
  const [open, setOpen] = useState(false);
  if (!result.roster.length && !discovered.length) return null;
  const located = result.roster.filter((row) => row.located).length;

  return (
    <section
      data-testid="urla-entity-roster"
      className="shrink-0 border-b border-slate-200 bg-white px-4 py-2"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <Building2 className="h-3.5 w-3.5" />
          {result.roster.length ? '1003 entities' : 'Entities on returns'}
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
        </span>
        {result.roster.length ? (
          <span className="text-[10px] font-bold text-indigo-700">
            {located}/{result.roster.length} located in packet
          </span>
        ) : (
          <span className="text-[10px] font-bold text-indigo-700">No 1003 businesses listed</span>
        )}
        {discovered.length ? (
          <span className="text-[10px] font-semibold text-amber-800" data-testid="undisclosed-count">
            {discovered.length} undisclosed on returns (not listed on 1003)
          </span>
        ) : null}
      </button>
      {open ? (
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {result.roster.map((row) => (
          <li key={row.entity.id}>
            <button
              type="button"
              onClick={() => onSelect?.(row.entity.id)}
              className={`rounded-full border px-2.5 py-1 text-left text-[10px] font-bold ${
                row.located
                  ? 'border-emerald-200 bg-white text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
              title={rosterStatusLabel(row)}
            >
              {row.entity.name}
              <span className="ml-1.5 font-semibold opacity-70">
                {row.entity.classification}
                {row.entity.selfEmployed ? ' · SE' : ''}
                {row.located ? '' : ' · missing'}
              </span>
            </button>
          </li>
        ))}
        {discovered.map((match) => (
          <li key={discoveredSelectId(match)}>
            <button
              type="button"
              data-testid="undisclosed-entity-chip"
              onClick={() => onSelect?.(discoveredSelectId(match))}
              className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-left text-[10px] font-bold text-amber-900"
              title={`On ${match.form} · not listed on the 1003`}
            >
              {match.name || 'Undisclosed business'}
              <span className="ml-1.5 font-semibold opacity-70">Undisclosed · {match.form}</span>
            </button>
          </li>
        ))}
      </ul>
      ) : null}
    </section>
  );
}
