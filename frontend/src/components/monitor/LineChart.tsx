'use client';

import { useId, useMemo, useState } from 'react';

export interface ChartPoint {
  /** Unix seconds at the start of the period */
  t: number;
  v: number | null;
}

interface LineChartProps {
  points: ChartPoint[];
  /** Optional second series drawn in red (failures) */
  errors?: ChartPoint[];
  label: string;
  height?: number;
  integer?: boolean;
  format?: (v: number) => string;
}

const W = 600;
const PAD = { l: 8, r: 8, t: 8, b: 18 };

/** Small dependency-free SVG line chart with a hover read-out. Gaps (null) break the line. */
export function LineChart({ points, errors, label, height = 140, integer, format }: LineChartProps) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const fmt = format ?? ((v: number) => (integer ? String(Math.round(v)) : v.toFixed(1)));

  const { path, area, errPath, max, xs } = useMemo(() => {
    const values = points.map((p) => p.v).filter((v): v is number => v != null);
    const errVals = (errors ?? []).map((p) => p.v ?? 0);
    const top = Math.max(1, ...values, ...errVals);
    const n = Math.max(1, points.length - 1);
    const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
    const y = (v: number) => height - PAD.b - (v / top) * (height - PAD.t - PAD.b);
    const line = (series: (number | null)[]) => {
      let d = '';
      let pen = false;
      series.forEach((v, i) => {
        if (v == null) {
          pen = false;
          return;
        }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
      });
      return d.trim();
    };
    const main = line(points.map((p) => p.v));
    const base = height - PAD.b;
    return {
      path: main,
      area: main && points.every((p) => p.v != null) ? `${main} L${x(points.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z` : '',
      errPath: errors && errVals.some((v) => v > 0) ? line(errors.map((p) => p.v ?? 0)) : '',
      max: top,
      xs: points.map((_, i) => x(i)),
    };
  }, [points, errors, height]);

  const empty = !points.some((p) => p.v != null && p.v > 0);
  const active = hover != null ? points[hover] : null;

  return (
    <div className="relative" aria-label={label}>
      {empty ? (
        <div className="flex items-center justify-center text-sm text-ink-muted" style={{ height }}>
          No data in this window
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full"
          style={{ height }}
          role="img"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const rel = ((e.clientX - rect.left) / rect.width) * W;
            let best = 0;
            xs.forEach((x, i) => {
              if (Math.abs(x - rel) < Math.abs(xs[best] - rel)) best = i;
            });
            setHover(best);
          }}
        >
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1={PAD.l} x2={W - PAD.r} y1={height - PAD.b} y2={height - PAD.b} stroke="currentColor" strokeOpacity="0.15" />
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t} y2={PAD.t} stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3 4" />
          {area ? <path d={area} fill={`url(#g${id})`} className="text-navy-500" /> : null}
          {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" className="text-navy-500" /> : null}
          {errPath ? <path d={errPath} fill="none" stroke="#dc2626" strokeWidth="1.5" /> : null}
          {hover != null ? <line x1={xs[hover]} x2={xs[hover]} y1={PAD.t} y2={height - PAD.b} stroke="currentColor" strokeOpacity="0.25" /> : null}
          <text x={PAD.l} y={height - 4} fontSize="10" fill="currentColor" opacity="0.55">
            {points.length ? new Date(points[0].t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </text>
          <text x={W - PAD.r} y={height - 4} fontSize="10" fill="currentColor" opacity="0.55" textAnchor="end">
            {points.length ? new Date(points[points.length - 1].t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
          </text>
          <text x={W - PAD.r} y={PAD.t + 9} fontSize="10" fill="currentColor" opacity="0.55" textAnchor="end">
            max {fmt(max)}
          </text>
        </svg>
      )}
      {active ? (
        <div className="pointer-events-none absolute right-2 top-1 rounded border border-surface-border bg-paper px-2 py-1 text-xs shadow-sm">
          <span className="text-ink-muted">{new Date(active.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{' '}
          <span className="font-semibold tabular-nums">{active.v == null ? 'n/a' : fmt(active.v)}</span>
        </div>
      ) : null}
    </div>
  );
}
