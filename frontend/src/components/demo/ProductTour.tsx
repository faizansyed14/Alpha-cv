'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Users,
  Briefcase,
  Target,
  ArrowRight,
  Sparkles,
  Plus,
  Calendar,
  MapPin,
  Building2,
  Mail,
  Phone,
  FileText,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Eye,
  Wand2,
  Edit3,
  Copy,
  Check,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page';
import { Avatar } from '@/components/ui/avatar';
import CandidateCard from '@/components/database/CandidateCard';
import JobRow, { type JobHandlers } from '@/components/careers/JobRow';
import MatchingFullPageAnimation from '@/components/results/MatchingFullPageAnimation';
import { MonthBars, SplitBar, Sparkline, TrendChart } from '@/components/dashboard/charts';
import { cn } from '@/lib/utils';
import { duration, ease } from '@/lib/motion';
import TourShell from './TourShell';
import TourCursor, { tourTargetClass } from './TourCursor';
import {
  DEMO_APP_DAYS,
  DEMO_APP_SERIES,
  DEMO_APPLICANTS,
  DEMO_CATEGORIES,
  DEMO_CVS,
  DEMO_JD_OPTIONS,
  DEMO_JOB,
  DEMO_LLM,
  DEMO_MONTHS,
  DEMO_PROFILE,
  demoDisplay,
  type TourScene,
} from './fakeData';

const noop = () => undefined;
const tourJobHandlers: JobHandlers = {
  onOpen: noop,
  onMatch: noop,
  onAi: noop,
  onToggleStatus: noop,
  onDelete: noop,
  onCopy: noop,
};
const asyncNoop = async () => undefined;

function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card', className)}>
      <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      <div className="flex-1 px-5 pb-5">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-surface-border bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-100">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-4 w-4 text-slate-300" />
      </div>
      <div className="mt-4">
        <p className="text-[12.5px] font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-slate-900">{value}</p>
        <p className="mt-2 text-[12px] text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

function FactTile({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-2xl border border-surface-border bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-2 text-[14px] font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Caption({ title, sub }: { title: string; sub?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: duration.base, ease }}
      className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4"
    >
      <div className="max-w-xl rounded-2xl border border-surface-border bg-white px-5 py-3 text-center shadow-lg">
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-slate-900">{title}</p>
        {sub ? <p className="mt-0.5 text-[12px] text-slate-500">{sub}</p> : null}
      </div>
    </motion.div>
  );
}

const SCRIPT: {
  scene: TourScene;
  nav: string;
  ms: number;
  title: string;
  sub?: string;
  hideSidebar?: boolean;
  /** data-tour ids the mouse visits (move then click) before / during this scene */
  targets?: string[];
}[] = [
  {
    scene: 'dashboard',
    nav: 'dashboard',
    ms: 2800,
    title: 'Dashboard',
    sub: 'Open Candidates from the talent pool card',
    targets: ['btn-open-candidates'],
  },
  {
    scene: 'candidates',
    nav: 'candidates',
    ms: 5600,
    title: 'Candidates by category',
    sub: 'Select Design, then open details with the eye',
    targets: ['filter-cat-design', 'btn-candidate-eye'],
  },
  {
    scene: 'profile',
    nav: 'candidates',
    ms: 4800,
    title: 'Candidate profile',
    sub: 'Scroll the profile, then open the full CV',
    targets: ['btn-view-cv'],
  },
  {
    scene: 'cv',
    nav: 'candidates',
    ms: 4200,
    title: 'Original CV',
    sub: 'Scroll the PDF, then open Match',
    targets: ['btn-open-match'],
  },
  {
    scene: 'matchSetup',
    nav: 'match',
    ms: 5600,
    title: 'Match from database',
    sub: 'Select JD, Design category, then run match',
    targets: ['match-jd', 'match-cat', 'btn-run-match'],
  },
  {
    scene: 'matching',
    nav: 'match',
    ms: 4200,
    title: 'Matching talent pool',
    sub: 'AI ranks database CVs against the JD',
  },
  {
    scene: 'results',
    nav: 'match',
    ms: 4200,
    title: 'Full match results',
    sub: 'Strengths, gaps, and fit summary',
  },
  {
    scene: 'jdUpload',
    nav: 'careers',
    ms: 5600,
    title: 'Careers: post a job',
    sub: 'Click Post a job, then upload the JD',
    targets: ['btn-post-job', 'zone-upload-jd'],
  },
  {
    scene: 'jdLlm',
    nav: 'careers',
    ms: 3600,
    title: 'LLM extracts job details',
    sub: 'Title, location, responsibilities, and requirements',
  },
  {
    scene: 'jdEdit',
    nav: 'careers',
    ms: 3600,
    title: 'Edit and publish',
    sub: 'Confirm AI fields, then go live',
    targets: ['btn-publish'],
  },
  {
    scene: 'jobLive',
    nav: 'careers',
    ms: 3600,
    title: 'Job live + boolean search',
    sub: 'Open the public candidate page',
    targets: ['btn-open-public'],
  },
  {
    scene: 'publicJob',
    nav: 'careers',
    ms: 3600,
    title: 'Public job page',
    sub: 'Candidate clicks Apply now',
    hideSidebar: true,
    targets: ['btn-apply-now'],
  },
  {
    scene: 'applyUpload',
    nav: 'careers',
    ms: 3200,
    title: 'Apply: upload CV',
    sub: 'Upload CV to start autofill',
    hideSidebar: true,
    targets: ['zone-upload-cv'],
  },
  {
    scene: 'applyFill',
    nav: 'careers',
    ms: 4800,
    title: 'AI fills the form',
    sub: 'Name, experience, salary, and location extracted',
    hideSidebar: true,
  },
  {
    scene: 'applySubmit',
    nav: 'careers',
    ms: 2800,
    title: 'Submit application',
    sub: 'Send the filled application',
    hideSidebar: true,
    targets: ['btn-submit-apply'],
  },
  {
    scene: 'applicants',
    nav: 'careers',
    ms: 3800,
    title: 'Received applicants',
    sub: 'Application appears in the recruiter list',
  },
  { scene: 'outro', nav: 'dashboard', ms: 2400, title: 'Hire faster. Rank smarter.', sub: 'Alpha Data Recruitment' },
];

