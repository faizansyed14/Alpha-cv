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
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { DashboardSkeleton } from '@/components/skeletons';
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
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
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
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-navy-700 transition-colors hover:bg-navy-50"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  );
}

function StatusChip({ live }: { live: boolean }) {
  return <span className={cn('chip shrink-0', live ? 'chip-success' : 'chip-neutral')}>{live ? 'Live' : 'Closed'}</span>;
}

type KpiProps = {
  label: string;
  value: string;
  hint: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  extra?: React.ReactNode;
};

function Kpi({ label, value, hint, icon: Icon, onClick, extra }: KpiProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-surface-border bg-white p-5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-100">
          <Icon className="h-5 w-5" />
        </span>
        {extra ?? <ArrowRight className="h-4 w-4 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-navy-600" />}
      </div>
      <div className="mt-4">
        <p className="text-[12.5px] font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-slate-900">{value}</p>
        <p className="mt-2 text-[12px] text-slate-500">{hint}</p>
      </div>
    </button>
  );
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

function SectionSkeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-2xl border border-surface-border bg-white', className)} aria-hidden />;
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

  if (bootstrapping) {
    return <DashboardSkeleton />;
  }

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
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-950 via-navy-800 to-navy-600 px-6 py-7 text-white shadow-lg sm:px-9 sm:py-9"
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
            <p suppressHydrationWarning className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-white/60">
              <Calendar className="h-3.5 w-3.5" /> {dateLine}
            </p>
            <h1 suppressHydrationWarning className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">
              {dayPart(now.getHours())}{name ? `, ${name}` : ''}
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/75">{summaryLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => go('careers')}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-navy-900 shadow-sm transition-colors hover:bg-navy-50"
            >
              <Plus className="h-4 w-4" /> Post a job
            </button>
            <button
              type="button"
              onClick={() => go('upload')}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <Upload className="h-4 w-4" /> Upload CVs
            </button>
            <button
              type="button"
              onClick={() => go('match')}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 text-[13px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <Target className="h-4 w-4" /> New match
            </button>
          </div>
        </div>
      </motion.section>

      {/* key numbers */}
      <motion.div variants={rise} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Candidates"
          value={loadingStates.cvs.isLoading && !cvCount ? '-' : cvCount.toLocaleString()}
          hint="In the talent pool"
          icon={Users}
          onClick={() => go('candidates')}
        />
        <Kpi
          label="Job descriptions"
          value={loadingStates.jds.isLoading && !jdCount ? '-' : jdCount.toLocaleString()}
          hint="Roles ready to match"
          icon={Briefcase}
          onClick={() => go('jobs')}
        />
        <Kpi
          label="Live jobs"
          value={overview ? overview.postings.live.toLocaleString() : '-'}
          hint={overview ? `${overview.postings.total.toLocaleString()} posted · ${overview.postings.closed.toLocaleString()} closed` : 'Loading'}
          icon={Sparkles}
          onClick={() => go('careers')}
        />
        <Kpi
          label="Applications"
          value={overview ? overview.applications.total.toLocaleString() : '-'}
          hint={overview ? `${week.toLocaleString()} in the last 7 days` : 'Loading'}
          icon={Target}
          onClick={() => go('careers')}
          extra={overview ? (
            <div className="flex flex-col items-end gap-1.5">
              <Delta last={overview.applications.last_7_days} previous={overview.applications.previous_7_days} />
              <Sparkline values={overview.applications.series} />
            </div>
          ) : null}
        />
      </motion.div>

      {overviewError && (
        <motion.div variants={rise} className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-[13px] text-amber-900">
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
                  <p className="text-[22px] font-semibold leading-none tabular-nums text-slate-900">{overview.applications.series.reduce((a, b) => a + b, 0).toLocaleString()}</p>
                  <p className="mt-1 text-[11.5px] text-slate-500">in 14 days</p>
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
                    { label: 'Live', value: overview.postings.live, className: 'bg-navy-700' },
                    { label: 'Closed', value: overview.postings.closed, className: 'bg-slate-300' },
                  ]}
                />
              </div>
            </Panel>
          </>
        ) : (
          <>
            <SectionSkeleton className="h-[330px] lg:col-span-2" />
            <SectionSkeleton className="h-[330px]" />
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
                        <span className="w-4 shrink-0 self-start pt-0.5 text-center text-[12px] font-semibold tabular-nums text-slate-400">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-navy-700">{j.job_title}</p>
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">{j.application_count}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={cn('h-full rounded-full', j.is_active ? 'bg-navy-600' : 'bg-slate-300')}
                                style={{ width: `${Math.max(j.application_count > 0 ? 4 : 0, (j.application_count / maxApplicants) * 100)}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-[11.5px] text-slate-400">{j.posted_by_user || '-'} · {shortDate(j.upload_date)}</span>
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
                          <p className="truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-navy-700">{j.job_title}</p>
                          <p className="mt-0.5 truncate text-[12px] text-slate-500">
                            {j.posted_by_user || '-'} · {shortDate(j.upload_date)}{j.job_location ? ` · ${j.job_location}` : ''}
                          </p>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] tabular-nums text-slate-600" title="Applicants">
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
            <SectionSkeleton className="h-[330px]" />
            <SectionSkeleton className="h-[330px]" />
          </>
        )}
      </motion.div>

      {hasSelection && (
        <motion.div
          variants={rise}
          className="flex flex-col gap-3 rounded-2xl border border-navy-100 bg-navy-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-navy-900">Ready for matching</p>
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
      <h3 className="mt-3 text-[15px] font-semibold text-slate-900">No jobs posted yet</h3>
      <p className="mt-1 max-w-xs text-[13px] text-slate-500">Post your first job and its applicants will show up here.</p>
      <Button className="mt-4" size="sm" variant="primary" icon={<Plus />} onClick={onPost}>Post a job</Button>
    </div>
  );
}
