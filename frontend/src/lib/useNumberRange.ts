'use client';
import { useCallback, useEffect, useState } from 'react';

export interface NumberRange {
  min?: number;
  max?: number;
}

/** "15,000" → 15000; empty, negative or not a number → undefined. */
export function parseAmount(v: string): number | undefined {
  const t = v.replace(/[,\s]/g, '');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The range meant by two typed boxes: either may be empty, and a minimum above the maximum is read the other way round. */
export function toRange(text: { min: string; max: string }): NumberRange {
  let min = parseAmount(text.min);
  let max = parseAmount(text.max);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max };
}

/** "10,000 – 20,000", "from 10,000", "up to 20,000". */
export function rangeLabel(r: NumberRange): string {
  const f = (n: number) => n.toLocaleString();
  if (r.min != null && r.max != null) return r.min === r.max ? f(r.min) : `${f(r.min)} – ${f(r.max)}`;
  return r.min != null ? `from ${f(r.min)}` : `up to ${f(r.max ?? 0)}`;
}

/**
 * A min / max filter typed in two boxes. `text` is what is in the boxes; `range` follows it a moment after typing stops (so a search
 * is not run for every key) and keeps the same object while the numbers do not change, so it can be an effect dependency.
 */
export function useNumberRange(delay = 400) {
  const [text, setText] = useState({ min: '', max: '' });
  const [range, setRange] = useState<NumberRange>({});
  useEffect(() => {
    const t = setTimeout(() => {
      const next = toRange(text);
      setRange((prev) => (prev.min === next.min && prev.max === next.max ? prev : next));
    }, delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  const clear = useCallback(() => { setText({ min: '', max: '' }); setRange({}); }, []);
  /** Put back saved boxes: the range applies at once, without the typing pause. */
  const restore = useCallback((saved: { min: string; max: string }) => { setText(saved); setRange(toRange(saved)); }, []);
  return { text, setText, range, active: range.min != null || range.max != null, clear, restore };
}
