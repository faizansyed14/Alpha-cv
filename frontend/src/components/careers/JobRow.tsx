'use client';

import React from 'react';
import {
  ClipboardList, Code2, Copy, Database, Edit3, ExternalLink, Eye, Linkedin, Mail, MapPin, MoreHorizontal, Power, Target, Trash2, Users,
} from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { JobPostingListItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { JobAiKind } from './JobAiDialog';

export type JobTab = 'applicants' | 'database' | 'details';
export type MatchScope = 'all' | 'applicants' | 'database';

export function formatPostedOn(dateString?: string) {
  if (!dateString || dateString === 'Unknown') return '-';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What can be done with a job, from its row or from inside its workspace. */
export interface JobHandlers {
  onOpen: (job: JobPostingListItem, tab?: JobTab, edit?: boolean) => void;
  onMatch: (job: JobPostingListItem, scope: MatchScope) => void;
  onAi: (job: JobPostingListItem, kind: JobAiKind) => void;
  onToggleStatus: (job: JobPostingListItem) => void;
  onDelete: (job: JobPostingListItem) => void;
  /** Copies text and tells the person what was copied */
  onCopy: (text: string, what: string) => void;
}

/** The column layout shared by the list header and every row (from the lg breakpoint; below it a row stacks). */
export const JOB_GRID = 'lg:grid lg:grid-cols-[minmax(0,1fr)_168px_104px_84px_236px] lg:items-center lg:gap-4';

export function JobListHeader() {
  return (
    <div className={cn('hidden border-b border-surface-border bg-slate-50 px-4 py-2.5 text-xs font-medium text-slate-500', JOB_GRID)}>
      <span>Job</span>
      <span>Posted by</span>
      <span>Applicants</span>
      <span>Status</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

/** One job in the list: what it is, who posted it, how many applied, and the actions used most. Clicking the row opens the job. */
export default function JobRow({ job, currentUser, handlers }: { job: JobPostingListItem; currentUser?: string; handlers: JobHandlers }) {
  const applicants = job.application_count ?? 0;
  const poster = job.posted_by_user || '-';
  const mine = poster !== '-' && poster === currentUser;
  const publicUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/careers/jobs/${job.public_token}`;

  return (
    <div
      role="row"
      onClick={() => handlers.onOpen(job)}
      className={cn(
        'group cursor-pointer border-b border-surface-border/70 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-slate-50/80',
        'flex flex-col gap-3',
        JOB_GRID,
      )}
    >
      {/* job */}
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handlers.onOpen(job); }}
          className="block max-w-full truncate text-left text-[14.5px] font-semibold tracking-[-0.01em] text-slate-900 hover:text-navy-700 focus-visible:underline focus-visible:outline-none"
          title={job.job_title}
        >
          {job.job_title || 'Untitled role'}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{job.job_location || 'No location'}</span>
          </span>
          {job.email_subject_id && (
            <button
              type="button"
              title="Copy the e-mail subject line candidates use to apply by e-mail"
              onClick={(e) => { e.stopPropagation(); handlers.onCopy(job.email_subject_template || job.email_subject_id || '', 'E-mail subject'); }}
              className="inline-flex items-center gap-1 rounded-md border border-surface-border bg-white px-1.5 py-0.5 font-mono text-[11.5px] text-slate-600 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800"
            >
              <Mail className="h-3 w-3" />
              {job.email_subject_id}
            </button>
          )}
        </div>
      </div>

      {/* posted by */}
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] leading-tight">
        <Avatar name={poster} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{poster}{mine && <span className="font-normal text-slate-400"> (you)</span>}</p>
          <p className="mt-0.5 text-slate-500">{formatPostedOn(job.upload_date)}</p>
        </div>
      </div>

      {/* applicants */}
      <div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handlers.onOpen(job, 'applicants'); }}
          title="Open the applicants"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold tabular-nums transition-colors hover:bg-navy-50 hover:text-navy-800',
            applicants > 0 ? 'text-slate-900' : 'text-slate-400',
          )}
        >
          <Users className="h-4 w-4" />
          {applicants.toLocaleString()}
          <span className="font-normal text-slate-500 lg:hidden">applicant{applicants === 1 ? '' : 's'}</span>
        </button>
      </div>

      {/* status */}
      <div>
        <span className={cn('chip', job.is_active ? 'chip-success' : 'chip-neutral')}>{job.is_active ? 'Live' : 'Inactive'}</span>
      </div>

      {/* actions */}
      <div className="flex items-center gap-1.5 lg:justify-end" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="soft"
          size="sm"
          icon={<Target className="h-3.5 w-3.5" />}
          title="Score the applicants and the database candidates that fit this job's search, best first"
          onClick={() => handlers.onMatch(job, 'all')}
        >
          Match
        </Button>
        <IconButton label="Write a LinkedIn post" icon={<Linkedin />} onClick={() => handlers.onAi(job, 'linkedin')} />
        <IconButton label="Interview questions" icon={<ClipboardList />} onClick={() => handlers.onAi(job, 'interview')} />
        <Menu
          trigger={({ ref, ...props }) => <IconButton ref={ref} label="More actions" icon={<MoreHorizontal />} {...props} />}
          items={[
            { label: 'Open job', icon: <Eye />, onSelect: () => handlers.onOpen(job) },
            { label: 'Database matches', hint: 'People you already have who fit this job', icon: <Database />, onSelect: () => handlers.onOpen(job, 'database') },
            job.can_edit && { label: 'Edit job', icon: <Edit3 />, onSelect: () => handlers.onOpen(job, 'details', true) },
            { label: 'Open public page', icon: <ExternalLink />, separated: true, onSelect: () => window.open(`/careers/jobs/${job.public_token}`, '_blank', 'noopener') },
            { label: 'Copy application link', icon: <Copy />, onSelect: () => handlers.onCopy(publicUrl, 'Application link') },
            !!job.boolean_search_string && { label: 'Copy boolean string', hint: 'For Naukri Gulf or LinkedIn search', icon: <Code2 />, onSelect: () => handlers.onCopy(job.boolean_search_string || '', 'Boolean string') },
            job.can_edit && { label: job.is_active ? 'Deactivate' : 'Activate', hint: job.is_active ? 'Stop taking applications' : 'Take applications again', icon: <Power />, separated: true, onSelect: () => handlers.onToggleStatus(job) },
            job.can_delete && { label: 'Delete job', icon: <Trash2 />, danger: true, separated: !job.can_edit, onSelect: () => handlers.onDelete(job) },
          ]}
        />
      </div>
    </div>
  );
}
