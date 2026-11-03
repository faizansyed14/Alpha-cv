'use client';

import React, { useState } from 'react';
import {
  Briefcase,
  Eye,
  FileText as FileTextIcon,
  Globe,
  Languages,
  MapPin,
  Trash2,
  Trophy,
  Tags,
  UserRound,
  Wallet,
} from '@/components/icons';
import ContactActions from '@/components/common/ContactActions';
import { CVListItem } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';

export type CandidateCardDisplay = {
  name: string;
  title: string;
  years: string | number;
  skillsCount: number;
  category: string;
  filename: string;
  expectedSalary: string | number;
  appliedJob: string | null;
  isApplication: boolean;
  matchScore: number | null;
  isTopForJob: boolean;
  matchRank: number | null;
  skillKeywords: string[];
  skills: string[];
  email: string | null;
  phone: string | null;
  gender: string | null;
  languages: string[];
  location: string | null;
  nationality: string | null;
};

function scoreToneClasses(score: number) {
  const pct = score * 100;
  if (pct >= 80) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (pct >= 60) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-red-50 text-red-700 ring-red-200';
}

/** One fact about the candidate, shown as a quiet labelled chip. */
function Fact({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px]" title={label}>
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="sr-only">{label}: </span>
      <span className="truncate text-slate-700">{children}</span>
    </div>
  );
}

interface CandidateCardProps {
  cv: CVListItem;
  display: CandidateCardDisplay;
  index: number;
  selected: boolean;
  matchedKeywords?: string[];
  onToggleSelect: () => void;
  onOpenDetails: () => void;
  onPreview: () => void;
  onDelete: () => void;
}

/**
 * Production candidate row for the Candidates workspace.
 * Initials avatar; contact masked by default; skills + expandable keywords. Clicking the card toggles selection.
 */
export default function CandidateCard({
  cv,
  display: d,
  index,
  selected,
  matchedKeywords = [],
  onToggleSelect,
  onOpenDetails,
  onPreview,
  onDelete,
}: CandidateCardProps) {
  const [showKeywords, setShowKeywords] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const hasSalary = d.expectedSalary && d.expectedSalary !== '-';
  const skills = (d.skills?.length ? d.skills : d.skillKeywords).filter(Boolean).slice(0, 20);
  const keywords = (d.skillKeywords || []).filter(Boolean);
  const languagesText = d.languages.length ? d.languages.join(', ') : null;
  const skillsPreviewLimit = 5;
  const visibleSkills = showAllSkills ? skills : skills.slice(0, skillsPreviewLimit);
  const hiddenSkillsCount = Math.max(0, skills.length - skillsPreviewLimit);

  const years = d.years !== '-' && d.years !== '' ? d.years : null;
  const facts: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }[] = [];
  if (years != null) facts.push({ icon: Briefcase, label: 'Experience', value: `${years} yrs experience` });
  if (d.location) facts.push({ icon: MapPin, label: 'Location', value: d.location });
  if (d.nationality) facts.push({ icon: Globe, label: 'Nationality', value: d.nationality });
  if (hasSalary) facts.push({ icon: Wallet, label: 'Expected salary', value: <span className="font-semibold text-emerald-700">{d.expectedSalary}</span> });
  if (languagesText) facts.push({ icon: Languages, label: 'Languages', value: languagesText });
  if (d.gender) facts.push({ icon: UserRound, label: 'Gender', value: d.gender });

  return (
    <article
      onClick={(e) => {
        // Clicking the empty part of a card selects it; links, buttons and inputs keep their own behaviour.
        if ((e.target as HTMLElement).closest('button, a, input, label')) return;
        onToggleSelect();
      }}
      className={`group relative flex cursor-pointer gap-3.5 rounded-2xl border bg-white p-5 transition-[border-color,box-shadow,background-color] duration-150 ${
        selected
          ? 'border-navy-300 bg-navy-50/30 shadow-[0_0_0_3px_rgba(38,84,227,0.10)]'
          : 'border-surface-border shadow-card hover:border-navy-200 hover:shadow-[0_6px_16px_-6px_rgba(16,24,40,0.10)]'
      }`}
    >
      <div className="flex shrink-0 flex-col items-center gap-2 pt-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 cursor-pointer rounded accent-navy-600"
          aria-label={selected ? 'Deselect' : 'Select'}
        />
        <span className="text-[11px] font-medium tabular-nums text-slate-400">{index}</span>
      </div>

      <Avatar name={d.name} size="lg" className="mt-0.5" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpenDetails}
            className="max-w-full truncate text-left text-[15px] font-semibold tracking-[-0.01em] text-slate-900 hover:text-navy-600"
            title={d.name}
          >
            {d.name}
          </button>
          {d.isTopForJob && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white"
              title={d.appliedJob ? `#1 candidate for ${d.appliedJob}` : '#1 candidate'}
            >
              <Trophy className="h-3 w-3" /> #1{d.appliedJob ? ` for ${d.appliedJob}` : ''}
            </span>
          )}
          {d.matchScore != null ? (
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${scoreToneClasses(d.matchScore)}`}>
              {Math.round(d.matchScore * 100)}% match
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 truncate text-[13px] text-slate-500">
          {d.title !== '-' ? d.title : 'No title'}
          {d.category && d.category !== 'General' ? <span className="text-slate-400"> · {d.category}</span> : null}
          <span className="text-slate-400"> · {d.appliedJob ? `Applied for ${d.appliedJob}` : d.isApplication ? 'Application' : 'Direct upload'}</span>
        </p>

        {facts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {facts.map((f) => (
              <Fact key={f.label} icon={f.icon} label={f.label}>{f.value}</Fact>
            ))}
          </div>
        )}

        {(d.email || d.phone) && (
          <ContactActions email={d.email} phone={d.phone} privacy className="mt-2.5" />
        )}

        {matchedKeywords.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-500">Matched</span>
            {matchedKeywords.map((k, i) => (
              <span key={i} className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {k}
              </span>
            ))}
          </div>
        )}

        {skills.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {visibleSkills.map((sk, i) => (
              <span key={i} className="max-w-[220px] truncate rounded-full border border-surface-border bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-slate-700 shadow-sm" title={sk}>
                {sk}
              </span>
            ))}
            {hiddenSkillsCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllSkills((v) => !v)}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-navy-600 hover:bg-navy-50"
              >
                {showAllSkills ? 'Show less' : `+${hiddenSkillsCount} more`}
              </button>
            )}
            {keywords.length > 0 && (
              <button
                type="button"
                onClick={() => setShowKeywords((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-navy-600 hover:bg-navy-50"
              >
                <Tags className="h-3 w-3" />
                {showKeywords ? 'Hide keywords' : `Keywords (${keywords.length})`}
              </button>
            )}
          </div>
        )}
        {showKeywords && keywords.length > 0 && (
          <p className="mt-2 rounded-lg bg-navy-50/60 px-3 py-2 text-[12px] leading-relaxed text-navy-900">{keywords.join(', ')}</p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onOpenDetails}
          title="Details and notes"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <Eye className="h-4 w-4 text-blue-600" />
        </button>
        <button
          type="button"
          onClick={onPreview}
          title="View CV"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <FileTextIcon className="h-4 w-4 text-indigo-600" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </button>
      </div>
    </article>
  );
}
