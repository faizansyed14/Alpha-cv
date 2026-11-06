'use client';

import { useEffect, useState } from 'react';

/** Reveals `text` as if it were being typed (about two seconds in all). Shows it at once when `active` is false. */
export function Typewriter({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) { setN(text.length); return; }
    let raf = 0;
    const start = performance.now();
    const perSecond = Math.max(500, text.length / 2.2);
    const tick = (t: number) => {
      const k = Math.min(text.length, Math.floor(((t - start) / 1000) * perSecond));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, active]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      {n < text.length && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse bg-current align-text-bottom" />}
    </span>
  );
}
