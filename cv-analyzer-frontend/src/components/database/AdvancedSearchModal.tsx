'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Loader2, ChevronDown, ChevronUp, Tag, Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { CVListItem } from '@/lib/types';

interface AdvancedSearchModalProps {
  onClose: () => void;
  onViewDetails: (cvId: string) => void;
}

interface FacetValue {
  value: string;
  count: number;
}

const PAGE_SIZE = 50;

/** Searchable, checkbox multi-select over a facet (distinct values + counts
 * fetched once from the whole CV database — see /api/cv/search/facets/:field). */
function FacetCheckboxList({
  field,
  selected,
  onToggle,
}: {
  field: 'location' | 'nationality';
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [values, setValues] = useState<FacetValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getCVSearchFacet(field)
      .then((res) => {
        if (!cancelled) setValues(res.values || []);
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [field]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => v.value.toLowerCase().includes(q));
  }, [values, query]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          {field === 'location' ? 'Current location' : 'Nationality'}
          {selected.length > 0 && (
            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
              {selected.length}
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
      </button>
      {!collapsed && (
        <div className="mt-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${field === 'location' ? 'locations' : 'nationalities'}…`}
            className="field-input mb-2 w-full"
          />
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center gap-2 py-2 text-[12px] text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-1 text-[12px] text-slate-400">No values yet</p>
            ) : (
              filtered.map((v) => (
                <label
                  key={v.value}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(v.value)}
                      onChange={() => onToggle(v.value)}
                      className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500/30"
                    />
                    <span className="truncate">{v.value}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-slate-400">{v.count}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdvancedSearchModal({ onClose, onViewDetails }: AdvancedSearchModalProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [experienceMin, setExperienceMin] = useState('');
  const [experienceMax, setExperienceMax] = useState('');
  const [locations, setLocations] = useState<string[]>([]);
  const [nationalities, setNationalities] = useState<string[]>([]);

  const [results, setResults] = useState<CVListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const addKeyword = () => {
    const k = keywordInput.trim();
    if (k && !keywords.includes(k)) setKeywords((prev) => [...prev, k]);
    setKeywordInput('');
  };
  const removeKeyword = (k: string) => setKeywords((prev) => prev.filter((x) => x !== k));

  const toggleLocation = (v: string) =>
    setLocations((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const toggleNationality = (v: string) =>
    setNationalities((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const buildParams = useCallback(
    (cursor?: string | null) => ({
      keywords: keywords.length ? keywords : undefined,
      experience_min: experienceMin.trim() ? Number(experienceMin) : undefined,
      experience_max: experienceMax.trim() ? Number(experienceMax) : undefined,
      locations: locations.length ? locations : undefined,
      nationalities: nationalities.length ? nationalities : undefined,
      limit: PAGE_SIZE,
      cursor: cursor || undefined,
    }),
    [keywords, experienceMin, experienceMax, locations, nationalities]
  );

  const runSearch = async () => {
    setSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const res = await api.searchCVsAdvanced(buildParams(null));
      setResults(res.results || []);
      setNextCursor(res.next_cursor);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      setResults([]);
      setNextCursor(null);
    } finally {
      setSearching(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || searching) return;
    setLoadingMore(true);
    try {
      const res = await api.searchCVsAdvanced(buildParams(nextCursor));
      setResults((prev) => [...prev, ...(res.results || [])]);
      setNextCursor(res.next_cursor);
    } catch {
      // A failed "load more" shouldn't blow away results already on screen;
      // the user can scroll again to retry once nextCursor is still set.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, searching, buildParams]);

  // Infinite scroll: fetch the next page as the sentinel at the bottom of the
  // results list comes into view, instead of a "load more" click.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root, rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 sm:px-8">
        <h2 className="text-[17px] font-semibold text-slate-900">Advanced search</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto p-5 sm:flex-row sm:overflow-visible sm:p-8">
          {/* Filters */}
          <div className="space-y-4 sm:w-72 sm:shrink-0">
            {/* Keywords */}
            <div>
              <label className="section-label mb-1.5 block">Keywords / skills</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  placeholder="e.g. Python, AWS…"
                  className="field-input flex-1"
                />
                <Button type="button" variant="secondary" size="sm" onClick={addKeyword}>
                  Add
                </Button>
              </div>
              {keywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[12px] font-medium text-brand-700"
                    >
                      <Tag className="h-3 w-3" />
                      {k}
                      <button type="button" onClick={() => removeKeyword(k)} aria-label={`Remove ${k}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[11px] text-slate-400">Matches any of the listed keywords.</p>
            </div>

            {/* Experience range */}
            <div>
              <label className="section-label mb-1.5 block">Work experience (years)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={experienceMin}
                  onChange={(e) => setExperienceMin(e.target.value)}
                  placeholder="Min"
                  className="field-input w-full"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="number"
                  min={0}
                  value={experienceMax}
                  onChange={(e) => setExperienceMax(e.target.value)}
                  placeholder="Max"
                  className="field-input w-full"
                />
              </div>
            </div>

            <FacetCheckboxList field="location" selected={locations} onToggle={toggleLocation} />
            <FacetCheckboxList field="nationality" selected={nationalities} onToggle={toggleNationality} />

            <Button type="button" variant="primary" className="w-full" icon={<Search className="h-4 w-4" />} loading={searching} onClick={runSearch}>
              Search
            </Button>
          </div>

          {/* Results */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
            {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}
            {!hasSearched ? (
              <div className="flex h-full min-h-[200px] items-center justify-center text-center text-[13px] text-slate-400">
                Set your filters and press Search — this searches every CV in the database, not just what's currently loaded.
              </div>
            ) : searching ? (
              <div className="flex h-full min-h-[200px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
              </div>
            ) : results.length === 0 ? (
              <div className="flex h-full min-h-[200px] items-center justify-center text-[13px] text-slate-400">
                No candidates match these filters.
              </div>
            ) : (
              <>
                <p className="mb-2 text-[12px] text-slate-500">{results.length} result{results.length !== 1 ? 's' : ''} loaded{nextCursor ? ' — scroll for more' : ''}</p>
                <div className="space-y-2">
                  {results.map((cv) => (
                    <div
                      key={cv.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:border-slate-300"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold text-slate-900">{cv.full_name}</p>
                        <p className="truncate text-[12px] text-slate-600">{cv.job_title} · {String(cv.years_of_experience)} yrs</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          {cv.location && <span>📍 {cv.location}</span>}
                          {cv.nationality && <span>🌐 {cv.nationality}</span>}
                          {cv.notice_period && <span>⏱ {cv.notice_period}</span>}
                        </div>
                        {(cv.skill_keywords?.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {(cv.skill_keywords || []).slice(0, 8).map((k) => (
                              <span key={k} className="chip chip-neutral text-[10px]">{k}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon={<Eye className="h-3.5 w-3.5" />}
                        onClick={() => onViewDetails(cv.id)}
                      >
                        View
                      </Button>
                    </div>
                  ))}
                </div>
                {/* Infinite-scroll trigger */}
                <div ref={sentinelRef} className="h-px w-full" />
                {loadingMore && (
                  <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more…
                  </div>
                )}
              </>
            )}
          </div>
        </div>
    </div>
  );
}

