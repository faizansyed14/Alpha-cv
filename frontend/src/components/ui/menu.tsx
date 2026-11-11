'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: string;
  /** A second, quieter line under the label */
  hint?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a divider above this item */
  separated?: boolean;
}

export interface MenuProps {
  /** Renders the button that opens the menu. Spread ``props`` on it. */
  trigger: (props: { onClick: (e: React.MouseEvent) => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  /** Falsy entries are skipped, so items can be listed conditionally. */
  items: Array<MenuItem | false | null | undefined>;
  align?: 'start' | 'end';
  className?: string;
}

/**
 * A small dropdown menu for the actions that do not fit in a row. Opens under its trigger (above it when there is no room
 * below), closes on Escape or a click outside, and is walked with the arrow keys.
 */
export function Menu({ trigger, items, align = 'end', className }: MenuProps) {
  const [open, setOpen] = React.useState(false);
  const [up, setUp] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const shown = items.filter(Boolean) as MenuItem[];

  const close = React.useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();          // the panel behind the menu must not close too
        e.stopPropagation();
        close(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const options = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (options.length === 0) return;
      e.preventDefault();
      const at = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === 'ArrowDown' ? (at + 1) % options.length : (at - 1 + options.length) % options.length;
      options[next].focus();
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [open, close]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      setUp(window.innerHeight - rect.bottom < shown.length * 40 + 24 && rect.top > window.innerHeight - rect.bottom);
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={root} className={cn('relative inline-flex', className)} onClick={(e) => e.stopPropagation()}>
      {trigger({ onClick: toggle, 'aria-haspopup': 'menu', 'aria-expanded': open, ref: button })}
      {open && (
        <div
          ref={list}
          role="menu"
          className={cn(
            'absolute z-40 min-w-[210px] rounded-xl border border-surface-border bg-paper p-1 shadow-[0_12px_32px_-8px_rgba(16,24,40,0.22)]',
            align === 'end' ? 'right-0' : 'left-0',
            up ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
          )}
        >
          {shown.map((item) => (
            <React.Fragment key={item.label}>
              {item.separated && <div className="my-1 h-px bg-surface-border" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                  'focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:mt-px [&_svg]:size-4 [&_svg]:shrink-0',
                  item.danger ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100',
                )}
              >
                {item.icon}
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.hint && <span className="mt-0.5 block text-[11.5px] font-normal text-slate-500">{item.hint}</span>}
                </span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
