'use client';

import React from 'react';
import {
  Code2, Copy, Database, Edit3, ExternalLink, Eye, Mail, MapPin, MoreHorizontal, Power, Target, Trash2, Users,
  ImageIcon,
} from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { Bone } from '@/components/skeletons';
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
  /** Open the "We are hiring" picture of the job */
  onImage: (job: JobPostingListItem) => void;
  onToggleStatus: (job: JobPostingListItem) => void;
  onDelete: (job: JobPostingListItem) => void;
  /** Copies text and tells the person what was copied */
  onCopy: (text: string, what: string) => void;
}

/** Shared column layout for header + rows. */
export const JOB_GRID = 'lg:grid lg:grid-cols-[minmax(0,1fr)_148px_88px_72px_168px] lg:items-center lg:gap-3';

export function JobListHeader() {
  return (
    <div className={cn('hidden border-b border-surface-border bg-slate-50/95 px-3 text-2xs font-semibold uppercase tracking-[0.04em] text-slate-500 backdrop-blur', JOB_GRID)} style={{ height: 'var(--row-h-compact)' }}>
      <span className="flex items-center">Job</span>
      <span className="flex items-center">Posted by</span>
      <span className="flex items-center">Applicants</span>
      <span className="flex items-center">Status</span>
      <span className="flex items-center justify-end">Actions</span>
    </div>
  );
}

/** A job row that is still loading: the same grid, height and cell shapes as a real row. */
export function JobRowSkeleton() {
  return (
    <div role="row" aria-hidden className={cn('border-b border-surface-border/70 px-3 last:border-b-0', 'flex flex-col gap-2 py-2.5 lg:py-0', JOB_GRID)} style={{ minHeight: 'var(--row-h)' }}>
      <div className="min-w-0 lg:py-2">
        <Bone className="h-4 w-2/3 max-w-[320px]" />
        <Bone className="mt-1.5 h-3 w-1/3 max-w-[170px]" />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Bone className="h-7 w-7 shrink-0 rounded-full" />
        <div className="space-y-1.5"><Bone className="h-3 w-16" /><Bone className="h-2.5 w-12" /></div>
      </div>
      <div className="flex items-center"><Bone className="h-5 w-10" /></div>
      <div className="flex items-center"><Bone className="h-5 w-10 rounded-full" /></div>
      <div className="flex items-center gap-1 lg:justify-end">
        <Bone className="h-7 w-[68px] rounded-lg" /><Bone className="h-7 w-7 rounded-lg" /><Bone className="h-7 w-7 rounded-lg" /><Bone className="h-7 w-7 rounded-lg" />
      </div>
    </div>
  );
}

/** Dense job row: overview layer. Click opens workspace sheet. */
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
        'group cursor-pointer border-b border-surface-border/70 px-3 transition-colors last:border-b-0 hover:bg-navy-50/40',
        'flex flex-col gap-2 py-2.5 lg:py-0',
        JOB_GRID,
      )}
      style={{ minHeight: 'var(--row-h)' }}
    >
      <div className="min-w-0 lg:py-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handlers.onOpen(job); }}
          className="block max-w-full truncate text-left text-sm font-semibold tracking-[-0.015em] text-slate-900 hover:text-navy-700 focus-visible:underline focus-visible:outline-none"
          title={job.job_title}
        >
          {job.job_title || 'Untitled role'}
        </button>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-slate-500">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{job.job_location || 'No location'}</span>
          </span>
          {job.email_subject_id && (
            <button
              type="button"
              title="Copy email subject"
              onClick={(e) => { e.stopPropagation(); handlers.onCopy(job.email_subject_template || job.email_subject_id || '', 'E-mail subject'); }}
              className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border border-slate-200 bg-paper px-1 py-0.5 font-mono text-[10.5px] text-slate-600 hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800"
            >
              <Mail className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{job.email_subject_id}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 text-xs leading-tight">
        <Avatar name={poster} size="sm" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{poster}{mine && <span className="font-normal text-slate-400"> · you</span>}</p>
          <p className="truncate text-2xs text-slate-500">{formatPostedOn(job.upload_date)}</p>
        </div>
      </div>

      <div className="flex items-center">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handlers.onOpen(job, 'applicants'); }}
          title="Open applicants"
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold tabular-nums transition-colors hover:bg-navy-50 hover:text-navy-800',
            applicants > 0 ? 'text-slate-900' : 'text-slate-400',
          )}
        >
          <Users className="h-3.5 w-3.5" />
          {applicants.toLocaleString()}
        </button>
      </div>

      <div className="flex items-center">
        <span className={cn('chip', job.is_active ? 'chip-success' : 'chip-neutral')}>{job.is_active ? 'Live' : 'Off'}</span>
      </div>

      <div className="flex items-center gap-1 lg:justify-end" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="soft"
          size="sm"
          className="!h-7 gap-1 px-2 text-[11.5px] [&_svg]:!size-3.5"
          icon={<Target />}
          title="Match applicants and database candidates"
          onClick={() => handlers.onMatch(job, 'all')}
        >
          Match
        </Button>
        <IconButton
          size="sm"
          label="LinkedIn post"
          icon={<img src="/icons/linkedin.svg" alt="" className="h-3.5 w-3.5 object-contain" draggable={false} />}
          onClick={() => handlers.onAi(job, 'linkedin')}
        />
        <IconButton
          size="sm"
          label="Interview questions"
          icon={<img src="/icons/interview.jpg" alt="" className="h-3.5 w-3.5 rounded-[3px] object-cover" draggable={false} />}
          onClick={() => handlers.onAi(job, 'interview')}
        />
        <Menu
          trigger={({ ref, ...props }) => <IconButton ref={ref} size="sm" label="More actions" icon={<MoreHorizontal />} {...props} />}
          items={[
            { label: 'Open job', icon: <Eye />, onSelect: () => handlers.onOpen(job) },
            { label: 'Database matches', hint: 'People you already have who fit', icon: <Database />, onSelect: () => handlers.onOpen(job, 'database') },
            { label: 'Hiring image', hint: 'A ready-to-post picture', icon: <ImageIcon />, onSelect: () => handlers.onImage(job) },
            job.can_edit && { label: 'Edit job', icon: <Edit3 />, onSelect: () => handlers.onOpen(job, 'details', true) },
            { label: 'Open public page', icon: <ExternalLink />, separated: true, onSelect: () => window.open(`/careers/jobs/${job.public_token}`, '_blank', 'noopener') },
            { label: 'Copy application link', icon: <Copy />, onSelect: () => handlers.onCopy(publicUrl, 'Application link') },
            !!job.boolean_search_string && { label: 'Copy boolean string', hint: 'Naukri Gulf / LinkedIn', icon: <Code2 />, onSelect: () => handlers.onCopy(job.boolean_search_string || '', 'Boolean string') },
            job.can_edit && { label: job.is_active ? 'Deactivate' : 'Activate', hint: job.is_active ? 'Stop applications' : 'Take applications', icon: <Power />, separated: true, onSelect: () => handlers.onToggleStatus(job) },
            job.can_delete && { label: 'Delete job', icon: <Trash2 />, danger: true, separated: !job.can_edit, onSelect: () => handlers.onDelete(job) },
          ]}
        />
      </div>
    </div>
  );
}
