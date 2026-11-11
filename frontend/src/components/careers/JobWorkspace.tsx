'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Calendar, Check, ChevronDown, ClipboardList, Copy, Database, Edit3, ExternalLink, FileText, Linkedin, Mail, MapPin,
  MoreHorizontal, Power, Target, Trash2, Users, X,
} from '@/components/icons';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { useCareersStore } from '@/stores/careersStore';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import ApplicationsList from './ApplicationsList';
import DatabaseCandidates from './DatabaseCandidates';
import JobPostingForm from './JobPostingForm';
import { formatPostedOn, type JobHandlers, type JobTab, type MatchScope } from './JobRow';

function CopyRow({ label, value, icon: Icon, href }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-[13px] text-slate-800">
        <Icon className="h-4 w-4 shrink-0 text-slate-400" />
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
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </button>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" title="Open in a new tab" className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
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

function TabButton({ selected, onClick, icon, label, count }: { selected: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-[13.5px] font-semibold transition-colors [&_svg]:size-4',
        selected ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-900',
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={cn('rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums', selected ? 'bg-navy-50 text-navy-800' : 'bg-slate-100 text-slate-600')}>{count}</span>
      )}
    </button>
  );
}

/**
 * One job's workspace, in a wide side panel: who applied, who in the database fits it, and the job itself.
 * The header carries the actions: match, LinkedIn post, interview questions, and the rest under "More".
 */
