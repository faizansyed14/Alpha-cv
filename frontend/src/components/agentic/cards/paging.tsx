'use client';

import { useState } from 'react';
import { Loader2 } from '@/components/icons';
import { api } from '@/lib/api';
import type { AgenticCard } from '@/lib/types';

const HINT_AFTER = 100;

/**
 * Rows of a list card, with "Show more". The next page comes straight from the application's API (no assistant, no tokens), so
 * a list can be paged through however large the data is. `card.page` says what to ask for next; it is absent when all is shown.
 */
export function usePagedRows<T = any>(card: AgenticCard) {
  const [extra, setExtra] = useState<T[]>([]);
  const [page, setPage] = useState<AgenticCard['page']>(card.page ?? null);
  const [total, setTotal] = useState<number>(card.total ?? (card.rows?.length ?? 0));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!page || loading) return;
    setLoading(true); setError(null);
    try {
      const res = await api.agenticMore({ tool: page.tool, args: page.args ?? {}, offset: page.offset ?? 0, cursor: page.cursor ?? null });
      setExtra((prev) => [...prev, ...(res.rows as T[])]);
      setPage(res.page ?? null);
      setTotal(res.total ?? total);
    } catch (e: any) {
      setError(e?.detail || e?.response?.data?.detail || 'Could not load more.');
    } finally {
      setLoading(false);
    }
  };

  return { rows: [...((card.rows ?? []) as T[]), ...extra], total, hasMore: !!page, loading, error, loadMore };
}

/** The line under a list: "Showing 10 of 1,795,000", the button, and a hint to narrow a very large result. */
export function ShowMore({ shown, total, hasMore, loading, error, onMore }: {
  shown: number; total: number; hasMore: boolean; loading: boolean; error: string | null; onMore: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500">
      <span className="tabular-nums">
        Showing {shown.toLocaleString()} of {total.toLocaleString()}
        {total > HINT_AFTER ? ' · narrow it down with a keyword or a Boolean string' : ''}
      </span>
      <span className="flex items-center gap-2">
        {error ? <span className="text-rose-600">{error}</span> : null}
        {hasMore ? (
          <button type="button" onClick={onMore} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Show 10 more
          </button>
        ) : null}
      </span>
    </div>
  );
}
