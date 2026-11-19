'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Bug, CheckCheck, ClipboardList, MessageSquare, Trophy, Volume2, VolumeX } from '@/components/icons';
import { api } from '@/lib/api';
import type { AppNotification } from '@/lib/types';
import { cn } from '@/lib/utils';
import { claimChime, isMuted, playChime, setMuted, unlockSoundOnFirstGesture } from '@/lib/notificationSound';
import { isLive, onLive } from '@/lib/liveEvents';

// New notifications arrive on the live line the moment they are saved (lib/liveEvents). The timer is only a safety net: every 5 minutes
// while the line is up, every 30 s when it is down (an old proxy, the server restarting), and only while the tab is visible.
const CHECK_LIVE_MS = 300_000;
const CHECK_OFFLINE_MS = 30_000;
export const FOCUS_EVENT = 'alphacv:notification-open';   // a page that is already open is told which item to show

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

function KindIcon({ kind }: { kind: string }) {
  const bug = kind.startsWith('bug');
  const closed = kind === 'requirement_closed';
  const comment = kind === 'requirement_comment';
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1',
      bug ? 'bg-rose-50 ring-rose-100' : closed ? 'bg-emerald-50 ring-emerald-100' : comment ? 'bg-sky-50 ring-sky-100' : 'bg-navy-50 ring-navy-100')}>
      {bug ? <Bug className="h-4 w-4" /> : closed ? <Trophy className="h-4 w-4" /> : comment ? <MessageSquare className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
    </span>
  );
}

/**
 * The bell at the top of every page: how many notifications are unread, the list, and a chime when a new one arrives.
 * Opening a notification marks it read (the count goes down at once) and goes to its page. Only the last 30 days are kept.
 */
export default function NotificationBell({ className, buttonClassName }: { className?: string; buttonClassName?: string }) {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [muted, setMutedState] = useState(false);
  const latest = useRef<string | null | undefined>(undefined);      // undefined: not polled yet (the first poll never chimes)
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMutedState(isMuted());
    unlockSoundOnFirstGesture();
  }, []);

  const loadList = useCallback(async (more = false) => {
    setLoading(true);
    setFailed(false);
    try {
      const before = more && items.length ? items[items.length - 1].created_at : null;
      const page = await api.listNotifications(before);
      setItems((prev) => (more ? [...prev, ...page.items] : page.items));
      setHasMore(page.has_more);
      setUnread(page.unread);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [items]);

  // the count: now, when the live line says something changed (even while the person is in another window: they hear the chime),
  // as soon as they come back to the tab, and on the safety timer
  const poll = useCallback(async (whenHidden = false) => {
    if (!whenHidden && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      const { unread: n, latest_id } = await api.getNotificationCount();
      setUnread(n);
      if (latest.current !== undefined && latest_id && latest_id !== latest.current && claimChime(latest_id)) {
        playChime();
        if (open) void loadList();                                    // the open list shows the new one too
      }
      if (latest.current === undefined && latest_id) claimChime(latest_id);   // what is already there on load never chimes
      latest.current = latest_id;
    } catch {
      /* signed out or offline: the next poll tries again */
    }
  }, [open, loadList]);

  const pollRef = useRef(poll);
  useEffect(() => { pollRef.current = poll; });

  useEffect(() => {
    void pollRef.current();
    let lastCheck = Date.now();
    const check = () => { lastCheck = Date.now(); void pollRef.current(); };
    // the safety timer ticks every 30 s but only asks the server when the live line is down, or every 5 minutes when it is up
    const id = window.setInterval(() => {
      if (Date.now() - lastCheck >= (isLive() ? CHECK_LIVE_MS : CHECK_OFFLINE_MS)) check();
    }, CHECK_OFFLINE_MS);
    const onVisible = () => { if (document.visibilityState === 'visible' && !isLive()) check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const off = onLive(() => { lastCheck = Date.now(); void pollRef.current(true); });   // new, read elsewhere, or back after a gap
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      off();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadList();
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openOne = async (n: AppNotification) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));                           // at once; the server's answer confirms it
      api.markNotificationRead(n.id).then((r) => setUnread(r.unread)).catch(() => undefined);
    }
    setOpen(false);
    if (n.link) {
      router.push(n.link);
      window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: n.link }));   // the page may already be open
    }
  };

  const readAll = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    try {
      await api.markAllNotificationsRead();
    } catch {
      void poll();
    }
  };

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) playChime();                                           // a sample, so the person hears what it will sound like
  };

  return (
    <div ref={box} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900',
          buttonClassName,
        )}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold tabular-nums leading-none text-white ring-2 ring-paper">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
             className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-surface-border bg-paper shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications{unread ? <span className="ml-1.5 text-xs font-medium text-slate-500">{unread} unread</span> : null}</p>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={toggleSound} title={muted ? 'Turn the sound on' : 'Turn the sound off'} aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100">
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => void readAll()} disabled={!unread}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            </div>
          </div>

          <div className="max-h-[min(70vh,460px)] overflow-y-auto">
            {failed && !items.length ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Could not load notifications. <button type="button" className="font-semibold text-navy-700 hover:underline" onClick={() => void loadList()}>Try again</button></p>
            ) : !items.length ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">{loading ? 'Loading…' : 'No notifications in the last 30 days.'}</p>
            ) : (
              <ul className="divide-y divide-surface-border/70">
                {items.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => void openOne(n)}
                            className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50', !n.read && 'bg-navy-50/40')}>
                      <KindIcon kind={n.kind} />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm leading-snug', n.read ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                        {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-slate-500">{n.body}</span>}
                        <span className="mt-1 block text-2xs text-slate-400">{ago(n.created_at)}</span>
                      </span>
                      {!n.read && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy-600" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasMore && (
              <div className="border-t border-surface-border p-2 text-center">
                <button type="button" onClick={() => void loadList(true)} disabled={loading} className="text-xs font-semibold text-navy-700 hover:underline disabled:opacity-50">
                  {loading ? 'Loading…' : 'Show older'}
                </button>
              </div>
            )}
          </div>
          <p className="border-t border-surface-border bg-slate-50/60 px-4 py-1.5 text-center text-2xs text-slate-400">Notifications are kept for 30 days.</p>
        </div>
      )}
    </div>
  );
}
