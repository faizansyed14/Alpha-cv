'use client';
import type { ReactNode } from 'react';

/**
 * While a search or a filter runs on the server.
 * - `SearchingPanel`: nothing to show yet: a header with a running bar and candidate-card placeholders with a light sweeping across.
 * - `RefreshingList`: results are already on screen: they stay (faded, not clickable) under a floating "Applying filters" pill until
 *   the new ones arrive, so the page never jumps to an empty state and back.
 */
export function SearchingPanel({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card">
        <div className="flex items-start gap-3 px-5 pb-3 pt-4">
          <Pulse />
          <div className="min-w-0">
            <p className="text-md font-semibold tracking-[-0.01em] text-slate-900">{title}</p>
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          </div>
        </div>
        <div className="search-track"><div className="search-bar" /></div>
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="search-sheen relative flex gap-3.5 overflow-hidden rounded-2xl border border-surface-border bg-paper p-5"
          style={{ animationDelay: `${i * 140}ms`, opacity: 1 - i * 0.18 }}>
          <div className="h-12 w-12 shrink-0 rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="h-3.5 w-1/3 rounded bg-slate-100" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
            <div className="flex gap-2 pt-1">
              <div className="h-5 w-16 rounded-full bg-slate-100" />
              <div className="h-5 w-20 rounded-full bg-slate-100" />
              <div className="h-5 w-14 rounded-full bg-slate-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function RefreshingList({ busy, label, children }: { busy: boolean; label: string; children: ReactNode }) {
  return (
    <div className="relative" aria-busy={busy}>
      {busy && (
        <div className="pointer-events-none sticky top-3 z-20 -mb-9 flex h-9 justify-center" role="status" aria-live="polite">
          <div className="flex items-center gap-2.5 overflow-hidden rounded-full bg-white/95 py-1.5 pl-2 pr-3.5 text-xs font-semibold text-slate-700 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80 backdrop-blur pill-in">
            <Pulse small />
            {label}
          </div>
        </div>
      )}
      <div className={`transition-[opacity,filter] duration-300 ${busy ? 'pointer-events-none select-none opacity-50 saturate-50' : 'opacity-100'}`}>
        {children}
      </div>
    </div>
  );
}

/** A navy ring that turns, with a soft halo: the "working" mark of both. */
function Pulse({ small = false }: { small?: boolean }) {
  const size = small ? 'h-5 w-5' : 'h-9 w-9';
  return (
    <span className={`relative flex ${size} shrink-0 items-center justify-center`} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-navy-100/70 motion-safe:animate-ping [animation-duration:1.8s]" />
      <span className={`relative ${small ? 'h-3.5 w-3.5 border-2' : 'h-5 w-5 border-[2.5px]'} rounded-full border-navy-100 border-t-navy-700 motion-safe:animate-spin`} />
    </span>
  );
}
