'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** A number shown at the right of the row (for example how many CVs are in the category). */
  count?: number;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Shown when nothing is ticked (and meaning "everything"), for example "All categories". */
  allLabel: string;
  /** Plural noun for the summary, for example "categories": "3 categories". */
  noun: string;
  className?: string;
}

/**
 * A dropdown with a tick box per row. Nothing ticked means "all". It shows the first choices as chips when it is closed,
 * a search box when there are many options, and Select all / Clear at the top of the list.
 */
export function MultiSelect({ options, value, onChange, allLabel, noun, className }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'field-input flex min-h-[40px] w-full items-center justify-between gap-2 text-left',
          open && 'border-navy-400 shadow-glow',
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {value.length === 0 ? (
            <span className="truncate text-slate-700">{allLabel}</span>
          ) : value.length <= 2 ? (
            value.map((v) => (
              <span key={v} className="inline-flex max-w-[160px] items-center truncate rounded-md bg-navy-50 px-1.5 py-0.5 text-xs font-medium text-navy-700">
                <span className="truncate">{labelOf(v)}</span>
              </span>
            ))
          ) : (
            <span className="truncate font-medium text-slate-800">
              {value.length} {noun} selected
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-xl border border-surface-border bg-paper shadow-[0_16px_40px_-12px_rgba(16,24,40,0.22)]">
          {options.length > 7 && (
            <div className="relative border-b border-surface-border p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${noun}…`}
                className="h-9 w-full rounded-lg bg-slate-50 pl-8 pr-8 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-paper focus:outline-none focus:ring-2 focus:ring-navy-500/20"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-b border-surface-border px-3 py-2 text-xs">
            <span className="text-slate-500">{value.length === 0 ? `All ${noun}` : `${value.length} selected`}</span>
            <span className="flex items-center gap-3 font-semibold">
              <button type="button" onClick={() => onChange(options.map((o) => o.value))} className="text-navy-600 hover:underline">
                Select all
              </button>
              <button type="button" onClick={() => onChange([])} className="text-slate-500 hover:text-slate-800 hover:underline">
                Clear
              </button>
            </span>
          </div>

          <ul role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No {noun} match</li>
            ) : (
              filtered.map((o) => {
                const on = selected.has(o.value);
                return (
                  <li key={o.value} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        on ? 'bg-navy-50/70 text-navy-800' : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          on ? 'border-navy-600 bg-solid-soft text-white' : 'border-slate-300 bg-paper',
                        )}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {typeof o.count === 'number' && <span className="shrink-0 text-xs tabular-nums text-slate-400">{o.count.toLocaleString()}</span>}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
