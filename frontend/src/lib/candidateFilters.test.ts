import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_ADVANCED_FORM } from '@/components/database/AdvancedSearchModal';
import { CANDIDATE_FILTERS_KEY, clearCandidateFilters, readCandidateFilters, saveCandidateFilters, type SavedCandidateFilters } from './candidateFilters';

const none: SavedCandidateFilters = {
  sidebar: { category: [], location: [], nationality: [], language: [] }, freshness: 'any', addedFrom: '', addedTo: '',
  salary: { min: '', max: '' }, experience: { min: '', max: '' }, notes: 'all', search: '', advancedQuery: null, advancedForm: EMPTY_ADVANCED_FORM,
};

describe('the Candidates filters kept for the tab', () => {
  beforeEach(() => sessionStorage.clear());

  it('come back exactly as they were left', () => {
    const f: SavedCandidateFilters = {
      ...none, sidebar: { ...none.sidebar, nationality: ['India', 'Egypt'] }, freshness: '30', salary: { min: '10,000', max: '' },
      experience: { min: '3', max: '5.5' }, notes: 'with_notes', search: 'python',
      advancedQuery: { keywords: ['sap'], salary_min: 9000, cursor: 'abc' }, advancedForm: { ...EMPTY_ADVANCED_FORM, keywords: ['sap'], salaryMin: '9000' },
    };
    saveCandidateFilters(f);
    expect(readCandidateFilters()).toEqual({ ...f, advancedQuery: { keywords: ['sap'], salary_min: 9000, cursor: null } });   // from the first page
  });

  it('are not kept when nothing is chosen, and go when cleared', () => {
    saveCandidateFilters(none);
    expect(sessionStorage.getItem(CANDIDATE_FILTERS_KEY)).toBeNull();
    saveCandidateFilters({ ...none, freshness: '7' });
    expect(readCandidateFilters()?.freshness).toBe('7');
    clearCandidateFilters();
    expect(readCandidateFilters()).toBeNull();
  });

  it('drop anything malformed rather than half-apply it', () => {
    sessionStorage.setItem(CANDIDATE_FILTERS_KEY, '{not json');
    expect(readCandidateFilters()).toBeNull();
    sessionStorage.setItem(CANDIDATE_FILTERS_KEY, JSON.stringify({ freshness: '7' }));
    expect(readCandidateFilters()).toBeNull();
    sessionStorage.setItem(CANDIDATE_FILTERS_KEY, JSON.stringify({ ...none, sidebar: { nationality: ['India', 5] }, notes: 'weird', salary: null }));
    const back = readCandidateFilters()!;
    expect(back.sidebar.nationality).toEqual(['India']);
    expect(back.notes).toBe('all');
    expect(back.salary).toEqual({ min: '', max: '' });
  });
});
