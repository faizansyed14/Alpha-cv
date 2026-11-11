'use client';

import type { AgenticCard } from '@/lib/types';
import { usePagedRows, ShowMore } from './paging';
import { useCardActions } from './actions';
import { Action, CardShell, dash, Pill, Row, type Send } from './ui';

/** The job postings the person asked to see: a page at a time. The one useful action is the applicants. */
export function JobsCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const { focus } = useCardActions();
  const purpose: string | undefined = card.purpose;
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  return (
    <CardShell title="Job postings" count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      <ul>
        {rows.map((r, i) => (
          <Row key={r.job_id ?? i} index={i % 10}>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-[14px] font-semibold text-slate-900">
                <span className="truncate">{dash(r.title)}</span>
                <Pill tone={r.active ? 'green' : 'slate'}>{r.active ? 'Open' : 'Closed'}</Pill>
              </p>
              <p className="truncate text-[12.5px] text-slate-500">
                {dash(r.location)} · {r.applications} {r.applications === 1 ? 'application' : 'applications'}{r.posted ? ` · posted ${r.posted}` : ''}
              </p>
              {r.subject ? <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{r.subject}</p> : null}
            </div>
            {purpose === 'interview' ? <Action tone="primary" label="Interview questions" onClick={() => onSend(`Interview questions for the ${r.title} job`)} />
              : purpose === 'linkedin' ? <Action tone="primary" label="Write the post" onClick={() => onSend(`Write a LinkedIn post for the ${r.title} job`)} />
              : (
                <div className="flex flex-wrap gap-1.5">
                  {r.applications > 0 ? <Action label="Applicants" onClick={() => onSend(`Who applied for the ${r.title} job?`)} /> : null}
                  <Action label="Edit" onClick={() => focus(`Change details of the ${r.title} job`, { job_id: r.job_id, name: r.title })} />
                  <Action label={r.active ? 'Close' : 'Reopen'} onClick={() => focus(`${r.active ? 'Close' : 'Reopen'} the ${r.title} job`, { job_id: r.job_id, name: r.title })} />
                </div>
              )}
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}

/** The saved job descriptions the person asked to see, a page at a time. While a task needs one (match, questions, a post) every row is a choice. */
export function JobDescriptionsCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const { preview } = useCardActions();
  const purpose: string | undefined = card.purpose;
  const { rows, total, hasMore, loading, error, loadMore } = usePagedRows<any>(card);
  return (
    <CardShell title="Job descriptions" count={`${total.toLocaleString()} found`}
      footer={<ShowMore shown={rows.length} total={total} hasMore={hasMore} loading={loading} error={error} onMore={() => void loadMore()} />} flush>
      <ul>
        {rows.map((r, i) => (
          <Row key={r.jd_id ?? i} index={i % 10}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-slate-900">{dash(r.title)}</p>
              <p className="truncate text-[12.5px] text-slate-500">{dash(r.file)}{r.category ? ` · ${r.category}` : ''}</p>
            </div>
            <Action label="Preview" onClick={() => preview(r.jd_id, 'jd', r.file || r.title)} />
            {purpose === 'match' ? <Action tone="primary" label="Match" onClick={() => onSend(`Match candidates for the ${r.title} job`)} />
              : purpose === 'interview' ? <Action tone="primary" label="Use this" onClick={() => onSend(`Interview questions for the ${r.title} role`)} />
              : purpose === 'linkedin' ? <Action tone="primary" label="Write the post" onClick={() => onSend(`Write a LinkedIn post for the ${r.title} job`)} /> : null}
          </Row>
        ))}
      </ul>
    </CardShell>
  );
}

/** A generic table for admin answers. Columns come from the rows themselves. */
export function TableCard({ card }: { card: AgenticCard }) {
  const rows: Array<Record<string, any>> = card.rows ?? [];
  const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 6);
  return (
    <CardShell title={card.title ?? 'Results'} count={`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
      footer={card.link ? <a href={card.link.href} className="inline-flex rounded-full bg-navy-900 px-3 py-1 text-[12px] font-medium text-white hover:bg-navy-800">{card.link.label}</a> : undefined}>
      {rows.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-slate-400">Nothing to show.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead><tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              {columns.map((c) => <th key={c} className="px-4 py-2 font-semibold">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-b-0">
                {columns.map((c) => <td key={c} className="px-4 py-2 text-slate-700">{typeof r[c] === 'number' ? r[c].toLocaleString() : dash(r[c])}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}
