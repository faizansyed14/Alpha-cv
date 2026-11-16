'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { roleLabel } from '@/lib/roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, Clock, RefreshCw, ThumbsUp } from '@/components/icons';
import type { NoticeAckUser, NoticeAcknowledgements as Acknowledgements } from '@/lib/types';

/** "Nov 16, 10:30 AM": when somebody clicked OK, in the admin's own time zone. */
function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Person({ u, done }: { u: NoticeAckUser; done: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-50">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase ${
          done ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
        }`}
        aria-hidden
      >
        {u.username.slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">{u.username}</p>
        <p className="truncate text-xs text-slate-500">
          {roleLabel(u.role)}
          {u.location ? ` · ${u.location}` : ''}
        </p>
      </div>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-700" title="When they clicked OK">
          <Check className="h-3.5 w-3.5 text-emerald-600" /> {when(u.acknowledged_at)}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-xs text-amber-600">
          <Clock className="h-3.5 w-3.5 text-amber-500" /> Not yet
        </span>
      )}
    </li>
  );
}

function Column({ title, tone, people, done, empty }: { title: string; tone: 'ok' | 'wait'; people: NoticeAckUser[]; done: boolean; empty: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <Badge variant={tone === 'ok' ? 'success' : 'secondary'}>{people.length}</Badge>
      </div>
      {people.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
          {people.map((u) => <Person key={u.id} u={u} done={done} />)}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin box under the notice editor: who has clicked the thumbs-up on the current notice and who has not. Only the current notice is
 * tracked (an edited notice starts again with nobody), and the list is every active non-admin account, the people it is shown to.
 * `refreshKey` changes when the admin saves, hides or removes the notice, so the list follows.
 */
export default function NoticeAcknowledgements({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Acknowledgements | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getNoticeAcknowledgements());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000);    // people click while the admin looks
    return () => window.clearInterval(id);
  }, [load]);

  const total = data?.summary.total ?? 0;
  const done = data?.summary.acknowledged ?? 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const pending = (data?.users ?? []).filter((u) => !u.acknowledged);
  const answered = (data?.users ?? []).filter((u) => u.acknowledged);

  return (
    <div className="mt-4 rounded-xl border border-surface-border bg-paper p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
            <ThumbsUp className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">Who clicked OK</p>
            <p className="mt-0.5 text-sm text-gray-500">
              People who gave the thumbs-up on the current notice never see it again. An edited notice starts again with nobody.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />} onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {failed && !data ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Could not load the list. Try Refresh.</p>
      ) : !data?.notice ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          There is no notice yet. Publish one above and you will see here who has read it.
        </p>
      ) : (
        <>
          {!data.notice.active && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The notice is hidden, so nobody sees it now. Showing it again with the same text keeps the clicks below.
            </p>
          )}

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="flex items-end justify-between gap-3">
              <p className="text-sm text-slate-600">
                <span className="text-2xl font-semibold tracking-tight text-slate-900">{done}</span>
                <span className="text-slate-500"> of {total} {total === 1 ? 'person' : 'people'} clicked OK</span>
              </p>
              <span className="text-sm font-semibold text-emerald-700">{percent}%</span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Share of people who clicked OK">
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Column title="Not yet" tone="wait" people={pending} done={false} empty={total ? 'Everyone has clicked OK.' : 'No users to show it to.'} />
            <Column title="Clicked OK" tone="ok" people={answered} done empty="Nobody has clicked OK yet." />
          </div>
        </>
      )}
    </div>
  );
}
