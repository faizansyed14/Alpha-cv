'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { pop } from '@/lib/motion';
import type { AgentUsage } from '@/lib/types';

export function formatResetTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

export function meterTone(percent: number): { bar: string; text: string } {
  if (percent >= 100) return { bar: 'bg-rose-500', text: 'text-rose-700' };
  if (percent >= 80) return { bar: 'bg-amber-500', text: 'text-amber-700' };
  return { bar: 'bg-solid-soft', text: 'text-slate-700' };
}

/** 38,200 -> "38.2k" */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return String(n);
}

/** A thin circular gauge. Navy; it only turns red when everything is used. */
export function TokenRing({ percent, size = 28, stroke = 3.5, children }: { percent: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          className={p >= 100 ? 'stroke-rose-500' : 'stroke-navy-700'}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - p / 100) }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  );
}

/** Ask an admin to reset today's tokens. Shows what happened to the last request. */
function ResetRequest({ usage, onRequest }: { usage: AgentUsage; onRequest: (reason: string) => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rr = usage.reset_request;

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      await onRequest(reason.trim());
      setAsking(false); setReason('');
    } catch (e: any) {
      setErr(e?.detail || e?.response?.data?.detail || e?.message || 'The request could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  if (rr?.status === 'pending') {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2.5">
        <p className="text-xs font-semibold text-slate-900">Reset requested</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">Sent {formatResetTime(rr.requested_at)}. Waiting for an admin to answer.</p>
      </div>
    );
  }
  return (
    <div className="mt-3">
      {rr && (
        <p className="mb-2 text-xs leading-relaxed text-slate-500">
          Your last request was {rr.status === 'approved' ? 'approved' : 'declined'} by {rr.decided_by} at {formatResetTime(rr.decided_at)}.
        </p>
      )}
      {usage.used > 0 && !asking && (
        <button type="button" onClick={() => setAsking(true)}
          className="w-full rounded-xl border border-slate-200 bg-paper px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50">
          Request a reset
        </button>
      )}
      {asking && (
        <div>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={300} placeholder="Why do you need more? (optional)"
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none transition-colors placeholder:text-slate-400 focus:border-navy-300 focus:bg-paper" />
          {err && <p className="mt-1.5 text-xs font-medium text-rose-700">{err}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => void send()}
              className="flex-1 rounded-lg bg-solid px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-solid-hover disabled:opacity-60">
              {busy ? 'Sending...' : 'Send to admin'}
            </button>
            <button type="button" onClick={() => { setAsking(false); setErr(null); }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Top-right usage button: tokens left and when they reset. Click for everything. */
export function UsageMenu({ usage, onOpen, onRequestReset }: {
  usage: AgentUsage | null; onOpen?: () => void; onRequestReset?: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!usage) return <div className="h-9 w-28 animate-pulse rounded-xl bg-slate-100" aria-hidden />;
  const empty = usage.remaining <= 0;
  const low = usage.percent >= 80;

  return (
    <div ref={box} className="relative">
      <button
        type="button" onClick={() => { if (!open) onOpen?.(); setOpen((o) => !o); }} aria-expanded={open} aria-label="Token usage"
        className={cn('flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-slate-100', open && 'bg-slate-100')}
      >
        <TokenRing percent={usage.percent} />
        <span className="leading-tight">
          <span className={cn('block text-sm font-semibold tabular-nums', empty ? 'text-rose-700' : 'text-slate-900')}>{compact(usage.remaining)} left</span>
          <span className="block text-2xs text-slate-400">Resets {formatResetTime(usage.resets_at)}</span>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            variants={pop} initial="hidden" animate="show" exit="exit"
            className="absolute right-0 top-full z-40 mt-2 w-[min(300px,calc(100vw-2rem))] origin-top-right rounded-2xl border border-slate-200 bg-paper p-4 shadow-[0_16px_48px_-12px_rgba(15,23,42,0.25)]"
          >
            <div className="flex items-center gap-4">
              <TokenRing percent={usage.percent} size={64} stroke={6}>
                <span className="text-sm font-semibold tabular-nums text-slate-900">{usage.percent}%</span>
              </TokenRing>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-slate-400">Tokens today</p>
                <p className="text-2xl font-semibold leading-tight tabular-nums text-slate-900">{compact(usage.remaining)} <span className="text-sm font-medium text-slate-500">left</span></p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full transition-all duration-700', empty ? 'bg-rose-500' : 'bg-solid-soft')} style={{ width: `${usage.percent}%` }} />
            </div>
            <dl className="mt-3.5 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Used</dt><dd className="font-medium tabular-nums text-slate-900">{usage.used.toLocaleString()} of {usage.limit.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Remaining</dt><dd className="font-medium tabular-nums text-slate-900">{usage.remaining.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Answers today</dt><dd className="font-medium tabular-nums text-slate-900">{usage.calls}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Resets</dt><dd className="font-medium text-slate-900">{formatResetTime(usage.resets_at)}</dd></div>
              {usage.last_reset_at ? (
                <div className="flex justify-between"><dt className="text-slate-500">Last reset</dt><dd className="text-right font-medium text-slate-900">{formatResetTime(usage.last_reset_at)}<span className="block text-2xs font-normal text-slate-400">by {usage.last_reset_by}</span></dd></div>
              ) : null}
            </dl>
            <p className={cn('mt-3.5 rounded-xl px-3 py-2 text-xs leading-relaxed', empty ? 'bg-rose-50 text-rose-700' : low ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500')}>
              {empty
                ? 'All of today’s tokens are used. They come back at the reset time, or an admin can reset them now.'
                : low
                  ? 'Running low. Shorter requests use fewer tokens.'
                  : 'Every answer uses tokens. The count starts again each day at 00:00 UTC.'}
            </p>
            {onRequestReset && <ResetRequest usage={usage} onRequest={onRequestReset} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
