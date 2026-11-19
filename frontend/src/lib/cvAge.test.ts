import { describe, expect, it } from 'vitest';
import { addedOnText, cvAge, differentDay } from './cvAge';

const NOW = new Date('2026-11-18T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('cvAge', () => {
  it('says "Received today" for a CV received in the last day', () => {
    expect(cvAge(ago(0), NOW)).toMatchObject({ label: 'Received today', days: 0 });
  });

  it('counts days under a month, with a singular day', () => {
    expect(cvAge(ago(1), NOW)?.label).toBe('1 day old');
    expect(cvAge(ago(12), NOW)?.label).toBe('12 days old');
    expect(cvAge(ago(29), NOW)?.label).toBe('29 days old');
  });

  it('counts whole months from a month up to a year, never "0 months" or "12 months"', () => {
    expect(cvAge(ago(30), NOW)?.label).toBe('1 month old');
    expect(cvAge(ago(65), NOW)?.label).toBe('2 months old');
    expect(cvAge(ago(183), NOW)?.label).toBe('6 months old');
    expect(cvAge(ago(364), NOW)?.label).toBe('11 months old');
  });

  it('counts years from a year on', () => {
    expect(cvAge(ago(365), NOW)?.label).toBe('1 year old');
    expect(cvAge(ago(729), NOW)?.label).toBe('1 year old');
    expect(cvAge(ago(731), NOW)?.label).toBe('2 years old');
  });

  it('is green under six months, yellow from six months, red from a year', () => {
    expect(cvAge(ago(0), NOW)?.tone).toBe('new');
    expect(cvAge(ago(182), NOW)?.tone).toBe('new');
    expect(cvAge(ago(183), NOW)?.tone).toBe('aging');
    expect(cvAge(ago(364), NOW)?.tone).toBe('aging');
    expect(cvAge(ago(365), NOW)?.tone).toBe('old');
    expect(cvAge(ago(900), NOW)?.tone).toBe('old');
  });

  it('writes the date as "12 Nov 2026" and tells a replaced CV by its day', () => {
    expect(addedOnText('2026-11-12T10:00:00Z')).toBe('12 Nov 2026');
    expect(addedOnText('nonsense')).toBe('');
    expect(differentDay('2026-11-12T10:00:00Z', '2026-11-12T18:00:00Z')).toBe(false);   // same day: not "updated"
    expect(differentDay('2026-11-12T10:00:00Z', '2025-05-03T10:00:00Z')).toBe(true);
    expect(differentDay('2026-11-12T10:00:00Z', null)).toBe(false);
  });

  it('is null without a usable date, and never negative for a date in the future', () => {
    expect(cvAge(undefined, NOW)).toBeNull();
    expect(cvAge('', NOW)).toBeNull();
    expect(cvAge('not a date', NOW)).toBeNull();
    expect(cvAge(ago(-3), NOW)).toMatchObject({ label: 'Received today', days: 0 });
  });
});
