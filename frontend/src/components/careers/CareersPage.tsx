'use client';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Check,
  AlertCircle,
  Briefcase,
  ExternalLink,
  Trash2,
  RefreshCw,
  Search,
  Download,
  Code2,
  Copy,
} from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { JobPostingListItem } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { PageHeader, EmptyState } from '@/components/ui/page';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { CareersSkeleton } from '@/components/skeletons';
import { AdminOnly } from '@/components/auth/RoleBasedAccess';
import JobPostingForm from './JobPostingForm';
import JobCard from './JobCard';
import JobDetailsPanel from './JobDetailsPanel';

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Text a person typed (a job title, a recruiter name) made safe to put inside the report's HTML. */
function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function downloadWordHtml(filename: string, html: string) {
  const blob = new Blob(
    [
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
    ],
    { type: 'application/msword;charset=utf-8' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The job whose panel is open is kept in the address (?job=ID), so coming back from a candidate's page reopens it. */
function jobIdFromAddress(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('job');
  } catch {
    return null;
  }
}

function writeJobToAddress(jobId: string | null) {
  try {
    const url = new URL(window.location.href);
    if (jobId) url.searchParams.set('job', jobId);
    else url.searchParams.delete('job');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* the address is only a convenience */
  }
}

export default function CareersPage() {
  const { user } = useAuthStore();
  const {
    jobPostings,
    totalJobPostings,
    jobCounts,
    isLoading,
    error,
    loadJobPostings,
    loadMoreJobPostings,
    updateJobStatus,
    selectJob,
    matchJobCandidates
  } = useCareersStore();
  const { setMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const { go } = useWorkspaceNav();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [copiedOpeningsUrl, setCopiedOpeningsUrl] = useState(false);
  const [openingsUrl, setOpeningsUrl] = useState('/careers/openings');
  const [booleanModal, setBooleanModal] = useState<{ title: string; value: string } | null>(null);
  const [booleanModalCopied, setBooleanModalCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingJob, setIsDeletingJob] = useState<string | null>(null);
  const [showJobDeleteConfirm, setShowJobDeleteConfirm] = useState<JobPostingListItem | null>(null);
  const [jobFilter, setJobFilter] = useState<'all' | 'yours' | 'others'>('yours');
  const [query, setQuery] = useState('');
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [reportFrom, setReportFrom] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return toYmd(start);
  });
  const [reportTo, setReportTo] = useState(() => toYmd(new Date()));
  const [downloadingReport, setDownloadingReport] = useState(false);

  useEffect(() => {
    setOpeningsUrl(`${window.location.origin}/careers/openings`);
    const fromAddress = jobIdFromAddress();
    if (fromAddress) {
      setOpenJobId(fromAddress);
      setJobFilter('all');       // the job may be someone else's
    }
  }, []);

  // The server filters and searches every posting; a change of filter loads the first page of what matches (the typed search waits a moment).
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        await loadJobPostings({
          q: query.trim(),
          scope: jobFilter === 'yours' ? 'mine' : jobFilter === 'others' ? 'others' : 'all',
          status: statusFilter,
        });
      } finally {
        setFirstLoadDone(true);      // the loading skeleton is for the first load only: typing in the search box must not replace the page
      }
    }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [jobFilter, statusFilter, query, loadJobPostings]);

  const openJob = useMemo(() => jobPostings.find((j) => j.job_id === openJobId) ?? null, [jobPostings, openJobId]);

  const openPanel = (job: JobPostingListItem) => {
    setOpenJobId(job.job_id);
    writeJobToAddress(job.job_id);
  };

  const closePanel = React.useCallback(() => {
    setOpenJobId(null);
    writeJobToAddress(null);
  }, []);

  const handleToggleStatus = async (job: JobPostingListItem) => {
    await updateJobStatus(job.job_id, !job.is_active);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadJobPostings();
    } catch (error) {
      console.error('Failed to refresh job postings:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMatchCandidates = async (job: JobPostingListItem) => {
    const totalCVs = job.application_count ?? 0;
    if (totalCVs === 0) return;
    try {
      setMatchingProgress({
        totalCVs,
        processedCVs: 0,
        currentStage: 'initializing',
        isVisible: true,
        estimatedTimeRemaining: Math.max(30, totalCVs * 3),
      });
      setAppLoading('careersMatching', true);
      closePanel();
      go('match');
      selectJob(job);
      await new Promise((r) => setTimeout(r, 500));
      await matchJobCandidates(job.job_id);
    } catch (error) {
      console.error('Failed to match candidates:', error);
      alert('Failed to match candidates. Please try again.');
    }
  };

  const handleDeleteJob = async (job: JobPostingListItem) => {
    setIsDeletingJob(job.job_id);
    try {
      const response = await api.deleteJobPosting(job.job_id);
      if (response.success) {
        closePanel();
        await loadJobPostings();
        alert(`Successfully deleted job posting "${job.job_title}"!\n\nDetails:\n- Job posting deleted: ${response.details.job_posting_deleted ? 'Yes' : 'No'}\n- JD documents deleted: ${response.details.jd_documents_deleted}\n- JD structured data deleted: ${response.details.jd_structured_deleted}\n- JD embeddings deleted: ${response.details.jd_embeddings_deleted}\n- Applications archived: ${response.details.applications_archived}`);
      } else {
        alert('Failed to delete job posting. Please try again.');
      }
    } catch (error: any) {
      console.error('Failed to delete job posting:', error);
      if (error.message?.includes('404') || error.message?.includes('not found')) {
        alert('Job posting not found. It may have already been deleted.');
      } else if (error.message?.includes('403') || error.message?.includes('You can only delete job postings that you created')) {
        alert('Access denied. You can only delete job postings that you created.');
      } else if (error.message?.includes('401')) {
        alert('Access denied. Please make sure you are logged in.');
      } else {
        alert('Failed to delete job posting. Please try again.');
      }
    } finally {
      setIsDeletingJob(null);
      setShowJobDeleteConfirm(null);
    }
  };

  const showBoolean = (job: JobPostingListItem) => {
    setBooleanModalCopied(false);
    setBooleanModal({ title: job.job_title || 'Job', value: job.boolean_search_string || '' });
  };

  const mayHaveMoreOnServer = totalJobPostings != null && jobPostings.length < totalJobPostings;
  const stats = { total: jobCounts.all, active: jobCounts.active, inactive: jobCounts.inactive };   // counted by the server, not from the loaded page

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

  if (!firstLoadDone) {
    return <CareersSkeleton />;
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13px] text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Error loading job postings: {error}</span>
        </div>
      </div>
    );
  }

  const postJobAction = (
    <Button
      variant="primary"
      icon={<Plus className="h-4 w-4" />}
      onClick={() => setShowCreateForm(true)}
    >
      Post job
    </Button>
  );

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <PageHeader
        title="Careers"
        description={
          user.role === 'admin'
            ? 'Manage job postings and applications'
            : `Your job postings (${user.username})`
        }
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={handleRefresh}
              loading={isRefreshing}
            >
              Refresh
            </Button>
            {postJobAction}
          </>
        }
      />

      {/* Weekly analysis report (admin only) */}
      <AdminOnly>
        <div className="surface-panel mb-4 px-4 py-2.5">
          <div className="flex flex-nowrap items-center justify-between gap-3 overflow-x-auto">
            <p className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-slate-900" title="Select a date range and download a Word report of recruiting activity.">
              Weekly analysis report
            </p>
            <div className="flex flex-nowrap items-center gap-2">
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                From
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className="field-input !h-8 !px-2 !text-xs"
                />
              </label>
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-slate-600">
                To
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className="field-input !h-8 !px-2 !text-xs"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 whitespace-nowrap"
                icon={<Download className="h-4 w-4" />}
                disabled={!reportFrom || !reportTo}
                loading={downloadingReport}
                onClick={async () => {
                  if (downloadingReport) return;
                  setDownloadingReport(true);
                  try {
                    const r = await api.getWeeklyAnalysisReport({ startDate: reportFrom, endDate: reportTo });
                    const title = `Alpha CV – weekly Analysis Report`;
                    const dateLine = `(Date: ${r.range.start_date} – ${r.range.end_date})`;

                    const recruiters = r.recruiters_posted
                      .map((x, i) => `${i + 1}. ${esc(x.recruiter)} – ${x.jobs_posted}`)
                      .join('<br/>');

                    const appsByRecruiter = Object.entries(r.applications_by_recruiter)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([recruiter, jobs], idx) => {
                        const jobsHtml = jobs
                          .map((j, jIdx) => `${String.fromCharCode(97 + (jIdx % 26))}. ${esc(j.job_title)} – ${j.applications}`)
                          .join('<br/>');
                        return `${idx + 1}. <b>${esc(recruiter)}</b><br/>${jobsHtml}`;
                      })
                      .join('<br/><br/>');

                    const html = `
                      <div style="font-family:Calibri, Arial, sans-serif; font-size:11pt;">
                        <div style="font-weight:700; font-size:16pt;">${title}</div>
                        <div style="margin-top:4px; font-size:11pt;">${dateLine}</div>
                        <div style="margin-top:16px;">
                          <div><b>1. How many total jobs posted?</b></div>
                          <div>Total jobs posted – ${r.total_jobs_posted}</div>
                        </div>
                        <div style="margin-top:14px;">
                          <div><b>2. Which Recruiters Posted?</b></div>
                          <div style="margin-top:6px;">${recruiters || '-'}</div>
                        </div>
                        <div style="margin-top:14px;">
                          <div><b>3. How many applications got for each job?</b></div>
                          <div style="margin-top:6px;">${appsByRecruiter || '-'}</div>
                        </div>
                        <div style="margin-top:14px;">
                          <div><b>4. Any selections?</b></div>
                          <div style="margin-top:6px;">-</div>
                        </div>
                      </div>
                    `;

                    downloadWordHtml(`weekly_analysis_report_${r.range.start_date}_to_${r.range.end_date}.doc`, html);
                  } catch (e: any) {
                    alert(e?.message || 'Failed to generate report');
                  } finally {
                    setDownloadingReport(false);
                  }
                }}
              >
                Download report
              </Button>
            </div>
          </div>
        </div>
      </AdminOnly>

      {/* Live / inactive tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-surface-border">
        {([['all', 'All jobs', stats.total], ['active', 'Live jobs', stats.active], ['inactive', 'Inactive', stats.inactive]] as const).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatusFilter(id)}
            className={`-mb-px border-b-2 pb-2.5 text-[13px] font-medium transition-colors ${
              statusFilter === id ? 'border-navy-600 text-navy-700' : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {label} <span className="ml-1 text-xs text-slate-400 tabular-nums">({n.toLocaleString()})</span>
          </button>
        ))}
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-1.5 pb-2.5">
          <span className="hidden shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:inline">All jobs URL</span>
          <a
            href={openingsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 truncate text-[12.5px] font-medium text-navy-700 hover:underline"
            title={openingsUrl}
          >
            {openingsUrl}
          </a>
          <button
            type="button"
            title={copiedOpeningsUrl ? 'Copied' : 'Copy all-jobs URL'}
            aria-label="Copy all-jobs URL"
            onClick={() => {
              navigator.clipboard.writeText(openingsUrl);
              setCopiedOpeningsUrl(true);
              setTimeout(() => setCopiedOpeningsUrl(false), 1500);
            }}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-white text-slate-500 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-700"
          >
            {copiedOpeningsUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            title="Open all jobs page"
            aria-label="Open all jobs page"
            onClick={() => window.open(openingsUrl, '_blank')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-white text-slate-500 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-700"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="toolbar-bar flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, poster, subject…"
            className="field-input w-full !pl-10 pr-3"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value as 'all' | 'yours' | 'others')}
            className="field-input text-slate-700"
            title="Ownership filter"
          >
            <option value="all">All jobs</option>
            <option value="yours">Your jobs</option>
            <option value="others">Others&apos; jobs</option>
          </select>
          <span className="text-[13px] text-slate-500">
            {(totalJobPostings ?? jobPostings.length).toLocaleString()} result{(totalJobPostings ?? jobPostings.length) === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Create Job Form */}
      {showCreateForm && (
        <div className="mb-4">
          <JobPostingForm
            onSuccess={() => {
              setShowCreateForm(false);
              loadJobPostings();
            }}
          />
        </div>
      )}

      {/* Job postings as cards, three to a row */}
      {jobPostings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={query.trim() || statusFilter !== 'all' || jobFilter !== 'all' ? 'No jobs match your filters' : 'No job postings yet'}
          hint={
            query.trim() || statusFilter !== 'all' || jobFilter !== 'all'
              ? 'Try changing the filters or create a new job posting.'
              : 'Create your first job posting to get started.'
          }
          action={postJobAction}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {jobPostings.map((job) => (
              <JobCard key={job.job_id} job={job} currentUser={user.username} onOpen={() => openPanel(job)} />
            ))}
          </div>

          {/* The next page of the same search loads by itself when the list is scrolled to its end. */}
          <p className="mt-4 text-center text-[13px] text-slate-500 tabular-nums">
            {`Showing ${jobPostings.length.toLocaleString()} of ${(totalJobPostings ?? jobPostings.length).toLocaleString()}`}
          </p>
          <InfiniteScrollSentinel
            hasMore={mayHaveMoreOnServer}
            loading={isLoading}
            itemCount={jobPostings.length}
            onLoadMore={() => loadMoreJobPostings()}
          />
        </>
      )}

      {/* Everything about one job: applicants, match, edit, activate, delete, boolean string */}
      {openJob && (
        <JobDetailsPanel
          job={openJob}
          currentUser={user.username}
          onClose={closePanel}
          onMatch={handleMatchCandidates}
          onToggleStatus={handleToggleStatus}
          onDelete={(j) => setShowJobDeleteConfirm(j)}
          onBoolean={showBoolean}
          onChanged={() => loadJobPostings()}
        />
      )}

      {/* Individual job delete confirmation */}
      <Dialog open={!!showJobDeleteConfirm} onOpenChange={(o) => !o && setShowJobDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete job posting</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{showJobDeleteConfirm?.job_title}&rdquo;? This is a soft deletion, data can be
              recovered if needed.
            </DialogDescription>
          </DialogHeader>
          {showJobDeleteConfirm && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
              <p className="font-medium">This action will:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>Mark the job posting as deleted</li>
                <li>Archive {showJobDeleteConfirm.application_count || 0} application(s)</li>
                <li>Remove the job from public view</li>
              </ul>
              {user.role === 'admin' && showJobDeleteConfirm.posted_by_user !== user.username && (
                <p className="mt-2 text-blue-800">
                  Admin action: you are deleting a job posted by {showJobDeleteConfirm.posted_by_user}.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setShowJobDeleteConfirm(null)}
              disabled={!!showJobDeleteConfirm && isDeletingJob === showJobDeleteConfirm.job_id}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => showJobDeleteConfirm && handleDeleteJob(showJobDeleteConfirm)}
              loading={!!showJobDeleteConfirm && isDeletingJob === showJobDeleteConfirm.job_id}
            >
              Delete job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Boolean search string viewer */}
      <Dialog open={!!booleanModal} onOpenChange={(open) => { if (!open) setBooleanModal(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code2 className="h-5 w-5 text-navy-600" />
              Naukri Gulf boolean search string
            </DialogTitle>
            <DialogDescription>{booleanModal?.title}</DialogDescription>
          </DialogHeader>
          {booleanModal?.value ? (
            <div className="space-y-3">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-slate-50 p-3 font-mono text-[13px] leading-relaxed text-slate-800">
                {booleanModal.value}
              </pre>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  icon={booleanModalCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  onClick={() => {
                    navigator.clipboard?.writeText(booleanModal.value);
                    setBooleanModalCopied(true);
                    setTimeout(() => setBooleanModalCopied(false), 2000);
                  }}
                >
                  {booleanModalCopied ? 'Copied' : 'Copy to clipboard'}
                </Button>
              </div>
              <p className="text-[12px] text-slate-500">
                Paste this into Naukri Gulf Resdex to find matching candidates.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-slate-500">
              No boolean string is stored for this job yet. Editing &amp; saving the job (or re-posting it)
              will generate one from the title and skills.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
