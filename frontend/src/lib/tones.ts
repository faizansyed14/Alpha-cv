/** The colour of an icon tile (soft tinted background + matching icon). Full class names, so Tailwind keeps them. */
export type Tone = 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'sky';

export const TONE: Record<Tone, { tile: string; solid: string }> = {
  blue: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  indigo: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  violet: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  emerald: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  amber: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  rose: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  cyan: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
  sky: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900' },
};

/** One colour per sidebar destination. */
export const NAV_TONE: Record<string, Tone> = {
  dashboard: 'blue',
  candidates: 'indigo',
  jobs: 'sky',
  match: 'violet',
  upload: 'cyan',
  careers: 'emerald',
  tracker: 'amber',
  admin: 'indigo',
  monitor: 'rose',
  email: 'sky',
};
