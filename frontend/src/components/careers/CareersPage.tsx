'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Briefcase, Copy, Download, ExternalLink, Globe, Plus, RefreshCw, Search, Trash2, X } from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { JobPostingListItem } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { ToastContainer, useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import JobPostingForm from './JobPostingForm';
import JobRow, { JobListHeader, JobRowSkeleton, type JobHandlers, type JobTab, type MatchScope } from './JobRow';
import { Bone } from '@/components/skeletons';
import JobAiDialog, { type JobAiKind } from './JobAiDialog';
import HiringImageDialog from './HiringImageDialog';
import WeeklyReportDialog from './WeeklyReportDialog';

type Owner = 'yours' | 'all' | 'others';
type Status = 'all' | 'active' | 'inactive';
const TABS: JobTab[] = ['applicants', 'database', 'details'];

function jobHref(jobId: string, tab: JobTab = 'applicants', edit = false) {
  const q = new URLSearchParams();
  if (tab !== 'applicants') q.set('tab', tab);
  if (edit) q.set('edit', '1');
  const qs = q.toString();
  return `/careers-manage/${encodeURIComponent(jobId)}${qs ? `?${qs}` : ''}`;
}

function errorText(error: any, fallback: string): string {
  return error?.detail || error?.response?.data?.detail || error?.message || fallback;
}

