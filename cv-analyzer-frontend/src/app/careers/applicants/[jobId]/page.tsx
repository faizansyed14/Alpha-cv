'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Target, Users, Briefcase } from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { LoadingCard } from '@/components/ui/loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import Protected from '@/components/layout/Protected';
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
          // Job is already in store — use it directly, no permission issues
          selectJob(existingJob);
        } else {
          // Job not in local store — try the edit endpoint (works if owner/admin),
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
            // 403 / not owner — we still want to show applicants read-only.
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
          <LoadingCard />
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
      <div className="min-h-screen bg-[var(--app-bg)]">
        <div className="max-w-6xl mx-auto p-4 sm:p-6">
          <div className="mb-4 sm:mb-6">
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => router.push('/dashboard')}
            >
              Back to Careers
            </Button>
          </div>

          <div className="mb-4 sm:mb-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-[12px] text-gray-500">
                <Briefcase className="h-4 w-4 text-gray-400" />
                <span className="truncate">Job</span>
              </div>
              <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
                {selectedJob?.job_title || 'Applicants'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-gray-400" />
                  {applications.length} candidate{applications.length !== 1 ? 's' : ''}
                </span>
                <span className="text-gray-300">·</span>
                <span>Review CVs, add notes, and run AI match when ready</span>
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
                  {isMatching ? 'Starting…' : `Match ${applications.length}`}
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <ApplicationsList />
          </div>
        </div>
      </div>
    </Protected>
  );
}