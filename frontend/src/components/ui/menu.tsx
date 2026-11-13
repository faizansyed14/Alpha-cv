'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
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
 * Dropdown for overflow row actions. Portaled to document.body so parent
 * overflow-hidden (job lists, sheets) never clips it.
 */
export function Menu({ trigger, items, align = 'end', className }: MenuProps) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ top: number; left: number; up: boolean } | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const shown = items.filter(Boolean) as MenuItem[];

  const close = React.useCallback((refocus = false) => {
    setOpen(false);
    setCoords(null);
    if (refocus) button.current?.focus();
  }, []);

  const place = React.useCallback(() => {
    if (!button.current) return;
    const rect = button.current.getBoundingClientRect();
    const menuW = Math.max(210, list.current?.offsetWidth ?? 210);
    const menuH = list.current?.offsetHeight ?? shown.length * 32 + 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom;
    const up = spaceBelow < menuH + gap && rect.top > spaceBelow;
    let left = align === 'end' ? rect.right - menuW : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - menuW - 8);
    const top = up ? rect.top - gap : rect.bottom + gap;
    setCoords({ top, left, up });
  }, [align, shown.length]);

  React.useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (root.current?.contains(t) || list.current?.contains(t)) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
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
    if (open) {
      close();
      return;
    }
    if (button.current) {
      const rect = button.current.getBoundingClientRect();
      const menuW = 220;
      const menuH = shown.length * 32 + 12;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom;
      const up = spaceBelow < menuH + gap && rect.top > spaceBelow;
      let left = align === 'end' ? rect.right - menuW : rect.left;
      left = Math.min(Math.max(8, left), window.innerWidth - menuW - 8);
      setCoords({ top: up ? rect.top - gap : rect.bottom + gap, left, up });
    }
    setOpen(true);
  };

  const panel =
    open && coords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={list}
            role="menu"
            style={{
              position: 'fixed',
              top: coords.up ? undefined : coords.top,
              bottom: coords.up ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              zIndex: 80,
              // never taller than the room there is: a long list scrolls inside the menu instead of running off the screen
              maxHeight: coords.up ? coords.top - 8 : window.innerHeight - coords.top - 8,
            }}
            className="min-w-[200px] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-paper p-1 shadow-panel"
          >
            {shown.map((item) => (
              <React.Fragment key={item.label}>
                {item.separated && <div className="my-0.5 h-px bg-surface-border" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                    'focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-3.5 [&_svg]:shrink-0',
                    item.danger
                      ? 'text-red-600 hover:bg-red-50 focus-visible:bg-red-50'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100',
                  )}
                >
                  {item.icon}
                  <span className="min-w-0">
                    <span className="block">{item.label}</span>
                    {item.hint && <span className="block text-[10.5px] font-normal leading-tight text-slate-500">{item.hint}</span>}
                  </span>
                </button>
              </React.Fragment>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={root} className={cn('relative inline-flex', className)} onClick={(e) => e.stopPropagation()}>
      {trigger({ onClick: toggle, 'aria-haspopup': 'menu', 'aria-expanded': open, ref: button })}
      {panel}
    </div>
  );
}
