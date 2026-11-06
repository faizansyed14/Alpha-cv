'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, ChevronDown, ChevronUp, Tag } from '@/components/icons';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import type { CVAdvancedSearchParams } from '@/lib/types';

interface AdvancedSearchModalProps {
  onClose: () => void;
  /** Run search on the candidates page with these filters. */
  onSubmit: (query: CVAdvancedSearchParams) => void;
  initialMode?: 'keywords' | 'boolean';
}

interface FacetValue {
  members?: string[];
  value: string;
  count: number;
}

/** Searchable checkbox multi-select over a facet. */
function FacetCheckboxList({
  field,
  label,
  selected,
  onToggle,
  onLoaded,
}: {
  field: 'location' | 'nationality' | 'languages';
  label: string;
  selected: string[];
  onToggle: (value: string) => void;
  onLoaded?: (values: FacetValue[]) => void;
}) {
  const [values, setValues] = useState<FacetValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCVSearchFacet(field)
      .then((res) => {
        if (cancelled) return;
        setValues(res.values || []);
        onLoaded?.(res.values || []);
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
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{selected.length}</span>
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
            placeholder={`Search ${label.toLowerCase()}…`}
            className="field-input mb-2 w-full"
          />
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
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

/**
 * Centered search form. Results are shown on the candidates list after submit —
 * not in a side panel inside this overlay.
 */
export default function AdvancedSearchModal({ onClose, onSubmit, initialMode = 'keywords' }: AdvancedSearchModalProps) {
  const [freshness, setFreshness] = useState<'any' | '1' | '7' | '30' | '90' | 'custom'>('any');
  const [addedFrom, setAddedFrom] = useState('');
  const [addedTo, setAddedTo] = useState('');
  const [mode, setMode] = useState<'keywords' | 'boolean'>(initialMode);
  const [booleanInput, setBooleanInput] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<'all' | 'any'>('all');
  const [experienceMin, setExperienceMin] = useState('');
  const [experienceMax, setExperienceMax] = useState('');
  const [locations, setLocations] = useState<string[]>([]);
  const [nationalities, setNationalities] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  // The location filter lists countries; the search itself looks for the locations stored behind them.
  const [countryMembers, setCountryMembers] = useState<Record<string, string[]>>({});

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
  const toggle = (list: string[], v: string, set: (n: string[]) => void) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const handleSearch = () => {
    const allKeywords = withTyped(keywords, keywordInput);
    setKeywords(allKeywords);
    setKeywordInput('');
    const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const booleanText = mode === 'boolean' ? booleanInput.trim() : '';
    const query: CVAdvancedSearchParams = {
      keywords: mode === 'keywords' && allKeywords.length ? allKeywords : undefined,
      boolean_query: booleanText || undefined,
      added_within_days: freshness !== 'any' && freshness !== 'custom' ? Number(freshness) : undefined,
      added_from: freshness === 'custom' && addedFrom ? addedFrom : undefined,
      added_to: freshness === 'custom' && addedTo ? addedTo : undefined,
      match_all: matchMode === 'all',
      experience_min: num(experienceMin),
      experience_max: num(experienceMax),
      locations: locations.length ? locations.flatMap((c) => countryMembers[c] || [c]) : undefined,
      nationalities: nationalities.length ? nationalities : undefined,
      languages: languages.length ? languages : undefined,
      limit: 100,
    };
    onSubmit(query);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
      <div
        className="flex max-h-[min(92vh,880px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-surface-border bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'boolean' ? 'Boolean search' : 'Advanced search'}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-surface-border px-5 py-3.5">
          <div>
            <h2 className="text-[17px] font-semibold text-slate-900">
              {mode === 'boolean' ? 'Boolean search' : 'Advanced search'}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Results replace the candidate list on this page
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            items={[
              { value: 'keywords', label: 'Keywords' },
              { value: 'boolean', label: 'Boolean string' },
            ]}
          />

          {mode === 'boolean' ? (
            <div>
              <label className="section-label mb-1.5 block">Boolean string</label>
              <textarea
                value={booleanInput}
                onChange={(e) => setBooleanInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                rows={5}
                spellCheck={false}
                placeholder={'("Cloud Engineer") AND ("Azure" OR "Terraform") NOT intern'}
                className="field-input w-full resize-y font-mono text-[12px] leading-relaxed"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Use AND, OR, NOT and brackets. Phrases in quotes. Ctrl+Enter to search.
              </p>
            </div>
          ) : (
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
            </div>
          )}

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

          <div>
            <label className="section-label mb-1.5 block">Freshness (date added)</label>
            <select
              value={freshness}
              onChange={(e) => setFreshness(e.target.value as typeof freshness)}
              className="field-input w-full"
            >
              <option value="any">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom range</option>
            </select>
            {freshness === 'custom' && (
              <div className="mt-2 flex items-center gap-2">
                <input type="date" value={addedFrom} onChange={(e) => setAddedFrom(e.target.value)} className="field-input w-full" aria-label="Added from" />
                <span className="text-slate-400">to</span>
                <input type="date" value={addedTo} onChange={(e) => setAddedTo(e.target.value)} className="field-input w-full" aria-label="Added to" />
              </div>
            )}
          </div>

          <FacetCheckboxList
            field="location"
            label="Country"
            onLoaded={(vals) => setCountryMembers(Object.fromEntries(vals.map((v) => [v.value, v.members || [v.value]])))}
            selected={locations}
            onToggle={(v) => toggle(locations, v, setLocations)}
          />
          <FacetCheckboxList
            field="nationality"
            label="Nationality"
            selected={nationalities}
            onToggle={(v) => toggle(nationalities, v, setNationalities)}
          />
          <FacetCheckboxList
            field="languages"
            label="Language"
            selected={languages}
            onToggle={(v) => toggle(languages, v, setLanguages)}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-surface-border bg-slate-50/80 px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" icon={<Search className="h-4 w-4" />} onClick={handleSearch}>
            Search candidates
          </Button>
        </div>
      </div>
    </div>
  );
}
