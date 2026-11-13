'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';

export type Send = (text: string) => void;

const TINTS = [
  'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-indigo-100 text-indigo-700',
];

/** A soft coloured circle with initials; the colour comes from the name so a person always looks the same. */
export function Initials({ name, size = 36 }: { name: string; size?: number }) {
  const clean = (name || '?').trim();
  const hash = Array.from(clean).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const letters = clean.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', TINTS[hash % TINTS.length])}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {letters}
    </span>
  );
}

/** The frame every result card shares: a title, a count, and rows that arrive one after another. */
export function CardShell({ title, count, children, footer, flush = false }: { title: string; count?: string; children: ReactNode; footer?: ReactNode; flush?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease }}
      className="overflow-hidden rounded-2xl border border-slate-200/70 bg-paper/85 shadow-[0_10px_32px_-18px_rgba(30,50,96,0.35)] backdrop-blur"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        {count ? <span className="text-2xs tabular-nums text-slate-400">{count}</span> : null}
      </div>
      {children}
      {footer ? (flush ? <>{footer}</> : <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">{footer}</div>) : null}
    </motion.div>
  );
}

export function Row({ index, children }: { index: number; children: ReactNode }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.26, ease, delay: Math.min(index, 10) * 0.04 }}
      className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
    >
      {children}
    </motion.li>
  );
}

/** A small action under a row. It sends a ready-made message, so the next step is one click. */
export function Action({ label, onClick, tone = 'quiet' }: { label: string; onClick: () => void; tone?: 'quiet' | 'primary' }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors',
        tone === 'primary' ? 'bg-solid text-white hover:bg-solid-hover' : 'border border-slate-200 bg-paper text-slate-700 hover:bg-slate-50')}>
      {label}
    </button>
  );
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'navy' | 'amber' }) {
  const tones = { slate: 'bg-slate-100 text-slate-600', green: 'bg-emerald-50 text-emerald-700', navy: 'bg-navy-50 text-navy-800', amber: 'bg-amber-50 text-amber-800' };
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium', tones[tone])}>{children}</span>;
}

export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <motion.div className="h-full rounded-full bg-solid-soft" initial={{ width: 0 }} animate={{ width: `${v}%` }} transition={{ duration: 0.8, ease }} />
    </div>
  );
}

export function dash(value: unknown): string {
  return value === null || value === undefined || value === '' ? '-' : String(value);
}
