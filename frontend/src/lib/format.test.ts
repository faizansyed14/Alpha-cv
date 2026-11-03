import { describe, expect, it } from 'vitest';
import { formatExperience } from './format';

describe('formatExperience', () => {
  it('never doubles the unit', () => {
    expect(formatExperience('8 years')).toBe('8 years');
    expect(formatExperience('8 yrs')).toBe('8 years');
    expect(formatExperience('8 years experience')).toBe('8 years');
    expect(formatExperience('5-8 years')).toBe('5-8 years');
  });
  it('adds the unit to bare numbers', () => {
    expect(formatExperience(8)).toBe('8 years');
    expect(formatExperience('8')).toBe('8 years');
    expect(formatExperience('3-5')).toBe('3-5 years');
    expect(formatExperience('8+')).toBe('8+ years');
    expect(formatExperience('1')).toBe('1 year');
    expect(formatExperience('1 yr')).toBe('1 year');
  });
  it('shows nothing when there is nothing to show', () => {
    for (const v of [undefined, null, '', ' ', '0', 0, 'N/A', 'Not specified']) expect(formatExperience(v)).toBeNull();
  });
});
