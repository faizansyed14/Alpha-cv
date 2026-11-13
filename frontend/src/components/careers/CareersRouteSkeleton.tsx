'use client';

import { useRouter } from 'next/navigation';
import { Globe, Plus, RefreshCw } from '@/components/icons';
import { Bone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page';
import { JobListHeader, JobRowSkeleton } from './JobRow';
import { JobWorkspaceSkeleton } from './JobWorkspace';

/** The jobs list while its page loads: the Careers header, tabs and toolbar are real; the job rows are placeholders. */
export function CareersListSkeleton() {
  return (
    <div className="min-h-[calc(100vh-8rem)]" role="status" aria-busy="true" aria-label="Loading careers">
      <PageHeader
        title="Careers"
        description="Jobs, applicants, database matches, and AI scoring."
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} disabled aria-label="Refresh the list" />
            <Button variant="secondary" size="sm" icon={<Globe className="h-4 w-4" />} disabled>Public page</Button>
            <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} disabled>Post a job</Button>
          </>
        }
      />
      <div className="toolbar-bar !mb-3 items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {['All', 'Live', 'Inactive'].map((label, i) => (
            <span key={label} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${i === 0 ? 'bg-navy-50 text-navy-800' : 'text-slate-500'}`}>
              {label}
              <span className="rounded-md bg-paper px-1.5 py-0.5"><Bone className="h-3 w-4" /></span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Bone className="h-8 w-64 rounded-lg" />
          <Bone className="h-8 w-40 rounded-lg" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-surface-border bg-paper shadow-card">
        <JobListHeader />
        {Array.from({ length: 8 }).map((_, i) => <JobRowSkeleton key={i} />)}
      </div>
    </div>
  );
}

/** A job's page while its code loads. */
export function CareersJobSkeleton() {
  const router = useRouter();
  return <JobWorkspaceSkeleton onBack={() => router.push('/careers-manage')} />;
}
