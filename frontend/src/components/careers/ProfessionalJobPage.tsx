'use client';
import { useEffect, useState } from 'react';
import {
  MapPin,
  Calendar,
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
          <p className="text-sm font-medium text-slate-900">
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
    { icon: Building2, label: 'Company', value: 'AlphaData' },
    ...(experience ? [{ icon: Briefcase, label: 'Experience', value: experience }] : []),
    { icon: Calendar, label: 'Posted', value: formatDate(publicJob.upload_date) },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-50 via-sky-50/40 to-[#EEF3FA]">
      <PublicHeader
        right={
          isActive ? (
            <Button variant="primary" size="sm" onClick={() => setShowApplicationForm(true)}>
              Apply now
            </Button>
          ) : (
            <span className="rounded-full border border-slate-200/70 bg-paper/70 px-3 py-1 text-xs font-medium text-slate-500 shadow-sm backdrop-blur">Closed</span>
          )
        }
      />

      <PublicBody>
        {/* Centered title hero */}
        <section className="relative overflow-hidden border-b border-slate-200/70">
          <div aria-hidden className="pointer-events-none absolute -left-20 top-4 h-56 w-56 rounded-full bg-sky-300/25 blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-navy-400/15 blur-3xl" />
          <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-14 text-center sm:px-6 sm:pb-14 sm:pt-16 lg:px-8">
            <motion.div variants={stagger(0.07, 0.05)} initial="hidden" animate="show" className="mx-auto flex flex-col items-center">
              <motion.p
                variants={rise}
                className="mb-5 inline-flex rounded-full border border-slate-200/70 bg-paper/80 px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-navy-700 shadow-[var(--shadow-card)] backdrop-blur"
              >
                {isActive ? 'Now hiring' : 'Position closed'}
              </motion.p>
              <motion.h1
                variants={rise}
                className="max-w-5xl text-3xl font-semibold leading-[1.1] tracking-[-0.035em] text-slate-900 sm:text-[40px]"
              >
                {publicJob.job_title || 'Open Position'}
              </motion.h1>
              <motion.dl
                variants={rise}
                className="mt-9 grid w-full max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4"
              >
                {facts.map(({ icon: Icon, label, value }) => (
                  <div
                    key={label}
                    className="min-w-0 rounded-xl border border-slate-200 bg-paper px-3 py-3 text-center shadow-card"
                  >
                    <dt className="flex items-center justify-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </dt>
                    <dd className="mt-1.5 truncate text-base font-semibold text-ink" title={String(value)}>
                      {value}
                    </dd>
                  </div>
                ))}
              </motion.dl>
              {isActive ? (
                <motion.div variants={rise} className="mt-8">
                  <Button variant="primary" size="lg" className="px-8 shadow-md" onClick={() => setShowApplicationForm(true)}>
                    Apply now
                  </Button>
                </motion.div>
              ) : null}
            </motion.div>
          </div>
        </section>

        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <motion.div variants={stagger(0.08, 0.1)} initial="hidden" animate="show" className="space-y-8">
            <motion.section
              variants={rise}
              className="rounded-3xl border border-slate-200 bg-paper p-6 text-center shadow-[var(--shadow-card)] sm:p-8 lg:p-10"
            >
              <h2 className="mb-4 text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">About the role</h2>
              <div className="whitespace-pre-wrap text-left text-md leading-7 text-slate-700">{publicJob.job_description}</div>
            </motion.section>

            {responsibilities.length > 0 && (
              <motion.section
                variants={rise}
                className="rounded-3xl border border-slate-200 bg-paper p-6 shadow-[var(--shadow-card)] sm:p-8 lg:p-10"
              >
                <h2 className="mb-5 text-center text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Key responsibilities</h2>
                <ul className="space-y-3 text-left">
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
              <motion.section
                variants={rise}
                className="rounded-3xl border border-slate-200 bg-paper p-6 shadow-[var(--shadow-card)] sm:p-8 lg:p-10"
              >
                <h2 className="mb-5 text-center text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Qualifications and requirements</h2>
                <ul className="space-y-3 text-left">
                  {requirements.map((requirement: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-3 text-md leading-7 text-slate-700">
                      <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-500" />
                      <span>{requirement}</span>
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}

          </motion.div>

          <section className="mt-16 text-center">
            <h2 className="mb-5 text-2xs font-semibold uppercase tracking-[0.12em] text-slate-400">Other openings</h2>
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
              className="absolute inset-0 bg-scrim/40"
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
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-border bg-paper/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
                <h2 className="text-base font-semibold text-ink sm:text-lg">Apply for this position</h2>
                <button
                  onClick={() => setShowApplicationForm(false)}
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 sm:p-6">
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
