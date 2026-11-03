'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}

/** Segmented control. The selected pill glides to the new choice rather than jumping. */
export function Segmented<T extends string>({ value, onChange, items, className, size = 'md' }: SegmentedProps<T>) {
  const group = React.useId();
  return (
    <div role="tablist" className={cn('inline-flex gap-0.5 rounded-lg bg-slate-100/80 p-0.5', className)}>
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
              'relative rounded-md font-semibold transition-colors duration-150',
              size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-3.5 text-sm',
              selected ? 'text-navy-700' : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`segmented-${group}`}
                transition={spring.snappy}
                className="absolute inset-0 rounded-md bg-paper shadow-soft ring-1 ring-surface-border"
              />
            ) : null}
            <span className="relative">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
