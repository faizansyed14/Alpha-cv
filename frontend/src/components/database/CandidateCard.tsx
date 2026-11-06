'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  Briefcase,
  Eye,
  FileText as FileTextIcon,
  Globe,
  Languages,
  MapPin,
  MoreHorizontal,
  Pencil,
  Trash2,
  Trophy,
  Tags,
  UserRound,
  Wallet,
} from '@/components/icons';
import ContactActions from '@/components/common/ContactActions';
import { CVListItem } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

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
  linkedin: string | null;
  github: string | null;
  gender: string | null;
  languages: string[];
  certifications: string[];
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
  noteText?: string | null;
  noteAuthor?: string | null;
  noteSaving?: boolean;
  onToggleSelect: () => void;
  onOpenDetails: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onSaveNote: (text: string) => Promise<void> | void;
  onDeleteNote: () => Promise<void> | void;
}

/**
 * Production candidate row for the Candidates workspace.
 * Initials avatar; contact masked by default; keyword chips + expandable full skills.
 * Card body opens the full candidate page; checkbox only toggles selection.
 * Notes are written inline from the pencil action.
 */
export default function CandidateCard({
  cv,
  display: d,
  index,
  selected,
  matchedKeywords = [],
  noteText = null,
  noteAuthor = null,
  noteSaving = false,
  onToggleSelect,
  onOpenDetails,
  onPreview,
  onDelete,
  onSaveNote,
  onDeleteNote,
}: CandidateCardProps) {
  const [showSkills, setShowSkills] = useState(false);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasSalary = d.expectedSalary && d.expectedSalary !== '-';
  /** Short keyword chips (preview 6). */
  const keywords = (d.skillKeywords || []).filter(Boolean);
  /** Full skill sentences — shown expanded as full text. */
  const skills = (d.skills || []).filter(Boolean);
  const languagesText = d.languages.length ? d.languages.join(', ') : null;
  const keywordPreviewLimit = 6;
  const visibleKeywords = showAllKeywords ? keywords : keywords.slice(0, keywordPreviewLimit);
  const hiddenKeywordsCount = Math.max(0, keywords.length - keywordPreviewLimit);

  const years = d.years !== '-' && d.years !== '' ? d.years : null;
  const facts: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }[] = [];
  if (years != null) facts.push({ icon: Briefcase, label: 'Experience', value: `${years} yrs experience` });
  if (d.location) facts.push({ icon: MapPin, label: 'Location', value: d.location });
  if (d.nationality) facts.push({ icon: Globe, label: 'Nationality', value: d.nationality });
  if (hasSalary) facts.push({ icon: Wallet, label: 'Expected salary', value: <span className="font-semibold text-emerald-700">{d.expectedSalary}</span> });
  if (languagesText) facts.push({ icon: Languages, label: 'Languages', value: languagesText });
  if (d.certifications.length) {
    const shown = d.certifications.slice(0, 3).join('; ');
    const more = d.certifications.length - 3;
    facts.push({ icon: Award, label: 'Certifications', value: <span title={d.certifications.join('\n')}>{shown}{more > 0 ? ` +${more} more` : ''}</span> });
  }
  if (d.gender) facts.push({ icon: UserRound, label: 'Gender', value: d.gender });

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (composing) textareaRef.current?.focus();
  }, [composing]);

  const startAdd = () => {
    setDraft('');
    setComposing(true);
    setMenuOpen(false);
  };

  const startEdit = () => {
    setDraft(noteText || '');
    setComposing(true);
    setMenuOpen(false);
  };

  const cancelCompose = () => {
    setComposing(false);
    setDraft('');
  };

  const saveCompose = async () => {
    const text = draft.trim();
    if (!text || noteSaving) return;
    await onSaveNote(text);
    setComposing(false);
    setDraft('');
  };

  const removeNote = async () => {
    setMenuOpen(false);
    if (!window.confirm('Delete this note?')) return;
    await onDeleteNote();
    setComposing(false);
    setDraft('');
  };

  return (
    <article
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, input, label, textarea')) return;
        onOpenDetails();
      }}
      className={`group relative overflow-hidden rounded-2xl border bg-white transition-[border-color,box-shadow] duration-150 ${
        selected
          ? 'border-navy-300 shadow-[0_0_0_3px_rgba(22,32,75,0.12)]'
          : 'border-surface-border shadow-card hover:border-navy-300 hover:shadow-[0_6px_16px_-6px_rgba(16,24,40,0.10)]'
      }`}
    >
      {/* Same soft navy wash as the candidate profile hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-navy-50 via-sky-50/60 to-white"
      />

      <div className="relative flex cursor-pointer gap-3.5 p-5">
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

      <Avatar name={d.name} size="lg" className="mt-0.5 ring-4 ring-white shadow-md" />

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

        {(d.email || d.phone || d.linkedin || d.github) && (
          <ContactActions email={d.email} phone={d.phone} linkedin={d.linkedin} github={d.github} privacy className="mt-2.5" />
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

        {(keywords.length > 0 || skills.length > 0) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {visibleKeywords.map((kw, i) => (
              <span key={i} className="max-w-[220px] truncate rounded-full border border-surface-border bg-white px-2.5 py-0.5 text-[11.5px] font-medium text-slate-700 shadow-sm" title={kw}>
                {kw}
              </span>
            ))}
            {hiddenKeywordsCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllKeywords((v) => !v)}
                className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-navy-600 hover:bg-navy-50"
              >
                {showAllKeywords ? 'Show less' : `+${hiddenKeywordsCount} more`}
              </button>
            )}
            {skills.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSkills((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-navy-600 hover:bg-navy-50"
              >
                <Tags className="h-3 w-3" />
                {showSkills ? 'Hide skills' : `Skills (${skills.length})`}
              </button>
            )}
          </div>
        )}
        {showSkills && skills.length > 0 && (
          <ol className="mt-2 space-y-1.5 rounded-lg bg-navy-50/60 px-3 py-2.5 text-[12px] leading-relaxed text-navy-900">
            {skills.map((sk, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-5 shrink-0 tabular-nums font-semibold text-navy-500">{i + 1}.</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{sk}</span>
              </li>
            ))}
          </ol>
        )}

        {/* Inline note */}
        {composing ? (
          <div className="mt-3 rounded-lg border border-navy-200 bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder="Write a note…"
              className="field-input w-full resize-y text-[13px]"
              disabled={noteSaving}
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={cancelCompose} disabled={noteSaving}>
                Cancel
              </Button>
              <Button type="button" size="sm" variant="primary" onClick={saveCompose} loading={noteSaving} disabled={!draft.trim()}>
                Save note
              </Button>
            </div>
          </div>
        ) : noteText ? (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Note{noteAuthor ? ` · ${noteAuthor}` : ''}
              </p>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-md p-1 text-slate-500 hover:bg-amber-100 hover:text-navy-700"
                  title="Edit note"
                  aria-label="Edit note"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={removeNote}
                  className="rounded-md p-1 text-slate-500 hover:bg-red-50 hover:text-red-600"
                  title="Delete note"
                  aria-label="Delete note"
                  disabled={noteSaving}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    className="rounded-md p-1 text-slate-500 hover:bg-amber-100 hover:text-slate-800"
                    title="More"
                    aria-label="More note actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-surface-border bg-white py-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50"
                        onClick={startEdit}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
                        onClick={removeNote}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{noteText}</p>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onOpenDetails}
          title="Open candidate page"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <Eye className="h-4 w-4 text-navy-800" />
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
          title="Delete candidate"
          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4 text-rose-500" />
        </button>
        <button
          type="button"
          onClick={() => (noteText ? startEdit() : startAdd())}
          title={noteText ? 'Edit note' : 'Add note'}
          className={`rounded-lg p-2 hover:bg-navy-50 ${noteText ? 'text-navy-700' : 'text-slate-500 hover:text-navy-700'}`}
        >
          <Pencil className={`h-4 w-4 ${noteText ? 'text-navy-600' : 'text-slate-500'}`} />
        </button>
      </div>
      </div>
    </article>
  );
}
