import { describe, expect, it } from 'vitest';
import { parseAmount, rangeLabel, toRange } from './useNumberRange';

describe('the min / max filter boxes', () => {
  it('read numbers with thousands separators and decimals, and nothing else', () => {
    expect(parseAmount('15,000')).toBe(15000);
    expect(parseAmount(' 2.5 ')).toBe(2.5);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount('abc')).toBeUndefined();
    expect(parseAmount('-3')).toBeUndefined();
  });

  it('take either box alone, and a minimum above the maximum the other way round', () => {
    expect(toRange({ min: '10,000', max: '' })).toEqual({ min: 10000, max: undefined });
    expect(toRange({ min: '', max: '5' })).toEqual({ min: undefined, max: 5 });
    expect(toRange({ min: '8', max: '3' })).toEqual({ min: 3, max: 8 });
    expect(toRange({ min: '', max: '' })).toEqual({ min: undefined, max: undefined });
  });

  it('describe the range on the filter chip', () => {
    expect(rangeLabel({ min: 10000, max: 20000 })).toBe('10,000 – 20,000');
    expect(rangeLabel({ min: 3 })).toBe('from 3');
    expect(rangeLabel({ max: 5 })).toBe('up to 5');
    expect(rangeLabel({ min: 4, max: 4 })).toBe('4');
  });
});
