'use client';
import { useEffect, useRef } from 'react';
import { onLive, type LiveEvent } from '@/lib/liveEvents';

/**
 * Keeps a page's data fresh without the reader pressing refresh, and without asking the server on a timer:
 * - when the reader comes back to the tab or the window after being away for `awayMs` (30 s), the page fetches again, quietly;
 * - when a live event of one of `kinds` arrives (e.g. a requirement was assigned or closed), it fetches again a moment later
 *   (several events close together make one fetch).
 * `refresh` must not show a loading placeholder: the current rows stay until the new ones replace them.
 */
export function useAutoRefresh(refresh: () => void, { kinds = [], awayMs = 30_000 }: { kinds?: string[]; awayMs?: number } = {}) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  const kindsKey = kinds.join(',');

  useEffect(() => {
    let awaySince: number | null = null;
    const left = () => { if (awaySince == null) awaySince = Date.now(); };
    const back = () => {
      if (document.visibilityState === 'hidden') return;
      const away = awaySince;
      awaySince = null;
      if (away != null && Date.now() - away >= awayMs) latest.current();
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? left() : back());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', left);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', left);
      window.removeEventListener('focus', back);
    };
  }, [awayMs]);

  useEffect(() => {
    const wanted = kindsKey ? kindsKey.split(',') : [];
    if (wanted.length === 0) return;
    let timer: number | undefined;
    const off = onLive((e: LiveEvent) => {
      const match = e.type === 'sync' || (e.type === 'notification' && wanted.some((k) => e.kind === k || (k.endsWith('*') && e.kind.startsWith(k.slice(0, -1)))));
      if (!match) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => latest.current(), 600);
    });
    return () => { window.clearTimeout(timer); off(); };
  }, [kindsKey]);
}
