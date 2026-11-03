'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  XCircle,
} from '@/components/icons';
import { motion } from 'framer-motion';
import { rise } from '@/lib/motion';
import { Segmented } from '@/components/ui/segmented';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { MonitorBodySkeleton } from '@/components/skeletons';
import { LineChart, type ChartPoint } from './LineChart';
import type { MonitorEvent, MonitorSummary, MonitorTimeseries, ModelRow } from './types';

const WINDOWS = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '24 hours', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
];
const REFRESH_MS = 5000;

const compact = (n: number | null | undefined) =>
  n == null ? 'n/a' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const ms = (v: number | null | undefined) =>
  v == null ? 'n/a' : v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`;
const usd = (v: number | null | undefined) => (v == null ? 'n/a' : `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`);
const pct = (num: number, den: number) => (den ? `${((num / den) * 100).toFixed(1)}%` : '0%');
const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`);

const KIND_NAMES: Record<string, string> = { llm: 'LLM', embedder: 'Embeddings', ocr: 'OCR' };
const ROLE_NAMES: Record<string, string> = {
  match_analysis: 'Match analysis (top CVs)',
  cv_extract: 'CV extraction',
  jd_extract: 'JD extraction',
  embed: 'Embedding batch',
  page: 'Page recognition',
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <motion.section variants={rise} className="overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card">
      <div className="border-b border-surface-border/80 px-5 py-3.5">
        <h2 className="text-md font-semibold tracking-[-0.011em] text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </motion.section>
  );
}

function Meter({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-muted">
        <span>{label}</span>
        <span className="tabular-nums">{detail ?? `${value.toFixed(0)}%`}</span>
      </div>
      <Progress value={Math.min(100, value)} />
    </div>
  );
}

