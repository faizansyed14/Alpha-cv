'use client';
import React from 'react';
import { Mail, Phone, WhatsApp, Linkedin, Github } from '@/components/icons';
import { profileHandle, safeProfileUrl } from '@/lib/profileLinks';

interface ContactActionsProps {
  email?: string | null;
  phone?: string | null;
  /** Profile links read from the CV. They open in a new tab. */
  linkedin?: string | null;
  github?: string | null;
  /** "chips" shows label text next to icons; "icons" shows compact icon buttons only */
  variant?: 'chips' | 'icons';
  /** @deprecated Masking removed — contacts always shown. */
  privacy?: boolean;
  className?: string;
}

/** Normalize a phone number to digits for a wa.me / tel link (keeps leading country code). */
function digits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

const SITE = {
  linkedin: { name: 'LinkedIn', Icon: Linkedin, hover: 'hover:border-sky-300 hover:text-sky-700' },
  github: { name: 'GitHub', Icon: Github, hover: 'hover:border-slate-400 hover:text-slate-900' },
} as const;

function ProfileIcon({ url, site }: { url: string; site: 'linkedin' | 'github' }) {
  const { name, Icon, hover } = SITE[site];
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${name} profile`}
      aria-label={`Open ${name} profile`}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-paper text-gray-500 transition-colors ${hover}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </a>
  );
}

function ProfileChip({ url, site }: { url: string; site: 'linkedin' | 'github' }) {
  const { name, Icon, hover } = SITE[site];
  const handle = profileHandle(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${name} profile: ${url}`}
      className={`inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-paper px-2 py-1 text-xs text-gray-600 transition-colors ${hover}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[140px] truncate">{handle || name}</span>
    </a>
  );
}

/**
 * Recruiter contact actions: email, call, WhatsApp, LinkedIn, GitHub.
 * Values always shown — no masking / eye toggle.
 */
export default function ContactActions({
  email,
  phone,
  linkedin,
  github,
  variant = 'chips',
  className = '',
}: ContactActionsProps) {
  const hasEmail = !!(email && email.trim());
  const phoneDigits = digits(phone);
  const hasPhone = phoneDigits.length >= 6;

  const linkedinUrl = safeProfileUrl(linkedin, 'linkedin');
  const githubUrl = safeProfileUrl(github, 'github');

  if (!hasEmail && !hasPhone && !linkedinUrl && !githubUrl) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (variant === 'icons') {
    return (
      <div className={`flex items-center gap-1 ${className}`} onClick={stop}>
        {hasEmail && (
          <a
            href={`mailto:${email}`}
            title={`Email ${email}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-paper text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        )}
        {hasPhone && (
          <>
            <a
              href={`tel:${phone}`}
              title={`Call ${phone}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-paper text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`WhatsApp ${phone}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-paper text-gray-500 transition-colors hover:border-success-300 hover:text-success-600"
            >
              <WhatsApp className="h-3.5 w-3.5" />
            </a>
          </>
        )}
        {linkedinUrl && <ProfileIcon url={linkedinUrl} site="linkedin" />}
        {githubUrl && <ProfileIcon url={githubUrl} site="github" />}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} onClick={stop}>
      {hasEmail && (
        <a
          href={`mailto:${email}`}
          title={`Email ${email}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-paper px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <Mail className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[220px] truncate">{email}</span>
        </a>
      )}
      {hasPhone && (
        <>
          <a
            href={`tel:${phone}`}
            title={`Call ${phone}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-paper px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span>{phone}</span>
          </a>
          <a
            href={`https://wa.me/${phoneDigits}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`WhatsApp ${phone}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-paper px-2 py-1 text-xs text-gray-600 transition-colors hover:border-success-300 hover:text-success-600"
          >
            <WhatsApp className="h-3.5 w-3.5" />
            <span>WhatsApp</span>
          </a>
        </>
      )}
      {linkedinUrl && <ProfileChip url={linkedinUrl} site="linkedin" />}
      {githubUrl && <ProfileChip url={githubUrl} site="github" />}
    </div>
  );
}
