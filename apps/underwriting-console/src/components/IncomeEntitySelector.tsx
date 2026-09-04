import { Building2, PlusCircle, Trash2 } from 'lucide-react';

export type IncomeEntityOption = {
  id: string;
  name: string;
  ein?: string;
  detail?: string;
};

export function IncomeEntitySelector({
  label,
  entities,
  activeId,
  onSelect,
  onAdd,
  onRemove,
  onUpdate,
}: {
  label: string;
  entities: IncomeEntityOption[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove?: (id: string) => void;
  onUpdate?: (id: string, patch: { name?: string; ein?: string }) => void;
}) {
  const active = entities.find((entity) => entity.id === activeId) ?? entities[0];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3">
      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-800">
        <Building2 className="h-3.5 w-3.5" />
        {label}
      </span>
      <select
        value={active?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
        className="min-w-[260px] flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
        aria-label={label}
      >
        {entities.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name}
            {entity.ein ? ` · EIN ${entity.ein}` : ''}
            {entity.detail ? ` · ${entity.detail}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-3 py-2 text-[10px] font-black uppercase text-indigo-700 hover:bg-indigo-100"
      >
        <PlusCircle className="h-3.5 w-3.5" />
        Add
      </button>
      {onRemove && active && entities.length > 1 ? (
        <button
          type="button"
          onClick={() => onRemove(active.id)}
          className="rounded-lg border border-rose-200 bg-white p-2 text-rose-500 hover:bg-rose-50"
          title={`Remove ${active.name}`}
          aria-label={`Remove ${active.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {onUpdate && active ? (
        <div className="grid w-full grid-cols-1 gap-2 border-t border-indigo-200 pt-2 sm:grid-cols-2">
          <label className="text-[9px] font-black uppercase tracking-wider text-indigo-700">
            Entity name
            <input
              value={active.name}
              onChange={(event) => onUpdate(active.id, { name: event.target.value })}
              className="mt-1 w-full rounded border border-indigo-200 bg-white px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-slate-900"
            />
          </label>
          <label className="text-[9px] font-black uppercase tracking-wider text-indigo-700">
            EIN
            <input
              value={active.ein ?? ''}
              onChange={(event) => onUpdate(active.id, { ein: event.target.value })}
              placeholder="XX-XXXXXXX"
              className="mt-1 w-full rounded border border-indigo-200 bg-white px-2 py-1.5 font-mono text-xs font-semibold normal-case tracking-normal text-slate-900"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
