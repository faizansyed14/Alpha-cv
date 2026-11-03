import { Bone, SkeletonCandidateCard, SkeletonFilterRail, SkeletonHeader, SkeletonRegion, SkeletonStats, SkeletonTable } from './blocks';

export function DashboardSkeleton() {
  return (
    <SkeletonRegion label="Loading dashboard" className="space-y-6">
      <SkeletonHeader withActions />
      <SkeletonStats count={3} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-surface-border bg-paper p-5 shadow-card">
            <Bone className="mb-3 h-4 w-40" />
            {Array.from({ length: 3 }).map((__, j) => (
              <div key={j} className="flex items-center gap-3 rounded-xl border border-surface-border p-3">
                <Bone className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Bone className="h-3.5 w-40" />
                  <Bone className="h-3 w-56" />
                </div>
                <Bone className="h-8 w-24" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function UploadSkeleton() {
  return (
    <SkeletonRegion label="Loading upload">
      <SkeletonHeader withActions />
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
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCandidateCard key={i} />
      ))}
    </div>
  );
}

export function CandidatesSkeleton() {
  return (
    <SkeletonRegion label="Loading candidates">
      <SkeletonHeader withActions actionCount={2} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Bone className="h-9 w-56" />
        <Bone className="h-9 w-32" />
        <Bone className="h-9 w-36" />
      </div>
      <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start">
        <SkeletonFilterRail />
        <div className="min-w-0 flex-1">
          <CandidatesListSkeleton />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function JobsTableSkeleton() {
  return <SkeletonTable columns={['', 'Job title', 'Filename', 'Skills', 'Upload date', 'Actions']} rows={8} />;
}

export function JobsSkeleton() {
  return (
    <SkeletonRegion label="Loading job descriptions">
      <SkeletonHeader withActions actionCount={2} />
      <Bone className="mb-4 h-9 w-56" />
      <JobsTableSkeleton />
    </SkeletonRegion>
  );
}

export function MatchSkeleton() {
  return (
    <SkeletonRegion label="Loading match">
      <SkeletonHeader withActions />
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

export function CareersSkeleton() {
  return (
    <SkeletonRegion label="Loading careers" className="p-4 sm:p-6">
      <SkeletonHeader withActions actionCount={2} />
      <div className="mb-4 rounded-2xl border border-surface-border bg-paper p-4">
        <Bone className="h-3 w-40" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Bone className="h-9 w-36" />
          <Bone className="h-9 w-36" />
          <Bone className="h-9 w-28" />
        </div>
      </div>
      <Bone className="mb-3 h-9 w-64" />
      <SkeletonTable columns={['Title', 'Location', 'Status', 'Posted by', 'Created']} rows={8} />
    </SkeletonRegion>
  );
}

export function EmailSkeleton() {
  return (
    <SkeletonRegion label="Loading email">
      <SkeletonHeader withActions />
      <SkeletonStats count={4} />
      <div className="mt-4 rounded-xl border border-surface-border bg-white p-5 shadow-card">
        <Bone className="mb-3 h-3 w-36" />
        <div className="flex flex-wrap gap-2">
          <Bone className="h-6 w-24 rounded-full" />
          <Bone className="h-6 w-28 rounded-full" />
          <Bone className="h-6 w-24 rounded-full" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function ReportsSkeleton() {
  return (
    <SkeletonRegion label="Loading reports">
      <SkeletonHeader withActions actionCount={2} />
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
      <SkeletonHeader withActions />
      <div className="rounded-xl border border-surface-border bg-white p-5 shadow-card">
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
      <SkeletonHeader withActions actionCount={2} />
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

export function AdminSkeleton() {
  return (
    <SkeletonRegion label="Loading admin">
      <SkeletonHeader withActions />
      <Bone className="mb-4 h-9 w-64" />
      <SkeletonTable columns={['User', 'Email', 'Role', 'Team', 'Status']} rows={8} />
    </SkeletonRegion>
  );
}

export function TrackerSkeleton() {
  return (
    <SkeletonRegion label="Loading tracker" className="flex h-screen overflow-hidden bg-[var(--app-bg)]">
      <div className="hidden w-52 shrink-0 flex-col gap-2 border-r border-surface-border bg-white p-3 md:flex">
        <Bone className="h-8 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Bone key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="min-w-0 flex-1 p-4">
        <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3">
          <Bone className="h-4 w-40" />
          <Bone className="h-8 w-28" />
        </div>
        <SkeletonTable columns={['Name', 'Role', 'Status', 'Owner', 'Updated']} rows={10} />
      </div>
    </SkeletonRegion>
  );
}

export function LoginSkeleton() {
  return (
    <SkeletonRegion label="Loading sign in" className="flex min-h-screen w-full items-center justify-center bg-[var(--app-bg)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-slate-200 bg-white p-2 shadow-[var(--shadow-md)]">
            <img src="/alphadatalogo.svg" alt="" className="h-full w-full object-contain" />
          </div>
          <Bone className="h-5 w-28" />
          <Bone className="mt-2 h-3 w-48" />
        </div>
        <div className="space-y-3 rounded-2xl border border-surface-border bg-paper p-6 shadow-[var(--shadow-md)]">
          <Bone className="h-3 w-16" />
          <Bone className="h-9 w-full" />
          <Bone className="h-3 w-16" />
          <Bone className="h-9 w-full" />
          <Bone className="h-9 w-full" />
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
      <div className="mx-auto max-w-3xl space-y-4 px-4">
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
    <SkeletonRegion label="Loading workspace" className="min-h-screen bg-[var(--app-bg)]">
      <div className="flex h-14 items-center gap-3 border-b border-surface-border bg-paper/95 px-4">
        <Bone className="h-7 w-7 rounded-md" />
        <Bone className="h-4 w-24" />
        <div className="ml-4 hidden items-center gap-2 lg:flex">
          <Bone className="h-8 w-24" />
          <Bone className="h-8 w-20" />
          <Bone className="h-8 w-24" />
          <Bone className="h-8 w-20" />
        </div>
      </div>
      <div className="p-4 sm:p-6">
        <DashboardSkeleton />
      </div>
    </SkeletonRegion>
  );
}
