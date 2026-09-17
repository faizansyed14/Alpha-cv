'use client';
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Users,
  FileText,
  Copy,
  Check,
  AlertCircle,
  Briefcase,
  ExternalLink,
  Power,
  Edit3,
  Trash2,
  User,
  RefreshCw,
  Target,
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  Code2
} from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useUserSessionStore } from '@/stores/userSessionStore';
import { JobPostingListItem } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { LoadingCard } from '@/components/ui/loading';
import { AdminOnly } from '@/components/auth/RoleBasedAccess';
import JobPostingForm from './JobPostingForm';

const JOBS_PAGE_SIZE = 20;

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

function filterJobPostings(
  list: JobPostingListItem[],
  opts: {
    jobFilter: 'all' | 'yours' | 'others';
    statusFilter: 'all' | 'active' | 'inactive';
    query: string;
    username?: string;
  }
): JobPostingListItem[] {
  let result = list;
  if (opts.jobFilter === 'yours') result = result.filter((job) => job.posted_by_user === opts.username);
  else if (opts.jobFilter === 'others') result = result.filter((job) => job.posted_by_user !== opts.username);
  if (opts.statusFilter === 'active') result = result.filter((job) => !!job.is_active);
  else if (opts.statusFilter === 'inactive') result = result.filter((job) => !job.is_active);
  const q = opts.query.trim().toLowerCase();
  if (q) {
    result = result.filter((job) => {
      const title = String(job.job_title || '').toLowerCase();
      const poster = String(job.posted_by_user || '').toLowerCase();
      const subject = String((job as any).email_subject_template || '').toLowerCase();
      const id = String(job.job_id || '').toLowerCase();
      return title.includes(q) || poster.includes(q) || subject.includes(q) || id.includes(q);
    });
  }
  return result;
}

