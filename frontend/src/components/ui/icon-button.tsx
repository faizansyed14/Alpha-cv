'use client';

import * as React from 'react';
import { Loader2 } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** What the button does. Shown as the tooltip and read by screen readers, so an icon is never the only explanation. */
  label: string;
  icon: React.ReactNode;
  loading?: boolean;
  tone?: 'default' | 'danger';
  /** Which side the tooltip opens on (use "bottom" for the first row under a clipped edge). */
  tip?: 'top' | 'bottom';
}

/** A square icon-only button with a tooltip. Use it where a row has several secondary actions and labels would not fit. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, loading = false, tone = 'default', tip = 'top', className, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled || loading}
      className={cn(
        'group/ib relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-paper text-slate-600',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-glow disabled:pointer-events-none disabled:opacity-45',
        '[&_svg]:size-4',
        tone === 'danger' ? 'hover:border-red-200 hover:bg-red-50 hover:text-red-700' : 'hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : icon}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11.5px] font-medium text-white opacity-0 shadow-md',
          'transition-opacity delay-150 duration-150 group-hover/ib:opacity-100 group-focus-visible/ib:opacity-100',
          tip === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {label}
      </span>
    </button>
  ),
);
IconButton.displayName = 'IconButton';
