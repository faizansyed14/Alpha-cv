import { describe, expect, it } from 'vitest';
import { COUNTRIES } from './countries';
import { NATIONALITY_GROUPS, canonicalNationality, countsByCountry, nationalitySearchTerms } from './nationalityGroups';

describe('nationality regions', () => {
  it('only lists countries the nationality picker knows, so a ticked one can match what candidates chose', () => {
    for (const g of NATIONALITY_GROUPS) {
      for (const c of g.countries) expect(COUNTRIES, `${g.label}: ${c}`).toContain(c);
      expect(new Set(g.countries).size).toBe(g.countries.length);
    }
  });

  it('the GCC is the six states and all of them are Arab', () => {
    const gcc = NATIONALITY_GROUPS.find((g) => g.key === 'gcc')!.countries;
    const arab = NATIONALITY_GROUPS.find((g) => g.key === 'arab')!.countries;
    expect(gcc).toHaveLength(6);
    for (const c of gcc) expect(arab).toContain(c);
  });

  it('reads an adjective or a short form as its country', () => {
    expect(canonicalNationality('Indian')).toBe('India');
    expect(canonicalNationality(' emirati ')).toBe('United Arab Emirates');
    expect(canonicalNationality('Netherlands')).toBe('The Netherlands');
    expect(canonicalNationality('Atlantis')).toBe('Atlantis');
  });

  it('searches a ticked country under every name a CV may use, once each', () => {
    const terms = nationalitySearchTerms(['India', 'Indian', 'The Netherlands']);
    expect(terms).toEqual(['India', 'indian', 'The Netherlands', 'netherlands', 'dutch', 'holland']);
    expect(nationalitySearchTerms(['Atlantis'])).toEqual(['Atlantis']);
  });

  it('counts "India" and "Indian" as one country', () => {
    const counts = countsByCountry([{ value: 'India', count: 5 }, { value: 'Indian', count: 2 }, { value: 'Egypt', count: 1 }]);
    expect(counts.get('India')).toBe(7);
    expect(counts.get('Egypt')).toBe(1);
    expect(counts.has('Indian')).toBe(false);
  });

  it('keeps every region small enough for the search (at most 400 names)', () => {
    const all = NATIONALITY_GROUPS.flatMap((g) => g.countries);
    expect(nationalitySearchTerms(all).length).toBeLessThanOrEqual(400);
  });
});
