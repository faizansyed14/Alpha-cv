/** Persist / restore window scroll for a list page across a detail navigation. */

type SavedPos = { y: number; focusId?: string };

function peekPos(key: string): SavedPos | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return null;
    if (/^\d+$/.test(raw)) {
      const y = Number(raw);
      return Number.isFinite(y) && y > 0 ? { y } : null;
    }
    const parsed = JSON.parse(raw) as SavedPos;
    if (!parsed || !Number.isFinite(parsed.y)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPos(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Jump with no animation — site uses html.scroll-smooth which would otherwise animate. */
function jumpTo(y: number) {
  const html = document.documentElement;
  const prevInline = html.style.scrollBehavior;
  const hadSmoothClass = html.classList.contains('scroll-smooth');
  html.style.scrollBehavior = 'auto';
  if (hadSmoothClass) html.classList.remove('scroll-smooth');
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' as ScrollBehavior });
  } catch {
    window.scrollTo(0, y);
  }
  // Put smooth back on the next frame so it cannot animate this jump.
  requestAnimationFrame(() => {
    html.style.scrollBehavior = prevInline;
    if (hadSmoothClass) html.classList.add('scroll-smooth');
  });
}

export function saveScroll(key: string, focusId?: string) {
  if (typeof window === 'undefined') return;
  try {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const payload: SavedPos = { y: Math.round(window.scrollY), focusId };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Instant restore (no animated scroll). Call from useLayoutEffect so first paint
 * is already at the saved offset. Returns a cleanup that cancels rAF retries.
 */
export function restoreScroll(key: string): (() => void) | void {
  const pos = peekPos(key);
  if (!pos || pos.y <= 0) {
    if (pos) clearPos(key);
    return;
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const apply = () => {
    jumpTo(pos.y);
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    return maxY >= pos.y - 8 || Math.abs(window.scrollY - pos.y) < 8;
  };

  if (apply()) {
    clearPos(key);
    return;
  }

  let frames = 0;
  let raf = 0;
  const tick = () => {
    if (apply() || frames++ > 45) {
      clearPos(key);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export const SCROLL_KEYS = {
  candidates: 'alphacv.scroll.candidates',
  applicants: 'alphacv.scroll.applicants',
} as const;
