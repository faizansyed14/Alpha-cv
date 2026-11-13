'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useSmoothPercent } from '@/hooks/useSmoothPercent';

interface RecentCandidate {
  cv_id: string;
  cv_name: string;
}

interface MatchingLiveOverlayProps {
  totalCVs: number;
  processedCVs: number;
  currentStage: 'initializing' | 'processing' | 'analyzing' | 'scoring' | 'finalizing';
  estimatedTimeRemaining?: number;
  isVisible: boolean;
  currentBatch?: number;
  totalBatches?: number;
  phase?: 'initializing' | 'batches' | 'llm_verification' | 'finalizing';
  currentCandidate?: string | null;
  recentCandidates?: RecentCandidate[];
  percent?: number;
  llmDone?: number;
  llmTotal?: number;
}

const STAGE_LABEL: Record<string, string> = {
  initializing: 'Preparing',
  batches: 'Scoring',
  llm_verification: 'Verifying',
  finalizing: 'Finishing',
};

export default function MatchingLiveOverlay({
  totalCVs,
  processedCVs,
  estimatedTimeRemaining,
  isVisible,
  currentBatch = 0,
  totalBatches = 0,
  phase = 'initializing',
  currentCandidate = null,
  percent = 0,
  llmDone = 0,
  llmTotal = 0,
}: MatchingLiveOverlayProps) {
  const pct = useSmoothPercent(percent);
  const displayPct = Math.floor(pct);
  const label = STAGE_LABEL[phase] ?? 'Matching';

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="matching-live"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 right-4 z-[110] w-[min(100vw-2rem,320px)] rounded-xl border border-navy-100 bg-paper px-4 py-3 shadow-card"
        >
          <div className="flex items-center gap-3">
            <img src="/icons/match/ai-robot.gif" alt="" aria-hidden className="h-9 w-9 shrink-0 object-contain" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <p className="text-sm font-semibold tabular-nums text-navy-800">{displayPct}%</p>
              </div>
            </div>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
            <motion.div
              className="h-full rounded-full bg-solid-hover"
              initial={false}
              animate={{ width: `${Math.max(pct, 1)}%` }}
              transition={{ duration: 0.25, ease: 'linear' }}
            />
          </div>
          <p className="mt-2 truncate text-xs text-slate-500">
            {phase === 'llm_verification'
              ? `Verifying${llmTotal > 0 ? ` ${llmDone} of ${llmTotal}` : ''}`
              : phase === 'finalizing'
                ? 'Saving results'
                : totalCVs > 0
                  ? `${processedCVs.toLocaleString()} of ${totalCVs.toLocaleString()}`
                  : 'Reading candidates'}
            {phase === 'batches' && totalBatches > 1 && currentBatch >= 1
              ? ` · batch ${Math.min(currentBatch, totalBatches)}/${totalBatches}`
              : ''}
            {typeof estimatedTimeRemaining === 'number' && estimatedTimeRemaining > 0
              ? estimatedTimeRemaining < 60 ? ' · <1 min' : ` · ~${Math.ceil(estimatedTimeRemaining / 60)} min`
              : ''}
            {currentCandidate ? ` · ${currentCandidate}` : ''}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
