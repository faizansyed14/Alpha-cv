'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, Download, Eye, Loader2, RefreshCw, Search, Trophy, X } from '@/components/icons';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useDocPreview } from '@/components/agentic/cards/actions';
import { Bone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ToastContainer, useToast } from '@/components/ui/toast';
import type { ClosuresPage as ClosuresData, Requirement, RequirementFilters, TrackerOptions } from '@/lib/types';
import { cn } from '@/lib/utils';
import { errorText } from './jd';
import { CommentCell, LocationFilter, PersonFilter, StatusPill, MONTH_NAMES, durationParts, formatDay, todayIso, yearChoices, TRACKER_TH_STICKY, TRACKER_THEAD } from './shared';

const PAGE = 50;
const ALL = '__all__';

export function Initials({ name }: { name: string }) {
  const letters = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-50 text-2xs font-semibold text-navy-800 ring-1 ring-inset ring-navy-100">{letters}</span>;
}

/**
 * Closures: the requirements that were closed, each credited to the recruiter it was assigned to.
 * A recruiter sees their own; everyone else sees every recruiter's in their location (the EVP and the admin: every location).
 * Reopening one (by the recruiter or the recruitment manager) puts it back on the requirements page.
 */
export default function ClosuresPage() {
  const user = useAuthStore((s) => s.user);
  const mine = user?.role === 'user';
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const { open: previewJd, node: previewNode } = useDocPreview();

  const [options, setOptions] = useState<TrackerOptions | null>(null);
  const [data, setData] = useState<ClosuresData | null>(null);
  const [items, setItems] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [salesId, setSalesId] = useState('');
  // the Year and Month dropdowns: a year alone shows that year, with a month it shows that month
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { if (user) api.getTrackerOptions().then(setOptions).catch(() => undefined); }, [user]);

  const range = useMemo(() => {
    if (!year) return { from: '', to: '' };
    if (!month) return { from: `${year}-01-01`, to: `${year}-12-31` };
    const mm = month.padStart(2, '0');
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(new Date(Number(year), Number(month), 0).getDate()).padStart(2, '0')}` };
  }, [year, month]);
  const filters: RequirementFilters = useMemo(() => ({ q, location, recruiter_id: recruiterId, manager_id: managerId, sales_manager_id: salesId, date_from: range.from, date_to: range.to }), [q, location, recruiterId, managerId, salesId, range]);
  const filtered = !!(q || location || recruiterId || managerId || salesId || year);

  const run = useRef(0);
  const load = useCallback(async (keep = 0) => {
    const mineRun = ++run.current;
    try {
      const page = await api.listClosures(filters, Math.max(PAGE, keep), 0);
      if (mineRun !== run.current) return;
      setData(page);
      setItems(page.items);
      setError(null);
    } catch (e) {
      if (mineRun === run.current) setError(errorText(e, 'The closures could not be loaded.'));
    } finally {
      if (mineRun === run.current) setLoading(false);
    }
  }, [filters]);
  useEffect(() => { if (user) { setLoading(true); void load(); } }, [load, user]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await api.listClosures(filters, PAGE, items.length);
      setItems((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
    } catch (e) {
      showError('Could not load more', errorText(e, 'Please try again.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const reopen = async (r: Requirement) => {
    setReopening(r.id);
    try {
      await api.updateRequirement(r.id, { status: 'open' });
      showSuccess('Requirement reopened', `${r.position} for ${r.client} is back on the requirements page.`);
      await load(items.length);
    } catch (e) {
      showError('Not reopened', errorText(e, 'Please try again.'));
    } finally {
      setReopening(null);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const url = URL.createObjectURL(await api.exportClosures(filters));
      const a = document.createElement('a');
      a.href = url;
      a.download = `closures-${todayIso()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showError('Export failed', errorText(e, 'The Excel file could not be created.'));
    } finally {
      setExporting(false);
    }
  };

  const clear = () => { setSearch(''); setQ(''); setLocation(''); setRecruiterId(''); setManagerId(''); setSalesId(''); setYear(''); setMonth(''); };

  if (!user) return null;
  const canReopen = !!options?.editable?.status;
  const inPlace = (p: { location: string }) => !location || p.location === location;      // the manager filters follow the chosen location
  const recruiters = (options?.recruiters ?? []).filter(inPlace);   // follows the chosen location
  const total = data?.total ?? 0;
  const firstLoad = loading && !data;      // the page and its table header are real; only the data is a placeholder
  const years = yearChoices(data?.years, year ? Number(year) : undefined);      // the five years before and after this one, and any year with closures
  const periodText = year ? (month ? `${MONTH_NAMES[Number(month) - 1]} ${year}` : year) : 'All time';

  return (
    <div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <PageHeader
        title={mine ? 'My closures' : 'Closures'}
        description={mine ? 'The requirements you closed.' : 'Closed requirements, each credited to the recruiter who closed it.'}
        actions={<Button variant="secondary" size="sm" icon={<Download />} onClick={() => void exportExcel()} loading={exporting} disabled={loading || total === 0}>Export to Excel</Button>}
      />

      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <StatCard compact label={year ? `Closed in ${periodText}` : 'Closed'} value={(data?.summary.closed ?? 0).toLocaleString()} loading={firstLoad} icon={Trophy} tone="emerald" hint={periodText} />
        <StatCard compact label="Closed this month" value={(data?.summary.closed_this_month ?? 0).toLocaleString()} loading={firstLoad} icon={CheckCircle2} tone="blue" />
        <StatCard compact label="Avg days to close" value={data?.summary.avg_days != null ? String(data.summary.avg_days) : '-'} loading={firstLoad} icon={Clock} tone="amber" hint="From the requirement date" />
      </div>

      <div className="toolbar-bar !mb-3 min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 w-full flex-1 sm:min-w-[200px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <label htmlFor="cl-search" className="sr-only">Search closures</label>
          <input id="cl-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={mine ? 'Search role or client' : 'Search role, client, recruiter'} className="field-input h-8 w-full !pl-8 pr-7 text-sm" maxLength={100} />
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {options?.all_locations && (
          <LocationFilter value={location} locations={options.locations} onChange={(l) => { setLocation(l); setRecruiterId(''); setManagerId(''); setSalesId(''); }} className="w-full sm:w-[9.5rem]" />
        )}
        {!mine && (<>
          <Select value={recruiterId || ALL} onValueChange={(v) => setRecruiterId(v === ALL ? '' : v)}>
            <SelectTrigger aria-label="Recruiter" className="h-8 w-full text-xs sm:w-[10.5rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All recruiters</SelectItem>
              {recruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.username}</SelectItem>)}
            </SelectContent>
          </Select>
          <PersonFilter label="Recruitment manager" all="All recruitment managers" value={managerId} people={(options?.managers ?? []).filter(inPlace)} onChange={setManagerId} className="w-full sm:w-[12.5rem]" />
          <PersonFilter label="Sales manager" all="All sales managers" value={salesId} people={(options?.sales_managers ?? []).filter(inPlace)} onChange={setSalesId} className="w-full sm:w-[11rem]" />
        </>)}
        <Select value={year || ALL} onValueChange={(v) => { setYear(v === ALL ? '' : v); if (v === ALL) setMonth(''); }}>
          <SelectTrigger aria-label="Year" className="h-8 w-[calc(50%-0.25rem)] text-xs sm:w-[7.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={month || ALL} onValueChange={(v) => { setMonth(v === ALL ? '' : v); if (v !== ALL && !year) setYear(String(new Date().getFullYear())); }}>
          <SelectTrigger aria-label="Month" className="h-8 w-[calc(50%-0.25rem)] text-xs sm:w-[8.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>All months</SelectItem>
            {MONTH_NAMES.map((name, i) => <SelectItem key={name} value={String(i + 1)}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered && <Button variant="ghost" size="sm" icon={<X />} onClick={clear}>Clear</Button>}
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button type="button" className="ml-auto font-semibold underline underline-offset-2" onClick={() => void load(items.length)}>Retry</button>
        </div>
      )}

      {!firstLoad && items.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title={filtered ? 'No closures match these filters' : mine ? 'You have not closed a requirement yet' : 'Nothing has been closed yet'}
          hint={filtered ? 'Change the search or the filters above.' : 'When a requirement is closed it leaves the requirements page and appears here.'}
          action={filtered ? <Button variant="secondary" onClick={clear}>Clear the filters</Button> : undefined}
        />
      ) : (
        <>
          <Table className="min-w-[1780px] [&_td]:px-2.5 [&_th]:whitespace-normal [&_th]:px-2.5">
            <THead className={TRACKER_THEAD}>
              <TR className="hover:bg-transparent">
                <TH className="w-12">S.No</TH>
                <TH>Position</TH>
                <TH>Client</TH>
                <TH>{mine ? 'Closed by' : 'Recruiter'}</TH>
                <TH>Recruitment manager</TH>
                <TH>Sales manager</TH>
                <TH>Requirement date</TH>
                <TH>Submission deadline</TH>
                <TH>CVs submitted on</TH>
                <TH className="text-center">No. of CVs submitted</TH>
                <TH>Status</TH>
                {!mine && <TH className="min-w-[7rem]">Sales manager comments</TH>}
                <TH className="min-w-[7rem]">Recruitment manager comments</TH>
                <TH className="min-w-[7rem]">Recruiter comments</TH>
                <TH>Job location</TH>
                <TH>Salary</TH>
                <TH>Job duration</TH>
                <TH>Closed on</TH>
                <TH className="text-right">Days to close</TH>
                <TH>JD</TH>
                {canReopen && <TH className={cn(TRACKER_TH_STICKY, 'text-right')}>Action</TH>}
              </TR>
            </THead>
            <TBody aria-busy={firstLoad}>
              {firstLoad ? Array.from({ length: 6 }).map((_, i) => (
                <TR key={i} className="align-top">
                  <TD><Bone className="h-4 w-5" /></TD>
                  <TD><Bone className="h-4 w-36" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><div className="flex items-center gap-2"><Bone className="h-7 w-7 shrink-0 rounded-full" /><Bone className="h-4 w-24" /></div></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><div className="flex justify-center"><Bone className="h-4 w-6" /></div></TD>
                  <TD><Bone className="h-6 w-20 rounded-full" /></TD>
                  {!mine && <TD><Bone className="h-3 w-24" /><Bone className="mt-1.5 h-3 w-16" /></TD>}
                  <TD><Bone className="h-3 w-24" /><Bone className="mt-1.5 h-3 w-16" /></TD>
                  <TD><Bone className="h-3 w-24" /></TD>
                  <TD><Bone className="h-4 w-24" /></TD>
                  <TD><Bone className="h-4 w-16" /></TD>
                  <TD><Bone className="h-4 w-16" /><Bone className="mt-1.5 h-3 w-14" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><div className="flex justify-end"><Bone className="h-4 w-6" /></div></TD>
                  <TD><Bone className="h-7 w-20 rounded-lg" /></TD>
                  {canReopen && <TD className="sticky right-0 z-[1] bg-paper shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.14)]"><div className="flex justify-end"><Bone className="h-8 w-20 rounded-lg" /></div></TD>}
                </TR>
              )) : items.map((r, i) => {
                const who = r.recruiter?.username ?? 'Unassigned';
                return (
                  <TR key={r.id} className="align-top">
                    <TD className="tabular-nums text-slate-400">{i + 1}</TD>
                    <TD className="min-w-[11rem] font-semibold text-slate-900">{r.position}</TD>
                    <TD className="min-w-[7rem]">{r.client}</TD>
                    <TD className="min-w-[9rem]">
                      <div className="flex items-center gap-2">
                        <Initials name={who} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{who}</p>
                          {r.closed_by && r.closed_by !== who && <p className="text-2xs text-slate-400">Marked closed by {r.closed_by}</p>}
                          {r.recruiters.length > 1 && <p className="truncate text-2xs text-slate-400" title={r.recruiters.map((x) => x.username).join(', ')}>With {r.recruiters.filter((x) => x.id !== r.recruiter?.id).map((x) => x.username).join(', ')}</p>}
                        </div>
                      </div>
                    </TD>
                    <TD className="min-w-[6rem] text-slate-700">{r.manager?.username || <span className="text-slate-300">-</span>}</TD>
                    <TD className="min-w-[6rem] text-slate-700">{r.sales_manager?.username || <span className="text-slate-300">-</span>}</TD>
                    <TD className="whitespace-nowrap tabular-nums">{formatDay(r.requirement_date)}</TD>
                    <TD className="whitespace-nowrap tabular-nums">{r.cv_submission_date ? formatDay(r.cv_submission_date) : <span className="text-slate-300">-</span>}</TD>
                    <TD className="whitespace-nowrap tabular-nums">{r.cvs_submitted_date ? formatDay(r.cvs_submitted_date) : <span className="text-slate-300">-</span>}</TD>
                    <TD className="text-center tabular-nums">{r.cvs_submitted_count == null ? <span className="text-slate-300">-</span> : r.cvs_submitted_count.toLocaleString()}</TD>
                    <TD><StatusPill status={r.status} /></TD>
                    {!mine && <TD><CommentCell width="w-28" label="Sales manager comments" value={r.sales_comments} editable={false} onSave={async () => false} /></TD>}
                    <TD><CommentCell width="w-28" label="Recruitment manager comments" value={r.rm_comments} editable={false} onSave={async () => false} /></TD>
                    <TD><CommentCell width="w-28" label="Recruiter comments" value={r.recruiter_comments} editable={false} onSave={async () => false} /></TD>
                    <TD className="min-w-[6rem]">{r.job_location || <span className="text-slate-300">-</span>}</TD>
                    <TD className="min-w-[6.75rem] tabular-nums">{r.salary || <span className="text-slate-300">-</span>}</TD>
                    <TD className="min-w-[5.5rem]">
                      {(() => {
                        const d = durationParts(r);
                        return d ? (<><p className="whitespace-nowrap text-slate-800">{d.main}</p>{d.note && <p className="text-2xs text-slate-400">{d.note}</p>}</>) : <span className="text-slate-300">-</span>;
                      })()}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{formatDay(r.closed_at)}</TD>
                    <TD className="text-right tabular-nums font-semibold">{r.days_to_close ?? '-'}</TD>
                    <TD>
                      {r.jd_id ? (
                        <button type="button" onClick={() => void previewJd(r.jd_id!, 'jd', r.jd_filename || undefined)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-paper px-2 py-1 text-xs font-medium text-slate-700 shadow-soft hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800" title="Preview the job description">
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </button>
                      ) : <span className="text-slate-300">-</span>}
                    </TD>
                    {canReopen && (
                      <TD className="sticky right-0 z-[1] bg-paper shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.14)] text-right">
                        <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => void reopen(r)} loading={reopening === r.id}>Reopen</Button>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {!firstLoad && <p className="mt-2 text-center text-xs tabular-nums text-slate-500">{items.length.toLocaleString()} of {total.toLocaleString()} closure{total === 1 ? '' : 's'}</p>}
          {!firstLoad && items.length < total && (
            <div className="mt-2 flex justify-center"><Button variant="secondary" size="sm" onClick={() => void loadMore()} loading={loadingMore}>Load more</Button></div>
          )}
        </>
      )}
      {previewNode}
    </div>
  );
}
