'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronsUpDown, Search, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import { pop } from '@/lib/motion';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Secondary line (file name, id ...) searched together with the label */
  hint?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}

/** Highlights the part of `text` that matches the query. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-amber-100 px-0.5 text-ink">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * One field that is both the picker and the search: click it and type, and the list narrows on every keystroke.
 * Arrow keys move, Enter picks, Escape closes. The selected option shows as the field's value when it is closed.
 */
export function Combobox({ options, value, onChange, placeholder = 'Select...', emptyText = 'No matches', className, disabled }: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    const words = q.split(/\s+/);
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  React.useEffect(() => setActive(0), [query, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (option: ComboboxOption) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border bg-paper px-3 shadow-soft transition-[border-color,box-shadow] duration-150',
          open ? 'border-navy-500 shadow-glow' : 'border-surface-strong hover:border-slate-400',
          disabled && 'pointer-events-none opacity-60',
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? query : selected?.label ?? ''}
          placeholder={open && selected ? selected.label : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-slate-400"
        />
        {value && !open ? (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            variants={pop}
            initial="hidden"
            animate="show"
            exit="exit"
            className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-surface-border bg-paper shadow-panel"
          >
            <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-slate-500">{emptyText}</li>
              ) : (
                results.map((o, i) => (
                  <li
                    key={o.value}
                    role="option"
                    data-index={i}
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(o)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors duration-100',
                      i === active ? 'bg-slate-100' : '',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">
                        <Highlight text={o.label} query={query} />
                      </div>
                      {o.hint ? (
                        <div className="truncate text-xs text-slate-500">
                          <Highlight text={o.hint} query={query} />
                        </div>
                      ) : null}
                    </div>
                    {o.value === value ? <Check className="h-4 w-4 shrink-0 text-ink" /> : null}
                  </li>
                ))
              )}
            </ul>
            {options.length > 8 ? (
              <div className="border-t border-surface-border px-3 py-1.5 text-2xs text-slate-400">
                {results.length} of {options.length}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
