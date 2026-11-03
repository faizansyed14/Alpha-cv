'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Search, Briefcase, AlertCircle, Clock, X } from '@/components/icons';
import { motion } from 'framer-motion';
import { rise, stagger } from '@/lib/motion';
import { Segmented } from '@/components/ui/segmented';
import { PublicBody, PublicFooter, PublicHeader } from '@/components/careers/PublicShell';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { OpeningCardsSkeleton } from '@/components/skeletons';

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

function postedAgo(iso?: string) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days <= 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  if (days < 30) return `Posted ${days} days ago`;
  return `Posted ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function FilterChip({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ${
        checked ? 'border-navy-700 bg-navy-700 text-white' : 'border-surface-strong bg-paper text-slate-600 hover:border-slate-400 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

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

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
    setPageIndex(0);
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)]">
      <PublicHeader />

      <PublicBody>
        {/* Hero */}
        <section className="border-b border-surface-border bg-gradient-to-b from-navy-50 via-white to-white">
          <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
            <motion.div variants={stagger(0.07, 0.05)} initial="hidden" animate="show" className="max-w-3xl">
              <motion.p variants={rise} className="mb-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-navy-700 shadow-soft ring-1 ring-inset ring-navy-100">
                Careers at AlphaData
              </motion.p>
              <motion.h1 variants={rise} className="font-display text-4xl leading-[1.08] text-slate-900 sm:text-5xl">
                Find the role that fits your <span className="text-navy-600">next chapter</span>
              </motion.h1>
              <motion.p variants={rise} className="mt-5 max-w-xl text-md text-slate-500">
                Explore current opportunities across the UAE and Saudi Arabia, and apply in a few minutes.
              </motion.p>

              <motion.div variants={rise} className="relative mt-8 max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value);
                    setPageIndex(0);
                  }}
                  placeholder="Search by job title or location"
                  className="h-12 w-full rounded-xl border border-surface-strong bg-paper pl-11 pr-11 text-md text-ink shadow-card transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-navy-500 focus:shadow-glow focus:outline-none"
                />
                {keyword ? (
                  <button
                    type="button"
                    onClick={() => {
                      setKeyword('');
                      setPageIndex(0);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </motion.div>
            </motion.div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {error ? (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/25 bg-danger-50 p-3.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Filters */}
          <div className="mb-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                value={locationBucket}
                onChange={(v) => {
                  setLocationBucket(v as LocationBucket | 'All');
                  setUaeEmirates([]);
                  setKsaCities([]);
                  setPageIndex(0);
                }}
                items={[
                  { value: 'All', label: 'All' },
                  { value: 'UAE', label: 'UAE' },
                  { value: 'KSA', label: 'Saudi Arabia' },
                  { value: 'Remote', label: 'Remote' },
                ]}
              />
              {!loading ? (
                <p className="text-sm text-slate-500">
                  <span className="font-semibold tabular text-ink">{filtered.length}</span> open {filtered.length === 1 ? 'role' : 'roles'}
                </p>
              ) : null}
            </div>

            {locationBucket === 'UAE' ? (
              <div className="flex flex-wrap items-center gap-2">
                {UAE_EMIRATES.map((em) => (
                  <FilterChip key={em} checked={uaeEmirates.includes(em)} onToggle={() => toggle(uaeEmirates, setUaeEmirates, em)}>
                    {em}
                  </FilterChip>
                ))}
              </div>
            ) : null}

            {locationBucket === 'KSA' ? (
              <div className="flex flex-wrap items-center gap-2">
                {availableKsaCities.length === 0 ? (
                  <span className="text-sm text-slate-500">No cities found in the current openings</span>
                ) : (
                  availableKsaCities.map((city) => (
                    <FilterChip key={city} checked={ksaCities.includes(city)} onToggle={() => toggle(ksaCities, setKsaCities, city)}>
                      {city}
                    </FilterChip>
                  ))
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Skills</span>
              {skills.map((sk) => (
                <span key={sk} className="inline-flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-700 px-3 py-1 text-xs font-medium text-white">
                  {sk}
                  <button
                    type="button"
                    onClick={() => {
                      setSkills((prev) => prev.filter((x) => x !== sk));
                      setPageIndex(0);
                    }}
                    className="text-white/70 transition-colors hover:text-white"
                    aria-label={`Remove skill ${sk}`}
                  >
                    <X className="h-3 w-3" />
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
                placeholder="Add a skill and press Enter"
                className="field-input h-8 min-w-[200px] max-w-xs flex-1 rounded-full px-3.5 text-xs"
              />
              {skills.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSkills([]);
                    setSkillDraft('');
                    setPageIndex(0);
                  }}
                  className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-ink hover:underline"
                >
                  Clear all
                </button>
              ) : null}
            </div>
          </div>

          {/* Cards */}
          {loading ? (
            <OpeningCardsSkeleton />
          ) : pageJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-strong bg-paper px-6 py-16 text-center">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 ring-1 ring-inset ring-surface-border">
                <Briefcase className="h-5 w-5 text-slate-500" />
              </div>
              <div className="text-md font-semibold text-ink">No roles match your search</div>
              <div className="mt-1.5 text-sm text-slate-500">Try a different keyword or clear a filter.</div>
            </div>
          ) : (
            <motion.div
              key={`${pageIndex}-${locationBucket}-${keyword}-${skills.join('|')}`}
              variants={stagger(0.04, 0)}
              initial="hidden"
              animate="show"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {pageJobs.map((job) => {
                const tokenOk = job.public_token && job.public_token !== 'unknown';
                const posted = postedAgo(job.upload_date);
                return (
                  <motion.div
                    key={job.job_id}
                    variants={rise}
                    whileHover={tokenOk ? { y: -3 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className={`group flex flex-col rounded-2xl border border-surface-border bg-paper p-6 shadow-card transition-[border-color,box-shadow] duration-200 ${
                      tokenOk ? 'cursor-pointer hover:border-surface-strong hover:shadow-md' : ''
                    }`}
                    onClick={() => tokenOk && openJob(job)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!tokenOk) return;
                      if (e.key === 'Enter' || e.key === ' ') openJob(job);
                    }}
                  >
                    <h3 className="text-lg font-semibold leading-snug text-navy-800">{job.job_title || 'Open position'}</h3>
                    <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="truncate">{job.job_location || 'Location to be confirmed'}</span>
                      </div>
                      {posted ? (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                          <span>{posted}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-6 flex items-center justify-between border-t border-surface-border pt-4">
                      <span className={`text-sm font-medium ${tokenOk ? 'text-ink' : 'text-slate-400'}`}>View and apply</span>
                      <ArrowRight className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-ink" />
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          {/* Pagination */}
          {!loading && filtered.length > PAGE_SIZE ? (
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronLeft className="h-4 w-4" />}
                disabled={pageIndex <= 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="px-2 text-sm tabular text-slate-500">
                Page {pageIndex + 1} of {maxPageIndex + 1}
              </span>
              <Button variant="secondary" size="sm" disabled={pageIndex >= maxPageIndex} onClick={() => setPageIndex((p) => Math.min(maxPageIndex, p + 1))}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </PublicBody>

      <PublicFooter />
    </div>
  );
}
