'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Users, Brain, CheckCircle2, Zap } from 'lucide-react';

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
  /** Current batch completed (1-based). */
  currentBatch?: number;
  /** Total batches. */
  totalBatches?: number;
  /** Phase drives the visuals: batches = live scoring feed, llm_verification = AI banner. */
  phase?: 'initializing' | 'batches' | 'llm_verification' | 'finalizing';
  /** Name of the CV whose score just landed (live). */
  currentCandidate?: string | null;
  /** Most-recently-scored candidates, newest first. */
  recentCandidates?: RecentCandidate[];
}

const STAGES = [
  { key: 'initializing', label: 'Initializing', icon: Sparkles },
  { key: 'batches', label: 'Scoring candidates', icon: Users },
  { key: 'llm_verification', label: 'AI verification', icon: Brain },
  { key: 'finalizing', label: 'Finalizing', icon: CheckCircle2 },
] as const;

/** Eased count-up so the percentage/count never just snaps between values. */
function useCountUp(value: number, durationMs = 450): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return display;
}

export default function MatchingLiveOverlay({
  totalCVs,
  processedCVs,
  estimatedTimeRemaining,
  isVisible,
  currentBatch = 0,
  totalBatches = 0,
  phase = 'initializing',
  currentCandidate = null,
  recentCandidates = [],
}: MatchingLiveOverlayProps) {
  const pct = totalCVs > 0 ? Math.min(100, (processedCVs / totalCVs) * 100) : 0;
  const displayPct = useCountUp(Math.round(pct));
  const activeIndex = Math.max(0, STAGES.findIndex((s) => s.key === phase));
  const ActiveIcon = STAGES[activeIndex]?.icon ?? Sparkles;

  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  const batchLabel =
    phase === 'batches' && totalBatches > 0 && currentBatch >= 1
      ? `Batch ${Math.min(currentBatch, totalBatches)} of ${totalBatches}`
      : null;

  return (
    <AnimatePresence>
      {isVisible && (
        <React.Fragment key="matching-live-overlay">
          {/* Slim shimmering top bar — a subtle always-on-screen heartbeat */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-x-0 top-0 z-[110] h-1 overflow-hidden bg-brand-100"
          >
            <motion.div
              className="h-full bg-gradient-to-r from-brand-400 via-brand-600 to-brand-400"
              style={{ width: `${Math.max(2, pct)}%`, backgroundSize: '200% 100%' }}
              animate={{ backgroundPositionX: ['0%', '100%'] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
            />
          </motion.div>

          {/* Main floating card */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="fixed bottom-4 right-4 z-[110] w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-white/95 shadow-[0_16px_48px_rgba(16,24,40,0.20)] backdrop-blur-sm"
          >
            <div className="p-4">
              <div className="flex items-center gap-3">
                {/* Circular progress ring with animated count-up */}
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                  <svg width="64" height="64" viewBox="0 0 72 72" className="-rotate-90">
                    <circle cx="36" cy="36" r={radius} strokeWidth="6" className="fill-none stroke-gray-100" />
                    <motion.circle
                      cx="36"
                      cy="36"
                      r={radius}
                      strokeWidth="6"
                      strokeLinecap="round"
                      className="fill-none stroke-brand-600"
                      style={{ strokeDasharray: circumference }}
                      animate={{ strokeDashoffset: dashOffset }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </svg>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={phase}
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      className="absolute"
                    >
                      {phase === 'finalizing' ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <span className="text-[13px] font-bold tabular-nums text-gray-900">{displayPct}%</span>
                      )}
                    </motion.span>
                  </AnimatePresence>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ActiveIcon className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={phase}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 6 }}
                        transition={{ duration: 0.2 }}
                        className="truncate text-[13px] font-semibold text-gray-900"
                      >
                        {STAGES[activeIndex]?.label ?? 'Matching'}
                      </motion.span>
                    </AnimatePresence>
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500">
                    <span className="font-medium tabular-nums text-gray-900">{processedCVs}</span>
                    <span className="tabular-nums"> / {totalCVs}</span> candidates
                    {batchLabel && <span className="text-gray-400"> · {batchLabel}</span>}
                    {typeof estimatedTimeRemaining === 'number' && estimatedTimeRemaining > 0 && (
                      <span className="text-gray-400"> · ~{Math.ceil(estimatedTimeRemaining / 60)} min left</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Stage stepper */}
              <div className="mt-3 flex items-center gap-1">
                {STAGES.map((s, i) => (
                  <motion.div
                    key={s.key}
                    className="h-1.5 flex-1 rounded-full bg-gray-100"
                    initial={false}
                  >
                    <motion.div
                      className={`h-full rounded-full ${i < activeIndex ? 'bg-brand-600' : i === activeIndex ? 'bg-brand-400' : 'bg-transparent'}`}
                      initial={{ width: '0%' }}
                      animate={{ width: i <= activeIndex ? '100%' : '0%' }}
                      transition={{ duration: 0.4, ease: 'easeOut' }}
                    />
                  </motion.div>
                ))}
              </div>

              {/* Live scoring feed */}
              {phase === 'batches' && (currentCandidate || recentCandidates.length > 0) && (
                <div className="mt-3 rounded-lg bg-gray-50 p-2.5">
                  <AnimatePresence mode="wait">
                    {currentCandidate && (
                      <motion.div
                        key={currentCandidate}
                        initial={{ opacity: 0, x: 14 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -14 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="flex items-center gap-2 text-[12.5px] font-medium text-gray-900"
                      >
                        <Zap className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                        <span className="truncate">Scoring {currentCandidate}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {recentCandidates.length > 1 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <AnimatePresence initial={false}>
                        {recentCandidates.slice(1, 6).map((c) => (
                          <motion.span
                            key={c.cv_id}
                            layout
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ duration: 0.2 }}
                            className="rounded-full bg-white px-2 py-0.5 text-[10.5px] text-gray-500 shadow-sm ring-1 ring-gray-200"
                          >
                            {c.cv_name}
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )}

              {/* AI verification banner */}
              {phase === 'llm_verification' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 p-2.5 text-[12.5px] font-medium text-brand-700"
                >
                  <motion.span
                    animate={{ rotate: [0, 8, -8, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Brain className="h-4 w-4 shrink-0" />
                  </motion.span>
                  Running AI verification on the top candidates…
                </motion.div>
              )}

              {/* Finalizing banner */}
              {phase === 'finalizing' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-[12.5px] font-medium text-emerald-700"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Preparing your results…
                </motion.div>
              )}
            </div>
          </motion.div>
        </React.Fragment>
      )}
    </AnimatePresence>
  );
}
