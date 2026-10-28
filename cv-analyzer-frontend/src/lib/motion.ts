/**
 * Shared motion tokens. Respect prefers-reduced-motion.
 */

export const MOTION = {
  fast: 0.15,
  normal: 0.22,
  slow: 0.32,
  easeOut: [0.16, 1, 0.3, 1] as const,
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Framer Motion transition that collapses when reduced motion is on. */
export function transition(duration: number = MOTION.normal) {
  if (prefersReducedMotion()) {
    return { duration: 0 };
  }
  return { duration, ease: MOTION.easeOut };
}

export const pageEnterVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};