function IconButton({
  title,
  onClick,
  disabled,
  className,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-50 ${className || ''}`}
    >
      {children}
    </button>
  );
}

export default function CareersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    jobPostings,
    totalJobPostings,
    isLoading,
    error,
    loadJobPostings,
    loadMoreJobPostings,
    updateJobStatus,
    selectJob,
    selectedJob,
    matchJobCandidates
  } = useCareersStore();
  const { setCurrentTab, setMatchingProgress, setLoading: setAppLoading } = useAppStore();

  const {
    loadingStates,
    setLoading,
    queueRequest,
    clearUserData
  } = useUserSessionStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingJob, setEditingJob] = useState<JobPostingListItem | null>(null);
  const [editingJobData, setEditingJobData] = useState<any>(null);
  const [isLoadingEditData, setIsLoadingEditData] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copiedBoolean, setCopiedBoolean] = useState<string | null>(null);
  const [booleanModal, setBooleanModal] = useState<{ title: string; value: string } | null>(null);
  const [booleanModalCopied, setBooleanModalCopied] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [isDeletingJob, setIsDeletingJob] = useState<string | null>(null);
  const [showJobDeleteConfirm, setShowJobDeleteConfirm] = useState<JobPostingListItem | null>(null);
  const [jobFilter, setJobFilter] = useState<'all' | 'yours' | 'others'>('all');
  const [listPageIndex, setListPageIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [reportFrom, setReportFrom] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return toYmd(start);
  });
  const [reportTo, setReportTo] = useState(() => toYmd(new Date()));
  const [downloadingReport, setDownloadingReport] = useState(false);

  // Reset to first page when filters change
  useEffect(() => {
    setListPageIndex(0);
  }, [jobFilter, statusFilter, query]);

  // When user searches, load all remaining pages so results aren't limited to first page
  useEffect(() => {
    if (!query.trim()) return;
    const { totalJobPostings: total, jobPostings: jp } = useCareersStore.getState();
    if (total != null && jp.length >= total) return;
    let cancelled = false;
    const loadAll = async () => {
      let attempts = 0;
      while (attempts < 50 && !cancelled) {
        const { jobPostings: current, totalJobPostings: tot } = useCareersStore.getState();
        if (tot != null && current.length >= tot) break;
        const lenBefore = current.length;
        await loadMoreJobPostings();
        const lenAfter = useCareersStore.getState().jobPostings.length;
        if (lenAfter === lenBefore) break;
        attempts++;
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [query, loadMoreJobPostings]);

  useEffect(() => {
    queueRequest('load-job-postings', async () => {
      setLoading('careers', true);
      try {
        await loadJobPostings();
      } finally {
        setLoading('careers', false);
      }
    });
  }, [loadJobPostings, queueRequest, setLoading]);

  const handleToggleStatus = async (jobId: string, currentStatus: boolean) => {
    await updateJobStatus(jobId, !currentStatus);
  };

  const handleViewApplicants = (job: JobPostingListItem) => {
    router.push(`/careers/applicants/${job.job_id}`);
  };

  const handleDeleteAllJobPostings = async () => {
    setIsDeletingAll(true);
    try {
      const response = await api.deleteAllJobPostings();
      if (response.success) {
        await loadJobPostings();
        alert(`Successfully deleted all job postings!\n\nDetails:\n- Job postings deleted: ${response.details.job_postings_deleted}\n- JD documents deleted: ${response.details.jd_documents_deleted}\n- JD structured data deleted: ${response.details.jd_structured_deleted}\n- JD embeddings deleted: ${response.details.jd_embeddings_deleted}\n- CVs preserved: ${response.details.cvs_preserved}`);
      } else {
        alert('Failed to delete job postings. Please try again.');
      }
    } catch (error: any) {
      console.error('Failed to delete all job postings:', error);
      if (error.message?.includes('Admin') || error.message?.includes('403')) {
        alert('Access denied. Admin privileges required for this action.');
      } else {
        alert('Failed to delete job postings. Please try again.');
      }
    } finally {
      setIsDeletingAll(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleEditJob = async (job: JobPostingListItem) => {
    setEditingJob(job);
    setIsLoadingEditData(true);
    setEditingJobData(null);

    try {
      const jobData = await api.getJobForEdit(job.job_id);
      setEditingJobData(jobData);
      setShowEditForm(true);
    } catch (error) {
      console.error('Failed to load job data for editing:', error);
    } finally {
      setIsLoadingEditData(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadJobPostings();
      setListPageIndex(0);
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
      setCurrentTab('match');
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

  const formatDate = (dateString?: string) => {
    if (!dateString || dateString === 'Unknown') return '—';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const filteredJobs = useMemo(
    () =>
      filterJobPostings(jobPostings, {
        jobFilter,
        statusFilter,
        query,
        username: user?.username,
      }),
    [jobPostings, jobFilter, statusFilter, query, user?.username]
  );

  const maxPageIndex = Math.max(0, Math.ceil(filteredJobs.length / JOBS_PAGE_SIZE) - 1);

  useEffect(() => {
    setListPageIndex((p) => Math.min(p, maxPageIndex));
  }, [maxPageIndex]);

  const visibleJobs = useMemo(
    () =>
      filteredJobs.slice(
        listPageIndex * JOBS_PAGE_SIZE,
        listPageIndex * JOBS_PAGE_SIZE + JOBS_PAGE_SIZE
      ),
    [filteredJobs, listPageIndex]
  );

  const filterOpts = { jobFilter, statusFilter, query, username: user?.username };

  const handlePrevPage = () => {
    setListPageIndex((p) => Math.max(0, p - 1));
  };

  const handleNextPage = async () => {
    const nextPage = listPageIndex + 1;
    const nextStart = nextPage * JOBS_PAGE_SIZE;

    if (nextStart < filteredJobs.length) {
      setListPageIndex(nextPage);
      return;
    }

    for (let attempts = 0; attempts < 25; attempts++) {
      const { jobPostings: jp, totalJobPostings: total } = useCareersStore.getState();
      const filtered = filterJobPostings(jp, filterOpts);
      if (nextStart < filtered.length) {
        setListPageIndex(nextPage);
        return;
      }
      const totalCount = total ?? jp.length;
      if (jp.length >= totalCount) return;

      const lenBefore = jp.length;
      await loadMoreJobPostings();
      const lenAfter = useCareersStore.getState().jobPostings.length;
      if (lenAfter === lenBefore) return;
    }
  };

  const rangeStart = filteredJobs.length === 0 ? 0 : listPageIndex * JOBS_PAGE_SIZE + 1;
  const rangeEnd = Math.min((listPageIndex + 1) * JOBS_PAGE_SIZE, filteredJobs.length);
  const hasNextPageInMemory = (listPageIndex + 1) * JOBS_PAGE_SIZE < filteredJobs.length;
  const mayHaveMoreOnServer =
    totalJobPostings != null && jobPostings.length < totalJobPostings;
  const canGoNext = hasNextPageInMemory || mayHaveMoreOnServer;

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

  // Full-page spinner only for the initial careers load, not for "load next page" (that would hide the list).
  if ((isLoading && jobPostings.length === 0) || loadingStates.careers) {
    return (
      <div className="p-4 sm:p-6">
        <LoadingCard />
      </div>
    );
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
    <div className="min-h-[calc(100vh-8rem)] p-4 sm:p-6">
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
            <AdminOnly>
              {jobPostings.length > 0 && (
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => setShowDeleteConfirm(true)}
                  loading={isDeletingAll}
                >
                  Delete all
                </Button>
              )}
            </AdminOnly>
          </>
        }
      />

      {/* Weekly analysis report (admin only) */}
      <AdminOnly>
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="section-label">Weekly analysis report</p>
              <p className="mt-1 text-[13px] text-gray-500">
                Select a date range and download a Word report of recruiting activity.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
                From
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-gray-600">
                To
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </label>
              <Button
                variant="secondary"
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
                      .map((x, i) => `${i + 1}. ${x.recruiter} – ${x.jobs_posted}`)
                      .join('<br/>');

                    const appsByRecruiter = Object.entries(r.applications_by_recruiter)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([recruiter, jobs], idx) => {
                        const jobsHtml = jobs
                          .map((j, jIdx) => `${String.fromCharCode(97 + (jIdx % 26))}. ${j.job_title} – ${j.applications}`)
                          .join('<br/>');
                        return `${idx + 1}. <b>${recruiter}</b><br/>${jobsHtml}`;
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
                          <div style="margin-top:6px;">${recruiters || '—'}</div>
                        </div>
                        <div style="margin-top:14px;">
                          <div><b>3. How many applications got for each job?</b></div>
                          <div style="margin-top:6px;">${appsByRecruiter || '—'}</div>
                        </div>
                        <div style="margin-top:14px;">
                          <div><b>4. Any selections?</b></div>
                          <div style="margin-top:6px;">—</div>
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

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, poster, subject…"
            className="h-9 w-full rounded-md border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value as 'all' | 'yours' | 'others')}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            title="Ownership filter"
          >
            <option value="all">All jobs</option>
            <option value="yours">Your jobs</option>
            <option value="others">Others&apos; jobs</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            title="Status filter"
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <span className="text-[13px] text-gray-500">
            {filteredJobs.length} result{filteredJobs.length === 1 ? '' : 's'}
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

      {/* Job Postings Table */}
      {filteredJobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={jobPostings.length === 0 ? 'No job postings yet' : 'No jobs match your filters'}
          hint={
            jobPostings.length === 0
              ? 'Create your first job posting to get started.'
              : 'Try changing the filters or create a new job posting.'
          }
          action={postJobAction}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Location</TH>
                <TH>Status</TH>
                <TH className="text-right">Applications</TH>
                <TH>Posted by</TH>
                <TH>Created</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {visibleJobs.map((job) => (
                <TR key={job.job_id}>
                  <TD className="max-w-[280px]">
                    <span className="block truncate font-medium text-gray-900" title={job.job_title}>
                      {job.job_title || 'Untitled role'}
                    </span>
                    {job.email_subject_template && (
                      <span className="mt-0.5 block truncate text-[12px] text-gray-400" title={job.email_subject_template}>
                        {job.email_subject_template}
                      </span>
                    )}
                    {job.boolean_search_string && (
                      <button
                        type="button"
                        title={`Naukri Gulf Boolean search — click to copy:\n${job.boolean_search_string}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard?.writeText(job.boolean_search_string || '');
                          setCopiedBoolean(job.job_id);
                          setTimeout(() => setCopiedBoolean(null), 2000);
                        }}
                        className="mt-1 flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-left text-[11px] font-mono text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
                      >
                        <Search className="h-3 w-3 shrink-0 text-gray-400" />
                        <span className="truncate">{job.boolean_search_string}</span>
                        {copiedBoolean === job.job_id ? (
                          <Check className="h-3 w-3 shrink-0 text-green-600" />
                        ) : (
                          <Copy className="h-3 w-3 shrink-0 text-gray-400" />
                        )}
                      </button>
                    )}
                  </TD>
                  <TD className="text-gray-600">{job.job_location || '—'}</TD>
                  <TD>
                    <Badge variant={job.is_active ? 'success' : 'secondary'}>
                      {job.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums text-gray-700">{job.application_count ?? 0}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 text-gray-700">
                      <User className="h-3.5 w-3.5 text-gray-400" />
                      <span className="truncate">{job.posted_by_user || '—'}</span>
                      {job.posted_by_user && job.posted_by_user === user.username && (
                        <Badge variant="default" className="ml-1">You</Badge>
                      )}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-gray-600">{formatDate(job.upload_date)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-0.5">
                      <IconButton
                        title="View Naukri Gulf boolean search string"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBooleanModalCopied(false);
                          setBooleanModal({ title: job.job_title || 'Job', value: job.boolean_search_string || '' });
                        }}
                        className="hover:text-brand-600"
                      >
                        <Code2 className="h-4 w-4" />
                      </IconButton>
                      {(job.application_count || 0) > 0 && (
                        <>
                          <IconButton
                            title="Match candidates"
                            onClick={(e) => { e.stopPropagation(); handleMatchCandidates(job); }}
                            className="hover:text-brand-600"
                          >
                            <Target className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            title="View applicants"
                            onClick={(e) => { e.stopPropagation(); handleViewApplicants(job); }}
                            className="hover:text-brand-600"
                          >
                            <Users className="h-4 w-4" />
                          </IconButton>
                        </>
                      )}
                      <IconButton
                        title="Copy public link"
                        onClick={(e) => {
                          e.stopPropagation();
                          const jobUrl = `${window.location.origin}/careers/jobs/${job.public_token}`;
                          navigator.clipboard.writeText(jobUrl);
                          setCopiedLink(job.job_id);
                          setTimeout(() => setCopiedLink(null), 2000);
                        }}
                      >
                        {copiedLink === job.job_id ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </IconButton>
                      <IconButton
                        title="View live page"
                        onClick={(e) => { e.stopPropagation(); window.open(`/careers/jobs/${job.public_token}`, '_blank'); }}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </IconButton>
                      {job.can_edit && (
                        <IconButton
                          title={job.is_active ? 'Deactivate' : 'Activate'}
                          onClick={(e) => { e.stopPropagation(); handleToggleStatus(job.job_id, job.is_active); }}
                          className={job.is_active ? 'hover:text-amber-600' : 'hover:text-green-600'}
                        >
                          <Power className="h-4 w-4" />
                        </IconButton>
                      )}
                      {job.can_edit && (
                        <IconButton
                          title="Edit"
                          onClick={(e) => { e.stopPropagation(); handleEditJob(job); }}
                          disabled={isLoadingEditData}
                          className="hover:text-brand-600"
                        >
                          <Edit3 className="h-4 w-4" />
                        </IconButton>
                      )}
                      {job.can_delete && (
                        <IconButton
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); setShowJobDeleteConfirm(job); }}
                          disabled={isDeletingJob === job.job_id}
                          className="hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {/* Inline edit form below the table */}
          {showEditForm && editingJob && editingJobData && (
            <div className="mt-4">
              <JobPostingForm
                jobId={editingJob.job_id}
                publicToken={editingJob.public_token === 'unknown' ? undefined : editingJob.public_token}
                initialData={{
                  jobTitle: editingJobData.job_title || '',
                  jobLocation: editingJobData.job_location || '',
                  jobSummary: editingJobData.job_summary || '',
                  keyResponsibilities: editingJobData.key_responsibilities || '',
                  qualifications: editingJobData.qualifications || ''
                }}
                onSuccess={() => {
                  setShowEditForm(false);
                  setEditingJob(null);
                  setEditingJobData(null);
                  loadJobPostings();
                }}
              />
            </div>
          )}

          {/* Pagination */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-[13px] text-gray-500">
              {filteredJobs.length === 0
                ? 'No matching jobs'
                : `Showing ${rangeStart}–${rangeEnd} of ${filteredJobs.length}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon={<ChevronLeft className="h-4 w-4" />}
                onClick={handlePrevPage}
                disabled={listPageIndex === 0 || isLoading}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleNextPage()}
                disabled={!canGoNext || isLoading}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Admin delete all confirmation */}
      <AdminOnly>
        <Dialog open={showDeleteConfirm} onOpenChange={(o) => !o && setShowDeleteConfirm(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete all job postings</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All CVs and job applications will be preserved.
                This is an admin-only action.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={isDeletingAll}>
                Cancel
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={handleDeleteAllJobPostings}
                loading={isDeletingAll}
              >
                Delete all
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AdminOnly>

      {/* Individual job delete confirmation */}
      <Dialog open={!!showJobDeleteConfirm} onOpenChange={(o) => !o && setShowJobDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete job posting</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{showJobDeleteConfirm?.job_title}&rdquo;? This is a soft deletion — data can be
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
              <Code2 className="h-5 w-5 text-brand-600" />
              Naukri Gulf boolean search string
            </DialogTitle>
            <DialogDescription>{booleanModal?.title}</DialogDescription>
          </DialogHeader>
          {booleanModal?.value ? (
            <div className="space-y-3">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[13px] leading-relaxed text-gray-800">
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
              <p className="text-[12px] text-gray-500">
                Paste this into Naukri Gulf Resdex to find matching candidates.
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-gray-500">
              No boolean string is stored for this job yet. Editing &amp; saving the job (or re-posting it)
              will generate one from the title and skills.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
