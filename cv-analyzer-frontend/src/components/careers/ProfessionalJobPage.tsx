'use client';
import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Calendar,
  CheckCircle2,
  Users,
  AlertCircle,
  Building2,
  Briefcase,
  X,
} from 'lucide-react';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import JobApplicationForm from './JobApplicationForm';
import MoreOpenings from './MoreOpenings';

interface ProfessionalJobPageProps {
  token: string;
}

export default function ProfessionalJobPage({ token }: ProfessionalJobPageProps) {
  const { publicJob, isLoading, error, loadPublicJob, clearError } = useCareersStore();
  const [showApplicationForm, setShowApplicationForm] = useState(false);

  useEffect(() => {
    if (token) loadPublicJob(token);
  }, [token, loadPublicJob]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7F8FA] py-16">
        <div className="mx-auto max-w-3xl px-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-2/3 rounded bg-gray-200" />
            <div className="h-40 rounded-lg bg-gray-200" />
            <div className="h-32 rounded-lg bg-gray-200" />
          </div>
        </div>
      </div>
    );
  }

  if (!token || error || !publicJob) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50">
            <AlertCircle className="h-5 w-5 text-danger-600" />
          </div>
          <p className="text-[13px] font-medium text-gray-900">
            {!token
              ? 'Invalid job link.'
              : error || 'Job posting not found or may have expired.'}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Please use the complete job posting URL provided by the employer.
          </p>
          {error && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => clearError?.()}>
              Dismiss
            </Button>
          )}
        </div>
      </div>
    );
  }

  const isActive = publicJob.is_active;
  const responsibilities = (publicJob.responsibilities || []).filter((r: string) => r && r.trim());
  const requirements = (publicJob.requirements || []).filter((r: string) => r && r.trim());

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white p-1.5">
              <img src="/alphadatalogo.svg" alt="Alpha Data" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-[13px] font-semibold leading-tight text-gray-900">AlphaData</p>
              <p className="text-[11px] uppercase tracking-wide text-gray-500">Recruitment</p>
            </div>
          </div>
          {isActive ? (
            <Button variant="primary" size="sm" onClick={() => setShowApplicationForm(true)}>
              Apply now
            </Button>
          ) : (
            <span className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
              Closed
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Title card */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
            {publicJob.job_title || 'Open Position'}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-gray-600">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-gray-400" />
              {publicJob.job_location || 'UAE'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-gray-400" />
              {publicJob.company_name || 'AlphaData'}
            </span>
            {publicJob.experience_required != null && publicJob.experience_required !== '' && (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-4 w-4 text-gray-400" />
                {publicJob.experience_required} yrs experience
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-gray-400" />
              Posted {formatDate(publicJob.upload_date)}
            </span>
          </div>
        </div>

        {/* Description */}
        <section className="mt-4 rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="section-label mb-3">About the role</h2>
          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-gray-700">
            {publicJob.job_description}
          </div>
        </section>

        {/* Responsibilities */}
        {responsibilities.length > 0 && (
          <section className="mt-4 rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="section-label mb-3">Key responsibilities</h2>
            <ul className="space-y-2.5">
              {responsibilities.map((responsibility: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <span>{responsibility}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Requirements */}
        {requirements.length > 0 && (
          <section className="mt-4 rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="section-label mb-3">Qualifications &amp; requirements</h2>
            <ul className="space-y-2.5">
              {requirements.map((requirement: string, idx: number) => (
                <li key={idx} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Apply CTA */}
        <div className="mt-6 flex justify-center">
          {isActive ? (
            <Button variant="primary" onClick={() => setShowApplicationForm(true)} className="px-8">
              Apply for this position
            </Button>
          ) : (
            <span className="rounded-md bg-gray-100 px-4 py-2 text-[13px] font-medium text-gray-500">
              No longer accepting candidates
            </span>
          )}
        </div>

        {/* More openings */}
        <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="section-label mb-4">Related openings</h2>
          <MoreOpenings currentJobToken={token} />
        </section>
      </main>

      {/* Application modal */}
      {showApplicationForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3.5">
              <h2 className="text-[15px] font-semibold text-gray-900">Apply for this position</h2>
              <button
                onClick={() => setShowApplicationForm(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <JobApplicationForm
                jobToken={token}
                jobData={{
                  years_of_experience: publicJob.experience_required,
                  job_title: publicJob.job_title,
                }}
                onSuccess={() => setShowApplicationForm(false)}
                onCancel={() => setShowApplicationForm(false)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
