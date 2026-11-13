'use client';

import { BarChart3 } from '@/components/icons';
import { EmptyState } from '@/components/ui/page';
import { cn } from '@/lib/utils';

/** One colour per status, the same everywhere on the page so a reader learns it once. */
export const STATUS_COLOR = {
  open: '#0ea5e9',
  submitted: '#10b981',
  hold: '#f59e0b',
  closed: '#1e3a8a',
  canceled: '#f43f5e',
} as const;

export type StatusKey = keyof typeof STATUS_COLOR;
export type StatusCounts = Record<StatusKey, number>;

const LABEL: Record<StatusKey, string> = { open: 'Open', submitted: 'Submitted', hold: 'Hold', closed: 'Closed', canceled: 'Cancelled' };
const ORDER: StatusKey[] = ['closed', 'open', 'submitted', 'hold', 'canceled'];

/** A ring split into one arc per status, with a number in the middle. */
export function Donut({ counts, size = 168, thickness = 24, centre, caption }: { counts: StatusCounts; size?: number; thickness?: number; centre: string; caption?: string }) {
  const total = ORDER.reduce((n, k) => n + counts[k], 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const used = ORDER.filter((k) => counts[k] > 0);
  const gap = used.length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img"
      aria-label={total ? ORDER.map((k) => `${LABEL[k]} ${counts[k]}`).join(', ') : 'No requirements'}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={thickness} className="text-slate-100" />
      {used.map((k) => {
        const len = Math.max(0, (counts[k] / total) * c - gap);
        const el = (
          <circle
            key={k} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={STATUS_COLOR[k]} strokeWidth={thickness}
            strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
        offset += (counts[k] / total) * c;
        return el;
      })}
      <text x="50%" y={caption ? '47%' : '50%'} textAnchor="middle" dominantBaseline="central" className="fill-slate-900 font-semibold" style={{ fontSize: size * 0.22 }}>{centre}</text>
      {caption && <text x="50%" y="63%" textAnchor="middle" dominantBaseline="central" className="fill-slate-400" style={{ fontSize: Math.max(10, size * 0.075) }}>{caption}</text>}
    </svg>
  );
}

/** What each colour means, with the count and its share. */
export function Legend({ counts, className }: { counts: StatusCounts; className?: string }) {
  const total = ORDER.reduce((n, k) => n + counts[k], 0);
  return (
    <ul className={cn('space-y-2', className)}>
      {ORDER.map((k) => (
        <li key={k} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: STATUS_COLOR[k] }} />
          <span className="text-slate-600">{LABEL[k]}</span>
          <span className="ml-auto font-semibold tabular-nums text-slate-900">{counts[k].toLocaleString()}</span>
          <span className="w-10 text-right text-xs tabular-nums text-slate-400">{total ? `${Math.round((counts[k] / total) * 100)}%` : '-'}</span>
        </li>
      ))}
    </ul>
  );
}

/** A titled donut with its legend: one location, or everyone. */
export function StatusDonut({ title, subtitle, counts, centreLabel }: { title: string; subtitle?: string; counts: StatusCounts; centreLabel?: string }) {
  const total = ORDER.reduce((n, k) => n + counts[k], 0);
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Donut counts={counts} centre={total.toLocaleString()} caption={centreLabel ?? 'requirements'} />
        <Legend counts={counts} className="min-w-[11rem] max-w-sm flex-1" />
      </div>
    </div>
  );
}

/** One recruiter: a small ring of what they were given and what became of it. */
export function RecruiterDonut({ name, location, counts }: { name: string; location?: string | null; counts: StatusCounts }) {
  const assigned = ORDER.reduce((n, k) => n + counts[k], 0);
  const rate = assigned ? Math.round((counts.closed / assigned) * 100) : 0;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-surface-border bg-paper p-3">
      <Donut counts={counts} size={92} thickness={13} centre={`${rate}%`} caption="closed" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900" title={name}>{name}</p>
        {location && <p className="truncate text-xs text-slate-400">{location}</p>}
        <p className="mt-1 text-xs text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{assigned}</span> assigned</p>
        <p className="text-xs text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{counts.closed}</span> closed</p>
        <p className="text-xs text-slate-400">{counts.open + counts.submitted + counts.hold} still working{counts.canceled ? `, ${counts.canceled} cancelled` : ''}</p>
      </div>
    </div>
  );
}

/** One plain bar per day or month: how many requirements were closed. Nothing else on it. */
export function ClosedBars({ data, period }: { data: Array<{ key: string; label: string; closed: number }>; period: string }) {
  const max = Math.max(1, ...data.map((d) => d.closed));
  const total = data.reduce((n, d) => n + d.closed, 0);
  if (!total) return <EmptyState compact icon={BarChart3} title={`Nothing was closed in ${period}`} hint="Pick another month or year." />;
  const daily = data.length > 12;
  const showLabel = (i: number) => !daily || i === 0 || (i + 1) % 5 === 0;
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600"><span className="font-semibold text-slate-900">{total}</span> closed in {period}</p>
      <div role="img" aria-label={`Closed per ${daily ? 'day' : 'month'}: ${data.filter((d) => d.closed).map((d) => `${d.label} ${d.closed}`).join(', ')}`} className={cn('flex h-40 items-end border-b border-slate-200', daily ? 'gap-0.5' : 'gap-2')}>
        {data.map((d) => (
          <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${d.label}: ${d.closed} closed`}>
            {d.closed > 0 && <span className="mb-0.5 text-2xs font-semibold tabular-nums text-slate-700">{d.closed}</span>}
            <div className={cn('w-full max-w-[26px] rounded-t', d.closed ? 'bg-navy-800' : 'bg-transparent')} style={{ height: d.closed ? `${Math.max(6, (d.closed / max) * 82)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className={cn('mt-1.5 flex', daily ? 'gap-0.5' : 'gap-2')}>
        {data.map((d, i) => <span key={d.key} className="min-w-0 flex-1 text-center text-2xs text-slate-500">{showLabel(i) ? d.label : ''}</span>)}
      </div>
    </div>
  );
}
