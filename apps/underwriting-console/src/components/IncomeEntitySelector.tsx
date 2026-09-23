import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, ChevronDown, PlusCircle, Trash2 } from 'lucide-react';

export type IncomeEntityOption = {
  id: string;
  name: string;
  ein?: string;
  detail?: string;
};

type MenuBox = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

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
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const placeMenu = () => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - margin * 2);
    let left = rect.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if (left < margin) left = margin;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(96, Math.min(240, (openUp ? spaceAbove : spaceBelow) - 4));
    setMenuBox(
      openUp
        ? { bottom: window.innerHeight - rect.top + 4, left, width, maxHeight }
        : { top: rect.bottom + 4, left, width, maxHeight },
    );
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onLayout = () => placeMenu();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[data-entity-menu="${listId}"]`)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, listId]);

  const activeLabel = active
    ? `${active.name}${active.ein ? ` · EIN ${active.ein}` : ''}${active.detail ? ` · ${active.detail}` : ''}`
    : 'Select';

  return (
    <div ref={rootRef} className="flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-800">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onAdd}
            className="flex items-center gap-1 rounded-lg border border-indigo-300 bg-white px-2.5 py-1.5 text-[10px] font-black uppercase text-indigo-700 hover:bg-indigo-100"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Add
          </button>
          {onRemove && active && entities.length > 1 ? (
            <button
              type="button"
              onClick={() => onRemove(active.id)}
              className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-500 hover:bg-rose-50"
              title={`Remove ${active.name}`}
              aria-label={`Remove ${active.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-left text-xs font-bold text-slate-900 outline-none focus:border-indigo-500"
      >
        <span className="truncate">{activeLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuBox
        ? createPortal(
            <ul
              id={listId}
              data-entity-menu={listId}
              role="listbox"
              aria-label={label}
              style={{ top: menuBox.top, bottom: menuBox.bottom, left: menuBox.left, width: menuBox.width, maxHeight: menuBox.maxHeight }}
              className="fixed z-[80] overflow-y-auto rounded-lg border border-indigo-200 bg-white py-1 shadow-lg"
            >
              {entities.map((entity) => {
                const selected = entity.id === active?.id;
                const text = `${entity.name}${entity.ein ? ` · EIN ${entity.ein}` : ''}${entity.detail ? ` · ${entity.detail}` : ''}`;
                return (
                  <li key={entity.id} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(entity.id);
                        setOpen(false);
                      }}
                      className={`block w-full truncate px-3 py-2 text-left text-xs font-semibold ${
                        selected ? 'bg-indigo-50 text-indigo-900' : 'text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {text}
                    </button>
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
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
