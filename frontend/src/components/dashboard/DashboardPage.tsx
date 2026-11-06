'use client';

import { useEffect } from 'react';
import {
  Upload,
  Users,
  Award,
  Briefcase,
  Target,
  Globe2,
  KanbanSquare,
  ArrowRight,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { DashboardSkeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { TONE, type Tone } from '@/lib/tones';

type WorkspaceLink = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  onClick: () => void;
};

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
    loadCVs,
    loadJDs,
    loadingStates,
  } = useAppStore();

  const cvCount = totalCVs ?? cvs.length;
  const jdCount = totalJDs ?? jds.length;
  const totalMatches = matchResult?.candidates.length || 0;
  const hasSelection = selectedCVs.length > 0 || !!selectedJD;

  useEffect(() => {
    loadCVs();
    loadJDs();
  }, [loadCVs, loadJDs]);

  const bootstrapping =
    cvs.length === 0 &&
    jds.length === 0 &&
    (loadingStates.cvs.isLoading || loadingStates.jds.isLoading);

  if (bootstrapping) {
    return <DashboardSkeleton />;
  }

  const workspace: WorkspaceLink[] = [
    {
      id: 'candidates',
      title: 'Candidates',
      description: 'Search, filter, and review CVs',
      icon: Users,
      tone: 'indigo',
      onClick: () => go('candidates'),
    },
    {
      id: 'jobs',
      title: 'Job descriptions',
      description: 'Manage roles ready to match',
      icon: Briefcase,
      tone: 'sky',
      onClick: () => go('jobs'),
    },
    {
      id: 'match',
      title: 'AI matching',
      description: 'Rank candidates against a role',
      icon: Target,
      tone: 'violet',
      onClick: () => go('match'),
    },
    {
      id: 'upload',
      title: 'Upload',
      description: 'Add CVs and job descriptions',
      icon: Upload,
      tone: 'cyan',
      onClick: () => go('upload'),
    },
    {
      id: 'careers',
      title: 'Careers portal',
      description: 'Openings and incoming applicants',
      icon: Globe2,
      tone: 'emerald',
      onClick: () => go('careers'),
    },
    {
      id: 'tracker',
      title: 'Hiring tracker',
      description: 'Move candidates through stages',
      icon: KanbanSquare,
      tone: 'amber',
      onClick: () => go('tracker'),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-navy-800 bg-navy-950 px-6 py-7 text-white shadow-card sm:px-8 sm:py-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#4A6BC8]/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[#6B86C8]/20 blur-3xl"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">
              Welcome back{user?.username ? `, ${user.username}` : ''}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-navy-100/80">
              AI screening for recruiters. Find the best fits, review ranked results, and keep hiring moving.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<Upload />}
              onClick={() => go('upload')}
              className="border-white/15 bg-white/10 text-white hover:bg-white/15"
            >
              Upload
            </Button>
            <Button variant="primary" icon={<Target />} onClick={() => go('match')} className="bg-white text-navy-900 hover:bg-navy-50">
              New match
            </Button>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Candidates"
          tone="indigo"
          value={loadingStates.cvs.isLoading && !cvCount ? '-' : cvCount.toLocaleString()}
          icon={Users}
          hint="In your talent database"
          onClick={() => go('candidates')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
        <StatCard
          label="Job descriptions"
          tone="sky"
          value={loadingStates.jds.isLoading && !jdCount ? '-' : jdCount.toLocaleString()}
          icon={Briefcase}
          hint="Roles ready to match"
          onClick={() => go('jobs')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
        <StatCard
          label="Latest match"
          tone="amber"
          value={totalMatches.toLocaleString()}
          icon={Award}
          hint={totalMatches ? 'Ranked in the last run' : 'No match run yet'}
          onClick={() => go('match')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
        <StatCard
          label="Ready to match"
          tone="violet"
          value={selectedCVs.length.toLocaleString()}
          icon={Target}
          hint={selectedJD ? 'Job selected' : selectedCVs.length ? 'Pick a job next' : 'Select CVs to begin'}
          onClick={() => go(selectedCVs.length ? 'jobs' : 'candidates')}
          className="cursor-pointer transition-shadow hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.12)]"
        />
      </div>

      {hasSelection && (
        <div className="flex flex-col gap-3 rounded-2xl border border-navy-100 bg-navy-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-navy-900">Selection carried across pages</p>
            <p className="mt-0.5 truncate text-xs text-navy-700/80">
              {selectedCVs.length} candidate{selectedCVs.length === 1 ? '' : 's'}
              {selectedJD ? ' · 1 job description' : ' · no job yet'}
            </p>
          </div>
          <Button size="sm" variant="primary" icon={<Target />} onClick={() => go('match')} disabled={!selectedCVs.length || !selectedJD}>
            Continue to match
          </Button>
        </div>
      )}

      {/* Workspace */}
      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Workspace</h2>
            <p className="text-xs text-slate-500">Jump into the tools you use every day</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {workspace.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className="group flex items-start gap-3.5 rounded-2xl border border-surface-border bg-white p-4 text-left shadow-card transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-[0_8px_24px_-12px_rgba(16,24,40,0.18)]"
              >
                <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', TONE[item.tone].tile)}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">{item.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-navy-600" />
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
