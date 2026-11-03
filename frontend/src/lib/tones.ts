/** The colour of an icon tile (soft tinted background + matching icon). Full class names, so Tailwind keeps them. */
export type Tone = 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'sky';

export const TONE: Record<Tone, { tile: string; solid: string }> = {
  blue: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  indigo: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  violet: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  emerald: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  amber: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  rose: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  cyan: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
  sky: { tile: 'bg-slate-50 text-slate-600 ring-slate-200', solid: 'bg-navy-600 text-white ring-navy-600' },
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
