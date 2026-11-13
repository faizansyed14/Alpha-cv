'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import type { AgenticCard } from '@/lib/types';
import { useCardActions } from './actions';
import { Action, CardShell, Initials, Pill, Row, ScoreBar } from './ui';

/** The ranked result of a matching run: exactly the scores the matching engine produced. */
export function MatchesCard({ card }: { card: AgenticCard }) {
  const { preview, review, focus } = useCardActions();
  const rows: any[] = card.rows ?? [];
  return (
    <CardShell title={card.job_title ? `Best matches for ${card.job_title}` : 'Best matches'} count={`top ${rows.length} of ${card.total ?? rows.length}`}
      footer={card.scope ? `Scored ${Number(card.scope.cvs_scored).toLocaleString()} of ${Number(card.scope.cvs_in_categories).toLocaleString()} CVs (the newest) in ${(card.scope.categories ?? []).join(', ')}. Same engine as the Match page.` : 'Scores come from the same matching engine as the Match page.'}>
      <ul>
        {rows.map((r, i) => (
          <Row key={r.cv_id ?? i} index={i}>
            <span className="w-5 text-center text-sm font-semibold tabular-nums text-slate-400">{i + 1}</span>
            <Initials name={r.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-900">{r.name}</p>
              <p className="truncate text-xs text-slate-500">{r.title}{r.years != null ? ` · ${r.years} yrs` : ''}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-slate-500">
                <span>Skills <b className="font-semibold text-slate-700">{r.skills}%</b></span>
                <span>Responsibilities <b className="font-semibold text-slate-700">{r.responsibilities}%</b></span>
                <span>Title <b className="font-semibold text-slate-700">{r.title_fit}%</b></span>
              </div>
              {Array.isArray(r.missing_skills) && r.missing_skills.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1"><span className="text-2xs text-slate-400">Missing:</span>{r.missing_skills.map((s: string) => <Pill key={s} tone="amber">{s}</Pill>)}</div>
              )}
            </div>
            <div className="w-28">
              <p className="text-right text-xl font-semibold tabular-nums text-slate-900">{r.score}%</p>
              <ScoreBar value={r.score} />
            </div>
            <div className="flex gap-1.5">
              <Action label="Preview CV" onClick={() => preview(r.cv_id, 'cv', r.name)} />
              <Action label="Review" onClick={() => review(r.cv_id, r.name)} />
              <Action label="Interview questions" onClick={() => focus(`Interview questions for ${r.name}`, { cv_id: r.cv_id, name: r.name })} />
            </div>
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}

/**
 * A matching run that is still going. The card watches the run itself (a small status call to the matching engine every few
 * seconds, no assistant, no tokens) and turns into the results as soon as they are ready. Nothing to press.
 */
export function MatchRunningCard({ card }: { card: AgenticCard }) {
  const [percent, setPercent] = useState<number | null>(typeof card.percent === 'number' ? Math.round(card.percent) : null);
  const [done, setDone] = useState<{ card: AgenticCard; summary?: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!card.job_id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let wait = 2500;
    const tick = async () => {
      if (!alive) return;
      if (typeof document !== 'undefined' && document.hidden) { timer = setTimeout(tick, 4000); return; }     // nothing to do in a background tab
      try {
        const res = await api.agenticMatchStatus(card.job_id);
        if (!alive) return;
        if (res.status === 'completed' && res.card) { setDone({ card: { ...res.card, scope: card.scope ?? res.card.scope }, summary: res.summary }); return; }
        if (res.status === 'failed') { setFailed(true); return; }
        if (typeof res.percent === 'number') setPercent(Math.round(res.percent));
      } catch { /* try again on the next tick */ }
      if (Date.now() - started > 30 * 60 * 1000) return;       // a run that takes half an hour is not coming back to this card
      wait = Math.min(wait + 500, 6000);
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 1200);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [card.job_id, card.scope]);

  if (done) {
    return (
      <div className="space-y-2">
        {done.summary ? <p className="px-1 text-sm text-slate-600">{done.summary}</p> : null}
        <MatchesCard card={done.card} />
      </div>
    );
  }
  if (failed) {
    return <CardShell title="Matching"><p className="px-4 py-4 text-sm text-rose-700">The matching run failed. Ask me to run it again.</p></CardShell>;
  }
  return (
    <CardShell title="Matching in progress">
      <div className="px-4 py-4">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
          <span>{card.scope ? `Scoring ${Number(card.scope.cvs_scored).toLocaleString()} CVs against the job...` : 'Scoring the candidates against the job...'}</span>{percent !== null && <span className="tabular-nums font-semibold">{percent}%</span>}
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
          {percent !== null
            ? <motion.div className="h-full rounded-full bg-solid-soft" initial={{ width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: 0.6 }} />
            : <motion.div className="absolute inset-y-0 w-1/3 rounded-full bg-solid-soft" animate={{ left: ['-33%', '100%'] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} />}
        </div>
        <p className="mt-3 text-2xs text-slate-400">The results appear here on their own. You can keep chatting.</p>
      </div>
    </CardShell>
  );
}
