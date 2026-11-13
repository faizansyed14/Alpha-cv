import { ArrowRight, Briefcase, Code2, FileText, Plus, RefreshCw, SlidersHorizontal, Sparkles, Target, Upload, Users } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { PageHeader, Section } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { Bone, SkeletonCandidateCard, SkeletonFilterRail, SkeletonHeader, SkeletonJobCards, SkeletonRegion, SkeletonStats, SkeletonTable } from './blocks';

/**
 * Page placeholders. The rule: what is always the same (titles, descriptions, buttons, tab names, column headings, tile labels) is drawn for
 * real, exactly as the page draws it; only what comes from the data (names, numbers, rows, charts) is a placeholder, in the shape it will
 * have. A placeholder never stands in for a title or a button.
 */

function ChartBars({ bars, className }: { bars: number; className?: string }) {
  const heights = [38, 62, 48, 80, 55, 70, 42, 90, 60, 52, 75, 46, 68, 58];
  return (
    <div className={`flex items-end gap-2 ${className ?? ''}`}>
      {Array.from({ length: bars }).map((_, i) => <Bone key={i} className="flex-1 rounded-t-md" style={{ height: `${heights[i % heights.length]}%` }} />)}
    </div>
  );
}

function JobListRows({ withAvatar }: { withAvatar?: boolean }) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2.5">
          {withAvatar ? <Bone className="h-6 w-6 shrink-0 rounded-full" /> : <Bone className="h-3 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3"><Bone className="h-4 w-2/3" /><Bone className="h-4 w-6" /></div>
            <Bone className="mt-2 h-1.5 w-full rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardSkeleton() {
  return (
    <SkeletonRegion label="Loading dashboard" className="space-y-5">
      <section className="hero-surface relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 sm:py-9">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <Bone className="h-3.5 w-44 !bg-white/20" />
            <Bone className="h-9 w-72 max-w-full !bg-white/20" />
            <Bone className="h-4 w-[26rem] max-w-full !bg-white/20" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hero-btn hero-btn-solid"><Plus /> Post a job</span>
            <span className="hero-btn"><Upload /> Upload CVs</span>
            <span className="hero-btn"><Target /> New match</span>
          </div>
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Candidates" value="" icon={Users} hint="In the talent pool" loading />
        <StatCard label="Job descriptions" value="" icon={Briefcase} hint="Roles ready to match" loading />
        <StatCard label="Live jobs" value="" icon={Sparkles} hint="Live and closed jobs" loading />
        <StatCard label="Applications" value="" icon={Target} tone="iris" hint="Applications received" loading />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Applications received" subtitle="Per day, last 14 days" className="lg:col-span-2" action={<Bone className="h-8 w-16" />}>
          <ChartBars bars={14} className="h-[220px]" />
        </Section>
        <Section title="Jobs posted" subtitle="Per month, last 6 months">
          <ChartBars bars={6} className="h-[150px]" />
          <div className="mt-5 border-t border-surface-border pt-4"><Bone className="h-2.5 w-full rounded-full" /></div>
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Busiest jobs" subtitle="Most applicants first" action={<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-navy-700">All jobs <ArrowRight className="h-3.5 w-3.5" /></span>}>
          <JobListRows />
        </Section>
        <Section title="Recently posted" subtitle="Newest first" action={<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-navy-700">Manage <ArrowRight className="h-3.5 w-3.5" /></span>}>
          <JobListRows withAvatar />
        </Section>
      </div>
    </SkeletonRegion>
  );
}

export function UploadSkeleton() {
  return (
    <SkeletonRegion label="Loading upload">
      <PageHeader title="Upload documents" description="Add candidate CVs and job descriptions to start AI-powered matching." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-surface-border bg-paper p-5 shadow-card">
            <div className="mb-3 flex items-center gap-3">
              <Bone className="h-9 w-9 rounded-md" />
              <div className="space-y-2">
                <Bone className="h-4 w-32" />
                <Bone className="h-3 w-48" />
              </div>
            </div>
            <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-border bg-navy-50/40">
              <Bone className="h-12 w-12 rounded-full" />
              <Bone className="h-4 w-40" />
              <Bone className="h-3 w-24" />
              <Bone className="mt-2 h-8 w-28" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function CandidatesListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading candidates" className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCandidateCard key={i} />
      ))}
    </div>
  );
}

