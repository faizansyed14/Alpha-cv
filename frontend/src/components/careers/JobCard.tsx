'use client';
import React, { useState } from 'react';
import { ArrowRight, Calendar, Check, Copy, Mail, Users } from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';
import { JobPostingListItem } from '@/lib/types';
import { cn } from '@/lib/utils';

export function formatPostedOn(dateString?: string) {
  if (!dateString || dateString === 'Unknown') return '-';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One job posting as a card: title, who posted it and when, its unique subject line, how many applied, and a button to open everything else. */
export default function JobCard({
  job,
  currentUser,
  onOpen,
}: {
  job: JobPostingListItem;
  currentUser?: string;
  onOpen: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const applicants = job.application_count ?? 0;
  const poster = job.posted_by_user || '-';

  return (
    <article
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card',
        'transition-all duration-200 hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md',
      )}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3
            className="line-clamp-2 min-h-[2.75rem] text-[16px] font-semibold leading-snug tracking-[-0.01em] text-slate-900"
            title={job.job_title}
          >
            {job.job_title || 'Untitled role'}
          </h3>
          <span
            className={cn(
              'chip shrink-0',
              job.is_active
                ? 'border-navy-200 bg-navy-50 text-navy-800'
                : 'chip-neutral',
            )}
          >
            {job.is_active ? 'Live' : 'Inactive'}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <Avatar name={poster} size="sm" />
          <div className="min-w-0 text-[12.5px] leading-tight">
            <p className="truncate text-slate-800">
              <span className="text-slate-500">Posted by </span>
              <span className="font-medium">{poster}</span>
              {poster !== '-' && poster === currentUser && <span className="text-slate-400"> (you)</span>}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-slate-500">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>on {formatPostedOn(job.upload_date)}</span>
            </p>
          </div>
        </div>

        <div className="mb-5 mt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Unique subject</p>
          {job.email_subject_template ? (
            <button
              type="button"
              title="Click to copy the subject line"
              onClick={() => {
                navigator.clipboard?.writeText(job.email_subject_template || '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-surface-border bg-slate-50/70 px-2.5 py-2 text-left text-[12.5px] font-medium text-slate-700 transition-colors hover:border-navy-300 hover:bg-navy-50/60 hover:text-navy-800"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{job.email_subject_template}</span>
              {copied ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-600" />}
            </button>
          ) : (
            <p className="rounded-lg border border-dashed border-surface-border px-2.5 py-2 text-[12.5px] text-slate-400">No subject line yet</p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-surface-border pt-4">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl',
                applicants > 0 ? 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-100' : 'bg-slate-50 text-slate-400 ring-1 ring-inset ring-slate-100',
              )}
            >
              <Users className="h-[18px] w-[18px]" />
            </span>
            <div className="leading-tight">
              <p className={cn('text-[20px] font-bold tabular-nums', applicants > 0 ? 'text-slate-900' : 'text-slate-400')}>{applicants}</p>
              <p className="text-[11.5px] text-slate-500">applicant{applicants === 1 ? '' : 's'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-navy-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500/40"
          >
            View more
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </article>
  );
}
