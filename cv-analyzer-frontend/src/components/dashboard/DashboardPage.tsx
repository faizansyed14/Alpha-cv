'use client';
import React, { useEffect } from 'react';
import {
  Upload,
  Database,
  Users,
  Award,
  Briefcase,
  Target,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';

export default function DashboardPage() {
  const { go } = useWorkspaceNav();
  const {
    cvs,
    jds,
    totalCVs,
    totalJDs,
    matchResult,
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

  const quickActions: {
    icon: typeof Upload;
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
  }[] = [
    {
      icon: Upload,
      title: 'Upload documents',
      description: 'Add candidate CVs and job descriptions',
      onClick: () => go('upload'),
    },
    {
      icon: Database,
      title: 'Review database',
      description: 'Browse and manage uploaded documents',
      onClick: () => { setDatabaseActiveTab('cvs'); go('candidates'); },
      disabled: cvCount === 0 && jdCount === 0,
    },
    {
      icon: Target,
      title: 'Run matching',
      description: 'Rank candidates against a job description',
      onClick: () => go('match'),
    },
    {
      icon: Briefcase,
      title: 'Manage jobs',
      description: 'Post openings and review applicants',
      onClick: () => go('careers'),
    },
  ];

  return (
    <div className="space-y-1">
      <PageHeader
        title="Dashboard"
        description="Overview of your recruitment workspace"
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Candidates"
          value={loadingStates.cvs.isLoading ? '—' : cvCount}
          icon={Users}
          hint="Ready for matching"
          className="transition-shadow duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)]"
        />
        <StatCard
          label="Job positions"
          value={loadingStates.jds.isLoading ? '—' : jdCount}
          icon={Briefcase}
          hint="Available for matching"
          className="transition-shadow duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)]"
        />
        <StatCard
          label="AI matches"
          value={loadingStates.cvs.isLoading || loadingStates.jds.isLoading ? '—' : totalMatches}
          icon={Award}
          hint="In the latest run"
          className="transition-shadow duration-[var(--duration-fast)] hover:shadow-[var(--shadow-md)]"
        />
      </div>

      {/* Quick actions */}
      <p className="section-label mt-6 mb-2">Quick actions</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((a) => {
          const Icon = a.icon;
          return (
            <button
              key={a.title}
              onClick={a.onClick}
              disabled={a.disabled}
              className="group flex flex-col items-start gap-3 rounded-lg border border-surface-border bg-paper p-4 text-left shadow-[var(--shadow-sm)] transition-colors hover:border-navy-400 hover:bg-navy-50/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-surface-border disabled:hover:bg-paper"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-50 text-navy-500">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-navy-800">{a.title}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{a.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* System status */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-surface-border bg-paper p-4 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-success-50 text-success-600">
            <CheckCircle2 className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">System operational</p>
            <p className="text-xs text-slate-500">AI matching ready &middot; Database connected</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-success-500" />
          Online
        </span>
      </div>
    </div>
  );
}
