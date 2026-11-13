'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from '@/components/icons';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { formatResetTime, meterTone } from '@/components/agents/shared/TokenMeter';
import { cn } from '@/lib/utils';
import type { AgentAdminUsage, AgentResetRequests } from '@/lib/types';

/** Admin: every person's AI agent token use today, with a reset per person. */
export default function AgentUsageAdminPage() {
  const [data, setData] = useState<AgentAdminUsage | null>(null);
  const [requests, setRequests] = useState<AgentResetRequests>({ pending: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usage, reqs] = await Promise.all([api.getAgentUsageAdmin(), api.getAgentResetRequests()]);
      setData(usage);
      setRequests(reqs);
    } catch (e: any) {
      setError(e?.detail || e?.response?.data?.detail || 'Could not load token usage.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = async (username: string, used: number) => {
    if (!window.confirm(`Reset ${username}'s token count for today?\n\nThey have used ${used.toLocaleString()} tokens. Their history stays; the reset is recorded with your name.`)) return;
    setBusy(username);
    setNote(null);
    try {
      await api.resetAgentUsage(username);
      setNote(`${username}'s tokens were reset.`);
      await load();
    } catch (e: any) {
      setError(e?.detail || e?.response?.data?.detail || 'The reset failed.');
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, username: string, decision: 'approve' | 'reject') => {
    if (decision === 'approve' && !window.confirm(`Approve ${username}'s request? Their token count for today will be reset to zero.`)) return;
    setBusy(id);
    setNote(null);
    try {
      await api.answerAgentResetRequest(id, decision);
      setNote(decision === 'approve' ? `Approved: ${username}'s tokens were reset.` : `Rejected ${username}'s request.`);
      await load();
    } catch (e: any) {
      setError(e?.detail || e?.response?.data?.detail || 'That could not be done.');
    } finally {
      setBusy(null);
    }
  };

  const globalPercent = data && data.global_limit ? Math.min(100, Math.round((100 * data.global_used) / data.global_limit)) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI agent usage"
        description="Tokens each person has used today across the Interview and LinkedIn agents. The day runs 00:00 to 24:00 UTC."
        actions={<Button variant="secondary" size="sm" icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} onClick={() => void load()} disabled={loading}>Refresh</Button>}
      />

      {error && <p className="flex items-center gap-2 text-sm font-medium text-rose-600"><AlertCircle className="h-4 w-4" />{error}</p>}
      {note && <p className="text-sm font-medium text-emerald-700">{note}</p>}

      <div className="rounded-2xl border border-surface-border bg-paper shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
          <p className="text-base font-semibold text-slate-900">Reset requests</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium tabular-nums text-slate-600">{requests.pending.length} waiting</span>
        </div>
        {requests.pending.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No one is waiting for a reset.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {requests.pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{r.username}
                    <span className="ml-2 text-xs font-normal tabular-nums text-slate-500">{r.used.toLocaleString()} of {r.limit.toLocaleString()} used ({r.percent}%)</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">Asked {formatResetTime(r.requested_at)}{r.reason ? ` · "${r.reason}"` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, r.username, 'approve')}>Approve</Button>
                  <Button variant="secondary" size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, r.username, 'reject')}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {requests.recent.length > 0 && (
          <div className="border-t border-surface-border px-4 py-2.5">
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">Recent decisions</p>
            <ul className="space-y-0.5 text-xs text-slate-600">
              {requests.recent.slice(0, 6).map((d) => (
                <li key={d.id}>{d.username}: <span className="font-medium text-slate-900">{d.decision}</span> by {d.decided_by} at {formatResetTime(d.decided_at)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {data && (
        <div className="rounded-2xl border border-surface-border bg-paper px-4 py-3 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Everyone combined (shared ceiling)</p>
            <p className={cn('text-sm tabular-nums', meterTone(globalPercent).text)}>
              <span className="font-semibold">{data.global_used.toLocaleString()}</span> of {data.global_limit.toLocaleString()}
            </p>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={cn('h-full rounded-full transition-all', meterTone(globalPercent).bar)} style={{ width: `${globalPercent}%` }} />
          </div>
          <p className="mt-1.5 text-2xs text-slate-400">When this is full, no one can use the agents until tomorrow. Each person's own limit is {data.limit_per_user.toLocaleString()} tokens a day.</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-surface-border bg-paper shadow-card">
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Role</TH>
              <TH className="min-w-[200px]">Tokens today</TH>
              <TH className="text-right">Answers</TH>
              <TH className="text-right">Cost (USD)</TH>
              <TH>Last reset</TH>
              <TH className="text-right">Action</TH>
            </TR>
          </THead>
          <TBody>
            {(data?.users ?? []).map((u) => {
              const tone = meterTone(u.percent);
              return (
                <TR key={u.username}>
                  <TD className="font-medium text-slate-900">{u.username}</TD>
                  <TD className="text-slate-500">{u.role}</TD>
                  <TD>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${u.percent}%` }} />
                      </div>
                      <span className={cn('text-xs tabular-nums', tone.text)}>{u.used.toLocaleString()} / {u.limit.toLocaleString()}</span>
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums">{u.calls}</TD>
                  <TD className="text-right tabular-nums">{u.cost_usd.toFixed(4)}</TD>
                  <TD className="text-xs text-slate-500">{u.last_reset_at ? `${formatResetTime(u.last_reset_at)} by ${u.last_reset_by}` : '-'}</TD>
                  <TD className="text-right">
                    <Button variant="secondary" size="sm" disabled={busy === u.username || u.used === 0} onClick={() => void reset(u.username, u.used)}>
                      {busy === u.username ? 'Resetting...' : 'Reset'}
                    </Button>
                  </TD>
                </TR>
              );
            })}
            {!loading && data && data.users.length === 0 && (
              <TR><TD colSpan={7} className="py-8 text-center text-slate-400">No users.</TD></TR>
            )}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
