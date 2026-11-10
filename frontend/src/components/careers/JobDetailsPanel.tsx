'use client';
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Calendar,
  Check,
  Code2,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  Power,
  Target,
  Trash2,
  Users,
  X,
} from '@/components/icons';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { useCareersStore } from '@/stores/careersStore';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import ApplicationsList from './ApplicationsList';
import JobPostingForm from './JobPostingForm';
import { formatPostedOn } from './JobCard';

type Tab = 'applicants' | 'details';

function CopyRow({ label, value, icon: Icon, href }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={value}>{value}</span>
        <button
          type="button"
          title={copied ? 'Copied' : 'Copy'}
          aria-label={`Copy ${label}`}
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" title="Open" className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text?: string }) {
  if (!text?.trim()) return null;
  return (
    <section>
      <h4 className="mb-1.5 text-[13px] font-semibold text-slate-900">{title}</h4>
      <p className="whitespace-pre-wrap rounded-xl border border-surface-border bg-white p-3.5 text-[13px] leading-relaxed text-slate-700">{text}</p>
    </section>
  );
}

/** Everything about one job posting in a side panel: its applicants, the match button, and edit, activate, delete, boolean string and links. */
export default function JobDetailsPanel({
  job,
  currentUser,
  onClose,
  onMatch,
  onToggleStatus,
  onDelete,
  onBoolean,
  onChanged,
}: {
  job: JobPostingListItem;
  currentUser?: string;
  onClose: () => void;
  onMatch: (job: JobPostingListItem) => void;
  onToggleStatus: (job: JobPostingListItem) => void;
  onDelete: (job: JobPostingListItem) => void;
  onBoolean: (job: JobPostingListItem) => void;
  onChanged: () => void;
}) {
  const { selectJob, applications } = useCareersStore();
  const [tab, setTab] = useState<Tab>('applicants');
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState<any>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');

  // The store loads this job's applicants whenever it is selected.
  useEffect(() => {
    selectJob(job);
    setTab('applicants');
    setEditing(false);
    setFull(null);
    return () => selectJob(null);
  }, [job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPublicUrl(`${window.location.origin}/careers/jobs/${job.public_token}`);
  }, [job.public_token]);

  // The list only carries short previews; whoever may edit the job can read it whole.
  useEffect(() => {
    if (!job.can_edit) return;
    let alive = true;
    api.getJobForEdit(job.job_id).then((d: any) => { if (alive) setFull(d); }).catch(() => {});
    return () => { alive = false; };
  }, [job.job_id, job.can_edit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;     // a dialog on top closes first
      onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const applicantCount = applications.length > 0 ? applications.length : (job.application_count ?? 0);
  const summary = full?.job_summary ?? job.job_summary;
  const responsibilities = full?.key_responsibilities ?? job.key_responsibilities;
  const qualifications = full?.qualifications ?? job.qualifications;

  const startEdit = async () => {
    setLoadingEdit(true);
    try {
      const data = full ?? (await api.getJobForEdit(job.job_id));
      setFull(data);
      setEditing(true);
    } catch (e) {
      console.error('Failed to load job data for editing:', e);
    } finally {
      setLoadingEdit(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[45]" role="presentation">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        role="complementary"
        aria-label={`${job.job_title || 'Job'} details`}
        className="absolute right-0 top-0 flex h-full w-full max-w-[1120px] flex-col bg-slate-50 shadow-[-24px_0_48px_-16px_rgba(16,24,40,0.25)]"
      >
        {/* header */}
        <header className="border-b border-surface-border bg-white px-5 pb-4 pt-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('chip', job.is_active ? 'chip-success' : 'chip-neutral')}>{job.is_active ? 'Live' : 'Inactive'}</span>
                {job.email_subject_id && <span className="chip chip-brand">{job.email_subject_id}</span>}
              </div>
              <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.025em] text-slate-900">{job.job_title || 'Untitled role'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {job.job_location || 'No location'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={job.posted_by_user || '-'} size="sm" className="!h-5 !w-5 !text-[8px]" />
                  {job.posted_by_user || '-'}{job.posted_by_user && job.posted_by_user === currentUser ? ' (you)' : ''}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {formatPostedOn(job.upload_date)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {applicantCount} applicant{applicantCount === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {applicantCount > 0 && (
              <Button variant="primary" size="sm" icon={<Target className="h-4 w-4" />} onClick={() => onMatch(job)}>
                Match {applicantCount} applicant{applicantCount === 1 ? '' : 's'}
              </Button>
            )}
            {job.can_edit && (
              <Button variant="secondary" size="sm" icon={<Edit3 className="h-4 w-4" />} onClick={startEdit} loading={loadingEdit} disabled={editing}>
                Edit
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<Code2 className="h-4 w-4" />} onClick={() => onBoolean(job)}>
              Boolean string
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="h-4 w-4" />}
              onClick={() => window.open(`/careers/jobs/${job.public_token}`, '_blank')}
            >
              Live page
            </Button>
            {job.can_edit && (
              <Button variant="secondary" size="sm" icon={<Power className="h-4 w-4" />} onClick={() => onToggleStatus(job)}>
                {job.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            {job.can_delete && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Trash2 className="h-4 w-4" />}
                className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => onDelete(job)}
              >
                Delete
              </Button>
            )}
          </div>
        </header>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {editing && full ? (
            <div>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-navy-600"
              >
                <ArrowLeft className="h-4 w-4" /> Back to job
              </button>
              <JobPostingForm
                jobId={job.job_id}
                publicToken={job.public_token === 'unknown' ? undefined : job.public_token}
                initialData={{
                  jobTitle: full.job_title || '',
                  jobLocation: full.job_location || '',
                  jobSummary: full.job_summary || '',
                  keyResponsibilities: full.key_responsibilities || '',
                  qualifications: full.qualifications || '',
                }}
                onSuccess={() => {
                  setEditing(false);
                  setFull(null);
                  onChanged();
                }}
              />
            </div>
          ) : (
            <>
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                className="mb-4"
                items={[
                  { value: 'applicants', label: `Applicants (${applicantCount})` },
                  { value: 'details', label: 'Job details' },
                ]}
              />

              {tab === 'applicants' ? (
                <ApplicationsList />
              ) : (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    {job.email_subject_template && <CopyRow label="Unique subject" value={job.email_subject_template} icon={Mail} />}
                    {publicUrl && <CopyRow label="Public application link" value={publicUrl} icon={FileText} href={publicUrl} />}
                  </div>
                  <TextBlock title="Summary" text={summary} />
                  <TextBlock title="Key responsibilities" text={responsibilities} />
                  <TextBlock title="Qualifications" text={qualifications} />
                  {!summary && !responsibilities && !qualifications && (
                    <p className="rounded-xl border border-dashed border-surface-border bg-white p-6 text-center text-[13px] text-slate-500">
                      No description was saved for this job.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </motion.aside>
    </div>
  );
}