export default function CareersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { jobPostings, totalJobPostings, jobCounts, isLoading, error, loadJobPostings, loadMoreJobPostings, updateJobStatus, selectJob, matchJobCandidates } = useCareersStore();
  const { setMatchingProgress, hideMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const { go } = useWorkspaceNav();
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [showCreateForm, setShowCreateForm] = useState(false);
  // "Post job" from a requirement opens this page with the requirement's job description ready (nothing is posted until Post job is clicked)
  const [fromJd, setFromJd] = useState<{ id: string; name: string; requirementId: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const id = q.get('postFromJd');
    if (!id) return;
    setFromJd({ id, name: q.get('jdName') || '', requirementId: q.get('requirement') || '' });
    setShowCreateForm(true);
    router.replace('/careers-manage');
  }, [router]);

  const [ai, setAi] = useState<{ job: JobPostingListItem; kind: JobAiKind } | null>(null);
  const [image, setImage] = useState<JobPostingListItem | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [openingsUrl, setOpeningsUrl] = useState('/careers/openings');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<JobPostingListItem | null>(null);
  const [owner, setOwner] = useState<Owner>('yours');
  const [status, setStatus] = useState<Status>('all');
  const [query, setQuery] = useState('');
  const [firstLoadDone, setFirstLoadDone] = useState(false);

  useEffect(() => {
    setOpeningsUrl(`${window.location.origin}/careers/openings`);
    // Legacy ?job= deep links → full job page
    try {
      const p = new URLSearchParams(window.location.search);
      const job = p.get('job');
      if (job) {
        const tab = p.get('tab');
        const t = tab && TABS.includes(tab as JobTab) ? (tab as JobTab) : 'applicants';
        router.replace(jobHref(job, t));
      }
    } catch {
      /* ignore */
    }
  }, [router]);

  // The server filters and searches every posting; a change of filter loads the first page of what matches (the typed search waits a moment).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        await loadJobPostings({ q: query.trim(), scope: owner === 'yours' ? 'mine' : owner === 'others' ? 'others' : 'all', status });
      } finally {
        setFirstLoadDone(true);      // the loading skeleton is for the first load only: typing in the search box must not replace the page
      }
    }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [owner, status, query, loadJobPostings]);

  const copy = useCallback((text: string, what: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    showSuccess(`${what} copied`);
  }, [showSuccess]);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await loadJobPostings();
    } finally {
      setIsRefreshing(false);
    }
  };

  /** Scores a job's applicants and/or the database candidates its boolean string finds, and shows the ranking on the Match page. */
  const startMatch = async (job: JobPostingListItem, scope: MatchScope, customQuery: string | null = null, expected?: number) => {
    setMatchingProgress({
      totalCVs: expected ?? job.application_count ?? 0,
      processedCVs: 0,
      currentStage: 'initializing',
      isVisible: true,
      estimatedTimeRemaining: undefined,
    });
    setAppLoading('careersMatching', true);
    go('match');
    try {
      let databaseIds: string[] = [];
      if (scope !== 'applicants') {
        databaseIds = (await api.getJobDatabaseCandidateIds(job.job_id, customQuery)).ids;
      }
      selectJob(job);
      await matchJobCandidates(job.job_id, { applicants: scope !== 'database', databaseIds });
    } catch (e) {
      // matchJobCandidates reports its own failure; this covers a failure before it started (the database search)
      hideMatchingProgress();
      setAppLoading('careersMatching', false, errorText(e, 'Matching could not be started. Please try again.'));
    }
  };

  const removeJob = async (job: JobPostingListItem) => {
    setDeleting(true);
    try {
      const response = await api.deleteJobPosting(job.job_id);
      if (!response.success) throw new Error('The job could not be deleted.');
      await loadJobPostings();
      showSuccess('Job deleted', `"${job.job_title}" was removed. Its ${response.details?.applications_archived ?? 0} application(s) were archived.`);
    } catch (e: any) {
      const text = String(e?.message || '');
      showError('Job not deleted',
        text.includes('404') || text.includes('not found') ? 'It may have been deleted already.'
          : text.includes('403') || text.includes('only delete') ? 'You can only delete jobs that you posted.'
            : 'Please try again.');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const handlers: JobHandlers = {
    onOpen: (job, tab = 'applicants', edit = false) => {
      router.push(jobHref(job.job_id, tab, edit));
    },
    onMatch: (job, scope) => void startMatch(job, scope),
    onAi: (job, kind) => setAi({ job, kind }),
    onImage: (j) => setImage(j),
    onToggleStatus: async (job) => {
      const ok = await updateJobStatus(job.job_id, !job.is_active);
      if (ok) showSuccess(job.is_active ? 'Job deactivated' : 'Job is live', job.is_active ? 'It no longer takes applications.' : 'It takes applications again.');
      else showError('Status not changed', 'Please try again.');
    },
    onDelete: (job) => setConfirmDelete(job),
    onCopy: copy,
  };

  if (!user) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You need to be logged in to access the careers page.</span>
        </div>
      </div>
    );
  }

  const initialLoading = !firstLoadDone;      // the page, its tabs and its toolbar are real; only the job rows are placeholders

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>The jobs could not be loaded: {error}</p>
            <button type="button" className="mt-1 font-semibold underline underline-offset-2" onClick={refresh}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  const filtered = !!query.trim() || status !== 'all' || owner !== 'all';
  const shownTotal = totalJobPostings ?? jobPostings.length;
  const hasMore = totalJobPostings != null && jobPostings.length < totalJobPostings;
  const postJob = (
    <Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateForm(true)} disabled={showCreateForm}>
      Post a job
    </Button>
  );

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <ToastContainer toasts={toasts} onClose={removeToast} />

      <PageHeader
        title="Careers"
        description="Jobs, applicants, database matches, and AI scoring."
        actions={
          <>
            <IconButton label="Refresh the list" icon={<RefreshCw />} loading={isRefreshing} onClick={refresh} tip="bottom" />
            <Menu
              trigger={({ ref, ...props }) => (
                <Button ref={ref} variant="secondary" size="sm" icon={<Globe className="h-4 w-4" />} {...props}>Public page</Button>
              )}
              items={[
                { label: 'Open the public jobs page', hint: 'What candidates see', icon: <ExternalLink />, onSelect: () => window.open(openingsUrl, '_blank', 'noopener') },
                { label: 'Copy its link', icon: <Copy />, onSelect: () => copy(openingsUrl, 'Public jobs page link') },
                user.role === 'admin' && { label: 'Weekly analysis report', hint: 'Word document for a date range', icon: <Download />, separated: true, onSelect: () => setShowReport(true) },
              ]}
            />
            {postJob}
          </>
        }
      />

      {/* new job */}
      {showCreateForm && (
        <section className="mb-5" aria-label="Post a new job">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">New job</h2>
            <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setShowCreateForm(false); setFromJd(null); }}>Close</Button>
          </div>
          <JobPostingForm
            key={fromJd?.id || 'new'}
            fromJdId={fromJd?.id}
            fromJdName={fromJd?.name}
            onPosted={(jobId) => {
              if (fromJd?.requirementId) {
                api.markRequirementPosted(fromJd.requirementId, jobId).catch(() => showError('The requirement was not updated', 'The job is posted, but the requirement could not be linked to it.'));
              }
            }}
            onSuccess={() => {
              setShowCreateForm(false);
              setFromJd(null);
              void loadJobPostings();
            }}
          />
        </section>
      )}

      {/* filters: status tabs, search, whose jobs — one dense toolbar */}
      <div className="toolbar-bar !mb-3 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div role="tablist" aria-label="Job status" className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
          {([['all', 'All', jobCounts.all], ['active', 'Live', jobCounts.active], ['inactive', 'Inactive', jobCounts.inactive]] as const).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={status === id}
              onClick={() => setStatus(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors',
                status === id ? 'bg-navy-50 text-navy-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              {label}
              <span className={cn('rounded-md px-1.5 py-0.5 text-2xs tabular-nums', status === id ? 'bg-paper text-navy-800' : 'bg-slate-100 text-slate-600')}>
                {initialLoading ? <Bone className="h-3 w-4" /> : n.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <label htmlFor="job-search" className="sr-only">Search jobs</label>
            <input
              id="job-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, recruiter, subject"
              className="field-input h-8 w-full !pl-8 pr-7 text-sm"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Segmented<Owner>
            value={owner}
            onChange={setOwner}
            size="sm"
            items={[
              { value: 'yours', label: 'Mine' },
              { value: 'all', label: 'All' },
              { value: 'others', label: 'Others' },
            ]}
          />
        </div>
      </div>

      {/* the jobs */}
      {initialLoading ? (
        <div className="overflow-hidden rounded-xl border border-surface-border bg-paper shadow-card" role="status" aria-busy="true" aria-label="Loading jobs">
          <JobListHeader />
          {Array.from({ length: 8 }).map((_, i) => <JobRowSkeleton key={i} />)}
        </div>
      ) : jobPostings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={filtered ? 'No jobs match these filters' : 'No jobs yet'}
          hint={filtered ? (owner === 'yours' ? 'You are looking at your own jobs. Switch to Everyone to see the whole team\'s.' : 'Change the search or the filters above.') : 'Post your first job to start receiving applications.'}
          action={filtered && owner === 'yours' ? <Button variant="secondary" onClick={() => setOwner('all')}>Show everyone&apos;s jobs</Button> : postJob}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-surface-border bg-paper shadow-card" role="table" aria-label="Jobs">
            <JobListHeader />
            {jobPostings.map((job) => (
              <JobRow key={job.job_id} job={job} currentUser={user.username} handlers={handlers} />
            ))}
          </div>
          <p className="mt-2 text-center text-xs tabular-nums text-slate-500">
            {jobPostings.length.toLocaleString()} of {shownTotal.toLocaleString()} job{shownTotal === 1 ? '' : 's'}
          </p>
          <InfiniteScrollSentinel hasMore={hasMore} loading={isLoading} itemCount={jobPostings.length} onLoadMore={() => loadMoreJobPostings()} />
        </>
      )}

      {ai && <JobAiDialog job={ai.job} kind={ai.kind} onClose={() => setAi(null)} />}
      {image && <HiringImageDialog jobId={image.job_id} title={image.job_title} onClose={() => setImage(null)} />}
      {showReport && <WeeklyReportDialog onClose={() => setShowReport(false)} />}

      {/* delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this job?</DialogTitle>
            <DialogDescription>&ldquo;{confirmDelete?.job_title}&rdquo;</DialogDescription>
          </DialogHeader>
          {confirmDelete && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <ul className="list-inside list-disc space-y-0.5">
                <li>The job disappears from this list and from the public jobs page.</li>
                <li>Its {confirmDelete.application_count || 0} application(s) are archived, and the candidates stay in the database.</li>
              </ul>
              {user.role === 'admin' && confirmDelete.posted_by_user !== user.username && (
                <p className="mt-2 font-medium">This job was posted by {confirmDelete.posted_by_user}.</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Keep the job</Button>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => confirmDelete && removeJob(confirmDelete)} loading={deleting}>Delete job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
