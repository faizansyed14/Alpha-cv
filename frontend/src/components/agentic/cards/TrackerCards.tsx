'use client';

import type { AgenticCard } from '@/lib/types';
import { cn } from '@/lib/utils';
import { usePagedRows, ShowMore } from './paging';
import { Action, CardShell, dash, Row, type Send } from './ui';

const REQUIREMENT_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-sky-50 text-sky-800' },
  submitted: { label: 'Submitted', cls: 'bg-emerald-50 text-emerald-800' },
  hold: { label: 'Hold', cls: 'bg-amber-50 text-amber-800' },
  closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-700' },
  canceled: { label: 'Canceled', cls: 'bg-rose-50 text-rose-800' },
};
const SELECTION_STATUS: Record<string, { label: string; cls: string }> = {
  offer_pending: { label: 'Offer Pending', cls: 'bg-amber-50 text-amber-800' },
  offer_released: { label: 'Offer Released', cls: 'bg-sky-50 text-sky-800' },
  joined: { label: 'Joined', cls: 'bg-emerald-50 text-emerald-800' },
  backed_out: { label: 'Backed Out', cls: 'bg-rose-50 text-rose-800' },
};

function Badge({ status, map }: { status: string; map: Record<string, { label: string; cls: string }> }) {
  const m = map[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-medium', m.cls)}>{m.label}</span>;
}

/** A line of small facts: only the ones that have a value. */
function Facts({ items }: { items: Array<[string, unknown]> }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return <p className="truncate text-xs text-slate-500">{shown.map(([k, v], i) => <span key={k}>{i ? ' · ' : ''}{k ? `${k} ` : ''}{String(v)}</span>)}</p>;
}

function Counts({ items }: { items: Array<[string, number | undefined]> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
      {items.map(([label, n]) => <span key={label}><span className="font-semibold tabular-nums text-slate-800">{(n ?? 0).toLocaleString()}</span> {label}</span>)}
    </div>
  );
}

/** The open requirements the person asked to see, a page at a time. Each row has its people and dates; the buttons send a ready-made request. */
export function RequirementsCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  const s = card.stats ?? null;
  return (
    <CardShell title="Requirements" count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      {s ? <Counts items={[['open', s.open], ['submitted', s.submitted], ['on hold', s.hold], ['canceled', s.canceled]]} /> : null}
      <ul>
        {rows.map((r, i) => {
          const name = `${r.position} requirement for ${r.client}`;
          return (
            <Row key={r.id ?? i} index={i % 10}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-base font-semibold text-slate-900"><span className="truncate">{dash(r.position)}</span><Badge status={r.status} map={REQUIREMENT_STATUS} /></p>
                <Facts items={[['', r.client], ['Recruiters', r.recruiters], ['Manager', r.manager], ['Sales', r.sales_manager]]} />
                <Facts items={[['Received', r.date], ['Deadline', r.deadline], ['CVs submitted', r.cvs], ['', r.job_location]]} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Action label="Update" onClick={() => onSend(`Update the ${name}`)} />
                <Action label="Close" onClick={() => onSend(`Close the ${name}`)} />
              </div>
            </Row>
          );
        })}
      </ul>
    </CardShell>
  );
}

/** Closed requirements: who closed them and how long they took. Reopening is one request away. */
export function ClosuresCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  const s = card.summary ?? null;
  return (
    <CardShell title="Closures" count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      {s ? <Counts items={[['closed', s.closed], ['closed this month', s.closed_this_month]]} /> : null}
      <ul>
        {rows.map((r, i) => (
          <Row key={r.id ?? i} index={i % 10}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-slate-900">{dash(r.position)}</p>
              <Facts items={[['', r.client], ['Closed by', r.recruiters], ['Manager', r.manager], ['Sales', r.sales_manager]]} />
              <Facts items={[['Closed', r.closed], ['Took', r.days == null ? null : `${r.days} days`]]} />
            </div>
            <Action label="Reopen" onClick={() => onSend(`Reopen the ${r.position} requirement for ${r.client}`)} />
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}

/** Selections and joining: the candidate, the offer status and the people. Not shown to recruiters (the server never returns it to them). */
export function SelectionsCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  const s = card.stats ?? null;
  return (
    <CardShell title="Selections & joining" count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      {s ? <Counts items={[['selections', s.total], ['offer pending', s.offer_pending], ['offer released', s.offer_released], ['backouts', s.backed_out], ['joined', s.joined]]} /> : null}
      <ul>
        {rows.map((r, i) => (
          <Row key={r.id ?? i} index={i % 10}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-base font-semibold text-slate-900">
                <span className="truncate">{r.candidate ?? <span className="font-normal text-slate-400">No candidate yet</span>}</span>
                <Badge status={r.status} map={SELECTION_STATUS} />
              </p>
              <Facts items={[['', r.position], ['', r.client], ['Recruiters', r.recruiters]]} />
              <Facts items={[['Account manager', r.account_manager], ['Recruitment manager', r.recruitment_manager], ['', r.date]]} />
              {r.comments ? <p className="truncate text-xs italic text-slate-400">{r.comments}</p> : null}
            </div>
            <Action label="Update" onClick={() => onSend(`Update the selection for ${r.candidate ?? `${r.position} at ${r.client}`}`)} />
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}
