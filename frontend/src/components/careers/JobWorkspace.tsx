'use client';

import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Calendar, Check, ChevronDown, Copy, Database, Edit3, ExternalLink, FileText, Mail, MapPin,
  MoreHorizontal, Power, Target, Trash2, Users,
  ImageIcon,
} from '@/components/icons';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { useCareersStore } from '@/stores/careersStore';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { cn } from '@/lib/utils';
import { Bone } from '@/components/skeletons';
import ApplicationsList, { CandidateRowsSkeleton } from './ApplicationsList';
import DatabaseCandidates from './DatabaseCandidates';
import JobPostingForm from './JobPostingForm';
import { formatPostedOn, type JobHandlers, type JobTab, type MatchScope } from './JobRow';

function CopyRow({ label, value, icon: Icon, href }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; href?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-paper px-3 py-2 text-sm text-slate-800">
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
    <section className="rounded-xl border border-slate-200 bg-paper p-4 shadow-card sm:p-5">
      <h4 className="mb-2 text-sm font-semibold tracking-[-0.01em] text-slate-900">{title}</h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{text}</p>
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
        '-mb-px inline-flex items-center gap-2 border-b-2 px-1 pb-2.5 pt-1 text-sm font-semibold transition-colors [&_svg]:size-4',
        selected ? 'border-navy-700 text-navy-800' : 'border-transparent text-slate-500 hover:text-slate-900',
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={cn('rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums', selected ? 'bg-navy-50 text-navy-800' : 'bg-slate-100 text-slate-600')}>{count}</span>
      )}
    </button>
  );
}

/**
 * A job's page while the job is still loading: the page layout, the back link, the action buttons and the tab names are real; the title,
 * its details and the applicants are placeholders.
 */
export function JobWorkspaceSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-[calc(100vh-8rem)]" role="status" aria-busy="true" aria-label="Loading job">
      <header className="sticky top-12 z-20 -mx-4 border-b border-surface-border bg-paper/90 px-4 pt-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
        <div className="mx-auto max-w-[1400px]">
          <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-navy-700">
            <ArrowLeft className="h-3.5 w-3.5" /> All jobs
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Bone className="h-8 w-72 max-w-full" />
            <Bone className="h-5 w-12 rounded-full" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <Bone className="h-3.5 w-24" /><Bone className="h-3.5 w-20" /><Bone className="h-3.5 w-24" /><Bone className="h-3.5 w-28" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button variant="primary" size="sm" icon={<Target className="h-4 w-4" />} disabled>Match candidates</Button>
            <Button variant="secondary" size="sm" icon={<img src="/icons/linkedin.svg" alt="" className="h-4 w-4 object-contain" draggable={false} />} disabled>LinkedIn</Button>
            <Button variant="secondary" size="sm" icon={<img src="/icons/interview.jpg" alt="" className="h-4 w-4 rounded-sm object-cover" draggable={false} />} disabled>Interview</Button>
            <Button variant="secondary" size="sm" icon={<ImageIcon className="h-4 w-4" />} disabled>Hiring image</Button>
          </div>
          <div role="tablist" aria-label="Job sections" className="-mx-1 mt-4 flex items-center gap-3 overflow-x-auto px-1 pb-px sm:gap-5">
            <TabButton selected onClick={() => undefined} icon={<Users />} label="Applicants" count={<Bone className="inline-block h-3 w-4 align-middle" />} />
            <TabButton selected={false} onClick={() => undefined} icon={<Database />} label="Database" count={<Bone className="inline-block h-3 w-4 align-middle" />} />
            <TabButton selected={false} onClick={() => undefined} icon={<FileText />} label="Details" />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1400px] py-5">
        <CandidateRowsSkeleton label="Loading applicants" />
      </div>
    </div>
  );
}

