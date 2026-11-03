'use client';
import { useEffect, useMemo } from 'react';
import {
  Upload,
  Users,
  Award,
  Briefcase,
  Target,
  FileText,
  Globe2,
  KanbanSquare,
  ArrowRight,
  Check,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { DashboardSkeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { TONE, type Tone } from '@/lib/tones';

function formatDate(value?: string) {
  if (!value || value === 'Unknown') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
  const { go } = useWorkspaceNav();
  const user = useAuthStore((s) => s.user);
  const {
    cvs,
    jds,
    totalCVs,
    totalJDs,
    matchResult,
    selectedCVs,
    selectedJD,
    selectJD,
    setDatabaseActiveTab,
    loadCVs,
    loadJDs,
    loadingStates,
  } = useAppStore();

  const cvCount = totalCVs ?? cvs.length;
  const jdCount = totalJDs ?? jds.length;
  const totalMatches = matchResult?.candidates.length || 0;

  useEffect(() => {
    loadCVs();
    loadJDs();
  }, [loadCVs, loadJDs]);

  const recentJDs = useMemo(
    () =>
      [...jds]
        .sort((a, b) => (Date.parse(b.upload_date || '') || 0) - (Date.parse(a.upload_date || '') || 0))
        .slice(0, 6),
    [jds],
  );
  const selectedJDItem = selectedJD ? jds.find((j) => j.id === selectedJD) : null;

  const bootstrapping =
    cvs.length === 0 &&
    jds.length === 0 &&
    (loadingStates.cvs.isLoading || loadingStates.jds.isLoading);

  if (bootstrapping) {
    return <DashboardSkeleton />;
  }

  const steps = [
    {
      n: 1,
      title: 'Select candidates',
      detail: selectedCVs.length ? `${selectedCVs.length.toLocaleString()} selected` : 'Pick the CVs you want to rank',
      done: selectedCVs.length > 0,
      action: () => { setDatabaseActiveTab('cvs'); go('candidates'); },
      cta: selectedCVs.length ? 'Change' : 'Browse candidates',
    },
    {
      n: 2,
      title: 'Choose a job description',
      detail: selectedJDItem ? selectedJDItem.job_title || selectedJDItem.filename : 'The role to match against',
      done: !!selectedJD,
      action: () => go('jobs'),
      cta: selectedJD ? 'Change' : 'Browse jobs',
    },
    {
      n: 3,
      title: 'Run the match',
      detail: 'Ranked results with an AI review of the best fits',
      done: false,
      action: () => go('match'),
      cta: 'Open matching',
    },
  ];

  const quickActions = [
    { icon: Upload, title: 'Upload documents', description: 'Add CVs and job descriptions', tone: 'cyan' as Tone, onClick: () => go('upload') },
    { icon: Globe2, title: 'Careers', description: 'Post openings and review applicants', tone: 'emerald' as Tone, onClick: () => go('careers') },
    { icon: KanbanSquare, title: 'Tracker', description: 'Follow candidates through hiring', tone: 'violet' as Tone, onClick: () => go('tracker') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-900">
            Welcome back{user?.username ? `, ${user.username}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here is what is happening in your recruitment workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Upload />} onClick={() => go('upload')}>Upload</Button>
          <Button variant="primary" icon={<Target />} onClick={() => go('match')}>New match</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Candidates"
          tone="indigo"
          value={loadingStates.cvs.isLoading && !cvCount ? '-' : cvCount.toLocaleString()}
          icon={Users}
          hint="CVs in your database"
          onClick={() => go('candidates')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
        <StatCard
          label="Job descriptions"
          tone="sky"
          value={loadingStates.jds.isLoading && !jdCount ? '-' : jdCount.toLocaleString()}
          icon={Briefcase}
          hint="Ready to match against"
          onClick={() => go('jobs')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
        <StatCard
          label="Latest match"
          tone="amber"
          value={totalMatches.toLocaleString()}
          icon={Award}
          hint={totalMatches ? 'Candidates ranked in the last run' : 'No match run yet'}
          onClick={() => go('match')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Start a match */}
        <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Start a match</h2>
              <p className="text-xs text-slate-500">Three steps. Your selection follows you across pages.</p>
            </div>
          </div>
          <ol className="space-y-2">
            {steps.map((st) => (
              <li
                key={st.n}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                  st.done ? 'border-navy-200 bg-navy-50/50' : 'border-surface-border bg-white',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
                    st.done ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {st.done ? <Check className="h-4 w-4" /> : st.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-900">{st.title}</p>
                  <p className="truncate text-xs text-slate-500">{st.detail}</p>
                </div>
                <Button size="sm" variant={st.n === 3 ? 'primary' : 'secondary'} onClick={st.action}>
                  {st.cta}
                </Button>
              </li>
            ))}
          </ol>
        </section>

        {/* Recent job descriptions */}
        <section className="rounded-2xl border border-surface-border bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Recent job descriptions</h2>
              <p className="text-xs text-slate-500">Pick one to match against</p>
            </div>
            <button type="button" onClick={() => go('jobs')} className="inline-flex items-center gap-1 text-xs font-semibold text-navy-600 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {recentJDs.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-slate-500">No job descriptions yet.</p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {recentJDs.map((jd) => {
                const active = selectedJD === jd.id;
                return (
                  <li key={jd.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-500')}>
                      {active ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-900">{jd.job_title || jd.filename || 'Untitled'}</p>
                      <p className="truncate text-xs text-slate-400">{formatDate(jd.upload_date)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectJD(active ? null : jd.id)}
                      className={cn(
                        'shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                        active ? 'bg-navy-600 text-white hover:bg-navy-700' : 'text-navy-600 hover:bg-navy-50',
                      )}
                    >
                      {active ? 'Selected' : 'Select'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {quickActions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.title}
              onClick={a.onClick}
              className="group flex items-center gap-3.5 rounded-2xl border border-surface-border bg-white p-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-navy-200 hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.10)]"
            >
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', TONE[a.tone].tile)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900">{a.title}</span>
                <span className="block truncate text-xs text-slate-500">{a.description}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-navy-600" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
