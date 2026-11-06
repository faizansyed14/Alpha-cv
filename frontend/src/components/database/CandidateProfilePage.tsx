'use client';

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Award,
  Briefcase,
  FileText,
  Github,
  Globe,
  Languages,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Tags,
  UserRound,
  Wallet,
} from '@/components/icons';
import { api } from '@/lib/api';
import { profileHandle, safeProfileUrl } from '@/lib/profileLinks';
import type { CVDataResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { CvDocumentViewer } from '@/components/database/CvDocumentViewer';

function pickList(...candidates: unknown[]): string[] {
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) return c.filter(Boolean).map(String);
  }
  return [];
}

function phoneDigits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

function FactTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  accent?: string;
}) {
  if (value == null || value === '' || value === '-') return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-card">
      <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', accent || 'bg-navy-50 text-navy-800')}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-[14px] font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function ContactLink({
  href,
  icon: Icon,
  label,
  value,
  tone,
  external,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'group flex min-w-0 items-center gap-3 rounded-2xl border bg-white px-4 py-3.5 shadow-card transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-14px_rgba(16,24,40,0.22)]',
        tone,
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors group-hover:bg-white">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
        <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-slate-900">{value}</span>
      </span>
    </a>
  );
}

function NumberedList({
  title,
  icon: Icon,
  items,
  limit = 40,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  items: string[];
  limit?: number;
}) {
  const shown = items.slice(0, limit);
  return (
    <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-slate-900">
          {title}
          <span className="ml-2 text-[13px] font-medium text-slate-400">({items.length})</span>
        </h2>
      </div>
      {!shown.length ? (
        <p className="text-[13px] text-slate-400">None extracted.</p>
      ) : (
        <ol className="space-y-2.5">
          {shown.map((item, i) => (
            <li key={i} className="flex gap-3 rounded-xl bg-slate-50/80 px-3 py-2.5 text-[13.5px] leading-relaxed text-slate-700">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-[11px] font-bold tabular-nums text-navy-800 ring-1 ring-inset ring-navy-100">
                {i + 1}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words pt-0.5">{item}</span>
            </li>
          ))}
        </ol>
      )}
      {items.length > limit ? (
        <p className="mt-3 text-[12px] text-slate-400">+{items.length - limit} more not shown</p>
      ) : null}
    </section>
  );
}

