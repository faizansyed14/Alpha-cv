/** How old a candidate's CV is, from the day the current CV arrived: "3 days old", "6 months old", "1 year old". */
/** new: under six months; aging: six months to a year; old: a year or more. */
export type CvAgeTone = 'new' | 'aging' | 'old';

export interface CvAge {
  label: string;
  days: number;
  tone: CvAgeTone;
}

const SIX_MONTHS_DAYS = 183;

const DAY_MS = 86_400_000;
const MONTH_DAYS = 30.4375;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} old`;

/** The age of a CV, or null when the date is missing or not a date. ``now`` is only for tests. */
export function cvAge(addedOn: string | null | undefined, now: Date = new Date()): CvAge | null {
  if (!addedOn) return null;
  const then = new Date(addedOn);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / DAY_MS));

  let label: string;
  if (days < 1) label = 'Received today';
  else if (days < 30) label = plural(days, 'day');
  else if (days < 365) label = plural(Math.max(1, Math.floor(days / MONTH_DAYS)), 'month');
  else label = plural(Math.floor(days / 365), 'year');
  const tone: CvAgeTone = days >= 365 ? 'old' : days >= SIX_MONTHS_DAYS ? 'aging' : 'new';
  return { label, days, tone };
}

/** True when two dates fall on different days (the CV was replaced by a newer one after the person was first added). */
export function differentDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && addedOnText(a) !== '' && addedOnText(a) !== addedOnText(b);
}

/** "12 Nov 2026", for the tooltip. Empty when the date is not a date. */
export function addedOnText(addedOn: string | null | undefined): string {
  if (!addedOn) return '';
  const d = new Date(addedOn);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
