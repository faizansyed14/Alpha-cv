import { useEffect, useRef, useState } from 'react';

/**
 * Eases the number shown on screen toward the real percentage.
 *
 * The backend reports progress about once a second; this fills the gaps so the figure glides instead of jumping.
 * It only ever moves forward within a run (a late or repeated update can never pull it back). A value of 0 starts a
 * new run and resets it. The glide takes about one polling interval, so the figure never runs ahead of the real one
 * by more than a poll.
 */
export function useSmoothPercent(target: number, glideMs = 900): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target === 0) {
      shownRef.current = 0;
      setShown(0);
      return;
    }
    const from = shownRef.current;
    if (target <= from) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / glideMs);
      const value = from + (target - from) * t;
      shownRef.current = value;
      setShown(value);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, glideMs]);

  return Math.min(100, Math.max(0, shown));
}