/** Full-page candidate profile: contact unmasked, clear action icons, original CV below. */
export default function CandidateProfilePage({ cvId }: { cvId: string }) {
  const router = useRouter();
  const [data, setData] = useState<CVDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getCVDetails(cvId)
      .then((cv) => {
        if (!cancelled) setData(cv);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || e?.detail || 'Failed to load candidate');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cvId]);

  const view = useMemo(() => {
    if (!data) return null;
    const s = data.structured_info || {};
    const c = data.candidate || ({} as CVDataResponse['candidate']);
    const app = (data as any).job_application || {};
    const contact = s.contact_info || c.contact_info || {};
    const email = app.applicant_email || contact.email || s.email || c.email || null;
    const phone = app.applicant_phone || contact.phone || s.phone || c.phone || null;
    const linkedinRaw =
      c.linkedin_url || s.linkedin_url || contact.linkedin || contact.linkedin_url || null;
    const githubRaw = c.github_url || s.github_url || contact.github || contact.github_url || null;
    return {
      name: c.full_name || s.full_name || 'Unknown',
      title: c.job_title || s.job_title || '-',
      years: c.years_of_experience ?? s.years_of_experience ?? '-',
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      linkedin: safeProfileUrl(linkedinRaw, 'linkedin'),
      github: safeProfileUrl(githubRaw, 'github'),
      skills: pickList(c.skills, s.skills_sentences, s.skills),
      keywords: pickList(s.skill_keywords, (data as any).skill_keywords),
      responsibilities: pickList(c.responsibilities, s.responsibility_sentences, s.responsibilities),
      languages: pickList(c.languages, s.languages),
      certifications: pickList(c.certifications, s.certifications),
      location: s.location || s.current_location || app.location || null,
      nationality: s.nationality || app.nationality || null,
      gender: c.gender || s.gender || null,
      salary: app.expected_salary || c.expected_salary || s.expected_salary || null,
      category: s.category || 'General',
      filename: data.filename,
      uploadDate: data.upload_date,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-[13px] text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-navy-700" />
        Loading candidate…
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-surface-border bg-white p-8 text-center shadow-card">
        <p className="text-[15px] font-semibold text-slate-900">Candidate not found</p>
        <p className="mt-1.5 text-[13px] text-slate-500">{error || 'This CV could not be loaded.'}</p>
        <Button type="button" variant="secondary" className="mt-4" onClick={() => router.push('/candidates')}>
          Back to candidates
        </Button>
      </div>
    );
  }

  const wa = phoneDigits(view.phone);
  const hasContact = !!(view.email || view.phone || view.linkedin || view.github);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => router.push('/candidates')}>
          Candidates
        </Button>
        <span className="text-[12px] text-slate-300">/</span>
        <span className="truncate text-[13px] font-medium text-slate-600">{view.name}</span>
      </div>

      {/* Hero — compact */}
      <header className="relative overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-br from-navy-50 via-sky-50/60 to-white" />
        <div className="relative flex items-start gap-3.5 px-4 py-3.5 sm:px-5 sm:py-4">
          <Avatar name={view.name} size="md" className="ring-2 ring-white shadow-sm" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-700">{view.category}</p>
            <h1 className="mt-0.5 text-[18px] font-bold leading-tight tracking-[-0.02em] text-slate-900 sm:text-[20px]">
              {view.name}
            </h1>
            <p className="mt-0.5 text-[13px] text-slate-600">
              {view.title !== '-' ? view.title : 'No title listed'}
            </p>
            {view.filename ? (
              <p className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-slate-400">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{view.filename}</span>
              </p>
            ) : null}
          </div>
        </div>
      </header>

      {/* Contact — always visible, with icons */}
      {hasContact ? (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500">Contact</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {view.email ? (
              <ContactLink
                href={`mailto:${view.email}`}
                icon={Mail}
                label="Email"
                value={view.email}
                tone="border-surface-border hover:border-navy-300"
              />
            ) : null}
            {view.phone ? (
              <ContactLink
                href={`tel:${view.phone}`}
                icon={Phone}
                label="Phone"
                value={view.phone}
                tone="border-surface-border hover:border-emerald-300"
              />
            ) : null}
            {view.phone && wa.length >= 6 ? (
              <ContactLink
                href={`https://wa.me/${wa}`}
                icon={MessageCircle}
                label="WhatsApp"
                value={view.phone}
                tone="border-surface-border hover:border-emerald-400"
                external
              />
            ) : null}
            {view.linkedin ? (
              <ContactLink
                href={view.linkedin}
                icon={Linkedin}
                label="LinkedIn"
                value={profileHandle(view.linkedin) || 'View profile'}
                tone="border-surface-border hover:border-sky-400"
                external
              />
            ) : null}
            {view.github ? (
              <ContactLink
                href={view.github}
                icon={Github}
                label="GitHub"
                value={profileHandle(view.github) || 'View profile'}
                tone="border-surface-border hover:border-slate-400"
                external
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Snapshot facts */}
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500">Profile</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FactTile icon={Briefcase} label="Experience" value={view.years !== '-' ? `${view.years} years` : null} />
          <FactTile icon={Wallet} label="Expected salary" value={view.salary} accent="bg-emerald-50 text-emerald-700" />
          <FactTile icon={MapPin} label="Location" value={view.location} />
          <FactTile icon={Globe} label="Nationality" value={view.nationality} />
          <FactTile icon={Languages} label="Languages" value={view.languages.length ? view.languages.join(', ') : null} />
          <FactTile icon={UserRound} label="Gender" value={view.gender} />
        </div>
      </section>

      {view.certifications.length > 0 ? (
        <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card sm:p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <Award className="h-4 w-4" />
            </span>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-slate-900">
              Certifications
              <span className="ml-2 text-[13px] font-medium text-slate-400">({view.certifications.length})</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {view.certifications.map((c) => (
              <span key={c} className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[12.5px] font-medium text-amber-900">
                {c}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {view.keywords.length > 0 ? (
        <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card sm:p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
              <Tags className="h-4 w-4" />
            </span>
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-slate-900">
              Keywords
              <span className="ml-2 text-[13px] font-medium text-slate-400">({view.keywords.length})</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {view.keywords.map((k) => (
              <span
                key={k}
                className="rounded-full border border-navy-100 bg-navy-50 px-3 py-1 text-[12.5px] font-medium text-navy-900"
              >
                {k}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <NumberedList title="Skills" icon={Tags} items={view.skills} />
      <NumberedList title="Responsibilities" icon={Briefcase} items={view.responsibilities} />

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500">Original CV</h2>
        <CvDocumentViewer cvId={cvId} filename={view.filename} />
      </section>
    </div>
  );
}
