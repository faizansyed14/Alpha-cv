'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Target, Users, Briefcase } from '@/components/icons';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ApplicantsSkeleton } from '@/components/skeletons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from '@/components/icons';
import Protected from '@/components/layout/Protected';
import AppShell from '@/components/layout/AppShell';
import ApplicationsList from '@/components/careers/ApplicationsList';
import type { JobPostingListItem } from '@/lib/types';

export default function JobApplicantsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;
  const { user } = useAuthStore();
  const {
    selectJob,
    selectedJob,
    applications,
    matchJobCandidates,
    jobPostings,
    loadJobApplications,
  } = useCareersStore();
  const { setMatchingProgress, setLoading: setAppLoading } = useAppStore();
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [isMatching, setIsMatching] = useState(false);

  useEffect(() => {
    if (!jobId || !user) {
      if (!user) setError('You need to be logged in to view applicants.');
      setInitializing(false);
      return;
    }
    let cancelled = false;

    (async () => {
      setError(null);
      setInitializing(true);
      try {
        // Step 1: Try to find job in already-loaded postings (no extra API call needed)
        const existingJob = jobPostings.find((j) => j.job_id === jobId);

        if (existingJob) {
          // Job is already in store, use it directly, no permission issues
          selectJob(existingJob);
        } else {
          // Job not in local store, try the edit endpoint (works if owner/admin),
          // but gracefully fall back for non-owners instead of blocking the page.
          let resolvedJob: JobPostingListItem;
          try {
            const editData = await api.getJobForEdit(jobId);
            resolvedJob = {
              job_id: jobId,
              job_title: editData.job_title,
              filename: '',
              upload_date: '',
              is_active: true,
              public_token: '',
            };
          } catch (editErr: any) {
            // 403 / not owner, we still want to show applicants read-only.
            // Use a placeholder title; the applicants list will still load fine.
            resolvedJob = {
              job_id: jobId,
              job_title: 'Job Applicants',
              filename: '',
              upload_date: '',
              is_active: true,
              public_token: '',
            };
          }

          if (cancelled) return;
          selectJob(resolvedJob);
        }

        // Step 2: Always load the applications for this job regardless of edit access
        if (!cancelled) {
          await loadJobApplications(jobId);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load applicants.');
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMatchCandidates = async () => {
    if (!selectedJob || applications.length === 0) return;
    try {
      setMatchingProgress({
        totalCVs: applications.length,
        processedCVs: 0,
        currentStage: 'initializing',
        isVisible: true,
        estimatedTimeRemaining: Math.max(30, applications.length * 3),
      });
      setAppLoading('careersMatching', true);
      router.push('/match');
      await new Promise((r) => setTimeout(r, 500));
      await matchJobCandidates(selectedJob.job_id);
    } catch (e) {
      console.error('Failed to match candidates:', e);
      alert('Failed to match candidates. Please try again.');
    } finally {
      setIsMatching(false);
    }
  };

  if (!user) {
    return (
      <Protected>
        <div className="p-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>You need to be logged in to view applicants.</AlertDescription>
          </Alert>
        </div>
      </Protected>
    );
  }

  if (initializing) {
    return (
      <Protected>
        <div className="p-6">
          <ApplicantsSkeleton />
        </div>
      </Protected>
    );
  }

  if (error) {
    return (
      <Protected>
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="secondary" className="mt-4" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/dashboard')}>
            Back to app
          </Button>
        </div>
      </Protected>
    );
  }

  return (
    <Protected>
      <AppShell>
        <div>
          <div className="mb-3">
            <button
              type="button"
              onClick={() => router.push('/careers-manage')}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-navy-600"
            >
              <ArrowLeft className="h-4 w-4" /> Careers
            </button>
          </div>

          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-solid-soft text-white shadow-sm">
                <Briefcase className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold tracking-[-0.025em] text-slate-900 sm:text-2xl">
                  {selectedJob?.job_title || 'Applicants'}
                </h1>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-slate-400" />
                    {applications.length} applicant{applications.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>Review CVs, add notes, and run AI match when ready</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              {applications.length > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Target className="h-4 w-4" />}
                  onClick={() => {
                    setIsMatching(true);
                    handleMatchCandidates();
                  }}
                  loading={isMatching}
                >
                  {isMatching ? 'Starting…' : `Match ${applications.length} applicant${applications.length !== 1 ? 's' : ''}`}
                </Button>
              )}
            </div>
          </div>

          <ApplicationsList />
        </div>
      </AppShell>
    </Protected>
  );
}