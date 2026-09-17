'use client';
import React, { useEffect, useState } from 'react';
import { MapPin, Briefcase, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';

interface MoreOpeningsProps {
  currentJobToken?: string; // Exclude current job from the list
}

export default function MoreOpenings({ currentJobToken }: MoreOpeningsProps) {
  const [recentJobs, setRecentJobs] = useState<JobPostingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRecentJobs = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch 6 jobs to ensure we have 5 after filtering out current job
        const jobs = await api.getRecentJobPostings(6);

        // Filter out the current job if token is provided
        const filteredJobs = currentJobToken
          ? jobs.filter(job => job.public_token !== currentJobToken)
          : jobs;

        // Take only the first 5
        setRecentJobs(filteredJobs.slice(0, 5));
      } catch (err: any) {
        console.error('Failed to fetch recent jobs:', err);
        setError('Failed to load recent job openings');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRecentJobs();
  }, [currentJobToken]);

  const handleJobClick = (job: JobPostingListItem) => {
    if (job.public_token && job.public_token !== 'unknown') {
      window.open(`/careers/jobs/${job.public_token}`, '_blank');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
        Loading more openings…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (recentJobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Briefcase className="h-5 w-5 text-gray-400" />
        </div>
        <p className="text-[13px] font-medium text-gray-900">No other openings</p>
        <p className="mt-1 text-xs text-gray-500">
          This is currently the only active job opening. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recentJobs.map((job) => {
        const tokenOk = job.public_token && job.public_token !== 'unknown';
        return (
          <button
            key={job.job_id}
            type="button"
            onClick={() => handleJobClick(job)}
            disabled={!tokenOk}
            className="group flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-brand-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-gray-900 group-hover:text-brand-700">
                {job.job_title || 'Open position'}
              </p>
              {job.job_location && (
                <span className="mt-1 inline-flex items-center gap-1.5 text-[13px] text-gray-500">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  <span className="truncate">{job.job_location}</span>
                </span>
              )}
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
          </button>
        );
      })}
    </div>
  );
}
