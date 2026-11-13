'use client';
import React, { useEffect, useState } from 'react';
import { ArrowRight, MapPin, Search, Briefcase, AlertCircle, Clock, X } from '@/components/icons';
import { motion } from 'framer-motion';
import { rise, stagger } from '@/lib/motion';
import { Segmented } from '@/components/ui/segmented';
import { PublicBody, PublicFooter, PublicHeader } from '@/components/careers/PublicShell';
import { api } from '@/lib/api';
import { JobPostingListItem } from '@/lib/types';
import { OpeningCardsSkeleton } from '@/components/skeletons';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';

const PAGE_SIZE = 12;

type LocationBucket = 'UAE' | 'KSA' | 'Remote' | 'Not specified';

const UAE_EMIRATES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'] as const;

/** The words of a location that put a posting in an emirate or a Saudi city (the server looks for them in every posting). */
const AREA_WORDS: Record<string, string[]> = {
  Dubai: ['dubai', 'dxb'], 'Abu Dhabi': ['abu dhabi', 'abudhabi', 'auh', 'al ain'], Sharjah: ['sharjah'], Ajman: ['ajman'],
  'Ras Al Khaimah': ['ras al khaimah', 'rasalkhaimah', 'rak'], Fujairah: ['fujairah'], 'Umm Al Quwain': ['umm al quwain', 'ummalqaiwain', 'uaq'],
  Riyadh: ['riyadh'], Jeddah: ['jeddah'], Dammam: ['dammam'], 'Al Khobar': ['khobar', 'al khobar'], Makkah: ['mecca', 'makkah'],
  Madinah: ['medina', 'madinah'], Jubail: ['jubail'], Yanbu: ['yanbu'], Taif: ['taif'], Tabuk: ['tabuk'], Abha: ['abha'], Najran: ['najran'],
  Jizan: ['jizan', 'gizan'], Hail: ['hail'], Buraidah: ['buraidah', 'buraydah'],
};
const KSA_CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Al Khobar', 'Makkah', 'Madinah', 'Jubail', 'Yanbu', 'Taif', 'Tabuk', 'Abha', 'Najran', 'Jizan', 'Hail', 'Buraidah'];

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
      className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
        checked
          ? 'border-navy-800 bg-solid text-white shadow-sm'
          : 'border-slate-200/70 bg-paper/70 text-slate-600 shadow-sm backdrop-blur hover:border-navy-200 hover:text-navy-800'
      }`}
    >
      {children}
    </button>
  );
}

export default function PublicJobOpeningsPage() {
  const [jobs, setJobs] = useState<JobPostingListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [skillDraft, setSkillDraft] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [locationBucket, setLocationBucket] = useState<LocationBucket | 'All'>('All');
  const [uaeEmirates, setUaeEmirates] = useState<string[]>([]);
  const [ksaCities, setKsaCities] = useState<string[]>([]);

  const queryParams = (offset: number) => {
    const areaWords = (locationBucket === 'UAE' ? uaeEmirates : locationBucket === 'KSA' ? ksaCities : []).flatMap((a) => AREA_WORDS[a] ?? [a]);
    return { q: keyword, skills, region: locationBucket === 'All' ? undefined : locationBucket, areas: areaWords, limit: PAGE_SIZE, offset } as const;
  };

  useEffect(() => {
    let mounted = true;
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.searchOpenJobs(queryParams(0));
        if (!mounted) return;
        setJobs(res.jobs ?? []);
        setTotal(typeof res.total === 'number' ? res.total : (res.jobs ?? []).length);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load job openings');
      } finally {
        if (mounted) setLoading(false);
      }
    }, keyword.trim() ? 300 : 0);
    return () => {
      mounted = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, skills, locationBucket, uaeEmirates, ksaCities]);

  const loadMoreJobs = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.searchOpenJobs(queryParams(jobs.length));
      setJobs((prev) => [...prev, ...(res.jobs ?? [])]);
      setTotal(typeof res.total === 'number' ? res.total : total);
    } catch {
      /* strip stays; scroll retries */
    } finally {
      setLoadingMore(false);
    }
  };

  const availableKsaCities = KSA_CITIES;
  const pageJobs = jobs;

  const openJob = (job: JobPostingListItem) => {
    const token = job.public_token;
    if (!token || token === 'unknown') return;
    window.location.href = `/careers/jobs/${token}`;
  };

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-50 via-sky-50/40 to-[#EEF3FA]">
      <PublicHeader />

      <PublicBody>
        {/* Centered hero */}
        <section className="relative overflow-hidden border-b border-slate-200/70">
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-sky-300/25 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 bottom-0 h-72 w-72 rounded-full bg-navy-400/15 blur-3xl"
          />
          <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-12 text-center sm:px-6 sm:pb-12 sm:pt-16 lg:px-8">
            <motion.div variants={stagger(0.07, 0.05)} initial="hidden" animate="show" className="mx-auto flex flex-col items-center">
              <motion.p
                variants={rise}
                className="mb-4 inline-flex rounded-full border border-slate-200 bg-paper/90 px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.14em] text-navy-700 shadow-card"
              >
                Careers at AlphaData
              </motion.p>
              <motion.h1
                variants={rise}
                className="max-w-3xl text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-[42px]"
              >
                Find the role that fits your{' '}
                <span className="bg-gradient-to-r from-navy-700 to-sky-600 bg-clip-text text-transparent">next chapter</span>
              </motion.h1>
              <motion.p variants={rise} className="mx-auto mt-4 max-w-lg text-md leading-relaxed text-slate-500">
                Explore current opportunities across the UAE and Saudi Arabia, and apply in a few minutes.
              </motion.p>

              <motion.div variants={rise} className="relative mt-9 w-full max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Search by job title or location"
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-paper pl-12 pr-12 text-md text-ink shadow-[var(--shadow-md)] transition-[border-color,box-shadow] duration-150 placeholder:text-slate-400 hover:border-navy-300 focus:border-navy-500 focus:shadow-glow focus:outline-none"
                />
                {keyword ? (
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-ink"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </motion.div>

              {!loading ? (
                <motion.p variants={rise} className="mt-5 text-sm text-slate-500">
                  <span className="font-semibold tabular-nums text-navy-800">{total.toLocaleString()}</span>
                  {' '}open {total === 1 ? 'role' : 'roles'}
                </motion.p>
              ) : null}
            </motion.div>
          </div>
        </section>

        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          {error ? (
            <div className="mx-auto mb-6 flex max-w-xl items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-50 p-4 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Centered filters */}
          <div className="mb-10 flex flex-col items-center gap-4 text-center">
            <Segmented
              value={locationBucket}
              onChange={(v) => {
                setLocationBucket(v as LocationBucket | 'All');
                setUaeEmirates([]);
                setKsaCities([]);
              }}
              items={[
                { value: 'All', label: 'All' },
                { value: 'UAE', label: 'UAE' },
                { value: 'KSA', label: 'Saudi Arabia' },
                { value: 'Remote', label: 'Remote' },
              ]}
            />

            {locationBucket === 'UAE' ? (
              <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2">
                {UAE_EMIRATES.map((em) => (
                  <FilterChip key={em} checked={uaeEmirates.includes(em)} onToggle={() => toggle(uaeEmirates, setUaeEmirates, em)}>
                    {em}
                  </FilterChip>
                ))}
              </div>
            ) : null}

            {locationBucket === 'KSA' ? (
              <div className="flex max-w-2xl flex-wrap items-center justify-center gap-2">
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

            <div className="flex w-full max-w-xl flex-wrap items-center justify-center gap-2">
              {skills.map((sk) => (
                <span key={sk} className="inline-flex items-center gap-1.5 rounded-full border border-navy-800 bg-solid px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
                  {sk}
                  <button
                    type="button"
                    onClick={() => setSkills((prev) => prev.filter((x) => x !== sk))}
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
                }}
                placeholder="Add a skill · Enter"
                className="h-9 w-full min-w-0 max-w-xs flex-1 rounded-full border border-slate-200 bg-paper px-4 text-center text-xs shadow-sm placeholder:text-slate-400 hover:border-navy-300 focus:border-navy-500 focus:outline-none sm:w-auto sm:min-w-[180px]"
              />
              {skills.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setSkills([]);
                    setSkillDraft('');
                  }}
                  className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-ink hover:underline"
                >
                  Clear skills
                </button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <OpeningCardsSkeleton />
          ) : pageJobs.length === 0 ? (
            <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-3xl border border-dashed border-navy-200/80 bg-paper/70 px-6 py-16 text-center shadow-[var(--shadow-card)] backdrop-blur">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-inset ring-navy-100">
                <Briefcase className="h-5 w-5 text-navy-700" />
              </div>
              <div className="text-lg font-semibold text-ink">No roles match your search</div>
              <div className="mt-1.5 text-sm text-slate-500">Try a different keyword or clear a filter.</div>
            </div>
          ) : (
            <motion.div
              key={`${locationBucket}-${keyword}-${skills.join('|')}`}
              variants={stagger(0.04, 0)}
              initial="hidden"
              animate="show"
              className="mx-auto grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {pageJobs.map((job) => {
                const tokenOk = job.public_token && job.public_token !== 'unknown';
                const posted = postedAgo(job.upload_date);
                return (
                  <motion.div
                    key={job.job_id}
                    variants={rise}
                    whileHover={tokenOk ? { y: -4 } : undefined}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className={`group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-paper p-5 text-left shadow-card transition-[border-color,box-shadow,transform] duration-200 ${
                      tokenOk ? 'cursor-pointer hover:border-navy-300 hover:shadow-md' : ''
                    }`}
                    onClick={() => tokenOk && openJob(job)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!tokenOk) return;
                      if (e.key === 'Enter' || e.key === ' ') openJob(job);
                    }}
                  >
                    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-br from-navy-50 via-sky-50/50 to-transparent" />
                    <h3 className="relative text-lg font-semibold leading-snug tracking-[-0.015em] text-navy-900">
                      {job.job_title || 'Open position'}
                    </h3>
                    <div className="relative mt-4 space-y-2 text-sm text-slate-500">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 shrink-0 text-sky-500" />
                        <span className="truncate">{job.job_location || 'Location to be confirmed'}</span>
                      </div>
                      {posted ? (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                          <span>{posted}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="relative mt-auto flex items-center justify-between border-t border-slate-100 pt-4 mt-6">
                      <span className={`text-sm font-semibold ${tokenOk ? 'text-navy-800' : 'text-slate-400'}`}>
                        View and apply
                      </span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-50 text-navy-700 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:bg-solid group-hover:text-white">
                        <ArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          <InfiniteScrollSentinel hasMore={!loading && jobs.length < total} loading={loadingMore} itemCount={jobs.length} onLoadMore={loadMoreJobs} />
        </div>
      </PublicBody>

      <PublicFooter />
    </div>
  );
}
