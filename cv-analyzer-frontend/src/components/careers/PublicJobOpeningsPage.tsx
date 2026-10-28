'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Search, Briefcase, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 12;

function toSearchText(job: JobPostingListItem) {
  return [
    job.job_title,
    job.job_location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

type LocationBucket = 'UAE' | 'KSA' | 'Remote' | 'Not specified';

const UAE_EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'] as const;

function normalizeLocationBucket(jobLocation?: string | null): LocationBucket {
  const raw = String(jobLocation || '').trim().toLowerCase();
  if (!raw) return 'Not specified';
  const has = (...keys: string[]) => keys.some((k) => raw.includes(k));
  if (has('remote', 'work from home', 'wfh', 'anywhere')) return 'Remote';
  if (has('ksa', 'saudi', 'riyadh', 'jeddah', 'dammam', 'khobar', 'al khobar')) return 'KSA';
  if (has('uae', 'dubai', 'abu dhabi', 'abudhabi', 'sharjah', 'ajman', 'ras al khaimah', 'rak', 'fujairah', 'al ain')) return 'UAE';
  return 'Not specified';
}

function normalizeUaeEmirate(jobLocation?: string | null): (typeof UAE_EMIRATES)[number] | null {
  const raw = String(jobLocation || '').trim().toLowerCase();
  if (!raw) return null;
  const has = (...keys: string[]) => keys.some((k) => raw.includes(k));
  if (has('dubai', 'dxb')) return 'Dubai';
  if (has('abu dhabi', 'abudhabi', 'auh', 'al ain')) return 'Abu Dhabi';
  if (has('sharjah')) return 'Sharjah';
  if (has('ajman')) return 'Ajman';
  if (has('ras al khaimah', 'rasalkhaimah', 'rak')) return 'Ras Al Khaimah';
  if (has('fujairah')) return 'Fujairah';
  if (has('umm al quwain', 'ummalqaiwain', 'uaq')) return 'Umm Al Quwain';
  return null;
}

function normalizeKsaCity(jobLocation?: string | null): string | null {
  const raw = String(jobLocation || '').trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => s.includes(k));
  if (has('riyadh')) return 'Riyadh';
  if (has('jeddah')) return 'Jeddah';
  if (has('dammam')) return 'Dammam';
  if (has('khobar', 'al khobar')) return 'Al Khobar';
  if (has('mecca', 'makkah')) return 'Makkah';
  if (has('medina', 'madinah')) return 'Madinah';
  if (has('jubail')) return 'Jubail';
  if (has('yanbu')) return 'Yanbu';
  if (has('taif')) return 'Taif';
  if (has('tabuk')) return 'Tabuk';
  if (has('abha')) return 'Abha';
  if (has('najran')) return 'Najran';
  if (has('jizan', 'gizan')) return 'Jizan';
  if (has('hail')) return 'Hail';
  if (has('buraidah', 'buraydah')) return 'Buraidah';
  // Fallback: extract first comma/pipe separated token as "city" if present
  const token = raw.split(/[|,]/)[0]?.trim();
  return token && token.length <= 40 ? token : null;
}

function toSkillMatchText(job: JobPostingListItem) {
  return [
    job.job_title,
    job.job_summary,
    job.qualifications,
    job.key_responsibilities,
    job.job_location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normSkill(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const selectClass = 'field-input text-slate-900';

export default function PublicJobOpeningsPage() {
  const [jobs, setJobs] = useState<JobPostingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [skillDraft, setSkillDraft] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [locationBucket, setLocationBucket] = useState<LocationBucket | 'All'>('All');
  const [uaeEmirates, setUaeEmirates] = useState<string[]>([]);
  const [ksaCities, setKsaCities] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const rows = await api.getRecentJobPostings(50);
        if (!mounted) return;
        setJobs(Array.isArray(rows) ? rows : []);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load job openings');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return jobs
      .filter((job) => (locationBucket === 'All' ? true : normalizeLocationBucket(job.job_location) === locationBucket))
      .filter((job) => {
        if (locationBucket === 'UAE' && uaeEmirates.length > 0) {
          const emirate = normalizeUaeEmirate(job.job_location);
          return emirate ? uaeEmirates.includes(emirate) : false;
        }
        if (locationBucket === 'KSA' && ksaCities.length > 0) {
          const city = normalizeKsaCity(job.job_location);
          return city ? ksaCities.includes(city) : false;
        }
        return true;
      })
      .filter((job) => {
        if (skills.length === 0) return true;
        const hay = toSkillMatchText(job);
        // match-all skills for more accurate filtering
        return skills.every((s) => hay.includes(normSkill(s)));
      })
      .filter((job) => (!kw ? true : toSearchText(job).includes(kw)));
  }, [jobs, keyword, locationBucket, skills, uaeEmirates, ksaCities]);

  const availableKsaCities = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      if (normalizeLocationBucket(j.job_location) !== 'KSA') continue;
      const city = normalizeKsaCity(j.job_location);
      if (city) set.add(city);
    }
    // Prefer common cities first, then whatever else exists in the data
    const preferred = [
      'Riyadh', 'Jeddah', 'Dammam', 'Al Khobar', 'Makkah', 'Madinah', 'Jubail', 'Yanbu', 'Taif', 'Tabuk', 'Abha', 'Najran', 'Jizan', 'Hail', 'Buraidah',
    ];
    const rest = Array.from(set).filter((x) => !preferred.includes(x)).sort((a, b) => a.localeCompare(b));
    return [...preferred.filter((x) => set.has(x)), ...rest];
  }, [jobs]);

  const maxPageIndex = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const pageJobs = useMemo(() => {
    const start = pageIndex * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, pageIndex]);

  useEffect(() => {
    // If the search reduces the result set, clamp page index.
    if (pageIndex > maxPageIndex) setPageIndex(maxPageIndex);
  }, [pageIndex, maxPageIndex]);

  const openJob = (job: JobPostingListItem) => {
    const token = job.public_token;
    if (!token || token === 'unknown') return;
    window.location.href = `/careers/jobs/${token}`;
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-3 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white p-1.5">
            <img src="/alphadatalogo.svg" alt="Alpha Data" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight text-slate-900">AlphaData</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Recruitment</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Open positions</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            Explore current opportunities and apply in a few minutes.
          </p>
        </div>

        {error ? (
          <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {/* Filters */}
        <div className="surface-panel mb-5 space-y-3 p-4">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPageIndex(0);
              }}
              placeholder="Search by title or location…"
              className="field-input w-full pl-9 pr-9"
            />
            {keyword ? (
              <button
                type="button"
                onClick={() => { setKeyword(''); setPageIndex(0); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors duration-200 hover:text-slate-600"
                aria-label="Clear search"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="section-label">Skills</span>
              {skills.map((s) => (
                <span
                  key={s}
                  className="chip chip-brand inline-flex items-center gap-1.5"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => { setSkills((prev) => prev.filter((x) => x !== s)); setPageIndex(0); }}
                    className="text-brand-500 hover:text-brand-800"
                    aria-label={`Remove skill ${s}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const v = normSkill(skillDraft);
                  if (!v) return;
                  setSkills((prev) => (prev.some((x) => normSkill(x) === v) ? prev : [...prev, skillDraft.trim()]));
                  setSkillDraft('');
                  setPageIndex(0);
                }}
                placeholder="Add a skill, press Enter…"
                className="field-input min-w-[180px] flex-1"
              />
              {skills.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { setSkills([]); setSkillDraft(''); setPageIndex(0); }}
                >
                  Clear
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="section-label">Location</span>
              <select
                value={locationBucket}
                onChange={(e) => {
                  const v = e.target.value as any;
                  setLocationBucket(v);
                  // reset sub-filters when switching bucket
                  setUaeEmirates([]);
                  setKsaCities([]);
                  setPageIndex(0);
                }}
                className={selectClass}
              >
                <option value="All">All</option>
                <option value="UAE">UAE</option>
                <option value="KSA">KSA</option>
                <option value="Remote">Remote</option>
                <option value="Not specified">Not specified</option>
              </select>
            </div>
          </div>

          {locationBucket === 'UAE' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="section-label">Emirates</span>
              {UAE_EMIRATES.map((em) => {
                const checked = uaeEmirates.includes(em);
                return (
                  <label
                    key={em}
                    className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] ${
                      checked ? 'border-brand-300 bg-brand-50 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setUaeEmirates((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(em);
                          else next.delete(em);
                          return Array.from(next);
                        });
                        setPageIndex(0);
                      }}
                      className="accent-brand-600"
                    />
                    <span className="max-w-[200px] truncate">{em}</span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {locationBucket === 'KSA' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="section-label">Cities</span>
              {availableKsaCities.length === 0 ? (
                <span className="text-[13px] text-slate-500">No KSA cities found in jobs</span>
              ) : availableKsaCities.map((city) => {
                const checked = ksaCities.includes(city);
                return (
                  <label
                    key={city}
                    className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px] ${
                      checked ? 'border-brand-300 bg-brand-50 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setKsaCities((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(city);
                          else next.delete(city);
                          return Array.from(next);
                        });
                        setPageIndex(0);
                      }}
                      className="accent-brand-600"
                    />
                    <span className="max-w-[220px] truncate">{city}</span>
                  </label>
                );
              })}
            </div>
          ) : null}

          {!loading ? (
            <div className="text-[13px] text-slate-500">
              Showing <span className="font-medium text-slate-700">{pageJobs.length}</span> of{' '}
              <span className="font-medium text-slate-700">{filtered.length}</span>
            </div>
          ) : null}
        </div>

        {/* Cards */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="surface-panel h-[140px] animate-pulse" />
            ))}
          </div>
        ) : pageJobs.length === 0 ? (
          <div className="surface-panel flex flex-col items-center justify-center border-dashed px-6 py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
              <Briefcase className="h-5 w-5 text-slate-400" />
            </div>
            <div className="text-sm font-medium text-slate-900">No jobs found</div>
            <div className="mt-1 text-[13px] text-slate-500">Try a different keyword or filter.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pageJobs.map((job) => {
              const tokenOk = job.public_token && job.public_token !== 'unknown';
              return (
                <div
                  key={job.job_id}
                  className="surface-panel-hover group flex cursor-pointer flex-col p-5 transition-colors duration-200 hover:border-brand-300"
                  onClick={() => tokenOk && openJob(job)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (!tokenOk) return;
                    if (e.key === 'Enter' || e.key === ' ') openJob(job);
                  }}
                >
                  <h3 className="text-[15px] font-semibold text-slate-900 group-hover:text-brand-700">
                    {job.job_title || 'Open position'}
                  </h3>
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                    <MapPin className="h-4 w-4 text-slate-400" />
                    <span className="truncate">{job.job_location || '—'}</span>
                  </div>
                  <div className="mt-4 pt-4">
                    <a
                      href={tokenOk ? `/careers/jobs/${job.public_token}` : undefined}
                      onClick={(e) => {
                        if (!tokenOk) e.preventDefault();
                        e.stopPropagation();
                      }}
                      className={
                        tokenOk
                          ? 'inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:text-brand-700'
                          : 'inline-flex cursor-not-allowed items-center gap-1.5 text-[13px] font-medium text-slate-400'
                      }
                    >
                      <span>View &amp; apply</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > 0 ? (
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronLeft className="h-4 w-4" />}
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="px-2 text-[13px] text-slate-500">
              Page {pageIndex + 1} of {maxPageIndex + 1}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pageIndex >= maxPageIndex}
              onClick={() => setPageIndex((p) => Math.min(maxPageIndex, p + 1))}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
