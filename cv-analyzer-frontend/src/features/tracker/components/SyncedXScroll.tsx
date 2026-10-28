'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

export function SyncedXScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const topRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<'top' | 'body' | null>(null);
  const [scrollW, setScrollW] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => setScrollW(body.scrollWidth);
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(body);
    if (body.firstElementChild) ro.observe(body.firstElementChild as Element);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const onTopScroll = () => {
    const top = topRef.current;
    const body = bodyRef.current;
    if (!top || !body) return;
    if (syncingRef.current === 'body') return;
    syncingRef.current = 'top';
    body.scrollLeft = top.scrollLeft;
    requestAnimationFrame(() => { syncingRef.current = null; });
  };

  const onBodyScroll = () => {
    const top = topRef.current;
    const body = bodyRef.current;
    if (!top || !body) return;
    if (syncingRef.current === 'top') return;
    syncingRef.current = 'body';
    top.scrollLeft = body.scrollLeft;
    requestAnimationFrame(() => { syncingRef.current = null; });
  };

  return (
    <div className={className}>
      <div ref={topRef} onScroll={onTopScroll} className="overflow-x-auto overflow-y-hidden border-b border-slate-100 bg-white">
        <div style={{ width: scrollW || 0, height: 12 }} />
      </div>
      <div ref={bodyRef} onScroll={onBodyScroll} className="overflow-x-auto">
        {children}
      </div>
    </div>
  );
}
