'use client';
import React, { useEffect } from 'react';
import {
  Upload,
  Database,
  Users,
  Award,
  Briefcase,
  Target,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { PageHeader } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';

export default function DashboardPage() {
  const {
    cvs,
    jds,
    totalCVs,
    totalJDs,
    matchResult,
    setCurrentTab,
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

  const nextStep =
    cvCount === 0 && jdCount === 0
      ? 'Upload CVs and a job description to start matching.'
      : cvCount === 0
        ? 'Upload candidate CVs to build your database.'
        : jdCount === 0
          ? 'Upload a job description so we can rank candidates.'
          : 'You’re ready — open the Database and run a match.';

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
      onClick: () => setCurrentTab('upload'),
    },
    {
      icon: Database,
      title: 'Review database',
      description: 'Browse and manage uploaded documents',
      onClick: () => { setDatabaseActiveTab('cvs'); setCurrentTab('database'); },
      disabled: cvCount === 0 && jdCount === 0,
    },
    {
      icon: Target,
      title: 'Run matching',
      description: 'Rank candidates against a job description',
      onClick: () => setCurrentTab('match'),
    },
    {
      icon: Briefcase,
      title: 'Manage jobs',
      description: 'Post openings and review applicants',
      onClick: () => setCurrentTab('careers'),
    },
  ];

  return (
    <div>
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
        />
        <StatCard
          label="Job positions"
          value={loadingStates.jds.isLoading ? '—' : jdCount}
          icon={Briefcase}
          hint="Available for matching"
        />
        <StatCard
          label="AI matches"
          value={loadingStates.cvs.isLoading || loadingStates.jds.isLoading ? '—' : totalMatches}
          icon={Award}
          hint="In the latest run"
        />
      </div>

      {/* Next step banner */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="section-label">Next step</p>
          <p className="mt-1 text-[13px] text-gray-700">{nextStep}</p>
        </div>
        <button
          onClick={() =>
            cvCount === 0 || jdCount === 0
              ? setCurrentTab('upload')
              : (setDatabaseActiveTab('cvs'), setCurrentTab('database'))
          }
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700"
        >
          {cvCount === 0 || jdCount === 0 ? 'Upload documents' : 'Go to database'}
          <ArrowRight className="h-4 w-4" />
        </button>
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
              className="group flex flex-col items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-brand-300 hover:bg-brand-50/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-white"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-gray-900">{a.title}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{a.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* System status */}
      <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-success-50 text-success-600">
            <CheckCircle2 className="h-[18px] w-[18px]" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-gray-900">System operational</p>
            <p className="text-xs text-gray-500">AI matching ready &middot; Database connected</p>
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
