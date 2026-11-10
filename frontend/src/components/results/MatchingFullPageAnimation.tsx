'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSmoothPercent } from '@/hooks/useSmoothPercent';
import { cn } from '@/lib/utils';

interface RecentCandidate {
  cv_id: string;
  cv_name: string;
}

interface MatchingFullPageAnimationProps {
  totalCVs: number;
  processedCVs: number;
  isQueued: boolean;
  queuePosition?: number | null;
  estimatedWaitTime?: number | null;
  estimatedTimeRemaining?: number;
  currentBatch?: number;
  totalBatches?: number;
  phase?: 'initializing' | 'batches' | 'llm_verification' | 'finalizing';
  currentCandidate?: string | null;
  recentCandidates?: RecentCandidate[];
  queueMessage?: string | null;
  /** The backend's own 0-100 progress. */
  percent?: number;
  llmDone?: number;
  llmTotal?: number;
}

const STAGES = [
  { key: 'initializing', label: 'Prepare', icon: '/icons/match/phase-prepare.svg', hint: 'Warming up the matcher' },
  { key: 'batches', label: 'Score', icon: '/icons/match/phase-score.svg', hint: 'Ranking each CV against the role' },
  { key: 'llm_verification', label: 'Verify', icon: '/icons/match/phase-verify.svg', hint: 'AI reviewing the strongest fits' },
  { key: 'finalizing', label: 'Finish', icon: '/icons/match/phase-finish.svg', hint: 'Packing your ranked shortlist' },
] as const;

