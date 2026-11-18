'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Megaphone, Check, AlertCircle } from '@/components/icons';
import { api } from '@/lib/api';
import { ease } from '@/lib/motion';
import { useAuthStore } from '@/stores/authStore';
import type { NoticeData } from '@/lib/types';

const DISMISS_PREFIX = 'notice_dismissed_';

type Block = { kind: 'p'; text: string } | { kind: 'ol'; items: { n: string; text: string }[] } | { kind: 'ul'; items: string[] };
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.+)$/;
const BULLET = /^\s*[-*•–]\s+(.+)$/;

/** The admin's message as paragraphs and lists: "1. ..." lines become a numbered list, "- ..." / "• ..." lines a bulleted one. */
export function toBlocks(message: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of message.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const last = blocks[blocks.length - 1];
    if (!line) {
      if (last && last.kind === 'p') blocks.push({ kind: 'p', text: '' });         // a blank line ends a paragraph
      continue;
    }
    const num = NUMBERED.exec(line);
    const bullet = num ? null : BULLET.exec(line);
    if (num) {
      if (last && last.kind === 'ol') last.items.push({ n: num[1], text: num[2] });
      else blocks.push({ kind: 'ol', items: [{ n: num[1], text: num[2] }] });
    } else if (bullet) {
      if (last && last.kind === 'ul') last.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
    } else if (last && last.kind === 'p' && last.text) {
      last.text += '\n' + line;
    } else if (last && last.kind === 'p') {
      last.text = line;
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  return blocks.filter((b) => b.kind !== 'p' || b.text);
}

/** One short sentence is centred under the title; anything with a list or several paragraphs reads left-aligned. */
function NoticeMessage({ text }: { text: string }) {
  const blocks = toBlocks(text);
  const simple = blocks.length === 1 && blocks[0].kind === 'p' && blocks[0].text.length < 160;
  return (
    <div id="notice-body" className={`mt-3 w-full space-y-3 text-[0.95rem] leading-relaxed text-slate-600 ${simple ? 'text-center' : 'text-left'}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'ol') {
          return (
            <ol key={i} className="space-y-2">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-3">
                  <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-50 text-2xs font-semibold tabular-nums text-navy-700">{item.n}</span>
                  <span className="min-w-0 break-words">{item.text}</span>
                </li>
              ))}
            </ol>
          );
        }
        if (b.kind === 'ul') {
          return (
            <ul key={i} className="space-y-2">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-3">
                  <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy-400" />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              ))}
            </ul>
          );
        }
        const heading = !simple && b.text.length <= 60 && b.text.endsWith(':') && !b.text.includes('\n');
        return heading
          ? <p key={i} className="text-sm font-semibold text-slate-800">{b.text}</p>
          : <p key={i} className="whitespace-pre-wrap break-words">{b.text}</p>;
      })}
    </div>
  );
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
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" aria-hidden onClick={dismiss} />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notice-title"
            aria-describedby="notice-body"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.26, ease }}
            className="relative z-10 flex max-h-[80vh] w-full max-w-[400px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_-18px_rgba(15,23,42,0.28)] ring-1 ring-slate-200/70"
          >
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500/30"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-7 pb-2 pt-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-50 ring-8 ring-navy-50/50">
                <Megaphone className="h-[22px] w-[22px] text-navy-700" />
              </span>
              <h2 id="notice-title" className="mt-4 font-display text-lg font-semibold tracking-[-0.01em] text-slate-900">Notice</h2>
              <NoticeMessage text={notice.message} />
            </div>

            <div className="shrink-0 px-7 pb-7 pt-5">
              {problem && (
                <p role="alert" className="mb-3 flex items-center justify-center gap-1.5 text-xs font-medium text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" /> {problem}
                </p>
              )}
              <button
                ref={okRef}
                type="button"
                onClick={acknowledge}
                disabled={sending || thanks}
                className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-500/40 focus-visible:ring-offset-2 disabled:cursor-default ${
                  thanks ? 'bg-emerald-600' : 'bg-navy-800 hover:bg-navy-700'
                }`}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {thanks ? (
                    <motion.span key="done" className="inline-flex items-center gap-2" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}>
                      <Check className="h-4 w-4 text-white" /> Thanks
                    </motion.span>
                  ) : (
                    <motion.span key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {sending ? 'Saving…' : 'Got it'}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