export default function JobWorkspace({
  job,
  currentUser,
  tab,
  startInEdit = false,
  onTab,
  onClose,
  onChanged,
  onMatchScope,
  handlers,
}: {
  job: JobPostingListItem;
  currentUser?: string;
  tab: JobTab;
  startInEdit?: boolean;
  onTab: (tab: JobTab) => void;
  onClose: () => void;
  /** The job was edited: reload the list */
  onChanged: () => void;
  /** Match from inside the workspace: the scope, the boolean string typed in the database tab (if any) and how many people it covers */
  onMatchScope: (job: JobPostingListItem, scope: MatchScope, customQuery: string | null, expected: number) => void;
  handlers: JobHandlers;
}) {
  const { selectJob, applications } = useCareersStore();
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState<any>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [dbTotal, setDbTotal] = useState<number | null>(null);
  const [dbEstimate, setDbEstimate] = useState(false);
  const [dbQuery, setDbQuery] = useState<string | null>(null);

  // The store loads this job's applicants whenever it is selected.
  useEffect(() => {
    selectJob(job);
    setFull(null);
    setEditing(false);
    return () => selectJob(null);
  }, [job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPublicUrl(`${window.location.origin}/careers/jobs/${job.public_token}`);
  }, [job.public_token]);

  // The list only carries short previews; whoever may edit the job can read it whole.
  useEffect(() => {
    if (!job.can_edit) return;
    let alive = true;
    api.getJobForEdit(job.job_id)
      .then((d: any) => {
        if (!alive) return;
        setFull(d);
        if (startInEdit) setEditing(true);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [job.job_id, job.can_edit, startInEdit]);

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
  const databaseCount = dbTotal ?? 0;
  const everyone = applicantCount + databaseCount;
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

  const match = (scope: MatchScope) =>
    onMatchScope(job, scope, dbQuery, scope === 'applicants' ? applicantCount : scope === 'database' ? databaseCount : everyone);

  return (
    <div className="fixed inset-0 z-[45]" role="presentation">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        role="complementary"
        aria-label={`${job.job_title || 'Job'} workspace`}
        className="absolute right-0 top-0 flex h-full w-full max-w-[1240px] flex-col bg-slate-50 shadow-[-24px_0_48px_-16px_rgba(16,24,40,0.25)]"
      >
        <header className="border-b border-surface-border bg-white px-5 pt-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-500 transition-colors hover:text-navy-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> All jobs
              </button>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-[21px] font-bold leading-tight tracking-[-0.025em] text-slate-900">{job.job_title || 'Untitled role'}</h2>
                <span className={cn('chip', job.is_active ? 'chip-success' : 'chip-neutral')}>{job.is_active ? 'Live' : 'Inactive'}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-slate-500">
                <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{job.job_location || 'No location'}</span>
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={job.posted_by_user || '-'} size="sm" className="!h-5 !w-5 !text-[8px]" />
                  {job.posted_by_user || '-'}{job.posted_by_user && job.posted_by_user === currentUser ? ' (you)' : ''}
                </span>
                <span className="inline-flex items-center gap-1.5"><Calendar className="h-4 w-4" />Posted {formatPostedOn(job.upload_date)}</span>
                {job.email_subject_id && <span className="font-mono text-[12px] text-slate-600">{job.email_subject_id}</span>}
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
            <div className="inline-flex">
              <Button
                variant="primary"
                size="sm"
                className="rounded-r-none"
                icon={<Target className="h-4 w-4" />}
                disabled={dbTotal !== null && everyone === 0}
                title="Score the applicants and the database candidates against this job and rank them, best first"
                onClick={() => match('all')}
              >
                {dbTotal === null ? 'Match candidates' : `Match ${dbEstimate ? 'about ' : ''}${everyone.toLocaleString()} candidate${everyone === 1 ? '' : 's'}`}
              </Button>
              <Menu
                align="start"
                trigger={({ ref, ...props }) => (
                  <Button ref={ref} variant="primary" size="sm" className="rounded-l-none border-l border-white/25 px-2" aria-label="Choose who to match" {...props}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                )}
                items={[
                  { label: `Applicants and database matches (${everyone.toLocaleString()})`, hint: 'Everyone who applied plus everyone your search finds', icon: <Target />, disabled: everyone === 0, onSelect: () => match('all') },
                  { label: `Applicants only (${applicantCount.toLocaleString()})`, icon: <Users />, disabled: applicantCount === 0, onSelect: () => match('applicants') },
                  { label: `Database matches only (${databaseCount.toLocaleString()})`, icon: <Database />, disabled: databaseCount === 0, onSelect: () => match('database') },
                ]}
              />
            </div>
            <Button variant="secondary" size="sm" icon={<Linkedin className="h-4 w-4" />} onClick={() => handlers.onAi(job, 'linkedin')}>
              LinkedIn post
            </Button>
            <Button variant="secondary" size="sm" icon={<ClipboardList className="h-4 w-4" />} onClick={() => handlers.onAi(job, 'interview')}>
              Interview questions
            </Button>
            {job.can_edit && (
              <Button variant="secondary" size="sm" icon={<Edit3 className="h-4 w-4" />} onClick={startEdit} loading={loadingEdit} disabled={editing}>
                Edit
              </Button>
            )}
            <Menu
              className="ml-auto"
              trigger={({ ref, ...props }) => <IconButton ref={ref} label="More actions" icon={<MoreHorizontal />} tip="bottom" {...props} />}
              items={[
                { label: 'Open public page', icon: <ExternalLink />, onSelect: () => window.open(`/careers/jobs/${job.public_token}`, '_blank', 'noopener') },
                { label: 'Copy application link', icon: <Copy />, onSelect: () => handlers.onCopy(publicUrl, 'Application link') },
                !!job.email_subject_template && { label: 'Copy e-mail subject', icon: <Mail />, onSelect: () => handlers.onCopy(job.email_subject_template || '', 'E-mail subject') },
                job.can_edit && { label: job.is_active ? 'Deactivate' : 'Activate', hint: job.is_active ? 'Stop taking applications' : 'Take applications again', icon: <Power />, separated: true, onSelect: () => handlers.onToggleStatus(job) },
                job.can_delete && { label: 'Delete job', icon: <Trash2 />, danger: true, separated: !job.can_edit, onSelect: () => handlers.onDelete(job) },
              ]}
            />
          </div>

          {/* tabs */}
          {!editing && (
            <div role="tablist" aria-label="Job sections" className="mt-4 flex items-center gap-6">
              <TabButton selected={tab === 'applicants'} onClick={() => onTab('applicants')} icon={<Users />} label="Applicants" count={applicantCount.toLocaleString()} />
              <TabButton
                selected={tab === 'database'}
                onClick={() => onTab('database')}
                icon={<Database />}
                label="Database matches"
                count={dbTotal === null ? '…' : `${dbEstimate ? '~' : ''}${databaseCount.toLocaleString()}`}
              />
              <TabButton selected={tab === 'details'} onClick={() => onTab('details')} icon={<FileText />} label="Job details" />
            </div>
          )}
          {editing && <div className="h-4" />}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
          {editing && full ? (
            <div>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 transition-colors hover:text-navy-600"
              >
                <ArrowLeft className="h-4 w-4" /> Back to the job without saving
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
              {tab === 'applicants' && <ApplicationsList />}

              {/* kept mounted so its count is known for the tab label and the match button, whichever tab is open */}
              <div className={tab === 'database' ? '' : 'hidden'}>
                <DatabaseCandidates
                  job={job}
                  onTotal={(total, estimate) => { setDbTotal(total); setDbEstimate(estimate); }}
                  onQuery={setDbQuery}
                />
              </div>

              {tab === 'details' && (
                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    {publicUrl && <CopyRow label="Public application link" value={publicUrl} icon={ExternalLink} href={publicUrl} />}
                    {job.email_subject_template && <CopyRow label="E-mail subject for applications by e-mail" value={job.email_subject_template} icon={Mail} />}
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