/**
 * Full-page job workspace: applicants, database matches, job details.
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
  onChanged: () => void;
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

  useEffect(() => {
    selectJob(job);
    setFull(null);
    setEditing(false);
    return () => selectJob(null);
  }, [job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPublicUrl(`${window.location.origin}/careers/jobs/${job.public_token}`);
  }, [job.public_token]);

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
    <div className="animate-page-enter min-h-[calc(100vh-8rem)]" aria-label={`${job.job_title || 'Job'} workspace`}>
      <header className="sticky top-12 z-20 -mx-4 border-b border-surface-border bg-paper/90 px-4 pt-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8">
        <div className="mx-auto max-w-[1400px]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onClose}
                className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors hover:text-navy-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> All jobs
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold leading-tight tracking-[-0.03em] text-slate-900 sm:text-2xl sm:text-[26px]">
                  {job.job_title || 'Untitled role'}
                </h1>
                <span className={cn('chip', job.is_active ? 'chip-success' : 'chip-neutral')}>{job.is_active ? 'Live' : 'Inactive'}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.job_location || 'No location'}</span>
                <span className="inline-flex items-center gap-1">
                  <Avatar name={job.posted_by_user || '-'} size="sm" className="!h-4 !w-4 !text-[7px]" />
                  {job.posted_by_user || '-'}{job.posted_by_user && job.posted_by_user === currentUser ? ' · you' : ''}
                </span>
                <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatPostedOn(job.upload_date)}</span>
                {job.email_subject_id && <span className="font-mono text-2xs text-slate-600">{job.email_subject_id}</span>}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <div className="inline-flex">
              <Button
                variant="primary"
                size="sm"
                className="rounded-r-none"
                icon={<Target className="h-4 w-4" />}
                disabled={dbTotal !== null && everyone === 0}
                title="Score applicants and database candidates"
                onClick={() => match('all')}
              >
                {dbTotal === null ? 'Match candidates' : `Match ${dbEstimate ? '~' : ''}${everyone.toLocaleString()}`}
              </Button>
              <Menu
                align="start"
                trigger={({ ref, ...props }) => (
                  <Button ref={ref} variant="primary" size="sm" className="rounded-l-none border-l border-white/25 px-2" aria-label="Choose who to match" {...props}>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                )}
                items={[
                  { label: `Applicants and database (${everyone.toLocaleString()})`, hint: 'Everyone who applied plus search matches', icon: <Target />, disabled: everyone === 0, onSelect: () => match('all') },
                  { label: `Applicants only (${applicantCount.toLocaleString()})`, icon: <Users />, disabled: applicantCount === 0, onSelect: () => match('applicants') },
                  { label: `Database only (${databaseCount.toLocaleString()})`, icon: <Database />, disabled: databaseCount === 0, onSelect: () => match('database') },
                ]}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<img src="/icons/linkedin.svg" alt="" className="h-4 w-4 object-contain" draggable={false} />}
              onClick={() => handlers.onAi(job, 'linkedin')}
            >
              LinkedIn
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<img src="/icons/interview.jpg" alt="" className="h-4 w-4 rounded-sm object-cover" draggable={false} />}
              onClick={() => handlers.onAi(job, 'interview')}
            >
              Interview
            </Button>
            <Button variant="secondary" size="sm" icon={<ImageIcon className="h-4 w-4" />} onClick={() => handlers.onImage(job)} title="A ready-to-post We are hiring picture">
              Hiring image
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
                job.can_edit && { label: job.is_active ? 'Deactivate' : 'Activate', hint: job.is_active ? 'Stop applications' : 'Take applications', icon: <Power />, separated: true, onSelect: () => handlers.onToggleStatus(job) },
                job.can_delete && { label: 'Delete job', icon: <Trash2 />, danger: true, separated: !job.can_edit, onSelect: () => handlers.onDelete(job) },
              ]}
            />
          </div>

          {!editing && (
            <div role="tablist" aria-label="Job sections" className="-mx-1 mt-4 flex items-center gap-3 overflow-x-auto px-1 pb-px sm:gap-5">
              <TabButton selected={tab === 'applicants'} onClick={() => onTab('applicants')} icon={<Users />} label="Applicants" count={applicantCount.toLocaleString()} />
              <TabButton
                selected={tab === 'database'}
                onClick={() => onTab('database')}
                icon={<Database />}
                label="Database"
                count={dbTotal === null ? '…' : `${dbEstimate ? '~' : ''}${databaseCount.toLocaleString()}`}
              />
              <TabButton selected={tab === 'details'} onClick={() => onTab('details')} icon={<FileText />} label="Details" />
            </div>
          )}
          {editing && <div className="h-3" />}
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] py-5">
        {editing && full ? (
          <div>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-navy-600"
            >
              <ArrowLeft className="h-4 w-4" /> Back without saving
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

            <div className={tab === 'database' ? '' : 'hidden'}>
              <DatabaseCandidates
                job={job}
                onTotal={(total, estimate) => { setDbTotal(total); setDbEstimate(estimate); }}
                onQuery={setDbQuery}
              />
            </div>

            {tab === 'details' && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  {publicUrl && <CopyRow label="Public application link" value={publicUrl} icon={ExternalLink} href={publicUrl} />}
                  {job.email_subject_template && <CopyRow label="E-mail subject" value={job.email_subject_template} icon={Mail} />}
                </div>
                <TextBlock title="Summary" text={summary} />
                <TextBlock title="Key responsibilities" text={responsibilities} />
                <TextBlock title="Qualifications" text={qualifications} />
                {!summary && !responsibilities && !qualifications && (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-paper p-8 text-center text-sm text-slate-500">
                    No description was saved for this job.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
