import { api } from '@/lib/api';

/**
 * AI matching.
 * Thin domain grouping over the existing `api` client — no new logic.
 */
export const matchingService = {
  matchCandidates: api.matchCandidates,
  matchText: api.matchText,
  matchByCategory: api.matchByCategory,
  getJobForMatching: api.getJobForMatching,
};

export default matchingService;
