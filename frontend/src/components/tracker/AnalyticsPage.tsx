'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, ClipboardList, Clock, FileText, Hourglass, MapPin, Trophy, TrendingDown, TrendingUp, Users } from '@/components/icons';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Bone } from '@/components/skeletons';
import { EmptyState, PageHeader, Section } from '@/components/ui/page';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LOCATIONS } from '@/lib/locations';
import { TONE, type Tone } from '@/lib/tones';
import type { AnalyticsView, TrackerAnalytics } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Initials } from './ClosuresPage';
import { errorText } from './jd';
import { ClosedBars, RecruiterDonut, StatusDonut, type StatusCounts } from './AnalyticsCharts';
import { LocationFilter, MONTH_NAMES, TRACKER_THEAD, formatDay, yearChoices } from './shared';

/** How a number moved against the month or year before: "+3 vs February 2026". */
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const diff = now - before;
  if (diff === 0) return <span className="text-slate-400">Same as {label}</span>;
  const up = diff > 0;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('inline-flex items-center gap-0.5 font-semibold', up ? 'text-emerald-600' : 'text-rose-600')}>
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
        {up ? '+' : '-'}{Math.abs(diff).toLocaleString()}
      </span>
      <span className="text-slate-400">vs {label}</span>
    </span>
  );
}

function Kpi({ label, value, icon: Icon, tone, sub, loading, alert }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  sub?: React.ReactNode;
  loading?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-surface-border bg-paper p-4 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONE[tone].tile)}><Icon className="h-4 w-4" /></span>
      </div>
      {loading ? <Bone className="mt-3 h-8 w-16" /> : <p className={cn('stat-number mt-2 text-3xl', alert && 'text-rose-600')}>{value}</p>}
      <div className="mt-1 min-h-[1rem] text-xs text-slate-500">{loading ? <Bone className="h-3 w-28" /> : sub}</div>
    </div>
  );
}

const toCounts = (c: { open: number; submitted: number; hold: number; canceled: number; closed: number }): StatusCounts =>
  ({ open: c.open, submitted: c.submitted, hold: c.hold, canceled: c.canceled, closed: c.closed });

const num = (n: number | null | undefined) => (n == null ? '-' : n.toLocaleString());

/**
 * Analytics: what came in, what was closed and by whom, how fast, how many CVs were submitted, what is open now and what is overdue, for a
 * month or a year compared with the one before.
 *  - a recruiter sees their own numbers;
 *  - the recruitment manager and the sales manager see every recruiter of their location;
 *  - the EVP and the admin see Dubai and Abu Dhabi together, side by side, or one of them (the Location dropdown).
 */
