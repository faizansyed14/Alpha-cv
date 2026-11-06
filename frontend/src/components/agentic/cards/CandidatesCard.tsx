'use client';

import type { AgenticCard } from '@/lib/types';
import { usePagedRows, ShowMore } from './paging';
import { useCardActions } from './actions';
import { Action, CardShell, dash, Initials, Pill, Row, ScoreBar, type Send } from './ui';

/** Candidates found by a search: a page at a time, with "Show more" and one action per row. */
export function CandidatesCard({ card }: { card: AgenticCard; onSend?: Send }) {
  const { preview, review, focus } = useCardActions();
  const purpose: string | undefined = card.purpose;
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  return (
    <CardShell title={card.title ?? 'Candidates'} count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      {card.query ? <p className="border-b border-slate-100 px-4 py-2 font-mono text-[11.5px] leading-relaxed text-slate-500 break-words">{card.query}</p> : null}
      <ul>
        {rows.map((r, i) => (
          <Row key={r.id ?? i} index={i % 10}>
            <Initials name={r.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-slate-900">{dash(r.name)}</p>
              <p className="truncate text-[12.5px] text-slate-500">
                {dash(r.title)}{r.years != null ? ` · ${r.years} yrs` : ''}{r.location ? ` · ${r.location}` : ''}{r.notice_period ? ` · notice ${r.notice_period}` : ''}
              </p>
              {Array.isArray(r.skills) && r.skills.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">{r.skills.slice(0, 5).map((s: string) => <Pill key={s}>{s}</Pill>)}</div>
              )}
              {r.applied_for ? <p className="mt-1 text-[11.5px] text-slate-400">Applied for {r.applied_for}</p> : null}
            </div>
            <div className="flex gap-1.5">
              <Action label="Preview" onClick={() => preview(r.id, 'cv', r.name)} />
              {purpose === 'interview' ? <Action tone="primary" label="Interview questions" onClick={() => focus(`Interview questions for ${r.name}`, { cv_id: r.id, name: r.name })} />
                : <Action label="Review" onClick={() => review(r.id, r.name)} />}
            </div>
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}

/** One candidate's profile. */
export function CandidateProfileCard({ card }: { card: AgenticCard; onSend?: Send }) {
  const { preview, focus } = useCardActions();
  const notes: Array<{ by: string; note: string; updated?: string }> = card.notes ?? [];
  const skills: string[] = card.skills ?? [];
  const duties: string[] = card.responsibilities ?? [];
  const facts: Array<[string, unknown]> = [
    ['Experience', card.years != null ? `${card.years} years` : null], ['Location', card.location], ['Nationality', card.nationality],
    ['Notice period', card.notice_period], ['Expected salary', card.expected_salary != null ? `AED ${Number(card.expected_salary).toLocaleString()}` : null],
    ['Languages', Array.isArray(card.languages) ? card.languages.join(', ') : null],
  ];
  return (
    <CardShell title="Candidate profile">
      <div className="flex items-center gap-3 px-4 pt-4">
        <Initials name={card.name} size={48} />
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-slate-900">{dash(card.name)}</p>
          <p className="truncate text-[13px] text-slate-500">{dash(card.title)}</p>
        </div>
        {card.application_status ? <span className="ml-auto"><Pill tone="navy">{card.application_status}</Pill></span> : null}
      </div>
      <dl className="grid gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-2">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{k}</dt><dd className="text-[13px] text-slate-800">{String(v)}</dd></div>
        ))}
      </dl>
      {skills.length > 0 && <div className="flex flex-wrap gap-1.5 px-4 pb-3">{skills.slice(0, 14).map((s) => <Pill key={s} tone="navy">{s}</Pill>)}</div>}
      {duties.length > 0 && (
        <ul className="space-y-1 px-4 pb-4 text-[12.5px] leading-relaxed text-slate-600">
          {duties.slice(0, 5).map((d) => <li key={d} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />{d}</li>)}
        </ul>
      )}
      {notes.length > 0 && (
        <div className="mx-4 mb-4 space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Team notes</p>
          {notes.map((n, i) => <p key={i} className="text-[12.5px] leading-relaxed text-slate-700"><b className="font-semibold text-slate-800">{n.by}</b>{n.updated ? <span className="text-slate-400"> ({n.updated})</span> : null}: {n.note}</p>)}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-2.5">
        <Action label="Preview CV" onClick={() => preview(card.cv_id, 'cv', card.name)} />
        <Action label="Interview questions" onClick={() => focus(`Interview questions for ${card.name}`, { cv_id: card.cv_id, name: card.name })} />
        <Action label="Add a note" onClick={() => focus(`Add a note to ${card.name}`, { cv_id: card.cv_id, name: card.name })} />
      </div>
    </CardShell>
  );
}

/** People who applied to a job, with the match score the application calculated. */
export function ApplicationsCard({ card }: { card: AgenticCard; onSend?: Send }) {
  const { preview, review } = useCardActions();
  const rows: any[] = card.rows ?? [];
  return (
    <CardShell title="Applications" count={`${rows.length} of ${card.total ?? rows.length}`}>
      <ul>
        {rows.map((r, i) => (
          <Row key={r.application_id ?? i} index={i}>
            <Initials name={r.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-slate-900">{dash(r.name)}</p>
              <p className="truncate text-[12.5px] text-slate-500">
                {r.years != null ? `${r.years} yrs` : '-'}{r.location ? ` · ${r.location}` : ''}{r.notice_period ? ` · notice ${r.notice_period}` : ''}
                {r.expected_salary != null ? ` · AED ${Number(r.expected_salary).toLocaleString()}` : ''}
              </p>
            </div>
            <div className="w-24">
              {r.match_score != null ? (<><p className="text-right text-[12px] font-semibold tabular-nums text-slate-700">{Math.round(Number(r.match_score) * (Number(r.match_score) <= 1 ? 100 : 1))}%</p>
                <ScoreBar value={Number(r.match_score) <= 1 ? Number(r.match_score) * 100 : Number(r.match_score)} /></>) : <p className="text-right text-[11.5px] text-slate-400">not scored</p>}
            </div>
            <Pill>{dash(r.status)}</Pill>
            <div className="flex gap-1.5">
              <Action label="Preview CV" onClick={() => preview(r.application_id, 'cv', r.name)} />
              <Action label="Review" onClick={() => review(r.application_id, r.name)} />
            </div>
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}
