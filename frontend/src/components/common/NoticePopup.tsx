'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Megaphone, ThumbsUp, Check, AlertCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { ease } from '@/lib/motion';
import { useAuthStore } from '@/stores/authStore';
import type { NoticeData } from '@/lib/types';

const DISMISS_PREFIX = 'notice_dismissed_';

/** "Nov 16, 2026, 10:30 AM" in the reader's own time zone; the server sends UTC without a zone marker. */
function postedOn(iso: string | undefined): string | null {
  if (!iso) return null;
  const when = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Shows an admin-published notice to non-admin users.
 * - Fetches the active notice when an authenticated non-admin user is present.
 * - The thumbs-up ("OK, got it") is remembered by the server for this person and notice: it is never shown to them again, and the admin sees
 *   who has acknowledged it. An edited notice has a new id, so it asks again.
 * - The X (or Escape, or a click outside) only closes it for this browser session, keyed by notice id: it does not re-open on every
 *   navigation but DOES come back at the next sign-in (logout clears the keys) while the person has not given the thumbs-up.
 */
export default function NoticePopup() {
  const { user } = useAuthStore();
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    try {
      const res = await api.getNotice();
      if (isCancelled()) return;
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
      setProblem(null);
      setOpen(!dismissed);
    } catch {
      if (!isCancelled()) {
        setNotice(null);
        setOpen(false);
      }
    }
  }, []);

  useEffect(() => {
    // Admins manage the notice; they never see the popup.
    if (!user || (user.role as string) === 'admin') {
      setNotice(null);
      setOpen(false);
      return;
    }
    let cancelled = false;
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [user?.username, user?.role, load]);

  const dismiss = useCallback(() => {
    if (notice) {
      try {
        sessionStorage.setItem(DISMISS_PREFIX + notice.id, '1');
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  }, [notice]);

  const acknowledge = async () => {
    if (!notice || sending) return;
    setSending(true);
    setProblem(null);
    try {
      await api.acknowledgeNotice(notice.id);
      setThanks(true);
      window.setTimeout(() => {
        setOpen(false);
        setThanks(false);
        setNotice(null);
      }, 1100);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        void load();                                  // the admin changed or removed it meanwhile: show what is current
      } else {
        setProblem('We could not save that. Please try again.');
      }
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => okRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, dismiss]);

  const posted = postedOn(notice?.updated_at);

  return (
    <AnimatePresence>
      {open && notice && (
        <motion.div
          key="notice"
          className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-scrim/55 backdrop-blur-[3px]" aria-hidden onClick={dismiss} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
            aria-describedby="notice-body"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.28, ease }}
            className="relative z-10 flex max-h-[85vh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgba(10,16,48,0.55)] ring-1 ring-black/5"
          >
            {/* header: the same deep navy as the sign-in page, with a soft glow */}
            <div
              className="relative shrink-0 overflow-hidden px-6 pb-6 pt-6 text-white"
              style={{
                background:
                  'radial-gradient(420px 200px at 100% -20%, rgba(99,110,240,0.38), transparent 62%),' +
                  'linear-gradient(160deg, #0a1030 0%, #111a40 60%, #16215a 100%)',
              }}
            >
              <button
                type="button"
                onClick={dismiss}
                className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                aria-label="Close for now"
                title="Close for now (it comes back at your next sign-in)"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3.5">
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
                  <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-white/10 [animation-duration:2.6s] [animation-iteration-count:2]" />
                  <Megaphone className="relative h-6 w-6 text-white" />
                </span>
                <div className="min-w-0 pr-8">
                  <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-white/55">Announcement</p>
                  <h2 id="notice-title" className="mt-0.5 font-display text-[1.25rem] font-semibold leading-tight tracking-[-0.02em]">
                    A message from your admin
                  </h2>
                </div>
              </div>
            </div>

            {/* the message */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <p id="notice-body" className="whitespace-pre-wrap break-words text-[0.97rem] leading-relaxed text-slate-700">
                {notice.message}
              </p>
              {(posted || notice.updated_by) && (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
                  {notice.updated_by ? <>Posted by <span className="font-medium text-slate-500">{notice.updated_by}</span></> : 'Posted'}
                  {posted ? ` · ${posted}` : ''}
                </p>
              )}
            </div>

            {/* the thumbs-up */}
            <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
              {problem && (
                <p role="alert" className="mb-3 flex items-center gap-1.5 text-xs font-medium text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {problem}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button
                  ref={okRef}
                  type="button"
                  onClick={acknowledge}
                  disabled={sending || thanks}
                  className={`group inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(10,16,48,0.6)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500/50 focus-visible:ring-offset-2 disabled:cursor-default ${
                    thanks ? 'bg-emerald-600' : 'bg-navy-800 hover:-translate-y-px hover:bg-navy-700 active:translate-y-0'
                  }`}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {thanks ? (
                      <motion.span key="done" className="inline-flex items-center gap-2" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                        <Check className="h-4 w-4 text-white" /> Thanks, noted
                      </motion.span>
                    ) : (
                      <motion.span key="ok" className="inline-flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                        <ThumbsUp className="h-[18px] w-[18px] text-white transition-transform duration-200 group-hover:-rotate-12 group-hover:scale-110" />
                        {sending ? 'Saving…' : 'OK, got it'}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
                <Button type="button" variant="ghost" size="lg" onClick={dismiss} disabled={sending || thanks} className="h-11 shrink-0 text-slate-500">
                  Later
                </Button>
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">
                Tap <span className="font-medium text-slate-500">OK, got it</span> and this won&apos;t show again. Your admin will see that you&apos;ve read it.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
