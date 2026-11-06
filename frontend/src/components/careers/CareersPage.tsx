'use client';
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Users,
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
  Code2,
  Mail,
  MapPin,
  MoreHorizontal
} from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useUserSessionStore } from '@/stores/userSessionStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { JobPostingListItem } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { Avatar } from '@/components/ui/avatar';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
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
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50 ${className || ''}`}
    >
      {children}
    </button>
  );
}

type RowMenuItem = { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void; danger?: boolean };

/** "More" menu for a table row. Fixed-positioned so the table never clips it or needs a sideways scroll. */
function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);
  return (
    <>
      <button
        type="button"
        title="More actions"
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPos(pos ? null : { top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal className="h-[18px] w-[18px]" />
      </button>
      {pos && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setPos(null)} aria-hidden />
          <div
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-[71] w-56 rounded-xl border border-surface-border bg-white p-1.5 shadow-[0_16px_40px_-12px_rgba(16,24,40,0.22)]"
          >
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  onClick={() => { setPos(null); it.onClick(); }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                    it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {it.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

/** Tiny area chart of applications per day (oldest to newest). */
function JobSparkline({ values, days }: { values?: number[]; days?: string[] }) {
  if (!values || values.length === 0) {
    return <div className="h-8 w-full rounded bg-slate-50" title="No applications in the last 14 days" />;
  }
  const W = 120, H = 32, pad = 2;
  const max = Math.max(1, ...values);
  const step = (W - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H} L${pts[0][0].toFixed(1)} ${H} Z`;
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" role="img" aria-label={`${total} applications in the last ${values.length} days`}>
      <title>{`${total} applications in the last ${values.length} days${days?.length ? ` (${days[0]} to ${days[days.length - 1]})` : ''}`}</title>
      <path d={area} fill="rgb(37 99 235 / 0.10)" />
      <path d={line} fill="none" stroke="rgb(37 99 235)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
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
    matchJobCandidates
  } = useCareersStore();
  const { setMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const { go } = useWorkspaceNav();

  const {
    loadingStates,
    setLoading,
    queueRequest
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
  const [isRefreshing, setIsRefreshing] = useState(false);
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
    if (!dateString || dateString === 'Unknown') return '-';
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
  const stats = useMemo(() => {
    const total = jobPostings.length;
    const active = jobPostings.filter((j) => !!j.is_active).length;
    return { total, active, inactive: total - active };
  }, [jobPostings]);

  // Applications per day for each job (last 14 days), drawn as a small chart in the Performance column.
  const [trends, setTrends] = useState<{ days: string[]; series: Record<string, number[]> } | null>(null);
  useEffect(() => {
    let alive = true;
    api.getJobTrends(14).then((t) => { if (alive) setTrends(t); }).catch(() => {});
    return () => { alive = false; };
  }, [jobPostings.length]);

  if ((isLoading && jobPostings.length === 0) || loadingStates.careers) {
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
      <div className="mb-3 flex items-center gap-5 border-b border-surface-border">
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
          <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
            <table className="w-full table-fixed text-left">
              <thead>
                <tr className="border-b border-surface-border bg-slate-50/60 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3 font-medium">Job</th>
                  <th className="hidden w-[110px] px-3 py-3 font-medium sm:table-cell">Status</th>
                  <th className="hidden w-[190px] px-3 py-3 font-medium md:table-cell">Applications</th>
                  <th className="hidden w-[150px] px-3 py-3 font-medium lg:table-cell">Posted by</th>
                  <th className="w-[170px] px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {visibleJobs.map((job) => {
                  const apps = job.application_count ?? 0;
                  return (
                    <tr key={job.job_id} className="align-top transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-3">
                          <Avatar name={job.job_title || 'Job'} size="sm" className="mt-0.5 hidden sm:flex" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold text-slate-900" title={job.job_title}>
                              {job.job_title || 'Untitled role'}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-slate-500">
                              <MapPin className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{job.job_location || 'No location'}</span>
                              <span className="text-slate-300">·</span>
                              <span className="shrink-0 whitespace-nowrap">{formatDate(job.upload_date)}</span>
                            </p>
                            {job.email_subject_template && (
                              <button
                                type="button"
                                title="Job subject line, click to copy"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard?.writeText(job.email_subject_template || '');
                                  setCopiedBoolean(job.job_id);
                                  setTimeout(() => setCopiedBoolean(null), 2000);
                                }}
                                className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-surface-border bg-white px-2 py-0.5 text-left text-[11.5px] font-medium text-slate-600 transition-colors hover:border-navy-300 hover:text-navy-700"
                              >
                                <Mail className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{job.email_subject_template}</span>
                                {copiedBoolean === job.job_id ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
                              </button>
                            )}
                            <p className="mt-1.5 text-xs text-slate-500 md:hidden">
                              {job.is_active ? 'Active' : 'Inactive'} · {apps} application{apps === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3.5 sm:table-cell">
                        <span className={`chip ${job.is_active ? 'chip-success' : 'chip-neutral'}`}>
                          {job.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="hidden px-3 py-3.5 md:table-cell">
                        <div className="flex items-center gap-3">
                          <span className="w-7 text-[15px] font-semibold tabular-nums text-slate-900">{apps}</span>
                          <div className="min-w-0 flex-1">
                            <JobSparkline values={trends?.series[job.job_id]} days={trends?.days} />
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3.5 lg:table-cell">
                        <div className="flex items-center gap-2">
                          <Avatar name={job.posted_by_user || '-'} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-[13px] text-slate-800">{job.posted_by_user || '-'}</p>
                            {job.posted_by_user && job.posted_by_user === user.username && (
                              <p className="text-[11px] text-slate-400">You</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {apps > 0 && (
                            <IconButton title="View applicants" onClick={(e) => { e.stopPropagation(); handleViewApplicants(job); }}>
                              <Users className="h-[18px] w-[18px]" />
                            </IconButton>
                          )}
                          <IconButton
                            title="View live page"
                            onClick={(e) => { e.stopPropagation(); window.open(`/careers/jobs/${job.public_token}`, '_blank'); }}
                          >
                            <ExternalLink className="h-[18px] w-[18px]" />
                          </IconButton>
                          {job.can_edit && (
                            <IconButton title="Edit" onClick={(e) => { e.stopPropagation(); handleEditJob(job); }} disabled={isLoadingEditData}>
                              <Edit3 className="h-[18px] w-[18px]" />
                            </IconButton>
                          )}
                          <RowMenu
                            items={[
                              { label: 'Naukri boolean string', icon: Code2, onClick: () => { setBooleanModalCopied(false); setBooleanModal({ title: job.job_title || 'Job', value: job.boolean_search_string || '' }); } },
                              ...(apps > 0 ? [{ label: 'Match candidates', icon: Target, onClick: () => handleMatchCandidates(job) }] : []),
                              { label: copiedLink === job.job_id ? 'Link copied' : 'Copy public link', icon: copiedLink === job.job_id ? Check : Copy, onClick: () => {
                                navigator.clipboard.writeText(`${window.location.origin}/careers/jobs/${job.public_token}`);
                                setCopiedLink(job.job_id);
                                setTimeout(() => setCopiedLink(null), 2000);
                              } },
                              ...(job.can_edit ? [{ label: job.is_active ? 'Deactivate' : 'Activate', icon: Power, onClick: () => handleToggleStatus(job.job_id, job.is_active) }] : []),
                              ...(job.can_delete ? [{ label: 'Delete', icon: Trash2, danger: true, onClick: () => setShowJobDeleteConfirm(job) }] : []),
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

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
            <p className="text-[13px] text-slate-500">
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
