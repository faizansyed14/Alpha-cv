'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Users, Brain, CheckCircle2, Zap, ListOrdered, LayoutGrid } from 'lucide-react';

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
}

const STAGES = [
  { key: 'initializing', label: 'Initializing', icon: Sparkles },
  { key: 'batches', label: 'Scoring candidates', icon: Users },
  { key: 'llm_verification', label: 'AI verification', icon: Brain },
  { key: 'finalizing', label: 'Finalizing', icon: CheckCircle2 },
] as const;

/** Eased count-up so numbers never just snap between values. */
function useCountUp(value: number, durationMs = 500): number {
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
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return display;
}

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
}: MatchingFullPageAnimationProps) {
  const pct = totalCVs > 0 ? Math.min(100, (processedCVs / totalCVs) * 100) : 0;
  const displayPct = useCountUp(Math.round(pct));
  const activeIndex = Math.max(0, STAGES.findIndex((s) => s.key === phase));

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  // Pure queue wait: nothing has started scoring yet.
  const pureQueueWait = isQueued && processedCVs === 0;

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-white px-6 py-16">
      {/* Ambient animated backdrop */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-brand-100/60 blur-3xl"
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
        {pureQueueWait ? (
          <>
            <div className="relative flex h-32 w-32 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-brand-100" />
              <motion.span
                className="absolute inset-0 rounded-full bg-brand-200"
                animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
              <ListOrdered className="relative h-10 w-10 text-brand-600" />
            </div>
            <h2 className="mt-6 text-xl font-bold text-gray-900">You're in the queue</h2>
            {queuePosition != null && (
              <p className="mt-1 text-[15px] text-gray-500">
                Position{' '}
                <AnimatePresence mode="wait">
                  <motion.span
                    key={queuePosition}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="font-bold text-gray-900"
                  >
                    #{queuePosition}
                  </motion.span>
                </AnimatePresence>
                {estimatedWaitTime != null && estimatedWaitTime > 0 && (
                  <> · ~{Math.ceil(estimatedWaitTime / 60)} min wait</>
                )}
              </p>
            )}
            {queueMessage && <p className="mt-3 max-w-sm text-[13px] text-gray-500">{queueMessage}</p>}
          </>
        ) : (
          <>
            {/* Big progress ring */}
            <div className="relative flex h-36 w-36 items-center justify-center">
              <svg width="144" height="144" viewBox="0 0 128 128" className="-rotate-90">
                <circle cx="64" cy="64" r={radius} strokeWidth="8" className="fill-none stroke-gray-100" />
                <motion.circle
                  cx="64"
                  cy="64"
                  r={radius}
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="fill-none stroke-brand-600"
                  style={{ strokeDasharray: circumference }}
                  animate={{ strokeDashoffset: dashOffset }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </svg>
              <AnimatePresence mode="wait">
                <motion.div
                  key={phase === 'finalizing' ? 'done' : 'pct'}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  className="absolute flex flex-col items-center"
                >
                  {phase === 'finalizing' ? (
                    <CheckCircle2 className="h-10 w-10 text-emerald-600" />
                  ) : (
                    <span className="text-3xl font-bold tabular-nums text-gray-900">{displayPct}%</span>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <AnimatePresence mode="wait">
              <motion.h2
                key={phase}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-5 text-xl font-bold text-gray-900"
              >
                {STAGES[activeIndex]?.label ?? 'Matching candidates'}
              </motion.h2>
            </AnimatePresence>
            <p className="mt-1 text-[14px] text-gray-500">
              <span className="font-semibold tabular-nums text-gray-900">{processedCVs}</span>
              <span className="tabular-nums"> / {totalCVs}</span> candidates
              {phase === 'batches' && totalBatches > 0 && currentBatch >= 1 && (
                <> · batch {Math.min(currentBatch, totalBatches)} of {totalBatches}</>
              )}
              {typeof estimatedTimeRemaining === 'number' && estimatedTimeRemaining > 0 && (
                <> · ~{Math.ceil(estimatedTimeRemaining / 60)} min left</>
              )}
            </p>

            {/* Stage stepper */}
            <div className="mt-6 flex w-full max-w-xs items-center gap-1.5">
              {STAGES.map((s, i) => (
                <div key={s.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <motion.div
                    className={`h-full rounded-full ${i < activeIndex ? 'bg-brand-600' : i === activeIndex ? 'bg-brand-400' : 'bg-transparent'}`}
                    initial={{ width: '0%' }}
                    animate={{ width: i <= activeIndex ? '100%' : '0%' }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              ))}
            </div>

            {/* Live scoring feed */}
            {phase === 'batches' && (currentCandidate || recentCandidates.length > 0) && (
              <div className="mt-6 w-full rounded-xl bg-gray-50 p-4">
                <AnimatePresence mode="wait">
                  {currentCandidate && (
                    <motion.div
                      key={currentCandidate}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="flex items-center justify-center gap-2 text-[14px] font-semibold text-gray-900"
                    >
                      <Zap className="h-4 w-4 shrink-0 text-brand-600" />
                      <span className="truncate">Scoring {currentCandidate}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                {recentCandidates.length > 1 && (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    <AnimatePresence initial={false}>
                      {recentCandidates.slice(1, 9).map((c) => (
                        <motion.span
                          key={c.cv_id}
                          layout
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.2 }}
                          className="rounded-full bg-white px-2.5 py-1 text-[11.5px] text-gray-500 shadow-sm ring-1 ring-gray-200"
                        >
                          {c.cv_name}
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}

            {phase === 'llm_verification' && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-[13px] font-medium text-brand-700"
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
          </>
        )}

        {/* Reassurance: it's safe to leave and come back */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-10 flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-[12.5px] text-gray-500"
        >
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          Feel free to check other tabs — matching keeps running in the background.
          You can come back to this page anytime to see live progress.
        </motion.div>
      </div>
    </div>
  );
}
