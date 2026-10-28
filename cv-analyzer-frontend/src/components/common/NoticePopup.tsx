'use client';

import { useEffect, useState } from 'react';
import { X, Megaphone } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { NoticeData } from '@/lib/types';

const DISMISS_PREFIX = 'notice_dismissed_';

/**
 * Shows an admin-published notice to non-admin users.
 * - Fetches the active notice when an authenticated non-admin user is present.
 * - Dismissed (X) per browser session, keyed by notice id, so it doesn't re-open on
 *   every navigation but DOES re-open on a fresh login (logout clears the keys) or
 *   when the admin publishes a new/updated notice (new id).
 */
export default function NoticePopup() {
  const { user } = useAuthStore();
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Admins manage the notice; they never see the popup.
    if (!user || (user.role as string) === 'admin') {
      setNotice(null);
      setOpen(false);
      return;
    }
    let cancelled = false;
    api.getNotice()
      .then((res) => {
        if (cancelled) return;
        const n = res?.notice ?? null;
        if (!n || !n.active) {
          setNotice(null);
          setOpen(false);
          return;
        }
        setNotice(n);
        let dismissed = false;
        try {
          dismissed = sessionStorage.getItem(DISMISS_PREFIX + n.id) === '1';
        } catch {
          dismissed = false;
        }
        setOpen(!dismissed);
      })
      .catch(() => {
        if (!cancelled) {
          setNotice(null);
          setOpen(false);
        }
      });
    return () => { cancelled = true; };
  }, [user?.username, user?.role]);

  const dismiss = () => {
    if (notice) {
      try {
        sessionStorage.setItem(DISMISS_PREFIX + notice.id, '1');
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  };

  if (!open || !notice) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-950/50" aria-hidden onClick={dismiss} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Notice"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-brand-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-800 text-paper">
              <Megaphone className="h-4 w-4" />
            </span>
            <h2 className="text-[15px] font-semibold text-gray-900">Notice</h2>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
            aria-label="Close notice"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-4">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{notice.message}</p>
        </div>
        <div className="flex justify-end border-t border-gray-100 px-4 py-3">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md bg-navy-500 px-4 py-1.5 text-[13px] font-medium text-paper transition-colors hover:bg-navy-400"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
