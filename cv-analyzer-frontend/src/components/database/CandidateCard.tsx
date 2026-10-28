'use client';

import React, { useState } from 'react';
import {
  Briefcase,
  Eye,
  FileText as FileTextIcon,
  MapPin,
  Trash2,
  Trophy,
  Tags,
} from 'lucide-react';
import ContactActions from '@/components/common/ContactActions';
import { CVListItem } from '@/lib/types';

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
  if (pct >= 80) return 'bg-green-50 text-green-700 border-green-200';
  if (pct >= 60) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 truncate text-[12px] text-slate-800" title={typeof value === 'string' ? value : undefined}>
        {value || <span className="text-slate-400">—</span>}
      </dd>
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
 * Dummy avatar only; contact masked by default; skills + expandable keywords.
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
  const hasSalary = d.expectedSalary && d.expectedSalary !== '—';
  const skills = (d.skills?.length ? d.skills : d.skillKeywords).filter(Boolean).slice(0, 20);
  const keywords = (d.skillKeywords || []).filter(Boolean);
  const languagesText = d.languages.length ? d.languages.join(', ') : null;
  const skillsPreviewLimit = 5;
  const visibleSkills = showAllSkills ? skills : skills.slice(0, skillsPreviewLimit);
  const hiddenSkillsCount = Math.max(0, skills.length - skillsPreviewLimit);

  return (
    <article
      className={`relative flex gap-3 rounded-xl border bg-white p-4 shadow-[var(--shadow-sm)] transition-all duration-[var(--duration-fast)] ${
        selected ? 'border-brand-400 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300 hover:shadow-[var(--shadow-md)]'
      }`}
    >
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 cursor-pointer accent-brand-600"
          aria-label={selected ? 'Deselect' : 'Select'}
        />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
          {index}
        </span>
      </div>

      <img
        src={`https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(d.name || 'candidate')}&backgroundType=gradientLinear`}
        alt=""
        className="mt-0.5 h-14 w-14 shrink-0 rounded-full border border-slate-200 bg-slate-100 object-cover"
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={onOpenDetails}
            className="truncate text-left text-[15px] font-semibold text-brand-700 hover:text-brand-600"
            title={d.name}
          >
            {d.name}
          </button>
          <span className="truncate text-[13px] text-slate-700">
            — {d.title}
            {d.years !== '—' && d.years !== '' ? (
              <span className="text-slate-500"> ({d.years} yrs.)</span>
            ) : null}
          </span>
          {d.isTopForJob && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white"
              title={d.appliedJob ? `#1 candidate for ${d.appliedJob}` : '#1 candidate'}
            >
              <Trophy className="h-3 w-3" /> #1{d.appliedJob ? ` for ${d.appliedJob}` : ''}
            </span>
          )}
          {d.matchScore != null ? (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-semibold ${scoreToneClasses(d.matchScore)}`}>
              {Math.round(d.matchScore * 100)}% match
            </span>
          ) : null}
        </div>

        {d.category && d.category !== 'General' ? (
          <p className="mt-0.5 text-[12px] text-slate-500">{d.category}</p>
        ) : null}

        {(d.email || d.phone) && (
          <ContactActions email={d.email} phone={d.phone} privacy className="mt-1.5" />
        )}

        <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <MetaCell
            label="Applied for"
            value={d.appliedJob || (d.isApplication ? null : 'Direct upload')}
          />
          <MetaCell
            label="Location"
            value={
              d.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-slate-400" />
                  {d.location}
                </span>
              ) : null
            }
          />
          <MetaCell
            label="Expected salary"
            value={hasSalary ? <span className="font-medium text-green-700">{d.expectedSalary}</span> : null}
          />
          <MetaCell label="Nationality" value={d.nationality} />
          <MetaCell label="Gender" value={d.gender} />
          <MetaCell label="Languages" value={languagesText} />
          <MetaCell
            label="Experience"
            value={
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3 w-3 text-slate-400" />
                {d.years !== '—' ? `${d.years} years` : null}
              </span>
            }
          />
        </dl>

        {matchedKeywords.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Matched:</span>
            {matchedKeywords.map((k, i) => (
              <span key={i} className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                {k}
              </span>
            ))}
          </div>
        )}

        {skills.length > 0 && (
          <div className="mt-2.5">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Skills ({skills.length})
            </p>
            <p className="text-[12px] leading-relaxed text-slate-700">
              {visibleSkills.join(', ')}
              {hiddenSkillsCount > 0 && !showAllSkills ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setShowAllSkills(true)}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    show all (+{hiddenSkillsCount})
                  </button>
                </>
              ) : null}
              {showAllSkills && skills.length > skillsPreviewLimit ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setShowAllSkills(false)}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    show less
                  </button>
                </>
              ) : null}
            </p>
          </div>
        )}

        {keywords.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowKeywords((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-[12px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
            >
              <Tags className="h-3.5 w-3.5" />
              {showKeywords ? 'Hide keyword skills' : `Keyword skills (${keywords.length})`}
            </button>
            {showKeywords && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-brand-800">
                {keywords.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <button
          type="button"
          onClick={onPreview}
          title="View raw document"
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <FileTextIcon className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onOpenDetails}
          title="View details & analysis"
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <Eye className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
