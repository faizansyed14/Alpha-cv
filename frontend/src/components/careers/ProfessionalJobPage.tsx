'use client';
import { useEffect, useState } from 'react';
import {
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Building2,
  Briefcase,
  X,
} from '@/components/icons';
import { AnimatePresence, motion } from 'framer-motion';
import { duration, ease, rise, spring, stagger } from '@/lib/motion';
import { formatExperience } from '@/lib/format';
import { PublicBody, PublicFooter, PublicHeader } from '@/components/careers/PublicShell';
import { useCareersStore } from '@/stores/careersStore';
import { Button } from '@/components/ui/button';
import JobApplicationForm from './JobApplicationForm';
import MoreOpenings from './MoreOpenings';
import { JobDetailSkeleton } from '@/components/skeletons';

interface ProfessionalJobPageProps {
  token: string;
}

export default function ProfessionalJobPage({ token }: ProfessionalJobPageProps) {
  const { publicJob, isLoading, error, loadPublicJob, clearError } = useCareersStore();
  const [showApplicationForm, setShowApplicationForm] = useState(false);

  // Until the first load for THIS link has finished we do not know whether the job exists, so show the skeleton,
  // never "not found" (the store starts with no job and isLoading=false, which used to flash the error first).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    Promise.resolve(loadPublicJob(token)).finally(() => {
      if (alive) setLoadedFor(token);
    });
    return () => {
      alive = false;
    };
  }, [token, loadPublicJob]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  if (token && (isLoading || loadedFor !== token)) {
    return <JobDetailSkeleton />;
  }

  // Only treat missing job / bad token as a dead page. Application submit errors
  // (e.g. already applied) stay on the form via careersStore.error.
  if (!token || !publicJob) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4">
        <div className="surface-panel w-full max-w-md p-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-danger-50">
            <AlertCircle className="h-5 w-5 text-danger-600" />
          </div>
          <p className="text-[13px] font-medium text-slate-900">
            {!token
              ? 'Invalid job link.'
              : error || 'Job posting not found or may have expired.'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
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
  const experience = formatExperience(publicJob.experience_required);

  const facts = [
    { icon: MapPin, label: 'Location', value: publicJob.job_location || 'UAE' },
    { icon: Building2, label: 'Company', value: publicJob.company_name || 'AlphaData' },
    ...(experience ? [{ icon: Briefcase, label: 'Experience', value: experience }] : []),
    { icon: Calendar, label: 'Posted', value: formatDate(publicJob.upload_date) },
  ];

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      <PublicHeader
        right={
          isActive ? (
            <Button variant="primary" size="sm" onClick={() => setShowApplicationForm(true)}>
              Apply now
            </Button>
          ) : (
            <span className="rounded-full border border-surface-strong bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">Closed</span>
          )
        }
      />

      <PublicBody>
        {/* Title */}
        <section className="border-b border-surface-border bg-gradient-to-b from-navy-50 via-white to-white">
          <div className="mx-auto max-w-3xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
            <motion.div variants={stagger(0.07, 0.05)} initial="hidden" animate="show">
              <motion.p variants={rise} className="mb-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-navy-700 shadow-soft ring-1 ring-inset ring-navy-100">
                {isActive ? 'Now hiring' : 'Position closed'}
              </motion.p>
              <motion.h1 variants={rise} className="font-display text-3xl leading-[1.12] text-slate-900 sm:text-4xl">
                {publicJob.job_title || 'Open Position'}
              </motion.h1>
              <motion.dl variants={rise} className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                {facts.map(({ icon: Icon, label, value }) => (
                  <div key={label} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </dt>
                    <dd className="mt-1 truncate text-base font-medium text-ink" title={String(value)}>
                      {value}
                    </dd>
                  </div>
                ))}
              </motion.dl>
            </motion.div>
          </div>
        </section>

        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <motion.div variants={stagger(0.08, 0.1)} initial="hidden" animate="show" className="space-y-10">
            <motion.section variants={rise}>
              <h2 className="mb-3 text-2xs font-semibold uppercase tracking-[0.1em] text-slate-400">About the role</h2>
              <div className="whitespace-pre-wrap text-md leading-7 text-slate-700">{publicJob.job_description}</div>
            </motion.section>

            {responsibilities.length > 0 && (
              <motion.section variants={rise}>
                <h2 className="mb-4 text-2xs font-semibold uppercase tracking-[0.1em] text-slate-400">Key responsibilities</h2>
                <ul className="space-y-3">
                  {responsibilities.map((responsibility: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-3 text-md leading-7 text-slate-700">
                      <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-500" />
                      <span>{responsibility}</span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}

            {requirements.length > 0 && (
              <motion.section variants={rise}>
                <h2 className="mb-4 text-2xs font-semibold uppercase tracking-[0.1em] text-slate-400">Qualifications and requirements</h2>
                <ul className="space-y-3">
                  {requirements.map((requirement: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-3 text-md leading-7 text-slate-700">
                      <CheckCircle2 className="mt-1.5 h-4 w-4 shrink-0 text-success" />
                      <span>{requirement}</span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}

            <motion.section variants={rise} className="rounded-2xl border border-surface-border bg-paper p-6 text-center shadow-card sm:p-8">
              {isActive ? (
                <>
                  <h2 className="font-display text-2xl text-ink">Interested in this role?</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                    It takes a few minutes. Upload your CV and tell us a little about yourself.
                  </p>
                  <Button variant="primary" size="lg" className="mt-6 px-8" onClick={() => setShowApplicationForm(true)}>
                    Apply for this position
                  </Button>
                </>
              ) : (
                <p className="text-sm text-slate-500">This position is no longer accepting candidates.</p>
              )}
            </motion.section>
          </motion.div>

          <section className="mt-16">
            <h2 className="mb-4 text-2xs font-semibold uppercase tracking-[0.1em] text-slate-400">Other openings</h2>
            <MoreOpenings currentJobToken={token} />
          </section>
        </div>
      </PublicBody>

      <PublicFooter />

      {/* Application modal */}
      <AnimatePresence>
        {showApplicationForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-slate-900/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: duration.base, ease }}
              onClick={() => setShowApplicationForm(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Apply for this position"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: duration.fast, ease } }}
              transition={spring.soft}
              className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-surface-border bg-paper shadow-panel"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-border bg-paper/95 px-6 py-4 backdrop-blur">
                <h2 className="text-lg font-semibold text-ink">Apply for this position</h2>
                <button
                  onClick={() => setShowApplicationForm(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-6">
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