/** The Talent database page: its header and its two tabs are real, the counts and the list are placeholders. */
function TalentDatabaseChrome({ view, children }: { view: 'candidates' | 'jobs'; children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <PageHeader
        title="Talent database"
        description={view === 'candidates' ? 'Select people, then pick a JD to match.' : 'Pick the JD for your selected candidates.'}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw />} disabled>Refresh</Button>
            {view === 'candidates' && (
              <>
                <Button variant="secondary" size="sm" icon={<Code2 />} disabled>Boolean</Button>
                <Button variant="secondary" size="sm" icon={<SlidersHorizontal />} disabled>Keyword search</Button>
              </>
            )}
            <Button variant="primary" size="sm" icon={<Upload />} disabled>Upload</Button>
          </>
        }
      />
      <div className="mb-3 flex items-center gap-1">
        {([['candidates', 'Candidates', Users], ['jobs', 'Job descriptions', FileText]] as const).map(([id, label, Icon]) => (
          <span key={id} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${view === id ? 'bg-navy-50 text-navy-800' : 'text-slate-500'}`}>
            <Icon className="h-3.5 w-3.5" /> {label}
            <span className="rounded-md bg-paper px-1.5 py-0.5"><Bone className="h-3 w-5" /></span>
          </span>
        ))}
      </div>
      <div className="toolbar-bar">
        <Bone className="h-9 min-w-[200px] flex-1 rounded-lg" />
        <Bone className="h-9 w-32 rounded-lg" />
        <Bone className="h-9 w-36 rounded-lg" />
      </div>
      {children}
    </div>
  );
}

export function CandidatesSkeleton() {
  return (
    <SkeletonRegion label="Loading candidates">
      <TalentDatabaseChrome view="candidates">
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start">
          <SkeletonFilterRail />
          <div className="min-w-0 flex-1">
            <CandidatesListSkeleton />
          </div>
        </div>
      </TalentDatabaseChrome>
    </SkeletonRegion>
  );
}

export function JobsSkeleton() {
  return (
    <SkeletonRegion label="Loading job descriptions">
      <TalentDatabaseChrome view="jobs">
        <SkeletonJobCards />
      </TalentDatabaseChrome>
    </SkeletonRegion>
  );
}

export function MatchSkeleton() {
  return (
    <SkeletonRegion label="Loading match">
      <PageHeader title="Matching" description="Run a match against a job description" />
      <SkeletonStats count={3} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-3 rounded-2xl border border-surface-border bg-paper p-4">
          <Bone className="h-4 w-24" />
          <Bone className="h-9 w-full" />
          <Bone className="h-9 w-full" />
          <Bone className="h-9 w-full" />
        </div>
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-surface-border bg-paper p-4">
              <div className="flex items-center justify-between gap-3">
                <Bone className="h-4 w-1/3" />
                <Bone className="h-6 w-16 rounded-full" />
              </div>
              <Bone className="mt-3 h-2 w-full rounded-full" />
              <Bone className="mt-3 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function ReportsSkeleton() {
  return (
    <SkeletonRegion label="Loading reports">
      <PageHeader title="Analytics & Reports" description="Generate comprehensive matching reports and insights" />
      <SkeletonStats count={4} />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-2xl border border-surface-border bg-paper p-4">
          <Bone className="h-4 w-32" />
          <Bone className="mt-4 h-36 w-full" />
        </div>
        <div className="h-56 rounded-2xl border border-surface-border bg-paper p-4">
          <Bone className="h-4 w-40" />
          <Bone className="mt-4 h-36 w-full" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function SystemSkeleton() {
  return (
    <SkeletonRegion label="Loading system status">
      <PageHeader title="System Status" description="Monitor system health and performance" />
      <div className="rounded-xl border border-surface-border bg-paper p-5 shadow-card">
        <div className="flex items-center gap-3">
          <Bone className="h-9 w-9 rounded-md" />
          <div className="space-y-2">
            <Bone className="h-4 w-28" />
            <Bone className="h-3 w-40" />
          </div>
        </div>
      </div>
      <div className="mt-4">
        <SkeletonStats count={4} />
      </div>
      <div className="mt-4">
        <SkeletonTable columns={['Service', 'Status', 'Detail']} rows={5} />
      </div>
    </SkeletonRegion>
  );
}

export function MonitorSkeleton() {
  return (
    <SkeletonRegion label="Loading monitor">
      <PageHeader title="Monitor" description="Model calls, matching flow, queues and system health across every API and worker process" />
      <SkeletonStats count={4} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-surface-border bg-paper p-4">
            <Bone className="h-4 w-40" />
            <Bone className="mt-1 h-3 w-56" />
            <Bone className="mt-4 h-36 w-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function MonitorBodySkeleton() {
  return (
    <SkeletonRegion label="Loading monitoring data">
      <SkeletonStats count={4} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-surface-border bg-paper p-4">
            <Bone className="h-4 w-40" />
            <Bone className="mt-4 h-36 w-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function AdminSkeleton({ page = 'users' }: { page?: 'users' | 'bugs' }) {
  return (
    <SkeletonRegion label={page === 'bugs' ? 'Loading bug reports' : 'Loading users'}>
      {page === 'bugs' ? (
        <PageHeader title="Bug reports" description="What users reported. Open one to change its status, set how serious it is, and reply to the reporter." />
      ) : (
        <PageHeader title="Users" description="Manage accounts, roles, and access for your workspace" />
      )}
      <Bone className="mb-4 h-9 w-64" />
      <SkeletonTable columns={page === 'bugs' ? ['Report', 'Severity', 'Status', 'Reported by', 'When'] : ['User', 'Email', 'Role', 'Location', 'Status', 'Actions']} rows={8} />
    </SkeletonRegion>
  );
}

export function LoginSkeleton() {
  return (
    <SkeletonRegion
      label="Loading sign in"
      className="relative flex min-h-screen flex-col bg-[var(--app-bg,#F7F8FA)]"
    >
      <div className="flex h-16 items-center border-b border-slate-200/70 bg-paper/70 px-6 backdrop-blur-xl">
        <Bone className="h-8 w-8 rounded-lg" />
        <div className="ml-3 space-y-1.5">
          <Bone className="h-3 w-20" />
          <Bone className="h-2 w-16" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center gap-2">
            <Bone className="h-7 w-24 rounded-full" />
            <Bone className="h-8 w-40" />
            <Bone className="h-3 w-36" />
          </div>
          <div className="space-y-3 rounded-3xl border border-slate-200/70 bg-paper/80 p-8 shadow-card">
            <Bone className="h-3 w-16" />
            <Bone className="h-11 w-full rounded-xl" />
            <Bone className="h-3 w-16" />
            <Bone className="h-11 w-full rounded-xl" />
            <Bone className="h-11 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function OpeningCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-surface-border bg-paper p-4 shadow-card">
          <Bone className="h-4 w-3/4" />
          <Bone className="mt-3 h-3 w-1/2" />
          <Bone className="mt-4 h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export function OpeningsSkeleton() {
  return (
    <SkeletonRegion label="Loading openings" className="mx-auto max-w-6xl px-4 py-8">
      <Bone className="mb-2 h-8 w-48" />
      <Bone className="mb-6 h-4 w-72" />
      <Bone className="mb-4 h-10 w-full max-w-md" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-surface-border bg-paper p-4 shadow-card">
            <Bone className="h-4 w-3/4" />
            <Bone className="mt-3 h-3 w-1/2" />
            <Bone className="mt-4 h-8 w-24" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function JobDetailSkeleton() {
  return (
    <SkeletonRegion label="Loading job" className="min-h-screen bg-[var(--app-bg)] py-16">
      <div className="mx-auto max-w-7xl space-y-4 px-4 sm:px-6 lg:px-8">
        <Bone className="h-8 w-2/3" />
        <Bone className="h-4 w-1/3" />
        <div className="rounded-2xl border border-surface-border bg-paper p-6">
          <Bone className="h-4 w-full" />
          <Bone className="mt-2 h-4 w-5/6" />
          <Bone className="mt-2 h-4 w-4/6" />
          <Bone className="mt-6 h-10 w-32" />
        </div>
        <div className="rounded-2xl border border-surface-border bg-paper p-6">
          <Bone className="h-4 w-40" />
          <Bone className="mt-3 h-3 w-full" />
          <Bone className="mt-2 h-3 w-full" />
          <Bone className="mt-2 h-3 w-2/3" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function ApplicantsSkeleton() {
  return (
    <SkeletonRegion label="Loading applicants" className="mx-auto max-w-6xl p-4 sm:p-6">
      <Bone className="mb-4 h-8 w-28" />
      <Bone className="h-3 w-16" />
      <Bone className="mt-2 h-7 w-64" />
      <Bone className="mt-2 h-4 w-40" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-surface-border bg-paper p-4">
            <Bone className="h-10 w-10 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Bone className="h-4 w-40" />
              <Bone className="h-3 w-56" />
            </div>
            <Bone className="h-8 w-20" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function BootSkeleton() {
  return (
    <SkeletonRegion label="Loading workspace" className="flex min-h-screen bg-[var(--app-bg)]">
      <aside className="hidden h-screen w-[232px] shrink-0 border-r border-surface-border/70 bg-paper/70 lg:block">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Bone className="h-8 w-8 rounded-xl" />
          <Bone className="h-4 w-20" />
        </div>
        <div className="space-y-5 px-3 pt-2">
          {[4, 2, 3].map((count, g) => (
            <div key={g} className="space-y-1">
              <Bone className="mb-2 ml-2.5 h-2.5 w-16" />
              {Array.from({ length: count }).map((_, k) => (
                <div key={k} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"><Bone className="h-4 w-4 rounded" /><Bone className="h-3.5 w-24" /></div>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 pt-14 sm:p-6 sm:pt-14 lg:px-8">
        <DashboardSkeleton />
      </div>
    </SkeletonRegion>
  );
}
