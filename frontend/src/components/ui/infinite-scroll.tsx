'use client';
import { useEffect, useRef } from 'react';

/**
 * The end of a list that loads itself: when this strip scrolls into view (a little before the reader reaches it), `onLoadMore` asks the
 * server for the next page. It replaces Previous / Next buttons. While a page is loading, or when there is nothing more, it asks for nothing.
 * If the loaded rows do not fill the screen the strip stays in view, so the next page is requested again until the screen is full.
 */
export function InfiniteScrollSentinel({
  hasMore,
  loading,
  onLoadMore,
  itemCount,
  error,
  rootMargin = '600px 0px',
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void | Promise<void>;
  /** The number of rows on screen: when it changes the strip is checked again. */
  itemCount: number;
  error?: boolean;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onLoadMore);
  latest.current = onLoadMore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || loading || error) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void latest.current();
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, error, itemCount, rootMargin]);

  if (!hasMore && !loading) return null;
  return (
    <div ref={ref} className="flex min-h-10 items-center justify-center py-3 text-xs text-slate-500" aria-live="polite">
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" aria-hidden />
          Loading more…
        </span>
      ) : error ? (
        <button type="button" onClick={() => void latest.current()} className="font-semibold text-navy-600 hover:underline">
          Could not load more. Try again
        </button>
      ) : (
        <span className="sr-only">More results load as you scroll</span>
      )}
    </div>
  );
}
