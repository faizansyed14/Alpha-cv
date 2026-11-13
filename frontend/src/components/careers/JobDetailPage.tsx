'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Trash2 } from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { JobPostingListItem } from '@/lib/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ToastContainer, useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import JobWorkspace, { JobWorkspaceSkeleton } from './JobWorkspace';
import JobAiDialog, { type JobAiKind } from './JobAiDialog';
import HiringImageDialog from './HiringImageDialog';
import type { JobHandlers, JobTab, MatchScope } from './JobRow';

const TABS: JobTab[] = ['applicants', 'database', 'details'];

function errorText(error: any, fallback: string): string {
  return error?.detail || error?.response?.data?.detail || error?.message || fallback;
}

function parseTab(raw: string | null): JobTab {
  return raw && TABS.includes(raw as JobTab) ? (raw as JobTab) : 'applicants';
}

/** Full-page job workspace at /careers-manage/[jobId]. */
export default function JobDetailPage() {
  const params = useParams<{ jobId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = params?.jobId ? decodeURIComponent(params.jobId) : '';
  const tab = parseTab(searchParams.get('tab'));
  const startInEdit = searchParams.get('edit') === '1';

  const { user } = useAuthStore();
  const { jobPostings, loadJobPostings, updateJobStatus, selectJob, matchJobCandidates } = useCareersStore();
  const { setMatchingProgress, hideMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const { go } = useWorkspaceNav();
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [ready, setReady] = useState(false);
  const [ai, setAi] = useState<{ job: JobPostingListItem; kind: JobAiKind } | null>(null);
  const [image, setImage] = useState<JobPostingListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<JobPostingListItem | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const found = jobPostings.some((j) => j.job_id === jobId);
        if (!found) {
          await loadJobPostings({ scope: 'all', status: 'all' });
        }
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const job = useMemo(() => jobPostings.find((j) => j.job_id === jobId) ?? null, [jobPostings, jobId]);

  const setTab = useCallback((next: JobTab) => {
    const url = new URL(window.location.href);
    if (next === 'applicants') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    url.searchParams.delete('edit');
    router.replace(url.pathname + url.search);
  }, [router]);

  const backToList = useCallback(() => {
    router.push('/careers-manage');
  }, [router]);

  const copy = useCallback((text: string, what: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    showSuccess(`${what} copied`);
  }, [showSuccess]);

  const startMatch = async (target: JobPostingListItem, scope: MatchScope, customQuery: string | null = null, expected?: number) => {
    setMatchingProgress({
      totalCVs: expected ?? target.application_count ?? 0,
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
        databaseIds = (await api.getJobDatabaseCandidateIds(target.job_id, customQuery)).ids;
      }
      selectJob(target);
      await matchJobCandidates(target.job_id, { applicants: scope !== 'database', databaseIds });
    } catch (e) {
      hideMatchingProgress();
      setAppLoading('careersMatching', false, errorText(e, 'Matching could not be started. Please try again.'));
    }
  };

  const removeJob = async (target: JobPostingListItem) => {
    setDeleting(true);
    try {
      const response = await api.deleteJobPosting(target.job_id);
      if (!response.success) throw new Error('The job could not be deleted.');
      await loadJobPostings();
      showSuccess('Job deleted', `"${target.job_title}" was removed.`);
      backToList();
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
    onOpen: (j, nextTab = 'applicants', edit = false) => {
      const q = new URLSearchParams();
      if (nextTab !== 'applicants') q.set('tab', nextTab);
      if (edit) q.set('edit', '1');
      const qs = q.toString();
      router.push(`/careers-manage/${encodeURIComponent(j.job_id)}${qs ? `?${qs}` : ''}`);
    },
    onMatch: (j, scope) => void startMatch(j, scope),
    onAi: (j, kind) => setAi({ job: j, kind }),
    onImage: (j) => setImage(j),
    onToggleStatus: async (j) => {
      const ok = await updateJobStatus(j.job_id, !j.is_active);
      if (ok) {
        showSuccess(j.is_active ? 'Job deactivated' : 'Job is live', j.is_active ? 'It no longer takes applications.' : 'It takes applications again.');
        await loadJobPostings({ scope: 'all', status: 'all' });
      } else showError('Status not changed', 'Please try again.');
    },
    onDelete: (j) => setConfirmDelete(j),
    onCopy: copy,
  };

  if (!user) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>You need to be logged in to open this job.</span>
      </div>
    );
  }

  if (!ready) return <JobWorkspaceSkeleton onBack={backToList} />;

  if (!job) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50">
          <AlertCircle className="h-5 w-5 text-danger-600" />
        </div>
        <p className="text-md font-semibold text-slate-900">Job not found</p>
        <p className="mt-1 text-sm text-slate-500">It may have been deleted, or you may not have access.</p>
        <Button variant="secondary" className="mt-4" onClick={backToList}>Back to careers</Button>
      </div>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <JobWorkspace
        job={job}
        currentUser={user.username}
        tab={tab}
        startInEdit={startInEdit}
        onTab={setTab}
        onClose={backToList}
        onChanged={() => void loadJobPostings({ scope: 'all', status: 'all' })}
        onMatchScope={(j, scope, customQuery, expected) => void startMatch(j, scope, customQuery, expected)}
        handlers={handlers}
      />
      {ai && <JobAiDialog job={ai.job} kind={ai.kind} onClose={() => setAi(null)} />}
      {image && <HiringImageDialog jobId={image.job_id} title={image.job_title} onClose={() => setImage(null)} />}
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
                <li>Its {confirmDelete.application_count || 0} application(s) are archived; candidates stay in the database.</li>
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Keep the job</Button>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => confirmDelete && removeJob(confirmDelete)} loading={deleting}>Delete job</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
