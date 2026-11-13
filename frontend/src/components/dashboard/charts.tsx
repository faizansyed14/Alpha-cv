'use client';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';

/** Width of an element in pixels, kept current as it is resized (charts are drawn at their real size so text is never stretched). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A round upper bound for an axis: 4, 5, 10, 20, 50, 100 ... */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

function shortDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function longDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** One series over time: a 2px line with a faint wash under it, a crosshair and a tooltip that follow the pointer. */
export function TrendChart({
  values,
  days,
  height = 220,
  unit = 'application',
}: {
  values: number[];
  days: string[];
  height?: number;
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const left = 34, right = 14, top = 14, bottom = 26;
  const max = niceMax(Math.max(0, ...values));
  const innerW = Math.max(0, width - left - right);
  const innerH = height - top - bottom;
  const n = values.length;
  const x = (i: number) => left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => top + innerH - (v / max) * innerH;

  const pts = innerW === 0 ? [] : values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${top + innerH} L${pts[0][0].toFixed(1)} ${top + innerH} Z` : '';

  const ticks = [0, max / 2, max];
  const labelEvery = width < 420 ? 4 : width < 640 ? 3 : 2;
  const total = values.reduce((a, b) => a + b, 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / Math.max(1, box.width);
    setHover(Math.min(n - 1, Math.max(0, Math.round(rel * (n - 1)))));
  };

  return (
    <motion.div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      onViewportEnter={() => setRevealed(true)}
      viewport={{ once: true, amount: 0.35, margin: '0px 0px -40px 0px' }}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${total} ${unit}${total === 1 ? '' : 's'} over the last ${n} days`} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} className="stroke-slate-100" strokeWidth={1} />
              <text x={left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-400 text-[10.5px] tabular-nums">{Math.round(t)}</text>
            </g>
          ))}
          {days.map((d, i) =>
            (n - 1 - i) % labelEvery === 0 ? (
              <text key={d} x={x(i)} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[10.5px]">{shortDay(d)}</text>
            ) : null,
          )}
          <motion.path
            d={area}
            className="fill-navy-700"
            initial={{ opacity: 0 }}
            animate={revealed ? { opacity: 0.1 } : { opacity: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease }}
          />
          <motion.path
            d={line}
            fill="none"
            className="stroke-navy-700"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={revealed ? { pathLength: 1 } : { pathLength: 0 }}
            transition={{ duration: 0.85, ease }}
          />
          {n > 0 && hover === null && (
            <motion.circle
              cx={x(n - 1)}
              cy={y(values[n - 1])}
              r={4}
              className="fill-navy-700 stroke-white"
              strokeWidth={2}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={revealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.25, delay: 0.7, ease }}
            />
          )}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + innerH} className="stroke-slate-300" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(values[hover])} r={4.5} className="fill-navy-700 stroke-white" strokeWidth={2} />
            </g>
          )}
          <rect
            x={left}
            y={0}
            width={innerW}
            height={height}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-surface-border bg-paper px-3 py-2 shadow-md"
          style={{ left: Math.min(width - 70, Math.max(70, x(hover))), top: Math.max(8, y(values[hover]) - 10) }}
        >
          <p className="text-md font-semibold leading-none tabular-nums text-slate-900">
            {values[hover]} <span className="text-2xs font-medium text-slate-500">{unit}{values[hover] === 1 ? '' : 's'}</span>
          </p>
          <p className="mt-1 text-2xs text-slate-500">{longDay(days[hover])}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>{`${unit}s per day`}</caption>
        <tbody>
          {days.map((d, i) => (
            <tr key={d}><th scope="row">{d}</th><td>{values[i]}</td></tr>
          ))}
        </tbody>
      </table>
      {total === 0 && width > 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-[42%] text-center text-xs text-slate-400">No {unit}s in this period yet</p>
      )}
    </motion.div>
  );
}

/** A tiny line for a stat card: 2px, an end dot with a surface ring. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const W = 120, H = 36, pad = 4;
  if (values.length < 2) return <div className={cn('h-9 w-[120px]', className)} />;
  const max = Math.max(1, ...values);
  const step = (W - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)] as const);
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-9 w-[120px]', className)} aria-hidden>
      <path d={d} fill="none" className="stroke-navy-600" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={4} className="fill-navy-600 stroke-white" strokeWidth={2} />
    </svg>
  );
}

/** Columns for a handful of categories (months): at most 24px wide, 4px rounded tops, the value on the cap, a tooltip on hover. */
export function MonthBars({ months, unit = 'job' }: { months: { key: string; label: string; count: number }[]; unit?: string }) {
  const max = niceMax(Math.max(0, ...months.map((m) => m.count)));
  const [hover, setHover] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const plot = 150;
  return (
    <motion.div
      onViewportEnter={() => setRevealed(true)}
      viewport={{ once: true, amount: 0.35, margin: '0px 0px -40px 0px' }}
    >
      <div className="flex items-end gap-2" style={{ height: plot + 22 }}>
        {months.map((m, i) => {
          const h = m.count === 0 ? 3 : Math.max(8, Math.round((m.count / max) * plot));
          const current = i === months.length - 1;
          return (
            <div
              key={m.key}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
              onPointerEnter={() => setHover(m.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(m.key)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${m.label}: ${m.count} ${unit}${m.count === 1 ? '' : 's'} posted`}
            >
              {hover === m.key && revealed && (
                <div className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-lg border border-surface-border bg-paper px-2.5 py-1.5 shadow-md" style={{ bottom: h + 26 }}>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">{m.count}</span>
                  <span className="ml-1 text-2xs text-slate-500">{unit}{m.count === 1 ? '' : 's'} in {m.label}</span>
                </div>
              )}
              <motion.span
                className="mb-1 text-2xs font-semibold tabular-nums text-slate-600"
                initial={{ opacity: 0 }}
                animate={revealed ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.25, delay: 0.12 + i * 0.06, ease }}
              >
                {m.count > 0 ? m.count : ''}
              </motion.span>
              <motion.div
                className={cn(
                  'w-full max-w-[24px] origin-bottom rounded-t-[4px]',
                  m.count === 0 ? 'bg-slate-100' : hover === m.key ? 'bg-solid-soft' : current ? 'bg-solid-soft' : 'bg-navy-400',
                )}
                initial={{ height: 0 }}
                animate={revealed ? { height: h } : { height: 0 }}
                transition={{ duration: 0.55, delay: i * 0.07, ease }}
              />
              <span className={cn('mt-1.5 text-2xs', current ? 'font-semibold text-slate-800' : 'text-slate-400')}>{m.label}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/** One whole split in two: a thin rounded bar with a 2px gap between the parts. */
export function SplitBar({ parts }: { parts: { label: string; value: number; className: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-slate-100" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.label} className={cn('h-full first:rounded-l-full last:rounded-r-full', p.className)} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', p.className)} />
            {p.label}
            <span className="font-semibold tabular-nums text-slate-900">{p.value.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
