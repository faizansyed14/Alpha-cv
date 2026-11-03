'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSmoothPercent } from '@/hooks/useSmoothPercent';

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
  { key: 'initializing', label: 'Prepare' },
  { key: 'batches', label: 'Score' },
  { key: 'llm_verification', label: 'Verify' },
  { key: 'finalizing', label: 'Finish' },
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
  queueMessage = null,
  percent = 0,
  llmDone = 0,
  llmTotal = 0,
}: MatchingFullPageAnimationProps) {
  const pct = useSmoothPercent(percent);
  const displayPct = Math.floor(pct);
  const activeIndex = Math.max(0, STAGES.findIndex((s) => s.key === phase));
  const pureQueueWait = isQueued && processedCVs === 0;
  const stageLabel = STAGES[activeIndex]?.label ?? 'Matching';

  const remaining =
    typeof estimatedTimeRemaining === 'number' && estimatedTimeRemaining > 0
      ? estimatedTimeRemaining < 60
        ? ' · under a minute left'
        : ` · about ${Math.ceil(estimatedTimeRemaining / 60)} min left`
      : '';

  const detail = pureQueueWait
    ? queuePosition != null
      ? `Position ${queuePosition}${estimatedWaitTime != null && estimatedWaitTime > 0 ? ` · about ${Math.ceil(estimatedWaitTime / 60)} min` : ''}`
      : 'Waiting for a free worker'
    : phase === 'llm_verification'
      ? `Verifying the strongest matches${llmTotal > 0 ? ` · ${llmDone} of ${llmTotal}` : ''}${remaining}`
      : phase === 'finalizing'
        ? `Saving results${remaining}`
        : totalCVs > 0
          ? `${processedCVs.toLocaleString()} of ${totalCVs.toLocaleString()} CVs${
              totalBatches > 1 && currentBatch >= 1 ? ` · batch ${Math.min(currentBatch, totalBatches)} of ${totalBatches}` : ''
            }${remaining}`
          : 'Reading candidates';

  return (
    <div className="flex min-h-[60vh] items-center justify-center rounded-xl border border-surface-border bg-white px-6 py-16">
      <div className="w-full max-w-md">
        <p className="text-[13px] font-medium text-slate-500">
          {pureQueueWait ? 'In queue' : stageLabel}
        </p>
        <p className="mt-2 text-5xl font-semibold tabular-nums tracking-tight text-slate-900">
          {pureQueueWait ? (queuePosition != null ? queuePosition : 0) : `${displayPct}%`}
        </p>
        <p className="mt-2 text-[13px] text-slate-500">{detail}</p>

        <div className="mt-6 h-1 overflow-hidden rounded-full bg-slate-100">
          <motion.div
            className="h-full rounded-full bg-navy-800"
            initial={false}
            animate={{ width: pureQueueWait ? '8%' : `${Math.max(pct, 1)}%` }}
            transition={{ duration: 0.25, ease: 'linear' }}
          />
        </div>

        <div className="mt-4 flex items-center gap-4 text-[12px]">
          {STAGES.map((stage, i) => (
            <span
              key={stage.key}
              className={
                i === activeIndex && !pureQueueWait
                  ? 'font-semibold text-slate-900'
                  : i < activeIndex && !pureQueueWait
                    ? 'text-slate-500'
                    : 'text-slate-300'
              }
            >
              {stage.label}
            </span>
          ))}
        </div>

        <div className="mt-6 min-h-[20px] text-[13px] text-slate-600">
          <AnimatePresence mode="wait">
            {pureQueueWait && queueMessage ? (
              <motion.p key="queue" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {queueMessage}
              </motion.p>
            ) : currentCandidate ? (
              <motion.p
                key={currentCandidate}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="truncate"
              >
                {currentCandidate}
              </motion.p>
            ) : (
              <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {phase === 'llm_verification'
                  ? 'Checking the strongest matches'
                  : phase === 'finalizing'
                    ? 'Preparing results'
                    : 'Reading candidates'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <p className="mt-8 text-[12px] text-slate-400">
          You can leave this page. Matching keeps running.
        </p>
      </div>
    </div>
  );
}