const APPLY_FIELDS = [
  ['Full name', 'Nora Rahman'],
  ['Email', 'nora.demo@example.com'],
  ['Phone', '+971 50 000 0000'],
  ['Expected salary (AED)', '22000'],
  ['Years of experience', '6'],
  ['Location', 'Dubai'],
  ['Notice period', '30 days'],
  ['Nationality', 'UAE'],
] as const;

export default function ProductTour({ embedded = false }: { embedded?: boolean }) {
  const [step, setStep] = useState(0);
  const [matchPct, setMatchPct] = useState(0);
  const [matchPhase, setMatchPhase] = useState<'initializing' | 'batches' | 'llm_verification' | 'finalizing'>('initializing');
  const [llmFill, setLlmFill] = useState(0);
  const [applyFill, setApplyFill] = useState(0);
  const [matchJdOpen, setMatchJdOpen] = useState(false);
  const [designCatChecked, setDesignCatChecked] = useState(false);
  const [matchCatChecked, setMatchCatChecked] = useState(false);
  const profileScrollRef = useRef<HTMLDivElement>(null);
  const cvScrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const current = SCRIPT[step];
  const hasTargets = (current.targets?.length ?? 0) > 0;

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current != null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  const advance = useCallback(() => {
    clearAdvanceTimer();
    setStep((s) => (s + 1) % SCRIPT.length);
  }, [clearAdvanceTimer]);

  const scheduleAdvance = useCallback(
    (ms: number) => {
      clearAdvanceTimer();
      advanceTimerRef.current = window.setTimeout(advance, ms);
    },
    [advance, clearAdvanceTimer],
  );

  /** Scenes with clicks: jump next right after last click. */
  const onCursorComplete = useCallback(() => {
    scheduleAdvance(380);
  }, [scheduleAdvance]);

  const onTargetClick = useCallback((id: string) => {
    if (id === 'filter-cat-design') setDesignCatChecked(true);
    if (id === 'match-cat') setMatchCatChecked(true);
    if (id === 'match-jd') setMatchJdOpen(true);
  }, []);

  useEffect(() => {
    if (current.scene !== 'candidates') setDesignCatChecked(false);
    if (current.scene !== 'matchSetup') {
      setMatchCatChecked(false);
      setMatchJdOpen(false);
    }
  }, [current.scene, step]);

  useEffect(() => {
    if (hasTargets) {
      // Safety only if a target node is missing / click chain stalls
      scheduleAdvance(current.ms + 3500);
      return () => clearAdvanceTimer();
    }
    scheduleAdvance(current.ms);
    return () => clearAdvanceTimer();
  }, [step, current.ms, hasTargets, scheduleAdvance, clearAdvanceTimer]);

  useEffect(() => {
    if (current.scene !== 'matching') {
      setMatchPct(0);
      setMatchPhase('initializing');
      return;
    }
    let p = 0;
    const id = window.setInterval(() => {
      p = Math.min(100, p + 4);
      setMatchPct(p);
      if (p < 25) setMatchPhase('initializing');
      else if (p < 70) setMatchPhase('batches');
      else if (p < 90) setMatchPhase('llm_verification');
      else setMatchPhase('finalizing');
      if (p >= 100) window.clearInterval(id);
    }, 110);
    return () => window.clearInterval(id);
  }, [current.scene, step]);

  useEffect(() => {
    if (current.scene !== 'jdLlm') {
      setLlmFill(0);
      return;
    }
    setLlmFill(0);
    const id = window.setInterval(() => setLlmFill((n) => Math.min(4, n + 1)), 700);
    return () => window.clearInterval(id);
  }, [current.scene, step]);

  useEffect(() => {
    if (current.scene === 'applySubmit') {
      setApplyFill(APPLY_FIELDS.length);
      return;
    }
    if (current.scene !== 'applyFill') {
      setApplyFill(0);
      return;
    }
    setApplyFill(0);
    const id = window.setInterval(() => setApplyFill((n) => Math.min(APPLY_FIELDS.length, n + 1)), 520);
    return () => window.clearInterval(id);
  }, [current.scene, step]);

  useEffect(() => {
    if (current.scene !== 'profile') return;
    const el = profileScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const t1 = window.setTimeout(() => el.scrollTo({ top: Math.min(el.scrollHeight, 420), behavior: 'smooth' }), 700);
    const t2 = window.setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }), 2200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [current.scene, step]);

  useEffect(() => {
    if (current.scene !== 'cv') return;
    const el = cvScrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const t1 = window.setTimeout(() => el.scrollTo({ top: 220, behavior: 'smooth' }), 600);
    const t2 = window.setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }), 2000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [current.scene, step]);

  const p = DEMO_PROFILE;

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative overflow-hidden bg-white select-none pointer-events-none',
        embedded ? 'h-full min-h-0' : 'h-full min-h-[100dvh]',
      )}
      onWheel={(e) => e.preventDefault()}
      onTouchMove={(e) => e.preventDefault()}
    >
      <TourCursor
        rootRef={rootRef}
        targets={current.targets}
        stepKey={`${step}-${current.scene}`}
        onComplete={hasTargets ? onCursorComplete : undefined}
        onTargetClick={onTargetClick}
        lockPageScroll
      />

      <div className="absolute left-4 top-4 z-40 flex items-center gap-2 rounded-full border border-surface-border bg-white/95 px-2.5 py-1.5 shadow-sm">
        <img src="/alphadatalogo.svg" alt="" className="h-5 w-5 object-contain" />
        <span className="pr-1 text-[13px] font-semibold tracking-[-0.02em] text-slate-900">
          Alpha<span className="text-navy-700">CV</span>
        </span>
      </div>

      <AnimatePresence mode="wait">
        {current.scene === 'outro' && (
          <motion.div
            key="outro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-white px-6 text-center"
          >
            <div>
              <p className="inline-flex rounded-full border border-surface-border bg-slate-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                Product tour
              </p>
              <h1 className="mt-4 text-[34px] font-bold tracking-[-0.04em] text-slate-900 sm:text-[40px]">
                Hire faster. Rank smarter.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] text-slate-500">
                Dashboard, Candidates, Match, Careers, and AI ranking in one workspace.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn('absolute inset-0 bg-white', current.scene === 'outro' && 'opacity-0 pointer-events-none')}>
        <TourShell activeId={current.nav} hideSidebar={!!current.hideSidebar}>
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.scene}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease }}
              >
                {current.scene === 'dashboard' && (
                  <div className="space-y-5">
                    <section className="relative overflow-hidden rounded-3xl border border-surface-border bg-white px-6 py-7 shadow-card sm:px-9 sm:py-9">
                      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                          <p className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-navy-600">
                            <Calendar className="h-3.5 w-3.5" /> Monday, 9 November
                          </p>
                          <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-[-0.03em] text-slate-900 sm:text-[34px]">
                            Good morning, John
                          </h1>
                          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-slate-500">
                            12 live jobs · 48 new applications in the last 7 days
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-navy-900 px-4 text-[13px] font-semibold text-white">
                            <Plus className="h-4 w-4" /> Post a job
                          </span>
                          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-white px-4 text-[13px] font-semibold text-slate-700">
                            <Upload className="h-4 w-4" /> Upload CVs
                          </span>
                          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-white px-4 text-[13px] font-semibold text-slate-700">
                            <Target className="h-4 w-4" /> New match
                          </span>
                        </div>
                      </div>
                    </section>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div
                        data-tour="btn-open-candidates"
                        data-tour-label="Open Candidates"
                        className={cn('rounded-2xl', tourTargetClass)}
                      >
                        <Kpi label="Candidates" value="1,284" hint="In the talent pool" icon={Users} />
                      </div>
                      <Kpi label="Job descriptions" value="46" hint="Roles ready to match" icon={Briefcase} />
                      <Kpi label="Live jobs" value="12" hint="18 posted · 6 closed" icon={Sparkles} />
                      <div className="flex min-w-0 flex-col justify-between overflow-hidden rounded-2xl border border-surface-border bg-white p-5 shadow-card">
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-800 ring-1 ring-inset ring-navy-100">
                            <Target className="h-5 w-5" />
                          </span>
                          <Sparkline values={DEMO_APP_SERIES} />
                        </div>
                        <div className="mt-4">
                          <p className="text-[12.5px] font-medium text-slate-500">Applications</p>
                          <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-slate-900">326</p>
                          <p className="mt-2 text-[12px] text-slate-500">48 in the last 7 days</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-3">
                      <Panel
                        title="Applications received"
                        subtitle="Per day, last 14 days"
                        className="lg:col-span-2"
                        action={
                          <div className="text-right">
                            <p className="text-[22px] font-semibold leading-none tabular-nums text-slate-900">
                              {DEMO_APP_SERIES.reduce((a, b) => a + b, 0)}
                            </p>
                            <p className="mt-1 text-[11.5px] text-slate-500">in 14 days</p>
                          </div>
                        }
                      >
                        <TrendChart values={DEMO_APP_SERIES} days={DEMO_APP_DAYS} />
                      </Panel>
                      <Panel title="Jobs posted" subtitle="Per month, last 6 months">
                        <MonthBars months={DEMO_MONTHS} />
                        <div className="mt-5 border-t border-surface-border pt-4">
                          <SplitBar
                            parts={[
                              { label: 'Live', value: 12, className: 'bg-navy-700' },
                              { label: 'Closed', value: 6, className: 'bg-slate-300' },
                            ]}
                          />
                        </div>
                      </Panel>
                    </div>
                  </div>
                )}

                {current.scene === 'candidates' && (
                  <div className="space-y-5">
                    <PageHeader
                      markSrc="/icons/candidates.jpg"
                      title="Candidates"
                      description="1,284 profiles · pick a category"
                      actions={<Button variant="secondary" size="sm">Advanced search</Button>}
                    />
                    <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start">
                      <aside className="w-full shrink-0 sm:w-60">
                        <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                          <div className="border-b border-surface-border px-4 py-3 text-[13px] font-semibold text-slate-900">Filters</div>
                          <div className="px-4 py-3">
                            <p className="mb-2 text-[13px] font-semibold text-slate-800">Category</p>
                            <div className="space-y-1">
                              {DEMO_CATEGORIES.map((opt) => {
                                const checked = opt.value === 'Design' && designCatChecked;
                                return (
                                  <label
                                    key={opt.value}
                                    data-tour={opt.value === 'Design' ? 'filter-cat-design' : undefined}
                                    data-tour-label={opt.value === 'Design' ? 'Design category' : undefined}
                                    className={cn(
                                      'flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-[13px] text-slate-700 transition-colors',
                                      tourTargetClass,
                                      checked && 'bg-blue-50',
                                    )}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span
                                        className={cn(
                                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                                          checked
                                            ? 'border-blue-600 bg-blue-600 text-white'
                                            : 'border-slate-300 bg-white',
                                        )}
                                      >
                                        {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                                      </span>
                                      <span className={cn('truncate', checked && 'font-semibold text-blue-800')}>{opt.label}</span>
                                    </span>
                                    <span className="rounded bg-slate-100 px-1.5 text-[11px] font-medium tabular-nums text-slate-500">{opt.count}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </aside>
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <p className="text-[12px] font-medium text-slate-500">
                          {designCatChecked ? 'Design · 186 candidates' : 'All categories · 1,284 candidates'}
                        </p>
                        {DEMO_CVS.map((c, i) => (
                          <div key={c.id} className={cn('relative', i === 0 && 'ring-2 ring-navy-400 rounded-2xl')}>
                            <CandidateCard
                              cv={c}
                              display={demoDisplay(c)}
                              index={i + 1}
                              selected={i === 0}
                              onToggleSelect={noop}
                              onOpenDetails={noop}
                              onPreview={noop}
                              onDelete={noop}
                              onSaveNote={asyncNoop}
                              onDeleteNote={asyncNoop}
                              detailsTourId={i === 0 ? 'btn-candidate-eye' : undefined}
                              detailsTourLabel={i === 0 ? 'Open details' : undefined}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {current.scene === 'profile' && (
                  <div ref={profileScrollRef} className="mx-auto max-h-[calc(100dvh-3rem)] w-full max-w-5xl space-y-6 overflow-y-auto overscroll-none pb-8 pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft />}>Candidates</Button>
                      <span className="text-[12px] text-slate-300">/</span>
                      <span className="truncate text-[13px] font-medium text-slate-600">{p.name}</span>
                    </div>
                    <header className="relative overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-br from-navy-50 via-sky-50/60 to-white" />
                      <div className="relative flex items-start gap-3.5 px-4 py-3.5 sm:px-5 sm:py-4">
                        <Avatar name={p.name} size="md" className="ring-2 ring-white shadow-sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-700">{p.category}</p>
                          <h1 className="mt-0.5 text-[18px] font-bold tracking-[-0.02em] text-slate-900 sm:text-[20px]">{p.name}</h1>
                          <p className="mt-0.5 text-[13px] text-slate-600">{p.title}</p>
                          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                            <FileText className="h-3 w-3" /> {p.filename}
                          </p>
                        </div>
                      </div>
                    </header>

                    <section className="space-y-3">
                      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500">Contact</h2>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-center gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-card">
                          <Mail className="h-4 w-4 text-navy-600" />
                          <div>
                            <p className="text-[11px] text-slate-400">Email</p>
                            <p className="text-[13px] font-medium text-slate-800">{p.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-card">
                          <Phone className="h-4 w-4 text-navy-600" />
                          <div>
                            <p className="text-[11px] text-slate-400">Phone</p>
                            <p className="text-[13px] font-medium text-slate-800">{p.phone}</p>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-slate-500">Profile</h2>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <FactTile icon={Briefcase} label="Experience" value={`${p.years} years`} />
                        <FactTile icon={MapPin} label="Location" value={p.location} />
                        <FactTile icon={Building2} label="Nationality" value={p.nationality} />
                        <FactTile icon={Users} label="Languages" value={p.languages.join(', ')} />
                        <FactTile icon={Sparkles} label="Expected salary" value={p.salary} />
                        <FactTile icon={FileText} label="Gender" value={p.gender} />
                      </div>
                    </section>

                    <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
                      <h2 className="text-[16px] font-semibold text-slate-900">Skills</h2>
                      <ol className="mt-3 space-y-2">
                        {p.skills.map((s, i) => (
                          <li key={s} className="flex gap-3 text-[13.5px] text-slate-700">
                            <span className="w-5 shrink-0 text-[12px] font-semibold text-slate-400">{i + 1}.</span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    </section>
                    <section className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
                      <h2 className="text-[16px] font-semibold text-slate-900">Responsibilities</h2>
                      <ol className="mt-3 space-y-2">
                        {p.responsibilities.map((s, i) => (
                          <li key={s} className="flex gap-3 text-[13.5px] text-slate-700">
                            <span className="w-5 shrink-0 text-[12px] font-semibold text-slate-400">{i + 1}.</span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    </section>
                    <div className="flex justify-end">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<FileText />}
                        data-tour="btn-view-cv"
                        data-tour-label="View full CV"
                        className={tourTargetClass}
                      >
                        View full CV
                      </Button>
                    </div>
                  </div>
                )}

                {current.scene === 'cv' && (
                  <div className="mx-auto w-full max-w-5xl space-y-4 pb-8">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft />}>Profile</Button>
                      <span className="text-[12px] text-slate-300">/</span>
                      <span className="text-[13px] font-medium text-slate-600">Original CV</span>
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
                        <div className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                          <FileText className="h-4 w-4 text-navy-600" />
                          {p.filename}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                            <Eye className="h-3.5 w-3.5" /> Full CV view
                          </span>
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<Target />}
                            data-tour="btn-open-match"
                            data-tour-label="Open Match"
                            className={tourTargetClass}
                          >
                            Match
                          </Button>
                        </div>
                      </div>
                      <div ref={cvScrollRef} className="max-h-[70vh] overflow-y-auto overscroll-none bg-slate-200/70 px-4 py-6 [scrollbar-width:none] sm:px-8 sm:py-8 [&::-webkit-scrollbar]:hidden">
                        <article className="mx-auto max-w-[720px] overflow-hidden rounded-xl bg-white shadow-[0_12px_40px_-12px_rgba(15,23,42,0.35)] ring-1 ring-slate-900/5">
                          {/* Colorful header */}
                          <div className="relative overflow-hidden bg-gradient-to-br from-teal-600 via-cyan-600 to-sky-700 px-6 py-7 text-white sm:px-8 sm:py-8">
                            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
                            <div aria-hidden className="pointer-events-none absolute -bottom-16 left-20 h-44 w-44 rounded-full bg-amber-300/20 blur-2xl" />
                            <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                              <img
                                src="/demo/nora-rahman-portrait.jpg"
                                alt="Nora Rahman"
                                className="h-28 w-28 shrink-0 rounded-2xl object-cover shadow-lg ring-4 ring-white/40 sm:h-32 sm:w-32"
                              />
                              <div className="min-w-0 text-center sm:text-left">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-100">Curriculum Vitae</p>
                                <h2 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">{p.name}</h2>
                                <p className="mt-1 text-[15px] font-medium text-cyan-50">{p.title}</p>
                                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-teal-50/95 sm:justify-start">
                                  <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {p.location}, UAE</span>
                                  <span className="opacity-50">·</span>
                                  <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {p.email}</span>
                                  <span className="opacity-50">·</span>
                                  <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {p.phone}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
                            {/* Sidebar */}
                            <aside className="space-y-5 bg-slate-50 px-5 py-6 sm:px-6">
                              <div>
                                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Profile</h3>
                                <dl className="mt-3 space-y-2.5 text-[12.5px]">
                                  <div>
                                    <dt className="text-slate-400">Experience</dt>
                                    <dd className="font-semibold text-slate-800">{p.years} years</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-400">Nationality</dt>
                                    <dd className="font-semibold text-slate-800">{p.nationality}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-400">Languages</dt>
                                    <dd className="font-semibold text-slate-800">{p.languages.join(', ')}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-slate-400">Expected salary</dt>
                                    <dd className="font-semibold text-emerald-700">{p.salary}</dd>
                                  </div>
                                </dl>
                              </div>
                              <div>
                                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Skills</h3>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                  {p.keywords.map((kw) => (
                                    <span
                                      key={kw}
                                      className="rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm"
                                    >
                                      {kw}
                                    </span>
                                  ))}
                                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">Workshops</span>
                                </div>
                              </div>
                              <div>
                                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700">Certification</h3>
                                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-900">
                                  Google UX Certificate
                                </p>
                              </div>
                            </aside>

                            {/* Main column */}
                            <div className="space-y-6 px-5 py-6 sm:px-7">
                              <section>
                                <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-sky-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Summary
                                </h3>
                                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-700">
                                  Product designer with {p.years} years building digital products for enterprise and consumer teams.
                                  Strong in research, systems, and facilitation across web and mobile.
                                </p>
                              </section>

                              <section>
                                <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-sky-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Experience
                                </h3>
                                <div className="mt-3 space-y-4">
                                  <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-sky-50/40 p-3.5">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                      <p className="text-[14px] font-bold text-slate-900">Senior Product Designer</p>
                                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-800">2022 – Present</span>
                                    </div>
                                    <p className="mt-0.5 text-[12px] font-medium text-teal-700">Northwind Labs · Dubai</p>
                                    <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-slate-600">
                                      <li>• Led onboarding redesign that lifted activation by 18%</li>
                                      <li>• Owned the design system used across web and mobile</li>
                                    </ul>
                                  </div>
                                  <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-white to-amber-50/50 p-3.5">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                      <p className="text-[14px] font-bold text-slate-900">Product Designer</p>
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">2019 – 2022</span>
                                    </div>
                                    <p className="mt-0.5 text-[12px] font-medium text-amber-800">Cedar Soft · Abu Dhabi</p>
                                    <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-slate-600">
                                      <li>• Shipped B2B dashboards with engineering partners</li>
                                      <li>• Ran research workshops with stakeholders</li>
                                    </ul>
                                  </div>
                                </div>
                              </section>

                              <section>
                                <h3 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-sky-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Highlights
                                </h3>
                                <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-slate-700">
                                  {p.skills.map((s, i) => (
                                    <li key={s} className="flex gap-2">
                                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[10px] font-bold text-cyan-800">{i + 1}</span>
                                      <span>{s}</span>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            </div>
                          </div>
                        </article>
                      </div>
                    </div>
                  </div>
                )}

                {(current.scene === 'jdUpload' || current.scene === 'jdLlm' || current.scene === 'jdEdit') && (
                  <div className="space-y-5">
                    <PageHeader
                      markSrc="/icons/careers.jpg"
                      title="Careers"
                      description="Upload a JD, review AI details, then publish"
                      actions={
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Plus />}
                          data-tour="btn-post-job"
                          data-tour-label="Post a job"
                          className={tourTargetClass}
                        >
                          Post a job
                        </Button>
                      }
                    />
                    <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-surface-border bg-white p-5 shadow-card sm:p-6">
                      {current.scene === 'jdUpload' && (
                        <div
                          data-tour="zone-upload-jd"
                          data-tour-label="Upload JD"
                          className={cn('rounded-lg border-2 border-dashed border-navy-300 bg-navy-50/40 p-8 text-center', tourTargetClass)}
                        >
                          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-navy-50">
                            <Upload className="h-5 w-5 text-navy-700" />
                          </span>
                          <p className="mt-3 text-[13px] font-medium text-slate-900">Upload job description</p>
                          <p className="mt-1 text-[12px] text-slate-500">Drag and drop or select a file. Processed automatically.</p>
                          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-surface-border bg-white px-3 py-2 text-[12.5px] font-medium text-slate-700 shadow-sm">
                            <FileText className="h-4 w-4 text-navy-600" />
                            senior_product_designer.pdf
                          </div>
                        </div>
                      )}

                      {current.scene === 'jdLlm' && (
                        <div className="space-y-4">
                          <div className="flex items-center gap-3 rounded-xl border border-navy-100 bg-navy-50/50 px-4 py-3">
                            <img src="/icons/match/ai-robot.gif" alt="" className="h-9 w-9 object-contain" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-navy-900">LLM reading the JD</p>
                              <p className="text-[12px] text-navy-700/80">Extracting title, location, responsibilities, and requirements</p>
                            </div>
                            <Loader2 className="h-4 w-4 animate-spin text-navy-700" />
                          </div>
                          {[
                            ['Job title', DEMO_JOB.job_title],
                            ['Location', DEMO_JOB.job_location],
                            ['Responsibilities', '4 points extracted'],
                            ['Qualifications', '3 points extracted'],
                          ].map(([label, value], i) => (
                            <div
                              key={label}
                              className={cn(
                                'rounded-xl border px-3.5 py-3 transition-all duration-500',
                                llmFill > i ? 'border-navy-200 bg-white opacity-100' : 'border-dashed border-slate-200 bg-slate-50 opacity-50',
                              )}
                            >
                              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
                              <p className="mt-1 text-[13.5px] font-medium text-slate-900">
                                {llmFill > i ? value : <span className="inline-flex items-center gap-1.5 text-slate-400"><Wand2 className="h-3.5 w-3.5" /> Waiting</span>}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {current.scene === 'jdEdit' && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                            <Edit3 className="h-4 w-4 text-navy-600" /> Review and edit AI filled fields
                          </div>
                          <div>
                            <label className="mb-1 block text-[12px] font-semibold text-slate-600">Job title</label>
                            <div className="rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-[14px] font-medium text-slate-900 shadow-sm ring-2 ring-navy-100">
                              {DEMO_JOB.job_title}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-[12px] font-semibold text-slate-600">Location</label>
                            <div className="rounded-xl border border-surface-border bg-white px-3.5 py-2.5 text-[14px] text-slate-800">
                              {DEMO_JOB.job_location}
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-[12px] font-semibold text-slate-600">Key responsibilities</label>
                            <div className="whitespace-pre-line rounded-xl border border-surface-border bg-white px-3.5 py-3 text-[13px] leading-relaxed text-slate-700">
                              {DEMO_JOB.key_responsibilities}
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <Button variant="secondary" size="sm">Save draft</Button>
                            <Button
                              variant="primary"
                              size="sm"
                              data-tour="btn-publish"
                              data-tour-label="Publish opening"
                              className={tourTargetClass}
                            >
                              Publish opening
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {current.scene === 'jobLive' && (
                  <div className="space-y-5">
                    <PageHeader markSrc="/icons/careers.jpg" title="Careers" description="Your jobs" />
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                      <div
                        className={cn('max-w-md overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card', tourTargetClass)}
                        data-tour="btn-open-public"
                        data-tour-label="Open public job page"
                      >
                        <JobRow job={DEMO_JOB} currentUser="Aisha Demo" handlers={tourJobHandlers} />
                      </div>
                      <div className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                          Naukri Gulf boolean search
                        </p>
                        <p className="mt-1 text-[13px] text-slate-600">
                          Paste into Resdex to source matching candidates for this live role.
                        </p>
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed text-slate-900">
                            {DEMO_JOB.boolean_search_string}
                          </code>
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-white text-slate-600">
                            <Copy className="h-4 w-4" />
                          </span>
                        </div>
                        <p className="mt-3 text-[12px] text-slate-500">
                          Subject: {DEMO_JOB.email_subject_template}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {current.scene === 'publicJob' && (
                  <div className="min-h-[calc(100dvh-2rem)] rounded-2xl bg-gradient-to-br from-slate-50 via-white to-slate-100">
                    <div className="flex h-14 items-center justify-between border-b border-white/80 bg-white/80 px-5 backdrop-blur">
                      <div className="flex items-center gap-2.5">
                        <img src="/alphadatalogo.svg" alt="" className="h-7 w-7 object-contain" />
                        <div>
                          <p className="text-[13px] font-semibold text-slate-900">AlphaData</p>
                          <p className="text-[11px] text-slate-500">Careers</p>
                        </div>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        data-tour="btn-apply-now"
                        data-tour-label="Apply now"
                        className={tourTargetClass}
                      >
                        Apply now
                      </Button>
                    </div>
                    <div className="mx-auto max-w-3xl px-4 pb-10 pt-10 text-center sm:px-6">
                      <p className="mb-4 inline-flex rounded-full border border-surface-border bg-white px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                        Now hiring
                      </p>
                      <h1 className="text-[30px] font-bold tracking-[-0.03em] text-slate-900 sm:text-[36px]">{DEMO_JOB.job_title}</h1>
                      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          ['Location', DEMO_JOB.job_location],
                          ['Company', 'AlphaData'],
                          ['Experience', '5+ years'],
                          ['Posted', '9 Nov 2026'],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-white bg-white/90 px-3 py-3.5 shadow-card">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
                            <p className="mt-1 truncate text-[13px] font-semibold text-slate-900">{value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-8">
                        <Button variant="primary" size="lg" className="px-8 shadow-md">Apply now</Button>
                      </div>
                      <div className="mt-10 space-y-5 text-left">
                        <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-card">
                          <h2 className="mb-3 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">About the role</h2>
                          <p className="text-[14px] leading-7 text-slate-700">{DEMO_JOB.job_summary}</p>
                        </section>
                        <section className="rounded-3xl border border-white bg-white/90 p-6 shadow-card">
                          <h2 className="mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Key responsibilities</h2>
                          <ul className="space-y-2">
                            {DEMO_JOB.key_responsibilities.split('\n').filter(Boolean).map((line) => (
                              <li key={line} className="flex gap-3 text-[14px] leading-7 text-slate-700">
                                <span className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                                {line}
                              </li>
                            ))}
                          </ul>
                        </section>
                      </div>
                    </div>
                  </div>
                )}

                {(current.scene === 'applyUpload' || current.scene === 'applyFill' || current.scene === 'applySubmit') && (
                  <div className="mx-auto max-w-2xl pb-8">
                    <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                      <div className="flex items-center justify-between border-b border-surface-border px-5 py-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Apply for this position</p>
                          <h2 className="mt-0.5 text-[16px] font-semibold text-slate-900">{DEMO_JOB.job_title}</h2>
                        </div>
                      </div>
                      <div className="space-y-5 px-5 py-5 sm:px-6">
                        <div
                          data-tour={current.scene === 'applyUpload' ? 'zone-upload-cv' : undefined}
                          data-tour-label={current.scene === 'applyUpload' ? 'Upload CV' : undefined}
                          className={cn(
                            'rounded-xl border p-4',
                            current.scene === 'applyUpload' ? 'border-dashed border-navy-300 bg-navy-50/40' : 'border-slate-200 bg-slate-50/60',
                            tourTargetClass,
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <img src="/icons/match/ai-robot.gif" alt="" aria-hidden className="h-9 w-9 shrink-0 object-contain" />
                            <div className="min-w-0 flex-1">
                              <h3 className="text-[14px] font-semibold text-slate-900">Upload CV to fill info</h3>
                              <p className="mt-0.5 text-[12.5px] text-slate-600">
                                {current.scene === 'applyUpload'
                                  ? 'Drop a PDF. AI reads it and fills the form.'
                                  : 'Reading CV and filling name, experience, salary, and more.'}
                              </p>
                            </div>
                          </div>
                          {current.scene === 'applyUpload' ? (
                            <div className="mt-4 flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-center">
                              <Upload className="h-5 w-5 text-slate-500" />
                              <p className="text-[13px] font-medium text-slate-800">Click to upload CV</p>
                              <p className="text-[11px] text-slate-500">PDF, DOC, or DOCX</p>
                            </div>
                          ) : (
                            <div className="mt-4 flex items-center gap-3 rounded-lg border border-surface-border bg-white p-3">
                              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100">
                                <FileText className="h-4 w-4 text-slate-600" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-slate-900">nora_rahman_cv.pdf</p>
                                <p className="text-xs text-emerald-700">
                                  {applyFill < APPLY_FIELDS.length ? (
                                    <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Extracting fields…</span>
                                  ) : (
                                    'Attached · all fields filled'
                                  )}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {APPLY_FIELDS.map(([label, value], i) => {
                            const filled =
                              current.scene === 'applySubmit' || (current.scene === 'applyFill' && applyFill > i);
                            return (
                              <div key={label}>
                                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
                                <div
                                  className={cn(
                                    'rounded-xl border px-3.5 py-2.5 text-[13.5px] font-medium transition-all duration-300',
                                    filled
                                      ? 'border-emerald-200 bg-emerald-50/40 text-slate-900'
                                      : 'border-dashed border-slate-200 bg-slate-50 text-slate-400',
                                  )}
                                >
                                  {filled ? value : 'Waiting for CV…'}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {(current.scene === 'applyFill' || current.scene === 'applySubmit') && (
                          <div className="flex justify-end pt-1">
                            <Button
                              variant="primary"
                              data-tour={current.scene === 'applySubmit' ? 'btn-submit-apply' : undefined}
                              data-tour-label={current.scene === 'applySubmit' ? 'Submit application' : undefined}
                              className={tourTargetClass}
                            >
                              Submit application
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {current.scene === 'applicants' && (
                  <div className="space-y-5">
                    <PageHeader
                      markSrc="/icons/careers.jpg"
                      title="Applicants"
                      description={`${DEMO_JOB.job_title} · ${DEMO_APPLICANTS.length} received`}
                      actions={
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Target />}
                        >
                          Match applicants
                        </Button>
                      }
                    />
                    <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                      <table className="w-full text-left text-[13px]">
                        <thead className="border-b border-surface-border bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Applicant</th>
                            <th className="px-4 py-3 font-semibold">Location</th>
                            <th className="px-4 py-3 font-semibold">Experience</th>
                            <th className="px-4 py-3 font-semibold">Expected salary</th>
                            <th className="px-4 py-3 font-semibold">Applied</th>
                            <th className="px-4 py-3 font-semibold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {DEMO_APPLICANTS.map((a) => (
                            <tr key={a.email} className="hover:bg-slate-50/70">
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2.5">
                                  <Avatar name={a.name} size="sm" />
                                  <div>
                                    <p className="font-semibold text-slate-900">{a.name}</p>
                                    <p className="text-[11px] text-slate-500">{a.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3.5 text-slate-600">{a.location}</td>
                              <td className="px-4 py-3.5 text-slate-600">{a.years}</td>
                              <td className="px-4 py-3.5 font-semibold text-emerald-700">{a.salary}</td>
                              <td className="px-4 py-3.5 text-slate-600">{a.date}</td>
                              <td className="px-4 py-3.5 text-right">
                                <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white">
                                  <Eye className="h-3.5 w-3.5" /> Details
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {current.scene === 'matchSetup' && (
                  <div className="space-y-5">
                    <PageHeader
                      markSrc="/icons/match.jpg"
                      title="Match"
                      description="Score talent-pool CVs against a job description"
                    />
                    <div className="rounded-2xl border border-surface-border bg-white p-5 shadow-card">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <img src="/icons/match/ai-robot.gif" alt="" aria-hidden className="h-10 w-10 shrink-0 object-contain" />
                          <div>
                            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Quick match</h3>
                            <p className="text-xs text-slate-500">Pick a JD and category from the database, then run.</p>
                          </div>
                        </div>
                        <Button variant="secondary" size="sm" icon={<Users />}>
                          Hand-pick candidates instead
                        </Button>
                      </div>

                      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_auto] md:items-end">
                        <div className="relative flex min-w-0 flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-600">Job description</label>
                          <div
                            data-tour="match-jd"
                            data-tour-label="Select job description"
                            className={cn(
                              'flex h-10 items-center justify-between rounded-xl border px-3 text-[13px] font-medium',
                              tourTargetClass,
                              matchJdOpen ? 'border-navy-300 bg-navy-50/40 text-slate-900' : 'border-surface-border bg-white text-slate-500',
                            )}
                          >
                            <span>{matchJdOpen ? DEMO_JD_OPTIONS[0].title : 'Search or select a job description'}</span>
                            <span className="text-[11px] text-slate-400">{matchJdOpen ? 'Selected' : 'Choose'}</span>
                          </div>
                          {matchJdOpen && (
                            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 overflow-hidden rounded-xl border border-surface-border bg-white shadow-lg">
                              {DEMO_JD_OPTIONS.map((jd, i) => (
                                <div
                                  key={jd.id}
                                  className={cn(
                                    'px-3 py-2.5 text-[13px]',
                                    i === 0 ? 'bg-navy-50 font-semibold text-navy-800' : 'text-slate-700',
                                  )}
                                >
                                  {jd.title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="flex min-w-0 flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-600">Categories / CVs</label>
                          <div
                            data-tour="match-cat"
                            data-tour-label="Design category"
                            className={cn(
                              'flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-colors',
                              tourTargetClass,
                              matchCatChecked
                                ? 'border-blue-300 bg-blue-50 text-slate-900'
                                : 'border-surface-border bg-white text-slate-500',
                            )}
                          >
                            {matchCatChecked ? (
                              <>
                                <span className="flex h-4 w-4 items-center justify-center rounded border border-blue-600 bg-blue-600 text-white">
                                  <Check className="h-3 w-3" strokeWidth={3} />
                                </span>
                                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white">Design</span>
                                <span className="text-[11px] text-slate-500">50 latest CVs</span>
                              </>
                            ) : (
                              <span>Select categories</span>
                            )}
                          </div>
                        </div>

                        <div className="flex min-w-0 flex-col gap-1.5">
                          <label className="text-xs font-semibold text-slate-600">Number of CVs</label>
                          <div className="flex h-10 items-center rounded-xl border border-surface-border bg-white px-3 text-[13px] text-slate-800">
                            50 latest
                          </div>
                        </div>

                        <Button
                          variant="primary"
                          icon={<Target />}
                          data-tour="btn-run-match"
                          data-tour-label="Run match"
                          className={cn('md:min-w-[120px]', tourTargetClass)}
                        >
                          Run match
                        </Button>
                      </div>

                      <p className="mt-3 text-xs text-slate-500">
                        Scores the most recent 50 Design CVs from the database against the selected JD.
                      </p>
                    </div>
                  </div>
                )}

                {current.scene === 'matching' && (
                  <div className="space-y-5">
                    <PageHeader title="Matching" description="Ranking Design CVs for Senior Product Designer" markSrc="/icons/match.jpg" />
                    <MatchingFullPageAnimation
                      totalCVs={50}
                      processedCVs={Math.round((matchPct / 100) * 50)}
                      isQueued={false}
                      percent={matchPct}
                      phase={matchPhase}
                      currentCandidate={
                        matchPhase === 'batches'
                          ? DEMO_CVS[Math.min(3, Math.floor(matchPct / 25))].full_name
                          : matchPhase === 'llm_verification'
                            ? 'Verifying Nora Rahman'
                            : null
                      }
                      recentCandidates={DEMO_CVS.slice(0, 3).map((c) => ({ cv_id: c.id, cv_name: c.full_name }))}
                      llmDone={Math.round((matchPct / 100) * 8)}
                      llmTotal={8}
                      currentBatch={2}
                      totalBatches={3}
                    />
                  </div>
                )}

                {current.scene === 'results' && (
                  <div className="space-y-5">
                    <PageHeader
                      markSrc="/icons/match.jpg"
                      title="Match results"
                      description="Senior Product Designer · 50 ranked from database"
                      actions={<Button variant="secondary" size="sm">Export shortlist</Button>}
                    />

                    <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
                      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name="Nora Rahman" size="md" />
                          <div>
                            <p className="text-[15px] font-semibold text-slate-900">Nora Rahman</p>
                            <p className="text-[12px] text-slate-500">
                              Product Designer · Dubai
                              <span className="font-medium text-emerald-700"> · AED 22,000</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[22px] font-semibold tabular-nums text-navy-800">92%</p>
                          <p className="text-[11px] font-semibold text-emerald-700">Strong</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 border-b border-surface-border px-5 py-4 md:grid-cols-4">
                        {[
                          ['Skills', 94],
                          ['Responsibilities', 88],
                          ['Title', 90],
                          ['Experience', 86],
                        ].map(([label, score]) => (
                          <div key={label as string} className="rounded-xl border border-surface-border bg-slate-50/80 px-3 py-2.5">
                            <p className="text-[11px] font-medium text-slate-500">{label}</p>
                            <p className="mt-1 text-[16px] font-semibold tabular-nums text-slate-900">{score}%</p>
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
                              <div className="h-full rounded-full bg-navy-600" style={{ width: `${score}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-4 p-5">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                          <div className="flex items-center gap-3">
                            <img src="/icons/match/ai-robot.gif" alt="" className="h-9 w-9 object-contain" />
                            <div>
                              <h4 className="text-base font-semibold leading-tight text-slate-900">AI Match Analysis</h4>
                              <p className="mt-0.5 text-xs font-medium text-slate-500">
                                Match Level: <span className="font-semibold text-emerald-600">{DEMO_LLM.match_level}</span>
                              </p>
                            </div>
                          </div>
                          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            {DEMO_LLM.recommendation}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          <div>
                            <h5 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                              <CheckCircle2 className="h-4 w-4" /> Matched skills and tech
                            </h5>
                            <div className="flex flex-wrap gap-1.5">
                              {DEMO_LLM.key_matches.map((m) => (
                                <span key={m} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                                  {m}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <h5 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                              <AlertTriangle className="h-4 w-4" /> Missing skills and tech
                            </h5>
                            <div className="flex flex-wrap gap-1.5">
                              {DEMO_LLM.gaps.map((g) => (
                                <span key={g} className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800">
                                  {g}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-slate-100 pt-3">
                          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Key strengths</h5>
                          <ul className="space-y-1.5">
                            {DEMO_LLM.strengths.map((t) => (
                              <li key={t} className="flex gap-2 text-sm leading-relaxed text-slate-800">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-3 md:grid-cols-2">
                          {[
                            ['Experience', DEMO_LLM.experience_analysis],
                            ['Responsibilities', DEMO_LLM.responsibility_alignment],
                            ['Education and certifications', DEMO_LLM.education_certifications],
                            ['Languages', DEMO_LLM.language_fit],
                          ].map(([label, v]) => (
                            <div key={label}>
                              <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700">{label}</h5>
                              <p className="text-[13px] leading-relaxed text-slate-700">{v}</p>
                            </div>
                          ))}
                        </div>

                        <div className="border-t border-slate-100 pt-3">
                          <h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">Fit Summary</h5>
                          <p className="text-sm leading-relaxed text-slate-900">{DEMO_LLM.summary}</p>
                        </div>

                        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                          <h5 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                            <AlertTriangle className="h-4 w-4" /> Points to check
                          </h5>
                          <ul className="list-disc space-y-1 pl-5 text-[13px] text-rose-900">
                            {DEMO_LLM.red_flags.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </TourShell>
      </div>

      <AnimatePresence>
        {current.scene !== 'outro' && (
          <Caption key={current.title} title={current.title} sub={current.sub} />
        )}
      </AnimatePresence>

      <div className="absolute bottom-0 left-0 right-0 z-40 h-1 bg-slate-100">
        <motion.div
          className="h-full bg-navy-700"
          initial={{ width: '0%' }}
          animate={{ width: `${((step + 1) / SCRIPT.length) * 100}%` }}
          transition={{ duration: 0.35, ease }}
        />
      </div>
    </div>
  );
}
