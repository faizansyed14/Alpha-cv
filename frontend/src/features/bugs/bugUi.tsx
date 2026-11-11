import { cn } from '@/lib/utils';
import type { BugSeverity, BugStatus } from '@/lib/types';

export const BUG_AREAS = [
  'Dashboard', 'Candidates', 'Job descriptions', 'Match', 'Upload', 'Careers', 'AI agents', 'Login or account', 'Other',
] as const;

export const SEVERITIES: { value: BugSeverity; label: string; hint: string; chip: string; dot: string }[] = [
  { value: 'low', label: 'Low', hint: 'Cosmetic, easy to work around', chip: 'chip-neutral', dot: 'bg-slate-400' },
  { value: 'medium', label: 'Medium', hint: 'Something is off but I can continue', chip: 'chip-brand', dot: 'bg-navy-500' },
  { value: 'high', label: 'High', hint: 'A feature does not work', chip: 'chip-warning', dot: 'bg-amber-500' },
  { value: 'critical', label: 'Critical', hint: 'I cannot do my work', chip: 'chip-danger', dot: 'bg-red-500' },
];

export const STATUSES: { value: BugStatus; label: string; chip: string }[] = [
  { value: 'open', label: 'Open', chip: 'chip-warning' },
  { value: 'in_progress', label: 'In progress', chip: 'chip-brand' },
  { value: 'resolved', label: 'Resolved', chip: 'chip-success' },
  { value: 'closed', label: 'Closed', chip: 'chip-neutral' },
];

export function SeverityChip({ severity }: { severity: BugSeverity }) {
  const s = SEVERITIES.find((x) => x.value === severity) ?? SEVERITIES[1];
  return (
    <span className={cn('chip gap-1.5', s.chip)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

export function StatusChip({ status }: { status: BugStatus }) {
  const s = STATUSES.find((x) => x.value === status) ?? STATUSES[0];
  return <span className={cn('chip', s.chip)}>{s.label}</span>;
}

/** "5m ago", "3h ago", "2d ago", then the date. */
export function whenLabel(iso?: string | null): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '-';
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullWhen(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function shortId(id: string): string {
  return `BUG-${id.slice(0, 6).toUpperCase()}`;
}

/** Any API error (string, FastAPI 422 list, axios error) as one readable line. */
export function errText(err: unknown, fallback: string): string {
  const e = err as { detail?: unknown; response?: { data?: { detail?: unknown } }; message?: string };
  const d = e?.detail ?? e?.response?.data?.detail;
  if (Array.isArray(d)) {
    return d.map((x: { loc?: unknown[]; msg?: string }) => `${(x.loc || []).slice(1).join('.') || 'field'}: ${x.msg}`).join('; ') || fallback;
  }
  if (typeof d === 'string' && d) return d;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return fallback;
}
