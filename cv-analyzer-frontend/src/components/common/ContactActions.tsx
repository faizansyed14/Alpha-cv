'use client';
import React from 'react';
import { Mail, Phone, MessageCircle } from 'lucide-react';

interface ContactActionsProps {
  email?: string | null;
  phone?: string | null;
  /** "chips" shows label text next to icons; "icons" shows compact icon buttons only */
  variant?: 'chips' | 'icons';
  className?: string;
}

/** Normalize a phone number to digits for a wa.me / tel link (keeps leading country code). */
function digits(phone?: string | null): string {
  return (phone || '').replace(/[^\d]/g, '');
}

/**
 * Recruiter contact actions for a candidate: email, call, and WhatsApp.
 * Renders nothing when no contact details are available.
 */
export default function ContactActions({ email, phone, variant = 'chips', className = '' }: ContactActionsProps) {
  const hasEmail = !!(email && email.trim());
  const phoneDigits = digits(phone);
  const hasPhone = phoneDigits.length >= 6;

  if (!hasEmail && !hasPhone) return null;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (variant === 'icons') {
    return (
      <div className={`flex items-center gap-1 ${className}`} onClick={stop}>
        {hasEmail && (
          <a
            href={`mailto:${email}`}
            title={`Email ${email}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        )}
        {hasPhone && (
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
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} onClick={stop}>
      {hasEmail && (
        <a
          href={`mailto:${email}`}
          title={`Email ${email}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
        >
          <Mail className="h-3.5 w-3.5" />
          <span className="max-w-[180px] truncate">{email}</span>
        </a>
      )}
      {hasPhone && (
        <>
          <a
            href={`tel:${phone}`}
            title={`Call ${phone}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 transition-colors hover:border-brand-300 hover:text-brand-600"
          >
            <Phone className="h-3.5 w-3.5" />
            <span>{phone}</span>
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
      )}
    </div>
  );
}
