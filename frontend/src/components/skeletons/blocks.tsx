import React from 'react';
import { cn } from '@/lib/utils';

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

export function SkeletonRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonHeader({
  withActions = false,
  actionCount = 1,
}: {
  withActions?: boolean;
  actionCount?: number;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-2">
        <Bone className="h-7 w-44" />
        <Bone className="h-4 w-72 max-w-full" />
      </div>
      {withActions ? (
        <div className="flex gap-2">
          {Array.from({ length: actionCount }).map((_, i) => (
            <Bone key={i} className="h-9 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SkeletonStat() {
  return (
    <div className="rounded-2xl border border-surface-border bg-paper p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Bone className="h-3 w-20" />
          <Bone className="h-7 w-14" />
          <Bone className="h-3 w-24" />
        </div>
        <Bone className="h-8 w-8 rounded-md" />
      </div>
    </div>
  );
}

export function SkeletonStats({ count = 3 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${count > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStat key={i} />
      ))}
    </div>
  );
}

export function SkeletonTable({
  columns,
  rows = 6,
}: {
  columns: string[];
  rows?: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card">
      <div
        className="grid items-center gap-3 border-b border-surface-border bg-navy-50 px-4 py-2.5"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((col) => (
          <span key={col} className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {col || ''}
          </span>
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, row) => (
          <div
            key={row}
            className="grid items-center gap-3 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((col, colIndex) => (
              <Bone key={`${row}-${col}-${colIndex}`} className={colIndex === 0 && !col ? 'h-4 w-4' : 'h-4 w-4/5'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCandidateCard() {
  return (
    <div className="flex gap-3 rounded-xl border border-surface-border bg-white p-4 shadow-card">
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <Bone className="h-4 w-4 rounded" />
        <Bone className="h-6 w-6 rounded-full" />
      </div>
      <Bone className="mt-0.5 h-14 w-14 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="h-4 w-2/5" />
        <Bone className="h-3 w-3/5" />
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
          <Bone className="h-8" />
          <Bone className="h-8" />
          <Bone className="h-8" />
        </div>
        <Bone className="h-3 w-full" />
        <Bone className="h-3 w-4/5" />
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <Bone className="h-7 w-7" />
        <Bone className="h-7 w-7" />
        <Bone className="h-7 w-7" />
      </div>
    </div>
  );
}

export function SkeletonFilterRail() {
  return (
    <aside className="w-full shrink-0 sm:w-60">
      <div className="rounded-xl border border-surface-border bg-white">
        <div className="border-b border-surface-border px-4 py-3">
          <Bone className="h-4 w-16" />
        </div>
        {['Category', 'Location', 'Nationality'].map((group) => (
          <div key={group} className="space-y-2 border-b border-slate-100 px-4 py-3 last:border-b-0">
            <Bone className="h-3 w-24" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <Bone className="h-3 w-28" />
                <Bone className="h-3 w-6" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
