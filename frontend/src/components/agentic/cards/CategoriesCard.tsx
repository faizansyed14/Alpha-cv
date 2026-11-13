'use client';

import { useMemo, useState } from 'react';
import { Check } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { AgenticCard } from '@/lib/types';
import { Action, CardShell, type Send } from './ui';

/**
 * One question, one click: which CV categories to match, and how many CVs. A match never runs on the whole database: the count is
 * limited to what the chosen categories hold and to the matching limit (10,000), and the newest CVs in those categories are used.
 */
export function CategoriesCard({ card, onSend, active }: { card: AgenticCard; onSend: Send; active: boolean }) {
  const rows: Array<{ name: string; count: number }> = card.rows ?? [];
  const cap: number = card.max_cvs ?? 10000;
  const [picked, setPicked] = useState<string[]>([]);
  const [howMany, setHowMany] = useState('');

  const available = useMemo(() => rows.filter((r) => picked.includes(r.name)).reduce((a, r) => a + r.count, 0), [rows, picked]);
  const limit = Math.min(available, cap);
  const wanted = Math.max(0, Math.min(Number(howMany) || 0, limit));
  const ready = active && picked.length > 0 && wanted > 0;

  const toggle = (name: string) => setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
  const submit = () => onSend(`Match using the categories ${picked.join(', ')} and the newest ${wanted.toLocaleString()} CVs`);

  return (
    <CardShell title="Choose what to match" count={`${(card.total ?? 0).toLocaleString()} CVs in total`}
      footer={`A match scores at most ${cap.toLocaleString()} CVs, the newest in the categories you tick.`}>
      <div className="flex flex-wrap gap-2 px-4 pt-4">
        {rows.map((r) => {
          const on = picked.includes(r.name);
          return (
            <button key={r.name} type="button" disabled={!active} onClick={() => toggle(r.name)} aria-pressed={on}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                on ? 'border-navy-800 bg-solid text-white' : 'border-slate-200 bg-paper text-slate-700 hover:bg-slate-50')}>
              {on && <Check className="h-3.5 w-3.5" />}
              {r.name}<span className={cn('tabular-nums', on ? 'text-white/70' : 'text-slate-400')}>{r.count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3 px-4 py-4">
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-slate-400">How many CVs</span>
          <input type="number" min={1} max={limit || undefined} value={howMany} disabled={!active || picked.length === 0}
            onChange={(e) => setHowMany(e.target.value)} placeholder={picked.length ? `up to ${limit.toLocaleString()}` : 'pick a category'}
            className="h-9 w-44 rounded-lg border border-slate-200 bg-paper px-3 text-sm tabular-nums outline-none focus:border-navy-300 disabled:bg-slate-50" />
        </label>
        {picked.length > 0 && (
          <div className="flex gap-1.5 pb-0.5">
            {[100, 500, 1000, 5000, cap].filter((n) => n <= limit).slice(0, 4).map((n) => (
              <button key={n} type="button" disabled={!active} onClick={() => setHowMany(String(n))}
                className="rounded-full border border-slate-200 bg-paper px-2.5 py-1 text-2xs tabular-nums text-slate-600 hover:bg-slate-50">{n.toLocaleString()}</button>
            ))}
            <button type="button" disabled={!active} onClick={() => setHowMany(String(limit))}
              className="rounded-full border border-slate-200 bg-paper px-2.5 py-1 text-2xs text-slate-600 hover:bg-slate-50">All ({limit.toLocaleString()})</button>
          </div>
        )}
        <div className="ml-auto pb-0.5"><Action tone="primary" label={ready ? `Match ${wanted.toLocaleString()} CVs` : 'Match'} onClick={() => ready && submit()} /></div>
      </div>
    </CardShell>
  );
}
