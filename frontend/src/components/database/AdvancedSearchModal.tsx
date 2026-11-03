'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Loader2, ChevronDown, ChevronUp, Tag, Eye, MapPin, Globe, Clock } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import type { CVAdvancedSearchParams, CVAdvancedSearchResponse, CVSearchResult } from '@/lib/types';

interface AdvancedSearchModalProps {
  onClose: () => void;
  onViewDetails: (cvId: string) => void;
  /** Open straight on the boolean-string box. */
  initialMode?: 'keywords' | 'boolean';
}

interface FacetValue {
  value: string;
  count: number;
}

const PAGE_SIZE = 50;

/** Searchable, checkbox multi-select over a facet (distinct values + counts
 * fetched once from the whole CV database, see /api/cv/search/facets/:field). */
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

export default function AdvancedSearchModal({ onClose, onViewDetails, initialMode = 'keywords' }: AdvancedSearchModalProps) {
  const [mode, setMode] = useState<'keywords' | 'boolean'>(initialMode);
  const [booleanInput, setBooleanInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all');
  const [experienceMin, setExperienceMin] = useState('');
  const [experienceMax, setExperienceMax] = useState('');
  const [locations, setLocations] = useState<string[]>([]);
  const [nationalities, setNationalities] = useState<string[]>([]);

  const [results, setResults] = useState<CVSearchResult[]>([]);
  const [total, setTotal] = useState<{ count: number; estimate: boolean } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // The query the shown results belong to: scrolling pages through it even if the filters are edited meanwhile.
  const [activeQuery, setActiveQuery] = useState<CVAdvancedSearchParams | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /** "python, aws; sql" -> three keywords, skipping ones already added. */
  const withTyped = (current: string[], typed: string) => {
    const seen = new Set(current.map((k) => k.toLowerCase()));
    const added: string[] = [];
    for (const raw of typed.split(/[,;\n]+/)) {
      const k = raw.trim();
      if (k && !seen.has(k.toLowerCase())) {
        seen.add(k.toLowerCase());
        added.push(k);
      }
    }
    return [...current, ...added];
  };
  const addKeyword = () => {
    setKeywords((prev) => withTyped(prev, keywordInput));
    setKeywordInput('');
  };
  const removeKeyword = (k: string) => setKeywords((prev) => prev.filter((x) => x !== k));

  const toggleLocation = (v: string) =>
    setLocations((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  const toggleNationality = (v: string) =>
    setNationalities((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  /** One page of results; asks again while a page comes back short but the search is not finished. */
  const fetchPage = async (query: CVAdvancedSearchParams, cursor: string | null) => {
    let rows: CVSearchResult[] = [];
    let next: string | null = cursor;
    let first: CVAdvancedSearchResponse | null = null;
    for (let round = 0; round < 10; round += 1) {
      const res = await api.searchCVsAdvanced({ ...query, cursor: next });
      first = first ?? res;
      rows = rows.concat(res.results || []);
      next = res.next_cursor;
      if (!next || rows.length >= PAGE_SIZE) break;
    }
    return { rows, next, first };
  };

  const runSearch = async () => {
    // A keyword still in the box counts too: the search never silently drops what was typed.
    const allKeywords = withTyped(keywords, keywordInput);
    setKeywords(allKeywords);
    setKeywordInput('');
    const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const booleanText = mode === 'boolean' ? booleanInput.trim() : '';
    const query: CVAdvancedSearchParams = {
      keywords: allKeywords.length ? allKeywords : undefined,
      boolean_query: booleanText || undefined,
      match_all: matchMode === 'all',
      experience_min: num(experienceMin),
      experience_max: num(experienceMax),
      locations: locations.length ? locations : undefined,
      nationalities: nationalities.length ? nationalities : undefined,
      limit: PAGE_SIZE,
    };
    setActiveQuery(query);
    setSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const { rows, next, first } = await fetchPage(query, null);
      setResults(rows);
      setNextCursor(next);
      setTotal(first?.total != null ? { count: first.total, estimate: !!first.total_is_estimate } : null);
    } catch (e: any) {
      setError(e?.message || 'Search failed');
      setResults([]);
      setNextCursor(null);
      setTotal(null);
    } finally {
      setSearching(false);
    }
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || !activeQuery || loadingMore || searching) return;
    setLoadingMore(true);
    try {
      const { rows, next } = await fetchPage(activeQuery, nextCursor);
      setResults((prev) => [...prev, ...rows]);
      setNextCursor(next);
    } catch {
      // A failed "load more" shouldn't blow away results already on screen;
      // the user can scroll again to retry once nextCursor is still set.
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, activeQuery, loadingMore, searching]);

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
        <h2 className="text-[17px] font-semibold text-slate-900">{mode === 'boolean' ? 'Boolean search' : 'Advanced search'}</h2>
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
            <Segmented
              size="sm"
              value={mode}
              onChange={setMode}
              items={[
                { value: 'keywords', label: 'Keywords' },
                { value: 'boolean', label: 'Boolean string' },
              ]}
            />

            {mode === 'boolean' && (
              <div>
                <label className="section-label mb-1.5 block">Paste a boolean string</label>
                <textarea
                  value={booleanInput}
                  onChange={(e) => setBooleanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      runSearch();
                    }
                  }}
                  rows={6}
                  spellCheck={false}
                  placeholder={'("Cloud Engineer") AND ("Azure" OR "Terraform") NOT intern'}
                  className="field-input w-full resize-y font-mono text-[12px] leading-relaxed"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Use AND, OR, NOT (capitals) and brackets; put phrases in quotes. Two terms side by side mean AND. Every CV in the
                  database is checked and only exact matches are returned. Ctrl+Enter to search.
                </p>
              </div>
            )}

            {/* Keywords */}
            <div className={mode === 'boolean' ? 'hidden' : undefined}>
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
                  placeholder="e.g. Python, SAP FICO, Dubai"
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
              {keywords.length + (keywordInput.trim() ? 1 : 0) > 1 && (
                <Segmented
                  size="sm"
                  className="mt-2"
                  value={matchMode}
                  onChange={setMatchMode}
                  items={[
                    { value: 'all', label: 'All keywords' },
                    { value: 'any', label: 'Any keyword' },
                  ]}
                />
              )}
              <p className="mt-1 text-[11px] text-slate-400">
                Searches the whole CV, ignoring case. Separate keywords with commas; a phrase like project management matches as written.
              </p>
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
                Set your filters and press Search, this searches every CV in the database, not just what's currently loaded.
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
                <p className="mb-2 text-[12px] text-slate-500">
                  {total
                    ? `${total.estimate ? 'Up to ' : ''}${total.count.toLocaleString()} matching CV${total.count !== 1 ? 's' : ''}, ${results.length.toLocaleString()} shown`
                    : `${results.length.toLocaleString()} result${results.length !== 1 ? 's' : ''} loaded`}
                  {nextCursor ? ', scroll for more' : ''}
                </p>
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
                          {cv.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{cv.location}</span>}
                          {cv.nationality && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{cv.nationality}</span>}
                          {cv.notice_period && <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{cv.notice_period}</span>}
                        </div>
                        {(cv.matched_keywords?.length ?? 0) > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] text-slate-400">Matched:</span>
                            {(cv.matched_keywords || []).map((k) => (
                              <span key={k} className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">{k}</span>
                            ))}
                          </div>
                        )}
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

