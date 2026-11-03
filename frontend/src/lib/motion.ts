import type { Transition, Variants } from 'framer-motion';

/**
 * The motion language of the interface: short, soft and physical. Things settle, they do not bounce.
 * Every animation in the product uses these, so the whole app moves the same way.
 */

/** Fast start, long gentle stop (an "ease-out expo"). For fades and slides that are not springs. */
export const ease = [0.22, 1, 0.36, 1] as const;

export const spring = {
  /** Panels, dialogs, anything large that arrives. */
  soft: { type: 'spring', stiffness: 340, damping: 34, mass: 0.9 },
  /** Small controls: switches, tabs, indicators. */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 },
  /** Layout changes: a list that reflows, a card that expands. */
  layout: { type: 'spring', stiffness: 380, damping: 40, mass: 0.9 },
} satisfies Record<string, Transition>;

export const duration = { fast: 0.16, base: 0.24, slow: 0.4 } as const;

/** Fade and rise a few pixels: the default entrance for blocks of content. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: duration.slow, ease } },
  exit: { opacity: 0, y: 4, transition: { duration: duration.fast, ease } },
};

/** A floating surface (menu, popover) appearing from its trigger. */
export const pop: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 4 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, scale: 0.98, y: 2, transition: { duration: duration.fast, ease } },
};

/** Parent of a staggered list: children using `rise` arrive one after another. */
export const stagger = (gap = 0.045, start = 0.04): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: start } },
});