export default function MatchingFullPageAnimation({
  totalCVs,
  processedCVs,
  isQueued,
  queuePosition = null,
  estimatedWaitTime = null,
  estimatedTimeRemaining,
  currentBatch = 0,
  totalBatches = 0,
  phase = 'initializing',
  currentCandidate = null,
  recentCandidates = [],
  queueMessage = null,
  percent = 0,
  llmDone = 0,
  llmTotal = 0,
}: MatchingFullPageAnimationProps) {
  const pct = useSmoothPercent(percent);
  const displayPct = Math.floor(pct);
  const activeIndex = Math.max(0, STAGES.findIndex((s) => s.key === phase));
  const pureQueueWait = isQueued && processedCVs === 0;
  const stage = STAGES[activeIndex] ?? STAGES[0];

  const remaining =
    typeof estimatedTimeRemaining === 'number' && estimatedTimeRemaining > 0
      ? estimatedTimeRemaining < 60
        ? 'Under a minute left'
        : `About ${Math.ceil(estimatedTimeRemaining / 60)} min left`
      : null;

  const detail = pureQueueWait
    ? queuePosition != null
      ? `Queue position ${queuePosition}${estimatedWaitTime != null && estimatedWaitTime > 0 ? ` · ~${Math.ceil(estimatedWaitTime / 60)} min` : ''}`
      : 'Waiting for a free worker'
    : phase === 'llm_verification'
      ? `Verifying strongest matches${llmTotal > 0 ? ` · ${llmDone} of ${llmTotal}` : ''}`
      : phase === 'finalizing'
        ? 'Saving ranked results'
        : totalCVs > 0
          ? `${processedCVs.toLocaleString()} of ${totalCVs.toLocaleString()} CVs${
              totalBatches > 1 && currentBatch >= 1 ? ` · batch ${Math.min(currentBatch, totalBatches)}/${totalBatches}` : ''
            }`
          : 'Reading candidates';

  const ringR = 54;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - Math.max(pureQueueWait ? 0.08 : pct / 100, 0.02));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-slate-100/80 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-slate-50 blur-3xl" />

      <div className="relative mx-auto flex min-h-[62vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-12 text-center sm:px-10">
        {/* Robot + percent ring */}
        <div className="relative mb-6">
          <svg width="140" height="140" className="-rotate-90" aria-hidden>
            <circle cx="70" cy="70" r={ringR} fill="none" stroke="#E8ECF5" strokeWidth="8" />
            <motion.circle
              cx="70"
              cy="70"
              r={ringR}
              fill="none"
              stroke="#16204B"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={ringC}
              animate={{ strokeDashoffset: ringOffset }}
              transition={{ duration: 0.35, ease: 'linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.img
              src="/icons/match/ai-robot.gif"
              alt=""
              aria-hidden
              className="h-11 w-11 object-contain drop-shadow-sm sm:h-12 sm:w-12"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-600">
          {pureQueueWait ? 'In queue' : stage.label}
        </p>
        <p className="mt-2 text-5xl font-semibold tabular-nums tracking-[-0.04em] text-slate-900 sm:text-6xl">
          {pureQueueWait ? (queuePosition != null ? `#${queuePosition}` : '…') : `${displayPct}%`}
        </p>
        <p className="mt-2 max-w-md text-[14px] text-slate-500">{detail}</p>
        {remaining && !pureQueueWait && (
          <p className="mt-1 text-[12px] font-medium text-navy-700">{remaining}</p>
        )}

        <div className="mt-6 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/80 ring-1 ring-navy-100">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-navy-800 to-navy-500"
            initial={false}
            animate={{ width: pureQueueWait ? '8%' : `${Math.max(pct, 2)}%` }}
            transition={{ duration: 0.25, ease: 'linear' }}
          />
        </div>

        {/* Phase strip with SVG marks */}
        <div className="mt-8 grid w-full max-w-lg grid-cols-4 gap-2 sm:gap-3">
          {STAGES.map((s, i) => {
            const active = i === activeIndex && !pureQueueWait;
            const done = i < activeIndex && !pureQueueWait;
            return (
              <div
                key={s.key}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2.5 transition-colors',
                  active
                    ? 'border-navy-200 bg-white shadow-sm'
                    : done
                      ? 'border-navy-100/80 bg-navy-50/50'
                      : 'border-transparent bg-white/40',
                )}
              >
                <img
                  src={s.icon}
                  alt=""
                  aria-hidden
                  className={cn('h-8 w-8 rounded-lg object-cover', !active && !done && 'opacity-40 grayscale')}
                />
                <span
                  className={cn(
                    'text-[11px] font-semibold',
                    active ? 'text-navy-900' : done ? 'text-navy-600' : 'text-slate-400',
                  )}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[12px] text-slate-400">{pureQueueWait ? 'Your job will start when a worker is free' : stage.hint}</p>

        {/* Live candidate + recent chips */}
        <div className="mt-6 min-h-[52px] w-full max-w-md">
          <AnimatePresence mode="wait">
            {pureQueueWait && queueMessage ? (
              <motion.p
                key="queue"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-xl border border-navy-100 bg-white/80 px-4 py-3 text-[13px] text-slate-600"
              >
                {queueMessage}
              </motion.p>
            ) : currentCandidate ? (
              <motion.div
                key={currentCandidate}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-xl border border-navy-100 bg-white/90 px-4 py-3 shadow-sm"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-navy-500">Scoring now</p>
                <p className="mt-0.5 truncate text-[14px] font-semibold text-slate-900">{currentCandidate}</p>
              </motion.div>
            ) : (
              <motion.p
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[13px] text-slate-500"
              >
                {phase === 'llm_verification'
                  ? 'AI is double-checking the top matches'
                  : phase === 'finalizing'
                    ? 'Almost done — preparing your shortlist'
                    : 'Reading candidate profiles'}
              </motion.p>
            )}
          </AnimatePresence>

          {recentCandidates.length > 0 && !pureQueueWait && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {recentCandidates.slice(0, 4).map((c) => (
                <span
                  key={c.cv_id}
                  className="max-w-[9rem] truncate rounded-full border border-navy-100 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  title={c.cv_name}
                >
                  {c.cv_name}
                </span>
              ))}
            </div>
          )}
        </div>

        <p className="mt-8 text-[12px] text-slate-400">You can leave this page. Matching keeps running.</p>
      </div>
    </div>
  );
}
