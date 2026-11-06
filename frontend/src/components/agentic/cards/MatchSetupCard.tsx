'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Search } from '@/components/icons';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AgenticCard } from '@/lib/types';
import { useCardActions } from './actions';
import { Action, CardShell } from './ui';

export interface MatchSelection {
  kind: 'match';
  jd_id: string;
  jd_title: string;
  categories: string[];
  max_cvs: number;
}

type Jd = { jd_id: string; title: string; file?: string; category?: string };

/**
 * The whole "match CVs" question on one card: choose the job description (search the library, however big), tick the CV categories
 * (each shows how many CVs it holds) and say how many CVs. Pressing Match sends the choice back as a structured selection, which the
 * server runs through the same limits as everything else (at most 10,000 CVs, the newest in the chosen categories). No model is involved.
 */
export function MatchSetupCard({ card, onSelect, active }: { card: AgenticCard; onSelect: (text: string, selection: MatchSelection) => void; active: boolean }) {
  const { preview } = useCardActions();
  const cats: Array<{ name: string; count: number }> = card.categories?.rows ?? [];
  const cap: number = card.categories?.max_cvs ?? 10000;

  const [jds, setJds] = useState<Jd[]>(card.jds?.rows ?? []);
  const [jdTotal, setJdTotal] = useState<number>(card.jds?.total ?? 0);
  const [more, setMore] = useState<AgenticCard['page']>(card.jds?.page ?? null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Jd | null>(() => (card.preselect ? (card.jds?.rows ?? []).find((j: Jd) => j.jd_id === card.preselect) ?? null : null));
  const [chosen, setChosen] = useState<string[]>([]);
  const [howMany, setHowMany] = useState('');
  const first = useRef(true);

  // searching the library: the server searches (so a thousand job descriptions is as quick as five)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.agenticMore({ tool: 'list_job_descriptions', args: { query: query.trim() }, offset: 0, cursor: null });
        setJds(res.rows as Jd[]); setJdTotal(res.total); setMore(res.page ?? null);
      } catch { /* keep what is shown */ } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const loadMore = async () => {
    if (!more || loading) return;
    setLoading(true);
    try {
      const res = await api.agenticMore({ tool: more.tool, args: more.args ?? {}, offset: more.offset ?? 0, cursor: more.cursor ?? null });
      setJds((prev) => [...prev, ...(res.rows as Jd[])]); setMore(res.page ?? null); setJdTotal(res.total);
    } finally { setLoading(false); }
  };

  const available = useMemo(() => cats.filter((c) => chosen.includes(c.name)).reduce((a, c) => a + c.count, 0), [cats, chosen]);
  const limit = Math.min(available, cap);
  const wanted = Math.max(0, Math.min(Number(howMany) || 0, limit));
  const ready = active && !!picked && chosen.length > 0 && wanted > 0;
  const toggle = (name: string) => setChosen((c) => (c.includes(name) ? c.filter((x) => x !== name) : [...c, name]));

  const submit = () => {
    if (!ready || !picked) return;
    onSelect(`Match ${picked.title} using ${chosen.join(', ')} and the newest ${wanted.toLocaleString()} CVs`,
      { kind: 'match', jd_id: picked.jd_id, jd_title: picked.title, categories: chosen, max_cvs: wanted });
  };

  return (
    <CardShell title="Match CVs" count={`at most ${cap.toLocaleString()} per match`}
      footer={<span>{picked ? picked.title : 'No job description yet'} · {chosen.length} {chosen.length === 1 ? 'category' : 'categories'} · {wanted.toLocaleString()} CVs</span>}>
      {/* 1. the job description */}
      <div className="px-4 pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">1. Job description <span className="font-normal normal-case text-slate-400">({jdTotal.toLocaleString()} saved)</span></p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} disabled={!active} placeholder="Search by title"
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-navy-300 disabled:bg-slate-50" />
        </div>
        <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-100">
          {jds.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-slate-400">{loading ? 'Searching...' : 'No job description matches'}</li>}
          {jds.map((j) => {
            const on = picked?.jd_id === j.jd_id;
            return (
              <li key={j.jd_id}>
                <button type="button" disabled={!active} onClick={() => setPicked(j)} aria-pressed={on}
                  className={cn('flex w-full items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:cursor-not-allowed', on && 'bg-navy-50/70')}>
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-navy-800 bg-navy-900 text-white' : 'border-slate-300')}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-slate-900">{j.title}</span>
                    <span className="block truncate text-[11.5px] text-slate-400">{j.file}{j.category ? ` · ${j.category}` : ''}</span></span>
                  <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); preview(j.jd_id, 'jd', j.file || j.title); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); preview(j.jd_id, 'jd', j.file || j.title); } }}
                    className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-slate-600 hover:bg-slate-50">Preview</span>
                </button>
              </li>
            );
          })}
          {more && (
            <li><button type="button" onClick={() => void loadMore()} disabled={loading}
              className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Show 10 more</button></li>
          )}
        </ul>
      </div>

      {/* 2. categories */}
      <div className="px-4 pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">2. CV categories</p>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => {
            const on = chosen.includes(c.name);
            return (
              <button key={c.name} type="button" disabled={!active} onClick={() => toggle(c.name)} aria-pressed={on}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  on ? 'border-navy-800 bg-navy-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                {on && <Check className="h-3.5 w-3.5" />}{c.name}<span className={cn('tabular-nums', on ? 'text-white/70' : 'text-slate-400')}>{c.count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. how many */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">3. How many CVs (newest first)</span>
          <input type="number" min={1} max={limit || undefined} value={howMany} disabled={!active || chosen.length === 0} onChange={(e) => setHowMany(e.target.value)}
            placeholder={chosen.length ? `up to ${limit.toLocaleString()}` : 'pick a category'}
            className="h-9 w-48 rounded-lg border border-slate-200 bg-white px-3 text-[13px] tabular-nums outline-none focus:border-navy-300 disabled:bg-slate-50" />
        </label>
        {chosen.length > 0 && (
          <div className="flex gap-1.5 pb-0.5">
            {[100, 500, 1000, 5000].filter((n) => n < limit).map((n) => (
              <button key={n} type="button" disabled={!active} onClick={() => setHowMany(String(n))}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] tabular-nums text-slate-600 hover:bg-slate-50">{n.toLocaleString()}</button>
            ))}
            <button type="button" disabled={!active} onClick={() => setHowMany(String(limit))}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11.5px] text-slate-600 hover:bg-slate-50">All ({limit.toLocaleString()})</button>
          </div>
        )}
        <div className="ml-auto pb-0.5"><Action tone="primary" label={ready ? `Match ${wanted.toLocaleString()} CVs` : 'Match'} onClick={submit} /></div>
      </div>
    </CardShell>
  );
}
