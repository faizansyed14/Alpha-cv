'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Upload,
  Users,
  Briefcase,
  Target,
  ArrowRight,
  Sparkles,
  Plus,
  Calendar,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import type { CareersOverview } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import StatCard from '@/components/ui/stat-card';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { Bone } from '@/components/skeletons';
import { rise, stagger } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { MonthBars, SplitBar, Sparkline, TrendChart } from './charts';

function dayPart(hour: number) {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function shortDate(raw?: string) {
  if (!raw) return '-';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** A card with a title row; the one container every dashboard section uses. */
function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-md font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className={cn('flex-1 px-5 pb-5', bodyClassName)}>{children}</div>
    </section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-navy-700 transition-colors hover:bg-navy-50"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function StatusChip({ live }: { live: boolean }) {
  return <span className={cn('chip shrink-0', live ? 'chip-success' : 'chip-neutral')}>{live ? 'Live' : 'Closed'}</span>;
}

function Kpi({ label, value, hint, icon, onClick, spark, trend, tone, loading }: {
  loading?: boolean;
  label: string; value: string; hint: React.ReactNode; icon: React.ComponentType<{ className?: string }>; onClick: () => void;
  spark?: number[]; trend?: { value: string; direction: 'up' | 'down' | 'flat' }; tone?: 'blue' | 'iris' | 'emerald' | 'amber';
}) {
  return <StatCard label={label} value={value} hint={hint} icon={icon} onClick={onClick} spark={spark} trend={trend} tone={tone} loading={loading} />;
}

function Delta({ last, previous }: { last: number; previous: number }) {
  if (last === 0 && previous === 0) return <span className="chip chip-neutral">No change</span>;
  if (previous === 0) return <span className="chip chip-success">New activity</span>;
  const pct = Math.round(((last - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span className={cn('chip gap-0.5', up ? 'chip-success' : 'chip-danger')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function deltaOf(last: number, previous: number): { value: string; direction: 'up' | 'down' | 'flat' } | undefined {
  if (last === 0 && previous === 0) return undefined;
  if (previous === 0) return { value: 'New', direction: 'up' };
  const pct = Math.round(((last - previous) / previous) * 100);
  return { value: `${pct >= 0 ? '+' : ''}${pct}%`, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

/** Bars of a chart that is still loading: the same height and spacing the chart will have. */
function ChartSkeleton({ bars, className }: { bars: number; className?: string }) {
  const heights = [38, 62, 48, 80, 55, 70, 42, 90, 60, 52, 75, 46, 68, 58];
  return (
    <div role="status" aria-label="Loading chart" className={cn('flex items-end gap-2', className)}>
      {Array.from({ length: bars }).map((_, i) => (
        <Bone key={i} className="flex-1 rounded-t-md" style={{ height: `${heights[i % heights.length]}%` }} />
      ))}
    </div>
  );
}

/** The rows of a job list that is still loading: a rank, a title with its bar, and a count. */
function JobListSkeleton({ rows = 5, withAvatar }: { rows?: number; withAvatar?: boolean }) {
  return (
    <ul role="status" aria-label="Loading jobs" className="-mx-2 space-y-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2.5">
          {withAvatar ? <Bone className="h-6 w-6 shrink-0 rounded-full" /> : <Bone className="h-3 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <Bone className="h-4 w-2/3" />
              <Bone className="h-4 w-6" />
            </div>
            <Bone className="mt-2 h-1.5 w-full rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { go, router } = useWorkspaceNav();
  const user = useAuthStore((s) => s.user);
  const {
    cvs,
    jds,
    totalCVs,
    totalJDs,
    selectedCVs,
    selectedJD,
    loadCVs,
    loadJDs,
    loadingStates,
  } = useAppStore();

  const [overview, setOverview] = useState<CareersOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const cvCount = totalCVs ?? cvs.length;
  const jdCount = totalJDs ?? jds.length;
  const hasSelection = selectedCVs.length > 0 || !!selectedJD;
  const canMatch = selectedCVs.length > 0 && !!selectedJD;

  useEffect(() => {
    loadCVs();
    loadJDs();
  }, [loadCVs, loadJDs]);

  useEffect(() => {
    let cancelled = false;
    api
      .getCareersOverview()
      .then((o) => { if (!cancelled) setOverview(o); })
      .catch(() => { if (!cancelled) setOverviewError(true); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const bootstrapping =
    cvs.length === 0 &&
    jds.length === 0 &&
    (loadingStates.cvs.isLoading || loadingStates.jds.isLoading);

  const now = new Date();
  const name = user?.username ? user.username : '';
  const dateLine = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const openJob = (jobId: string) => router.push(`/careers-manage?job=${encodeURIComponent(jobId)}`);

  const live = overview?.postings.live ?? 0;
  const week = overview?.applications.last_7_days ?? 0;
  const summaryLine = overview
    ? `${live} live job${live === 1 ? '' : 's'} · ${week} new application${week === 1 ? '' : 's'} in the last 7 days`
    : 'Your hiring overview: talent pool, open roles and the latest match results.';
  const maxApplicants = Math.max(1, ...(overview?.top_jobs.map((j) => j.application_count) ?? [1]));

  return (
    <motion.div className="space-y-5" variants={stagger(0.05)} initial="hidden" animate="show">
      {/* hero */}
      <motion.section
        variants={rise}
        className="hero-surface relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 sm:py-9"
      >
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p suppressHydrationWarning className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-white/60">
              <Calendar className="h-3.5 w-3.5" /> {dateLine}
            </p>
            <h1 suppressHydrationWarning className="mt-2 font-display text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl">
              {dayPart(now.getHours())}{name ? `, ${name}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-base leading-relaxed text-white/80">{summaryLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => go('careers')} className="hero-btn hero-btn-solid"><Plus /> Post a job</button>
            <button type="button" onClick={() => go('upload')} className="hero-btn"><Upload /> Upload CVs</button>
            <button type="button" onClick={() => go('match')} className="hero-btn"><Target /> New match</button>
          </div>
        </div>
      </motion.section>

      {/* key numbers */}
      <motion.div variants={rise} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Candidates"
          value={cvCount.toLocaleString()}
          loading={loadingStates.cvs.isLoading && !cvCount}
          hint="In the talent pool"
          icon={Users}
          onClick={() => go('candidates')}
        />
        <Kpi
          label="Job descriptions"
          value={jdCount.toLocaleString()}
          loading={loadingStates.jds.isLoading && !jdCount}
          hint="Roles ready to match"
          icon={Briefcase}
          onClick={() => go('jobs')}
        />
        <Kpi
          label="Live jobs"
          value={overview ? overview.postings.live.toLocaleString() : ''}
          loading={!overview && !overviewError}
          hint={overview ? `${overview.postings.total.toLocaleString()} posted · ${overview.postings.closed.toLocaleString()} closed` : 'Live and closed jobs'}
          icon={Sparkles}
          onClick={() => go('careers')}
        />
        <Kpi
          label="Applications"
          value={overview ? overview.applications.total.toLocaleString() : ''}
          loading={!overview && !overviewError}
          hint={overview ? `${week.toLocaleString()} in the last 7 days` : 'Applications received'}
          icon={Target}
          tone="iris"
          onClick={() => go('careers')}
          spark={overview?.applications.series}
          trend={overview ? deltaOf(overview.applications.last_7_days, overview.applications.previous_7_days) : undefined}
        />
      </motion.div>

      {overviewError && (
        <motion.div variants={rise} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-900">
          <span className="inline-flex items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0" /> The job numbers could not be loaded.</span>
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { setOverviewError(false); setReloadKey((k) => k + 1); }}>Try again</Button>
        </motion.div>
      )}

      {/* applications over time + postings by month */}
      <motion.div variants={rise} className="grid gap-4 lg:grid-cols-3">
        {overview ? (
          <>
            <Panel
              title="Applications received"
              subtitle="Per day, last 14 days"
              className="lg:col-span-2"
              action={
                <div className="text-right">
                  <p className="text-2xl font-semibold leading-none tabular-nums text-slate-900">{overview.applications.series.reduce((a, b) => a + b, 0).toLocaleString()}</p>
                  <p className="mt-1 text-2xs text-slate-500">in 14 days</p>
                </div>
              }
            >
              <TrendChart values={overview.applications.series} days={overview.applications.days} />
            </Panel>
            <Panel title="Jobs posted" subtitle="Per month, last 6 months">
              <MonthBars months={overview.months} />
              <div className="mt-5 border-t border-surface-border pt-4">
                <SplitBar
                  parts={[
                    { label: 'Live', value: overview.postings.live, className: 'bg-solid-soft' },
                    { label: 'Closed', value: overview.postings.closed, className: 'bg-slate-300' },
                  ]}
                />
              </div>
            </Panel>
          </>
        ) : (
          <>
            <Panel title="Applications received" subtitle="Per day, last 14 days" className="lg:col-span-2" action={<Bone className="h-8 w-16" />}>
              <ChartSkeleton bars={14} className="h-[220px]" />
            </Panel>
            <Panel title="Jobs posted" subtitle="Per month, last 6 months">
              <ChartSkeleton bars={6} className="h-[150px]" />
              <div className="mt-5 border-t border-surface-border pt-4"><Bone className="h-2.5 w-full rounded-full" /></div>
            </Panel>
          </>
        )}
      </motion.div>

      {/* the jobs themselves */}
      <motion.div variants={rise} className="grid gap-4 lg:grid-cols-2">
        {overview ? (
          <>
            <Panel
              title="Busiest jobs"
              subtitle="Most applicants first"
              action={<LinkButton onClick={() => go('careers')}>All jobs</LinkButton>}
            >
              {overview.top_jobs.length === 0 ? (
                <EmptyJobs onPost={() => go('careers')} />
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {overview.top_jobs.map((j, i) => (
                    <li key={j.job_id}>
                      <button
                        type="button"
                        onClick={() => openJob(j.job_id)}
                        className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <span className="w-4 shrink-0 self-start pt-0.5 text-center text-xs font-semibold tabular-nums text-slate-400">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-navy-700">{j.job_title}</p>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{j.application_count}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn('h-full rounded-full', j.is_active ? 'bg-solid-soft' : 'bg-slate-300')}
                                style={{ width: `${Math.max(j.application_count > 0 ? 4 : 0, (j.application_count / maxApplicants) * 100)}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-2xs text-slate-400">{j.posted_by_user || '-'} · {shortDate(j.upload_date)}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Recently posted"
              subtitle="Newest first"
              action={<LinkButton onClick={() => go('careers')}>Manage</LinkButton>}
            >
              {overview.recent_jobs.length === 0 ? (
                <EmptyJobs onPost={() => go('careers')} />
              ) : (
                <ul className="-mx-2 space-y-0.5">
                  {overview.recent_jobs.map((j) => (
                    <li key={j.job_id}>
                      <button
                        type="button"
                        onClick={() => openJob(j.job_id)}
                        className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        <Avatar name={j.posted_by_user || '-'} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-navy-700">{j.job_title}</p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {j.posted_by_user || '-'} · {shortDate(j.upload_date)}{j.job_location ? ` · ${j.job_location}` : ''}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-slate-600" title="Applicants">
                          <Users className="h-3.5 w-3.5" />{j.application_count}
                        </span>
                        <StatusChip live={j.is_active} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : (
          <>
            <Panel title="Busiest jobs" subtitle="Most applicants first" action={<LinkButton onClick={() => go('careers')}>All jobs</LinkButton>}>
              <JobListSkeleton />
            </Panel>
            <Panel title="Recently posted" subtitle="Newest first" action={<LinkButton onClick={() => go('careers')}>Manage</LinkButton>}>
              <JobListSkeleton withAvatar />
            </Panel>
          </>
        )}
      </motion.div>

      {hasSelection && (
        <motion.div
          variants={rise}
          className="flex flex-col gap-3 rounded-2xl border border-navy-100 bg-navy-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-navy-900">Ready for matching</p>
            <p className="mt-0.5 truncate text-xs text-navy-700/80">
              {selectedCVs.length} candidate{selectedCVs.length === 1 ? '' : 's'}
              {selectedJD ? ' · 1 job selected' : ' · pick a job to continue'}
            </p>
          </div>
          <Button size="sm" variant="primary" icon={<Target />} onClick={() => go('match')} disabled={!canMatch}>
            Continue to match
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}

function EmptyJobs({ onPost }: { onPost: () => void }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-inset ring-navy-100">
        <Briefcase className="h-5 w-5 text-navy-700" />
      </span>
      <h3 className="mt-3 text-md font-semibold text-slate-900">No jobs posted yet</h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">Post your first job and its applicants will show up here.</p>
      <Button className="mt-4" size="sm" variant="primary" icon={<Plus />} onClick={onPost}>Post a job</Button>
    </div>
  );
}