export default function AnalyticsPage() {
  const user = useAuthStore((s) => s.user);
  const mine = user?.role === 'user';
  const canPickLocation = user?.role === 'evp' || user?.role === 'admin';
  const now = new Date();
  const [view, setView] = useState<AnalyticsView>('monthly');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [location, setLocation] = useState('');
  const [data, setData] = useState<TrackerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    api.getTrackerAnalytics({ view, year, month, location: canPickLocation ? location : undefined })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(errorText(e, 'The analytics could not be loaded.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user, view, year, month, location, canPickLocation]);

  if (!user) return null;
  const pending = loading && !data;                 // the page, its titles and table headers are real; only the numbers and charts are placeholders
  const team = data ? data.scope === 'team' : !mine;
  const both = !!data && data.locations.length > 0;  // Dubai and Abu Dhabi together
  const s = data?.summary;
  const periodText = data?.label ?? (view === 'yearly' ? String(year) : `${MONTH_NAMES[month - 1]} ${year}`);
  const years = yearChoices(data?.years, year);      // the five years before and after this one, and any year with data
  const maxClosed = Math.max(1, ...(data?.recruiters.map((r) => r.closed) ?? [1]));
  const placeText = data?.location ? `${data.location}` : canPickLocation ? 'Dubai and Abu Dhabi' : null;

  return (
    <div>
      <PageHeader
        title={mine ? 'My analytics' : 'Analytics'}
        description={mine
          ? 'What you closed, the CVs you submitted and what is open on your list.'
          : canPickLocation
            ? 'Dubai and Abu Dhabi: what came in, what was closed and by which recruiter, how fast, and what is overdue.'
            : 'What your location received and closed, and how each recruiter is doing.'}
        meta={placeText ? <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><MapPin className="h-3.5 w-3.5" /> {placeText}</span> : undefined}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canPickLocation && <LocationFilter value={location} locations={[...LOCATIONS]} onChange={setLocation} />}
            <Segmented<AnalyticsView>
              size="sm"
              value={view}
              onChange={setView}
              items={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]}
            />
            {view === 'monthly' && (
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger aria-label="Month" className="h-8 w-[8.5rem] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">{MONTH_NAMES.map((name, i) => <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger aria-label="Year" className="h-8 w-[6rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        }
      />

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" /> {error}</div>
      )}

      {data || pending ? (
        <div className={cn('space-y-4 transition-opacity', loading && !pending && 'opacity-60')} aria-busy={pending}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Received" value={num(s?.received)} icon={ClipboardList} tone="sky" loading={pending}
                 sub={s && <Delta now={s.received} before={s.previous_received} label={s.previous_label} />} />
            <Kpi label="Closed" value={num(s?.closed)} icon={Trophy} tone="emerald" loading={pending}
                 sub={s && <Delta now={s.closed} before={s.previous_closed} label={s.previous_label} />} />
            <Kpi label="Avg days to close" value={s?.avg_days != null ? String(s.avg_days) : '-'} icon={Clock} tone="amber" loading={pending}
                 sub={s && (s.median_days != null ? `Median ${s.median_days} days` : 'Nothing closed yet')} />
            <Kpi label="CVs submitted" value={num(s?.cvs_submitted)} icon={FileText} tone="cyan" loading={pending}
                 sub={mine ? 'By you, in this period' : 'By the recruiters, in this period'} />
            <Kpi label={mine ? 'Your open work' : 'Open work now'} value={num(s?.active_total)} icon={Hourglass} tone="blue" loading={pending}
                 sub={s && `${s.active.open} open, ${s.active.submitted} submitted, ${s.active.hold} hold`} />
            <Kpi label="Overdue" value={num(s?.overdue)} icon={AlertCircle} tone="rose" loading={pending} alert={!!s && s.overdue > 0}
                 sub="Open or on hold, deadline passed" />
          </div>

          <Section
            title={both ? 'Dubai and Abu Dhabi, compared' : mine ? 'Your requirements' : 'Requirements by status'}
            subtitle={`Closed is for ${periodText}. Open, submitted, hold and cancelled are what is on the list right now.`}
          >
            {pending ? (
              <div role="status" aria-label="Loading chart" className="flex flex-wrap items-center gap-6">
                <Bone className="h-[168px] w-[168px] rounded-full" /><div className="flex-1 space-y-3">{[0, 1, 2, 3, 4].map((i) => <Bone key={i} className="h-4 w-full max-w-xs" />)}</div>
              </div>
            ) : both ? (
              <div className="grid gap-8 md:grid-cols-2 md:divide-x md:divide-slate-100">
                {data!.locations.map((l, i) => (
                  <div key={l.location ?? 'none'} className={i ? 'md:pl-8' : ''}>
                    <StatusDonut title={l.location ?? 'Not assigned yet'} subtitle={`${l.recruiters} recruiters`} counts={toCounts(l)} />
                  </div>
                ))}
              </div>
            ) : (
              <StatusDonut title={mine ? 'All your requirements' : data?.location ?? 'All requirements'} counts={toCounts({ ...s!.active, canceled: s!.canceled, closed: s!.closed })} />
            )}
          </Section>

          <Section title={view === 'yearly' ? 'Closed each month' : 'Closed each day'} subtitle={periodText}>
            {pending ? <Bone className="h-40 w-full" /> : data ? <ClosedBars data={data.series} period={periodText} /> : null}
          </Section>

          {both && (
            <Section title="Dubai and Abu Dhabi" subtitle={`Side by side for ${periodText}`} bodyClassName="px-0 pb-0">
              <Table wrapperClassName="rounded-none border-0 border-t shadow-none" className="min-w-[860px]">
                <THead className={TRACKER_THEAD}>
                  <TR>
                    <TH>Location</TH>
                    <TH className="text-right">Recruiters</TH>
                    <TH className="text-right">Received</TH>
                    <TH>Closed</TH>
                    <TH className="text-right">Avg days</TH>
                    <TH className="text-right">CVs submitted</TH>
                    <TH className="text-right">Open work</TH>
                    <TH className="text-right">Overdue</TH>
                    <TH className="text-right">Cancelled</TH>
                  </TR>
                </THead>
                <TBody>
                  {data!.locations.map((l) => (
                    <TR key={l.location ?? 'none'}>
                      <TD><span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {l.location ?? 'Not assigned yet'}</span></TD>
                      <TD className="text-right tabular-nums">{l.location ? l.recruiters : '-'}</TD>
                      <TD className="text-right tabular-nums">{l.received}</TD>
                      <TD className="min-w-[12rem]">
                        <div className="flex items-center gap-2">
                          <span className="w-6 text-right text-sm font-semibold tabular-nums text-slate-900">{l.closed}</span>
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-navy-700" style={{ width: `${(l.closed / Math.max(1, ...data!.locations.map((x) => x.closed))) * 100}%` }} /></span>
                          <span className="w-24 text-2xs"><Delta now={l.closed} before={l.previous_closed} label="before" /></span>
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums">{l.avg_days ?? '-'}</TD>
                      <TD className="text-right tabular-nums">{l.cvs_submitted}</TD>
                      <TD className="text-right tabular-nums" title={`${l.open} open, ${l.submitted} submitted, ${l.hold} hold`}>{l.active}</TD>
                      <TD className={cn('text-right tabular-nums', l.overdue > 0 && 'font-semibold text-rose-600')}>{l.overdue}</TD>
                      <TD className="text-right tabular-nums">{l.canceled}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}

          {team && (pending || (data && data.recruiters.length > 0)) && (
            <Section title="Assigned and closed, by recruiter" subtitle="The ring shows what each recruiter was given: closed, still working and cancelled.">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {pending ? [0, 1, 2].map((i) => <Bone key={i} className="h-[118px] rounded-xl" />) : data?.recruiters.map((r) => (
                  <RecruiterDonut key={r.id ?? 'none'} name={r.username} location={both || canPickLocation ? r.location : null} counts={toCounts(r)} />
                ))}
              </div>
            </Section>
          )}

          {team && (
            <Section title="Recruiter performance" subtitle={`Closures and CVs in ${periodText}. Open work and cancelled are what each recruiter has now.`} bodyClassName="px-0 pb-0">
              {data && data.recruiters.length === 0 ? (
                <div className="px-5 pb-5"><EmptyState compact icon={Users} title="No recruiters yet" hint="Recruiters will be listed here." /></div>
              ) : (
                <Table wrapperClassName="rounded-none border-0 border-t shadow-none" className="min-w-[900px]">
                  <THead className={TRACKER_THEAD}>
                    <TR>
                      <TH className="w-10">#</TH>
                      <TH>Recruiter</TH>
                      {(both || canPickLocation) && <TH>Location</TH>}
                      <TH>Closed</TH>
                      <TH className="text-right">Avg days</TH>
                      <TH className="text-right">CVs submitted</TH>
                      <TH className="text-right">Open</TH>
                      <TH className="text-right">Submitted</TH>
                      <TH className="text-right">Hold</TH>
                      <TH className="text-right">Cancelled</TH>
                      <TH>Last closed</TH>
                    </TR>
                  </THead>
                  <TBody aria-busy={pending}>
                    {pending ? Array.from({ length: 4 }).map((_, i) => (
                      <TR key={i}>
                        <TD><Bone className="h-4 w-4" /></TD>
                        <TD><div className="flex items-center gap-2"><Bone className="h-7 w-7 shrink-0 rounded-full" /><Bone className="h-4 w-24" /></div></TD>
                        {(both || canPickLocation) && <TD><Bone className="h-4 w-16" /></TD>}
                        <TD className="min-w-[10rem]"><div className="flex items-center gap-2"><Bone className="h-4 w-6" /><Bone className="h-2 flex-1 rounded-full" /></div></TD>
                        {[0, 1, 2, 3, 4, 5].map((k) => <TD key={k}><div className="flex justify-end"><Bone className="h-4 w-6" /></div></TD>)}
                        <TD><Bone className="h-4 w-20" /></TD>
                      </TR>
                    )) : data?.recruiters.map((r, i) => (
                      <TR key={r.id ?? 'none'}>
                        <TD className="tabular-nums text-slate-400">{i + 1}</TD>
                        <TD><div className="flex items-center gap-2"><Initials name={r.username} /><span className="font-medium text-slate-900">{r.username}</span></div></TD>
                        {(both || canPickLocation) && <TD className="text-slate-600">{r.location ?? <span className="text-slate-300">-</span>}</TD>}
                        <TD className="min-w-[10rem]">
                          <div className="flex items-center gap-2">
                            <span className="w-6 text-right text-sm font-semibold tabular-nums text-slate-900">{r.closed}</span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-navy-700" style={{ width: `${(r.closed / maxClosed) * 100}%` }} /></span>
                          </div>
                        </TD>
                        <TD className="text-right tabular-nums">{r.avg_days ?? '-'}</TD>
                        <TD className="text-right tabular-nums">{r.cvs_submitted}</TD>
                        <TD className="text-right tabular-nums">{r.open}</TD>
                        <TD className="text-right tabular-nums">{r.submitted}</TD>
                        <TD className="text-right tabular-nums">{r.hold}</TD>
                        <TD className="text-right tabular-nums">{r.canceled}</TD>
                        <TD className="whitespace-nowrap tabular-nums text-slate-600">{r.last_closed ? formatDay(r.last_closed) : <span className="text-slate-300">-</span>}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Section>
          )}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <Section title={mine ? 'Your latest closures' : 'Latest closures'} subtitle={`What was closed in ${periodText}, and by whom`} bodyClassName="px-0 pb-0">
              {pending ? (
                <div className="space-y-3 px-5 pb-5">{Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-5 w-full" />)}</div>
              ) : data && data.closures.length === 0 ? (
                <div className="px-5 pb-5"><EmptyState compact icon={Trophy} title={`No closures in ${periodText}`} hint="Closed requirements will be listed here." /></div>
              ) : (
                <Table wrapperClassName="rounded-none border-0 border-t shadow-none" className="min-w-[560px]">
                  <THead className={TRACKER_THEAD}>
                    <TR>
                      <TH>Position</TH>
                      <TH>Client</TH>
                      {!mine && <TH>Closed by</TH>}
                      {both && <TH>Location</TH>}
                      <TH>Closed on</TH>
                      <TH className="text-right">Days</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data?.closures.map((c, i) => (
                      <TR key={`${c.closed_at}-${i}`}>
                        <TD className="font-medium text-slate-900">{c.position}</TD>
                        <TD>{c.client}</TD>
                        {!mine && <TD><div className="flex items-center gap-2"><Initials name={c.recruiter} /><span>{c.recruiter}</span></div></TD>}
                        {both && <TD className="text-slate-600">{c.location ?? '-'}</TD>}
                        <TD className="whitespace-nowrap tabular-nums">{formatDay(c.closed_at)}</TD>
                        <TD className="text-right font-semibold tabular-nums">{c.days}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </Section>

            {(pending || (data && data.clients.length > 0)) && (
              <Section title="Top clients" subtitle={`Closed in ${periodText}`}>
                <ul className="space-y-3">
                  {pending ? Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm"><Bone className="h-4 w-32" /><Bone className="h-2 flex-1 rounded-full" /><Bone className="h-4 w-8" /></li>
                  )) : data?.clients.map((c) => (
                    <li key={c.client}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-medium text-slate-800" title={c.client}>{c.client}</span>
                        <span className="shrink-0 tabular-nums"><span className="font-semibold text-slate-900">{c.closed}</span>{c.avg_days != null && <span className="text-2xs text-slate-400"> · {c.avg_days} days</span>}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-navy-700" style={{ width: `${(c.closed / data.clients[0].closed) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
