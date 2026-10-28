'use client';
import React, { useState } from 'react';
import { Mail, Phone, MessageCircle, Eye, EyeOff } from 'lucide-react';

interface ContactActionsProps {
  email?: string | null;
  phone?: string | null;
  /** "chips" shows label text next to icons; "icons" shows compact icon buttons only */
  variant?: 'chips' | 'icons';
  /**
   * When true, email/phone are masked by default and an eye toggle reveals them.
   * Action links (mailto / tel / WhatsApp) only work while revealed.
   */
  privacy?: boolean;
  className?: string;
}

/** Normalize a phone number to digits for a wa.me / tel link (keeps leading country code). */
function digits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '••••••';
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = Math.min(2, user.length);
  return `${user.slice(0, keep)}${'•'.repeat(Math.max(4, user.length - keep))}@${domain}`;
}

function maskPhone(phone: string): string {
  const d = digits(phone);
  if (d.length <= 4) return '••••••••';
  return `${'•'.repeat(Math.max(4, d.length - 4))}${d.slice(-4)}`;
}

/**
 * Recruiter contact actions for a candidate: email, call, and WhatsApp.
 * Renders nothing when no contact details are available.
 */
export default function ContactActions({
  email,
  phone,
  variant = 'chips',
  privacy = false,
  className = '',
}: ContactActionsProps) {
  const [revealed, setRevealed] = useState(!privacy);
  const hasEmail = !!(email && email.trim());
  const phoneDigits = digits(phone);
  const hasPhone = phoneDigits.length >= 6;

  if (!hasEmail && !hasPhone) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const showPlain = !privacy || revealed;

  const displayEmail = hasEmail ? (showPlain ? email! : maskEmail(email!)) : null;
  const displayPhone = hasPhone ? (showPlain ? phone! : maskPhone(phone!)) : null;

  const revealBtn = privacy ? (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        setRevealed((v) => !v);
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
      title={revealed ? 'Hide contact details' : 'Reveal contact details'}
      aria-label={revealed ? 'Hide contact details' : 'Reveal contact details'}
      aria-pressed={revealed}
    >
      {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  ) : null;

  if (variant === 'icons') {
    return (
      <div className={`flex items-center gap-1 ${className}`} onClick={stop}>
        {hasEmail &&
          (showPlain ? (
            <a
              href={`mailto:${email}`}
              title={`Email ${email}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400"
              title="Reveal to email"
            >
              <Mail className="h-3.5 w-3.5" />
            </span>
          ))}
        {hasPhone &&
          (showPlain ? (
            <>
              <a
                href={`tel:${phone}`}
                title={`Call ${phone}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
              >
                <Phone className="h-3.5 w-3.5" />
              </a>
              <a
                href={`https://wa.me/${phoneDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`WhatsApp ${phone}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-success-300 hover:text-success-600"
              >
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            </>
          ) : (
            <>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400" title="Reveal to call">
                <Phone className="h-3.5 w-3.5" />
              </span>
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-400" title="Reveal for WhatsApp">
                <MessageCircle className="h-3.5 w-3.5" />
              </span>
            </>
          ))}
        {revealBtn}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} onClick={stop}>
      {hasEmail &&
        (showPlain ? (
          <a
            href={`mailto:${email}`}
            title={`Email ${email}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[180px] truncate">{displayEmail}</span>
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-slate-50 px-2 py-1 text-xs text-gray-500">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[180px] truncate font-mono tracking-wide">{displayEmail}</span>
          </span>
        ))}
      {hasPhone &&
        (showPlain ? (
          <>
            <a
              href={`tel:${phone}`}
              title={`Call ${phone}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>{displayPhone}</span>
            </a>
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`WhatsApp ${phone}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-success-300 hover:text-success-600"
            >
              <MessageCircle className="h-3.5 w-3.5 text-success-600" />
              <span>WhatsApp</span>
            </a>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-slate-50 px-2 py-1 text-xs text-gray-500">
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono tracking-wide">{displayPhone}</span>
          </span>
        ))}
      {revealBtn}
    </div>
  );
}
