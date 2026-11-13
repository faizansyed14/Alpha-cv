'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trophy, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ease, spring } from '@/lib/motion';

export type ClosureCelebrationPayload = {
  position: string;
  client: string;
  recruiterName?: string | null;
};

type Props = {
  data: ClosureCelebrationPayload | null;
  onClose: () => void;
  onViewClosures: () => void;
};

const BURSTS = [
  { x: -72, y: -48, delay: 0.08, size: 6 },
  { x: 78, y: -40, delay: 0.14, size: 5 },
  { x: -58, y: 52, delay: 0.18, size: 4 },
  { x: 64, y: 46, delay: 0.12, size: 5 },
  { x: 0, y: -78, delay: 0.2, size: 4 },
  { x: -90, y: 8, delay: 0.16, size: 3 },
  { x: 96, y: 4, delay: 0.1, size: 3 },
];

/** Centered congratulations when a requirement is closed. */
export default function ClosureCelebration({ data, onClose, onViewClosures }: Props) {
  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, onClose]);

  return (
    <AnimatePresence>
      {data && (
        <motion.div
          key="closure-celebration"
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease }}
        >
          <motion.button
            type="button"
            aria-label="Dismiss"
            className="absolute inset-0 bg-scrim/50 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="closure-congrats-title"
            className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/80 bg-paper px-7 pb-7 pt-8 text-center shadow-pop"
            initial={{ opacity: 0, scale: 0.88, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={spring.soft}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center">
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-emerald-300/50"
                initial={{ scale: 0.55, opacity: 0 }}
                animate={{ scale: 1.35, opacity: [0, 0.7, 0] }}
                transition={{ duration: 1.1, ease, times: [0, 0.35, 1] }}
              />
              <motion.span
                aria-hidden
                className="absolute inset-2 rounded-full border border-navy-300/40"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1.2, opacity: [0, 0.55, 0] }}
                transition={{ duration: 1.2, ease, delay: 0.08, times: [0, 0.4, 1] }}
              />
              {BURSTS.map((b, i) => (
                <motion.span
                  key={i}
                  aria-hidden
                  className="absolute rounded-full bg-amber-400/80"
                  style={{ width: b.size, height: b.size, left: '50%', top: '50%' }}
                  initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
                  animate={{ opacity: [0, 1, 0], x: b.x, y: b.y, scale: [0.4, 1, 0.6] }}
                  transition={{ duration: 0.9, delay: b.delay, ease }}
                />
              ))}
              <motion.span
                className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-50 to-emerald-50 shadow-soft ring-1 ring-amber-200/70"
                initial={{ scale: 0.4, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={spring.snappy}
              >
                <Trophy className="h-8 w-8" />
              </motion.span>
            </div>

            <motion.p
              className="text-2xs font-semibold uppercase tracking-[0.18em] text-emerald-700"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, duration: 0.35, ease }}
            >
              Closure recorded
            </motion.p>
            <motion.h2
              id="closure-congrats-title"
              className="mt-2 font-display text-3xl font-semibold tracking-[-0.03em] text-slate-900"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.4, ease }}
            >
              Congratulations
            </motion.h2>
            <motion.p
              className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-600"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26, duration: 0.4, ease }}
            >
              <span className="font-semibold text-slate-900">{data.position}</span>
              {' '}for{' '}
              <span className="font-semibold text-slate-900">{data.client}</span>
              {' '}is now on the Closures page
              {data.recruiterName ? (
                <>
                  , credited to{' '}
                  <span className="font-semibold text-slate-900">{data.recruiterName}</span>
                </>
              ) : null}
              .
            </motion.p>

            <motion.div
              className="mt-7 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.34, duration: 0.35, ease }}
            >
              <Button variant="secondary" onClick={onClose}>Continue</Button>
              <Button onClick={onViewClosures}>View Closures</Button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
