'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { CareersSkeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import JobPostingForm from './JobPostingForm';
import JobRow, { JobListHeader, type JobHandlers, type JobTab, type MatchScope } from './JobRow';
import JobWorkspace from './JobWorkspace';
import JobAiDialog, { type JobAiKind } from './JobAiDialog';
import WeeklyReportDialog from './WeeklyReportDialog';

type Owner = 'yours' | 'all' | 'others';
type Status = 'all' | 'active' | 'inactive';
const TABS: JobTab[] = ['applicants', 'database', 'details'];

/** The open job and its tab are kept in the address (?job=ID&tab=database), so coming back from a candidate's page reopens the same view. */
function readAddress(): { job: string | null; tab: JobTab } {
  try {
    const p = new URLSearchParams(window.location.search);
    const tab = p.get('tab') as JobTab | null;
    return { job: p.get('job'), tab: tab && TABS.includes(tab) ? tab : 'applicants' };
  } catch {
    return { job: null, tab: 'applicants' };
  }
}

function writeAddress(jobId: string | null, tab: JobTab = 'applicants') {
  try {
    const url = new URL(window.location.href);
    if (jobId) {
      url.searchParams.set('job', jobId);
      if (tab === 'applicants') url.searchParams.delete('tab');
      else url.searchParams.set('tab', tab);
    } else {
      url.searchParams.delete('job');
      url.searchParams.delete('tab');
    }
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* the address is only a convenience */
  }
}

function errorText(error: any, fallback: string): string {
  return error?.detail || error?.response?.data?.detail || error?.message || fallback;
}

export default function CareersPage() {
  const { user } = useAuthStore();
  const { jobPostings, totalJobPostings, jobCounts, isLoading, error, loadJobPostings, loadMoreJobPostings, updateJobStatus, selectJob, matchJobCandidates } = useCareersStore();
  const { setMatchingProgress, hideMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const { go } = useWorkspaceNav();
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [open, setOpen] = useState<{ jobId: string; tab: JobTab; edit: boolean } | null>(null);
  const [ai, setAi] = useState<{ job: JobPostingListItem; kind: JobAiKind } | null>(null);
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
    const at = readAddress();
    if (at.job) {
      setOpen({ jobId: at.job, tab: at.tab, edit: false });
      setOwner('all');       // the job may be someone else's
    }
  }, []);

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

  const openJob = useMemo(() => jobPostings.find((j) => j.job_id === open?.jobId) ?? null, [jobPostings, open?.jobId]);

  const closeWorkspace = useCallback(() => {
    setOpen(null);
    writeAddress(null);
  }, []);

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
    closeWorkspace();
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
      closeWorkspace();
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
      setOpen({ jobId: job.job_id, tab, edit });
      writeAddress(job.job_id, tab);
    },
    onMatch: (job, scope) => void startMatch(job, scope),
    onAi: (job, kind) => setAi({ job, kind }),
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
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>You need to be logged in to access the careers page.</span>
        </div>
      </div>
    );
  }

  if (!firstLoadDone) return <CareersSkeleton />;

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13px] text-red-800" role="alert">
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
    <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowCreateForm(true)} disabled={showCreateForm}>
      Post a job
    </Button>
  );

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <ToastContainer toasts={toasts} onClose={removeToast} />

      <PageHeader
        title="Careers"
        description="Post jobs, review who applied, find people you already have in the database, and match them to the job."
        actions={
          <>
            <IconButton label="Refresh the list" icon={<RefreshCw />} loading={isRefreshing} onClick={refresh} tip="bottom" className="!h-9 !w-9" />
            <Menu
              trigger={({ ref, ...props }) => (
                <Button ref={ref} variant="secondary" icon={<Globe className="h-4 w-4" />} {...props}>Public jobs page</Button>
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
            <h2 className="text-[14px] font-semibold text-slate-900">New job</h2>
            <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setShowCreateForm(false)}>Close</Button>
          </div>
          <JobPostingForm
            onSuccess={() => {
              setShowCreateForm(false);
              void loadJobPostings();
            }}
          />
        </section>
      )}

      {/* filters: status tabs, search, whose jobs */}
      <div className="mb-3 flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-surface-border">
        <div role="tablist" aria-label="Job status" className="flex items-center gap-5">
          {([['all', 'All', jobCounts.all], ['active', 'Live', jobCounts.active], ['inactive', 'Inactive', jobCounts.inactive]] as const).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={status === id}
              onClick={() => setStatus(id)}
              className={cn(
                '-mb-px border-b-2 pb-2.5 text-[13.5px] font-semibold transition-colors',
                status === id ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-900',
              )}
            >
              {label}
              <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums', status === id ? 'bg-navy-50 text-navy-800' : 'bg-slate-100 text-slate-600')}>
                {n.toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 pb-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <label htmlFor="job-search" className="sr-only">Search jobs</label>
            <input
              id="job-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, recruiter or subject"
              className="field-input w-full !pl-9 pr-8"
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
              { value: 'yours', label: 'My jobs' },
              { value: 'all', label: 'Everyone' },
              { value: 'others', label: 'Others' },
            ]}
          />
        </div>
      </div>

      {/* the jobs */}
      {jobPostings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={filtered ? 'No jobs match these filters' : 'No jobs yet'}
          hint={filtered ? (owner === 'yours' ? 'You are looking at your own jobs. Switch to Everyone to see the whole team\'s.' : 'Change the search or the filters above.') : 'Post your first job to start receiving applications.'}
          action={filtered && owner === 'yours' ? <Button variant="secondary" onClick={() => setOwner('all')}>Show everyone&apos;s jobs</Button> : postJob}
        />
      ) : (
        <>
          <div className="rounded-2xl border border-surface-border bg-white shadow-card" role="table" aria-label="Jobs">
            <div className="overflow-hidden rounded-t-2xl"><JobListHeader /></div>
            {jobPostings.map((job) => (
              <JobRow key={job.job_id} job={job} currentUser={user.username} handlers={handlers} />
            ))}
          </div>
          <p className="mt-3 text-center text-[12.5px] text-slate-500 tabular-nums">
            Showing {jobPostings.length.toLocaleString()} of {shownTotal.toLocaleString()} job{shownTotal === 1 ? '' : 's'}
          </p>
          <InfiniteScrollSentinel hasMore={hasMore} loading={isLoading} itemCount={jobPostings.length} onLoadMore={() => loadMoreJobPostings()} />
        </>
      )}

      {/* one job: applicants, database matches, details */}
      {openJob && open && (
        <JobWorkspace
          job={openJob}
          currentUser={user.username}
          tab={open.tab}
          startInEdit={open.edit}
          onTab={(tab) => {
            setOpen((o) => (o ? { ...o, tab } : o));
            writeAddress(openJob.job_id, tab);
          }}
          onClose={closeWorkspace}
          onChanged={() => void loadJobPostings()}
          onMatchScope={(job, scope, customQuery, expected) => void startMatch(job, scope, customQuery, expected)}
          handlers={handlers}
        />
      )}

      {ai && <JobAiDialog job={ai.job} kind={ai.kind} onClose={() => setAi(null)} />}
      {showReport && <WeeklyReportDialog onClose={() => setShowReport(false)} />}

      {/* delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this job?</DialogTitle>
            <DialogDescription>&ldquo;{confirmDelete?.job_title}&rdquo;</DialogDescription>
          </DialogHeader>
          {confirmDelete && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
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
