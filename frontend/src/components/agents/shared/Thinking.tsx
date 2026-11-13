'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/** Shown while the answer is written: three quiet dots and a status line that changes. */
export function Thinking({ steps }: { steps: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % steps.length), 2400);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 text-slate-500" aria-live="polite">
      <span className="flex gap-1">
        {[0, 1, 2].map((d) => (
          <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-solid-soft" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.18 }} />
        ))}
      </span>
      <span className="relative h-5 flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.span key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="absolute inset-0 text-sm">
            {steps[i]}...
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.div>
  );
}
