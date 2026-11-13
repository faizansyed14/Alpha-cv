'use client';

import React, { useState } from 'react';
import {
  Briefcase,
  Check,
  Eye,
  FileText as FileTextIcon,
  Megaphone,
  Tags,
  Target,
  Trash2,
} from '@/components/icons';
import { Avatar } from '@/components/ui/avatar';

export type JobCardDisplay = {
  title: string;
  filename: string;
  years: string | number;
  skillsCount: number;
  skills: string[];
  skillKeywords: string[];
  responsibilitiesCount: number;
  uploadDate: string;
};

interface JobCardProps {
  display: JobCardDisplay;
  index: number;
  selected: boolean;
  showLinkedIn?: boolean;
  onSelect: () => void;
  onOpenDetails: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onLinkedIn?: () => void;
}

/**
 * Job description card — same layout language as CandidateCard:
 * hero wash, avatar, keyword chips, expandable full skills, action rail.
 */
export default function JobCard({
  display: d,
  index,
  selected,
  showLinkedIn,
  onSelect,
  onOpenDetails,
  onPreview,
  onDelete,
  onLinkedIn,
}: JobCardProps) {
  const [showSkills, setShowSkills] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);

  const keywords = (d.skillKeywords || []).filter(Boolean);
  const skills = (d.skills || []).filter(Boolean);
  const keywordPreviewLimit = 6;
  const visibleKeywords = showAllKeywords ? keywords : keywords.slice(0, keywordPreviewLimit);
  const hiddenKeywordsCount = Math.max(0, keywords.length - keywordPreviewLimit);
  const years = d.years !== '-' && d.years !== '' && d.years != null ? d.years : null;

  return (
    <article
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, input, label, textarea')) return;
        onOpenDetails();
      }}
      className={`group relative overflow-hidden rounded-2xl border bg-paper transition-[border-color,box-shadow] duration-150 ${
        selected
          ? 'border-navy-300 shadow-[0_0_0_3px_rgba(22,32,75,0.12)]'
          : 'border-surface-border shadow-card hover:border-navy-300 hover:shadow-[0_6px_16px_-6px_rgba(16,24,40,0.10)]'
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-navy-50 via-sky-50/60 to-paper"
      />

      <div className="relative flex cursor-pointer gap-3.5 p-5">
        <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
          <input
            type="radio"
            checked={selected}
            onChange={onSelect}
            className="h-4 w-4 cursor-pointer accent-navy-600"
            aria-label={selected ? 'Deselect job' : 'Select job for match'}
          />
          <span className="text-2xs font-medium tabular-nums text-slate-400">{index}</span>
        </div>

        <Avatar name={d.title} size="lg" className="mt-0.5 ring-4 ring-paper shadow-md" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={onOpenDetails}
              className="max-w-full truncate text-left text-md font-semibold tracking-[-0.01em] text-slate-900 hover:text-navy-600"
              title={d.title}
            >
              {d.title}
            </button>
            {selected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-solid-soft px-2 py-0.5 text-2xs font-semibold text-white">
                <Check className="h-3 w-3" /> Selected for match
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 truncate text-sm text-slate-500">
            {d.filename || 'No filename'}
            {years != null ? <span className="text-slate-400"> · {years} yrs experience</span> : null}
            <span className="text-slate-400"> · Uploaded {d.uploadDate}</span>
          </p>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-4 w-4 text-slate-400" />
              {d.skillsCount || skills.length} skills
            </span>
            {d.responsibilitiesCount > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Tags className="h-4 w-4 text-slate-400" />
                {d.responsibilitiesCount} responsibilities
              </span>
            ) : null}
          </div>

          {(keywords.length > 0 || skills.length > 0) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {visibleKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="max-w-[220px] truncate rounded-full border border-surface-border bg-paper px-2.5 py-0.5 text-2xs font-medium text-slate-700 shadow-sm"
                  title={kw}
                >
                  {kw}
                </span>
              ))}
              {hiddenKeywordsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllKeywords((v) => !v)}
                  className="rounded-md px-1.5 py-0.5 text-2xs font-semibold text-navy-600 hover:bg-navy-50"
                >
                  {showAllKeywords ? 'Show less' : `+${hiddenKeywordsCount} more`}
                </button>
              )}
              {skills.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSkills((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold text-navy-600 hover:bg-navy-50"
                >
                  <Tags className="h-3 w-3" />
                  {showSkills ? 'Hide skills' : `Skills (${skills.length})`}
                </button>
              )}
            </div>
          )}

          {showSkills && skills.length > 0 && (
            <ol className="mt-2 space-y-1.5 rounded-lg bg-navy-50/60 px-3 py-2.5 text-xs leading-relaxed text-navy-900">
              {skills.map((sk, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-5 shrink-0 tabular-nums font-semibold text-navy-500">{i + 1}.</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words">{sk}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onSelect}
            title={selected ? 'Deselect' : 'Use for match'}
            className={`rounded-lg p-2 ${selected ? 'bg-navy-50 text-navy-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
          >
            <Target className={`h-4 w-4 ${selected ? 'text-navy-700' : 'text-violet-600'}`} />
          </button>
          <button
            type="button"
            onClick={onOpenDetails}
            title="View details"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <Eye className="h-4 w-4 text-navy-800" />
          </button>
          <button
            type="button"
            onClick={onPreview}
            title="View document"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <FileTextIcon className="h-4 w-4 text-indigo-600" />
          </button>
          {showLinkedIn && onLinkedIn ? (
            <button
              type="button"
              onClick={onLinkedIn}
              title="LinkedIn post"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <Megaphone className="h-4 w-4 text-amber-600" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4 text-rose-500" />
          </button>
        </div>
      </div>
    </article>
  );
}
