'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: React.ReactNode; icon?: React.ReactNode; count?: number }[];
  className?: string;
  size?: 'sm' | 'md';
  /** Stretch the items to fill the width */
  full?: boolean;
}

/** Segmented control. The selected pill glides to the new choice rather than jumping. */
export function Segmented<T extends string>({ value, onChange, items, className, size = 'md', full }: SegmentedProps<T>) {
  const group = React.useId();
  return (
    <div role="tablist" className={cn('inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5 ring-1 ring-inset ring-slate-200/60', full && 'flex w-full', className)}>
      {items.map((item) => {
        const selected = value === item.value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition-colors duration-150 [&_svg]:size-3.5',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              full && 'flex-1',
              selected ? 'text-navy-900' : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`segmented-${group}`}
                transition={spring.snappy}
                className="absolute inset-0 rounded-md bg-paper shadow-soft ring-1 ring-slate-200/80"
              />
            ) : null}
            <span className="relative inline-flex items-center gap-1.5">
              {item.icon}
              {item.label}
              {typeof item.count === 'number' ? (
                <span className={cn('rounded-full px-1.5 text-2xs tabular-nums', selected ? 'bg-navy-50 text-navy-800' : 'bg-slate-200/70 text-slate-600')}>
                  {item.count.toLocaleString()}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
