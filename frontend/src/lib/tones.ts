/** The colour of an icon tile (soft tinted background + matching icon). Full class names, so Tailwind keeps them. */
export type Tone = 'blue' | 'indigo' | 'violet' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'sky' | 'iris';

export const TONE: Record<Tone, { tile: string; solid: string; text: string }> = {
  blue: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900', text: 'text-navy-800' },
  indigo: { tile: 'bg-navy-50 text-navy-800 ring-navy-100', solid: 'bg-navy-900 text-white ring-navy-900', text: 'text-navy-800' },
  iris: { tile: 'bg-iris-50 text-iris-700 ring-iris-100', solid: 'bg-iris-600 text-white ring-iris-600', text: 'text-iris-700' },
  violet: { tile: 'bg-violet-50 text-violet-700 ring-violet-100', solid: 'bg-violet-600 text-white ring-violet-600', text: 'text-violet-700' },
  emerald: { tile: 'bg-emerald-50 text-emerald-700 ring-emerald-100', solid: 'bg-emerald-600 text-white ring-emerald-600', text: 'text-emerald-700' },
  amber: { tile: 'bg-amber-50 text-amber-700 ring-amber-100', solid: 'bg-amber-500 text-white ring-amber-500', text: 'text-amber-700' },
  rose: { tile: 'bg-rose-50 text-rose-700 ring-rose-100', solid: 'bg-rose-600 text-white ring-rose-600', text: 'text-rose-700' },
  cyan: { tile: 'bg-sky-50 text-sky-700 ring-sky-100', solid: 'bg-sky-600 text-white ring-sky-600', text: 'text-sky-700' },
  sky: { tile: 'bg-sky-50 text-sky-700 ring-sky-100', solid: 'bg-sky-600 text-white ring-sky-600', text: 'text-sky-700' },
};
