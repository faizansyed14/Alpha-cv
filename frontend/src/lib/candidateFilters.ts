import type { AdvancedSearchForm } from '@/components/database/AdvancedSearchModal';
import type { CVAdvancedSearchParams } from '@/lib/types';

/**
 * The Candidates page's filters, kept for this browser tab (sessionStorage) so that opening a candidate and coming back finds the
 * list filtered as it was. Signing out removes them (see authStore.logout), so the next person on the computer starts clean.
 */
export const CANDIDATE_FILTERS_KEY = 'alphacv.candidates.filters';

export interface SavedCandidateFilters {
  sidebar: Record<string, string[]>;
  freshness: string;
  addedFrom: string;
  addedTo: string;
  salary: { min: string; max: string };
  experience: { min: string; max: string };
  notes: 'all' | 'with_notes' | 'without_notes';
  search: string;
  advancedQuery: CVAdvancedSearchParams | null;
  advancedForm: AdvancedSearchForm;
}

/** Nothing chosen: the page as it opens. Not worth keeping. */
export function isEmptyFilters(f: SavedCandidateFilters): boolean {
  return Object.values(f.sidebar).every((v) => !v?.length) && f.freshness === 'any' && !f.salary.min && !f.salary.max
    && !f.experience.min && !f.experience.max && f.notes === 'all' && !f.search.trim() && !f.advancedQuery;
}

export function saveCandidateFilters(f: SavedCandidateFilters): void {
  try {
    if (isEmptyFilters(f)) sessionStorage.removeItem(CANDIDATE_FILTERS_KEY);
    else sessionStorage.setItem(CANDIDATE_FILTERS_KEY, JSON.stringify({ ...f, advancedQuery: f.advancedQuery ? { ...f.advancedQuery, cursor: null } : null }));
  } catch {
    /* private mode or full: the filters are simply not kept */
  }
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const pair = (v: unknown) => ({ min: str((v as { min?: unknown })?.min), max: str((v as { max?: unknown })?.max) });

/** What was kept, or null. Anything malformed (an older shape, edited by hand) is dropped rather than half-applied. */
export function readCandidateFilters(): SavedCandidateFilters | null {
  try {
    const raw = sessionStorage.getItem(CANDIDATE_FILTERS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || !v.sidebar || !v.advancedForm) return null;
    const sidebar: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(v.sidebar)) sidebar[k] = strs(vals);
    const notes = ['all', 'with_notes', 'without_notes'].includes(v.notes) ? v.notes : 'all';
    return {
      sidebar, freshness: str(v.freshness) || 'any', addedFrom: str(v.addedFrom), addedTo: str(v.addedTo),
      salary: pair(v.salary), experience: pair(v.experience), notes, search: str(v.search),
      advancedQuery: v.advancedQuery && typeof v.advancedQuery === 'object' ? v.advancedQuery : null,
      advancedForm: v.advancedForm,
    };
  } catch {
    return null;
  }
}

export function clearCandidateFilters(): void {
  try {
    sessionStorage.removeItem(CANDIDATE_FILTERS_KEY);
  } catch {
    /* ignore */
  }
}