function ModelCalls({ rows }: { rows: ModelRow[] }) {
  if (!rows.length) return <EmptyState title="No model calls in this window" hint="Calls appear here as CVs are uploaded and matches run." />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Call</TH>
          <TH>Model</TH>
          <TH className="text-right">Calls</TH>
          <TH className="text-right">Errors</TH>
          <TH className="text-right">Avg</TH>
          <TH className="text-right">p50</TH>
          <TH className="text-right">p95</TH>
          <TH className="text-right">Tokens in / out</TH>
          <TH className="text-right">Est. cost</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={`${r.kind}|${r.role}|${r.model}`}>
            <TD>
              <span className="font-medium">{ROLE_NAMES[r.role] ?? r.role}</span>
              <span className="ml-2 text-xs text-ink-muted">{KIND_NAMES[r.kind] ?? r.kind}</span>
            </TD>
            <TD className="max-w-[180px] truncate text-ink-muted" title={r.model}>{r.model}</TD>
            <TD className="text-right tabular-nums">{compact(r.calls)}</TD>
            <TD className={`text-right tabular-nums ${r.errors ? 'font-semibold text-red-600' : 'text-ink-muted'}`}>{r.errors}</TD>
            <TD className="text-right tabular-nums">{ms(r.avg_ms)}</TD>
            <TD className="text-right tabular-nums">{ms(r.p50_ms)}</TD>
            <TD className="text-right tabular-nums">{ms(r.p95_ms)}</TD>
            <TD className="text-right tabular-nums">{r.tokens_in || r.tokens_out ? `${compact(r.tokens_in)} / ${compact(r.tokens_out)}` : 'n/a'}</TD>
            <TD className="text-right tabular-nums">{r.cost_usd ? usd(r.cost_usd) : 'n/a'}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function Events({ rows, empty }: { rows: MonitorEvent[]; empty: string }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          <TH>What</TH>
          <TH className="text-right">Duration</TH>
          <TH>Details</TH>
          <TH>Result</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((e, i) => {
          const d = e.detail ?? {};
          const bits: string[] = [];
          if (e.kind === 'job') {
            if (d.candidates != null) bits.push(`${d.candidates} CVs scored`);
            else if (d.cvs) bits.push(`${d.cvs} CVs`);
            if (d.llm_analyzed) bits.push(`${d.llm_analyzed} LLM-analysed`);
            if (d.queue_wait_s != null) bits.push(`waited ${duration(Math.round(Number(d.queue_wait_s)))}`);
            if (d.attempt && Number(d.attempt) > 1) bits.push(`attempt ${d.attempt}`);
          } else {
            if (e.tokens_in || e.tokens_out) bits.push(`${compact(e.tokens_in)} in / ${compact(e.tokens_out)} out`);
            if (e.cost) bits.push(usd(e.cost));
            if (d.cvs) bits.push(`${d.cvs} CVs`);
            if (d.attempts) bits.push(`${d.attempts} attempts`);
          }
          return (
            <TR key={`${e.ts}-${i}`}>
              <TD className="whitespace-nowrap tabular-nums text-ink-muted">{clock(e.ts)}</TD>
              <TD>
                <span className="font-medium">{e.kind === 'job' ? 'Match job' : ROLE_NAMES[e.role] ?? e.role}</span>
                {e.kind !== 'job' ? <span className="ml-2 text-xs text-ink-muted">{e.model}</span> : null}
              </TD>
              <TD className="text-right tabular-nums">{ms(e.ms)}</TD>
              <TD className="max-w-[320px] truncate text-xs text-ink-muted" title={String(d.error ?? bits.join(' · '))}>
                {d.error ? <span className="text-red-600">{String(d.error)}</span> : bits.join(' · ') || 'n/a'}
              </TD>
              <TD>{e.status === 'ok' ? <Badge variant="success">OK</Badge> : <Badge variant="destructive">Failed</Badge>}</TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

const series = (rows: MonitorTimeseries['llm'] | undefined, pick: (p: NonNullable<MonitorTimeseries['llm']>[number]) => number | null): ChartPoint[] =>
  (rows ?? []).map((p) => ({ t: p.t, v: pick(p) }));

export default function MonitorPage() {
  const [minutes, setMinutes] = useState(60);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [ts, setTs] = useState<MonitorTimeseries | null>(null);
  const [jobs, setJobs] = useState<MonitorEvent[]>([]);
  const [llmCalls, setLlmCalls] = useState<MonitorEvent[]>([]);
  const [failures, setFailures] = useState<MonitorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [s, t, j, l, f] = await Promise.all([
        api.getMonitorSummary(minutes),
        api.getMonitorTimeseries(minutes),
        api.getMonitorEvents({ kind: 'job', limit: 15 }),
        api.getMonitorEvents({ kind: 'llm', limit: 20 }),
        api.getMonitorEvents({ failures: true, limit: 15 }),
      ]);
      setSummary(s);
      setTs(t);
      setJobs(j.events);
      setLlmCalls(l.events);
      setFailures(f.events);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load monitoring data');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [minutes]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [live, load]);

  const s = summary;
  const q = s?.queue;
  const waiting = q?.available ? q.waiting : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Monitor"
        description="Model calls, matching flow, queues and system health across every API and worker process"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={String(minutes)}
              onChange={(v) => setMinutes(Number(v))}
              items={WINDOWS.map((w) => ({ value: String(w.minutes), label: w.label }))}
            />
            <button
              onClick={() => setLive((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
              title={live ? 'Refreshing every 5 seconds' : 'Live updates paused'}
            >
              <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-green-500' : 'bg-slate-300'}`} />
              {live ? 'Live' : 'Paused'}
            </button>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      {loading && !s ? (
        <MonitorBodySkeleton />
      ) : s ? (
        <>
          {s.alerts.length ? (
            <div className="space-y-2">
              {s.alerts.map((a, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${a.level === 'danger' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <span className="font-semibold">{a.title}</span>
                    <span className="ml-2 opacity-80">{a.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4" /> All systems normal
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="LLM calls" value={compact(s.llm.calls)}
              hint={s.llm.errors ? `${s.llm.errors} failed (${pct(s.llm.errors, s.llm.calls)})` : 'No failures'} />
            <StatCard label="Tokens" value={compact(s.llm.tokens_in + s.llm.tokens_out)}
              hint={`${compact(s.llm.tokens_in)} in · ${compact(s.llm.tokens_out)} out`} />
            <StatCard label="LLM cost today" value={usd(s.llm.cost_today_usd)}
              hint={s.llm.daily_budget_usd ? `of ${usd(s.llm.daily_budget_usd)} budget` : `${usd(s.llm.cost_usd)} in this window`} />
            <StatCard label="Match jobs" value={compact(s.jobs.calls)}
              hint={s.jobs.calls ? `typical ${ms(s.jobs.p50_ms)} · slowest 5% ${ms(s.jobs.p95_ms)}${s.jobs.errors ? ` · ${s.jobs.errors} failed` : ''}` : 'None in this window'} />
            <StatCard label="Queue" value={q?.available ? waiting : 'n/a'}
              hint={q?.available ? `${q.running} running · ${q.waiting} waiting` : 'Redis unreachable'} />
            <StatCard label="API p95" value={ms(s.api.p95_ms)}
              hint={`${compact(s.api.calls)} requests · ${pct(s.api.errors, s.api.calls)} errors`} />
          </div>

          <Section title="Model calls" description="Every call to a model in this window, by purpose. Cost is an estimate from token counts.">
            <ModelCalls rows={s.models} />
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="LLM calls over time" description="Failed calls shown in red">
              <LineChart points={series(ts?.llm, (p) => p.calls)} errors={series(ts?.llm, (p) => p.errors)} label="LLM calls" integer />
            </Section>
            <Section title="LLM latency (p95)" description="Slowest 5% of calls in each period">
              <LineChart points={series(ts?.llm, (p) => p.p95_ms)} label="LLM p95" format={ms} />
            </Section>
            <Section title="Match jobs over time" description="Finished matches per period">
              <LineChart points={series(ts?.job, (p) => p.calls)} errors={series(ts?.job, (p) => p.errors)} label="Match jobs" integer />
            </Section>
            <Section title="Match duration (p95)" description="Queue wait excluded: time from start to finish">
              <LineChart points={series(ts?.job, (p) => p.p95_ms)} label="Match p95" format={ms} />
            </Section>
            <Section title="Tokens over time">
              <LineChart points={series(ts?.llm, (p) => p.tokens)} label="Tokens" format={compact} />
            </Section>
            <Section title="API latency (p95)">
              <LineChart points={series(ts?.api, (p) => p.p95_ms)} label="API p95" format={ms} />
            </Section>
          </div>

          <Section title="Match queue" description="Every match goes through the same queue, whatever its size. Any number of users can submit at once.">
            {q?.available ? (
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                <StatCard label="Waiting" value={q.waiting} hint="queued, oldest first" />
                <StatCard label="Running" value={q.running} hint={`${q.limits.worker_concurrency} runners per worker`} />
                <StatCard label="Jobs finished" value={compact(s.jobs.calls)} hint="in this window" />
              </div>
            ) : (
              <p className="mb-4 text-sm text-red-700">The queue is unreachable.</p>
            )}
            <Events rows={jobs} empty="No match jobs have finished yet." />
          </Section>

          <Section title="Recent LLM calls" description="The latest calls with latency, tokens and cost">
            <Events rows={llmCalls} empty="No LLM calls recorded yet." />
          </Section>

          <Section title="Recent failures" description="Failed model calls, API errors and failed jobs">
            {failures.length ? <Events rows={failures} empty="" /> : (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-muted">
                <CheckCircle2 className="h-4 w-4 text-green-600" /> Nothing has failed in the recorded history
              </div>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Processes" description="Heartbeat every 2 seconds">
              {s.processes.length ? (
                <Table>
                  <THead>
                    <TR><TH>Process</TH><TH>Host</TH><TH>Uptime</TH><TH>Status</TH></TR>
                  </THead>
                  <TBody>
                    {s.processes.map((p) => (
                      <TR key={p.id}>
                        <TD className="font-medium">{p.kind}</TD>
                        <TD className="text-ink-muted">{p.host}:{p.pid}</TD>
                        <TD className="tabular-nums text-ink-muted">{duration(p.uptime_s)}</TD>
                        <TD>{p.online ? <Badge variant="success">Online</Badge> : <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Offline</Badge>}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <p className="py-6 text-center text-sm text-ink-muted">No process has reported yet.</p>
              )}
            </Section>

            <Section title="Health" description="Host, Redis and library">
              <div className="space-y-4">
                <Meter label="CPU" value={s.system.cpu_percent} detail={`${s.system.cpu_percent.toFixed(0)}% of ${s.system.cpus} cores · load ${s.system.load_1m}`} />
                <Meter label="Memory" value={s.system.memory_percent} detail={`${s.system.memory_used_gb} / ${s.system.memory_total_gb} GB`} />
                <Meter label="Disk" value={s.system.disk_percent} />
                {s.redis.available ? (
                  <Meter
                    label="Redis memory"
                    value={s.redis.max_mb ? (s.redis.used_mb / s.redis.max_mb) * 100 : 0}
                    detail={`${s.redis.used_mb} MB${s.redis.max_mb ? ` of ${s.redis.max_mb} MB` : ''} · hit ratio ${s.redis.hit_ratio != null ? `${(s.redis.hit_ratio * 100).toFixed(0)}%` : 'n/a'}`}
                  />
                ) : (
                  <p className="text-sm text-red-700">Redis is unreachable.</p>
                )}
                <div className="text-sm text-ink-muted">
                  Library: <span className="font-medium text-slate-900">{compact(s.library.cvs)}</span> CVs ·{' '}
                  <span className="font-medium text-slate-900">{compact(s.library.jds)}</span> job descriptions
                </div>
              </div>
            </Section>
          </div>
        </>
      ) : null}
    </div>
  );
}
