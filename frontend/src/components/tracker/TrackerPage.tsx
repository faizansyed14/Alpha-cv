'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Briefcase, CheckCircle, ClipboardList, Clock, Download, ExternalLink, Eye, FileText, Hourglass, Loader2, Pencil, Plus, Search, Send, Trash2, Trophy, Upload, X, XCircle } from '@/components/icons';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useDocPreview } from '@/components/agentic/cards/actions';
import { Bone } from '@/components/skeletons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ToastContainer, useToast } from '@/components/ui/toast';
import type { Requirement, RequirementFilters, RequirementInput, RequirementStats, RequirementStatus, TrackerOptions } from '@/lib/types';
import { cn } from '@/lib/utils';
import ClosureCelebration, { type ClosureCelebrationPayload } from './ClosureCelebration';
import RequirementDialog from './RequirementDialog';
import { errorText } from './jd';
import { CommentCell, RecruitersSelect, STATUS_META, STATUSES, StatusPill, StatusSelect, InlineCount, InlineDate, LocationFilter, PersonFilter, PersonSelect, durationParts, formatDay, todayIso, TRACKER_TH_STICKY, TRACKER_THEAD } from './shared';

const PAGE = 50;
const ALL = '__all__';
const NO_STATS: RequirementStats = { total: 0, open: 0, submitted: 0, hold: 0, closed: 0, canceled: 0, cvs_submitted: 0 };

/**
 * The requirements page of the tracker. What it shows depends on who is signed in:
 *  - the sales manager, recruitment managers, EVP and admin: every requirement of their location (the EVP and the admin see both, with no
 *    location to pick or show: it follows the people),
 *    with dropdowns to change the recruiter and the status, comments edited in place, and a form to add or change one.
 *  - a recruiter: only the requirements assigned to them, with the status, their comments and the job description. From a job
 *    description they can open Careers to post the job; nothing is posted until they click Post job there.
 * A requirement that is closed leaves this page: it is on the Closures page, credited to its recruiter.
 */
export default function TrackerPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { toasts, showSuccess, showError, removeToast } = useToast();
  const { open: previewJd, node: previewNode } = useDocPreview();

  const isRecruiter = user?.role === 'user';
  const mode: 'manage' | 'recruiter' = isRecruiter ? 'recruiter' : 'manage';

  const [options, setOptions] = useState<TrackerOptions | null>(null);
  const [items, setItems] = useState<Requirement[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<RequirementStats>(NO_STATS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<RequirementStatus | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [salesId, setSalesId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [dialog, setDialog] = useState<{ requirement: Requirement | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Requirement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [celebration, setCelebration] = useState<ClosureCelebrationPayload | null>(null);

  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const filters: RequirementFilters = useMemo(
    () => ({ status, q, location, recruiter_id: recruiterId, manager_id: managerId, sales_manager_id: salesId, date_from: dateFrom, date_to: dateTo }),
    [status, q, location, recruiterId, managerId, salesId, dateFrom, dateTo],
  );
  const filtered = !!(status || q || location || recruiterId || managerId || salesId || dateFrom || dateTo);

  useEffect(() => {
    if (!user) return;
    api.getTrackerOptions().then(setOptions).catch((e) => setError(errorText(e, 'The tracker could not be loaded.')));
  }, [user]);

  // the first page of what the filters match; an older answer that arrives late is dropped
  const run = useRef(0);
  const load = useCallback(async (keep = 0) => {
    const mine = ++run.current;
    try {
      const page = await api.listRequirements(filters, Math.max(PAGE, keep), 0);
      if (mine !== run.current) return;
      setItems(page.items);
      setTotal(page.total);
      setStats(page.stats);
      setError(null);
    } catch (e) {
      if (mine === run.current) setError(errorText(e, 'The requirements could not be loaded.'));
    } finally {
      if (mine === run.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { if (user) { setLoading(true); void load(); } }, [load, user]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await api.listRequirements(filters, PAGE, items.length);
      setItems((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setTotal(page.total);
      setStats(page.stats);
    } catch (e) {
      showError('Could not load more', errorText(e, 'Please try again.'));
    } finally {
      setLoadingMore(false);
    }
  };

  /** Change fields of one row. The row is replaced by the server's answer; returns false (and says why) when it was refused. */
  const patch = useCallback(async (id: string, body: RequirementInput): Promise<boolean> => {
    try {
      const updated = await api.updateRequirement(id, body);
      setItems((prev) => (updated.status === 'closed' ? prev.filter((r) => r.id !== id) : prev.map((r) => (r.id === id ? updated : r))));
      if (updated.status === 'closed') {
        setCelebration({
          position: updated.position,
          client: updated.client,
          recruiterName: updated.recruiter?.username ?? null,
        });
      }
      void load(items.length);                                // the tiles and the filters follow the change
      return true;
    } catch (e) {
      showError('Not saved', errorText(e, 'The change could not be saved. Please try again.'));
      return false;
    }
  }, [load, items.length, showError]);

  const remove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.deleteRequirement(confirmDelete.id);
      showSuccess('Requirement deleted', `${confirmDelete.position} for ${confirmDelete.client}`);
      setConfirmDelete(null);
      await load(items.length);
    } catch (e) {
      showError('Not deleted', errorText(e, 'Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const blob = await api.exportRequirements(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `requirements-${todayIso()}.xlsx`;
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

  const postInCareers = (r: Requirement) => {
    if (!r.jd_id) return;
    const q = new URLSearchParams({ postFromJd: r.jd_id, jdName: r.jd_filename || '', requirement: r.id });
    router.push(`/careers-manage?${q.toString()}`);
  };

  const clearFilters = () => { setStatus(''); setSearch(''); setQ(''); setLocation(''); setRecruiterId(''); setManagerId(''); setSalesId(''); setDateFrom(''); setDateTo(''); };

  if (!user) return null;
  const firstLoad = loading && items.length === 0;      // the page and its table header are real; only the data is a placeholder
  const manage = mode === 'manage';
  const ed = options?.editable;
  const today = todayIso();
  const recruiterList = options?.recruiters ?? [];
  const filterRecruiters = recruiterList.filter((r) => !location || r.location === location);   // the Recruiter filter follows the chosen location
  const inPlace = (p: { location: string }) => !location || p.location === location;      // the manager filters follow the chosen location
  const managerList = options?.managers ?? [];
  const salesList = options?.sales_managers ?? [];
  const assignable = (_r: Requirement) => recruiterList.map((x) => ({ id: x.id, username: x.username }));
  const withCurrent = (r: Requirement) => {
    const list = assignable(r);
    for (const x of r.recruiters) if (!list.some((y) => y.id === x.id)) list.push({ id: x.id, username: x.username });   // one who is no longer in the list is still shown
    return list;
  };


  const tiles: Array<{ key: keyof RequirementStats; label: string; icon: any; tone: 'blue' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan'; filter: RequirementStatus | '' }> = [
    { key: 'total', label: 'Total', icon: ClipboardList, tone: 'blue', filter: '' },
    { key: 'open', label: 'Open', icon: Clock, tone: 'sky', filter: 'open' },
    { key: 'submitted', label: 'Submitted', icon: Send, tone: 'emerald', filter: 'submitted' },
    { key: 'hold', label: 'Hold', icon: Hourglass, tone: 'amber', filter: 'hold' },
    { key: 'canceled', label: 'Cancelled', icon: XCircle, tone: 'rose', filter: 'canceled' },
    { key: 'closed', label: 'Closed', icon: Trophy, tone: 'violet', filter: 'closed' },      // opens the Closures page
    { key: 'cvs_submitted', label: 'CVs submitted', icon: FileText, tone: 'cyan', filter: '' },   // a total, not a status: it does not filter
  ];

  const header = (
    <PageHeader
      className="!mb-3"
      title={manage ? 'Requirements' : 'My requirements'}
      description={manage
        ? 'Who is working on each requirement, and where it stands.'
        : 'Requirements assigned to you. Keep status and comments current.'}
      actions={
        <>
          <Button variant="secondary" size="sm" icon={<Download />} onClick={() => void exportExcel()} loading={exporting} disabled={loading || total === 0}>Export to Excel</Button>
          {manage && options?.can_create && <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setDialog({ requirement: null })}>New requirement</Button>}
        </>
      }
    />
  );

  if (error && !options && items.length === 0) {
    return (
      <div>
        {header}
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            <button type="button" className="mt-1 font-semibold underline underline-offset-2" onClick={() => { setError(null); setLoading(true); void load(); api.getTrackerOptions().then(setOptions).catch(() => undefined); }}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      {header}

      {/* One row of short counters */}
      <div className={cn('mb-3 grid gap-1', isRecruiter ? 'grid-cols-4 sm:grid-cols-7' : 'grid-cols-3 sm:grid-cols-6')}>
        {/* the CVs submitted total is the recruiter's own check on how many they sent: managers, the EVP and the admin do not get it */}
        {tiles.filter((t) => t.key !== 'cvs_submitted' || isRecruiter).map((t) => (
          <StatCard
            key={t.key}
            compact
            label={t.key === 'cvs_submitted' ? 'CVs' : t.label}
            value={stats[t.key].toLocaleString()}
            loading={firstLoad}
            icon={t.icon}
            tone={t.tone}
            onClick={t.key === 'cvs_submitted' ? undefined : () => (t.key === 'closed' ? router.push('/tracker/closures') : setStatus(status === t.filter ? '' : t.filter))}
            aria-pressed={t.key !== 'closed' && t.filter !== '' && status === t.filter}
            hint={t.key === 'closed' ? 'Open Closures' : t.key === 'total' ? 'All, with closed' : t.key === 'cvs_submitted' ? 'On your requirements' : undefined}
            className={cn(t.filter !== '' && status === t.filter && 'ring-2 ring-navy-500/60')}
          />
        ))}
      </div>

      {/* filters */}
      <div className="toolbar-bar !mb-3 flex-wrap items-center gap-2">
        <div className="relative min-w-0 w-full flex-1 sm:max-w-xs sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <label htmlFor="rq-search" className="sr-only">Search requirements</label>
          <input id="rq-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={manage ? 'Search role, client, recruiter' : 'Search role or client'} className="field-input h-9 w-full !pl-8 pr-7 text-sm sm:h-8" maxLength={100} />
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-700 sm:p-0.5"><X className="h-3.5 w-3.5" /></button>}
        </div>

        <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? '' : (v as RequirementStatus))}>
          <SelectTrigger aria-label="Status" className="h-9 w-full text-xs sm:h-8 sm:w-[9.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.filter((s) => s !== 'closed').map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
          </SelectContent>
        </Select>

        {manage && options?.all_locations && (
          <LocationFilter value={location} locations={options.locations} onChange={(l) => { setLocation(l); setRecruiterId(''); setManagerId(''); setSalesId(''); }} />
        )}

        {manage && (
          <Select value={recruiterId || ALL} onValueChange={(v) => setRecruiterId(v === ALL ? '' : v)}>
            <SelectTrigger aria-label="Recruiter" className="h-9 w-full text-xs sm:h-8 sm:w-[10.5rem]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All recruiters</SelectItem>
              <SelectItem value="none">Unassigned</SelectItem>
              {filterRecruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.username}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {manage && <PersonFilter label="Recruitment manager" all="All recruitment managers" value={managerId} people={managerList.filter(inPlace)} onChange={setManagerId} className="w-full sm:w-[12.5rem]" />}
        {manage && <PersonFilter label="Sales manager" all="All sales managers" value={salesId} people={salesList.filter(inPlace)} onChange={setSalesId} className="w-full sm:w-[11rem]" />}

        <div className="flex w-full flex-wrap items-center gap-1.5 text-xs text-slate-500 sm:w-auto">
          <span>From</span>
          <Input type="date" aria-label="Requirement date from" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[min(100%,11rem)] flex-1 px-2 text-xs sm:h-8 sm:w-[8.75rem] sm:flex-none" />
          <span>to</span>
          <Input type="date" aria-label="Requirement date to" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[min(100%,11rem)] flex-1 px-2 text-xs sm:h-8 sm:w-[8.75rem] sm:flex-none" />
        </div>

        {filtered && <Button variant="ghost" size="sm" icon={<X />} onClick={clearFilters}>Clear</Button>}
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          <button type="button" className="ml-auto font-semibold underline underline-offset-2" onClick={() => void load(items.length)}>Retry</button>
        </div>
      )}

      {!firstLoad && items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={filtered ? 'No requirements match these filters' : manage ? 'No open requirements' : 'Nothing is assigned to you'}
          hint={filtered ? 'Change the search or the filters above.' : manage ? 'Add a requirement received from a client. Closed ones are on the Closures page.' : 'When a requirement is assigned to you it appears here. Closed ones are on the Closures page.'}
          action={filtered ? <Button variant="secondary" onClick={clearFilters}>Clear the filters</Button> : manage && options?.can_create ? <Button variant="primary" icon={<Plus />} onClick={() => setDialog({ requirement: null })}>New requirement</Button> : undefined}
        />
      ) : (
        <>
          <Table className={cn('[&_td]:px-2 [&_th]:whitespace-normal [&_th]:px-2', manage ? 'min-w-[1760px]' : 'min-w-[1520px]')}>
            <THead className={TRACKER_THEAD}>
              <TR className="hover:bg-transparent">
                <TH className="w-12">S.No</TH>
                <TH>Position</TH>
                <TH>Client</TH>
                {manage && <TH>Recruiter</TH>}
                <TH>Recruitment manager</TH>
                <TH>Sales manager</TH>
                <TH>Requirement date</TH>
                <TH>Submission deadline</TH>
                <TH>CVs submitted on</TH>
                <TH>No. of CVs submitted</TH>
                <TH>Status</TH>
                {manage && <TH className="min-w-[6.5rem] whitespace-normal">Sales manager comments</TH>}
                <TH className="min-w-[6.5rem] whitespace-normal">Recruitment manager comments</TH>
                <TH className="min-w-[6.5rem] whitespace-normal">Recruiter comments</TH>
                <TH>Job location</TH>
                <TH>Salary</TH>
                <TH>Job duration</TH>
                {!manage && <TH>Job description</TH>}
                {!manage && <TH className={TRACKER_TH_STICKY}>Careers</TH>}
                {manage && <TH className={cn(TRACKER_TH_STICKY, 'text-right')}>Actions</TH>}
              </TR>
            </THead>
            <TBody aria-busy={firstLoad}>
              {firstLoad ? Array.from({ length: 6 }).map((_, i) => (
                <TR key={i} className="align-top">
                  <TD><Bone className="h-4 w-5" /></TD>
                  <TD><Bone className="h-4 w-32" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  {manage && <TD><Bone className="h-8 w-28 rounded-lg" /></TD>}
                  <TD><Bone className="h-8 w-[8.75rem] rounded-lg" /></TD>
                  <TD><Bone className="h-8 w-[8.75rem] rounded-lg" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-8 w-[8.6rem] rounded-lg" /></TD>
                  <TD><Bone className="h-8 w-[4.5rem] rounded-lg" /></TD>
                  <TD><Bone className="h-8 w-[7.75rem] rounded-full" /></TD>
                  {manage && <TD><Bone className="h-3 w-24" /><Bone className="mt-1.5 h-3 w-16" /></TD>}
                  <TD><Bone className="h-3 w-24" /><Bone className="mt-1.5 h-3 w-14" /></TD>
                  <TD><Bone className="h-3 w-24" /></TD>
                  <TD><Bone className="h-4 w-24" /></TD>
                  <TD><Bone className="h-4 w-16" /></TD>
                  <TD><Bone className="h-4 w-16" /><Bone className="mt-1.5 h-3 w-14" /></TD>
                  {!manage && <TD><Bone className="h-7 w-28 rounded-lg" /></TD>}
                  {!manage && <TD><Bone className="h-8 w-32 rounded-lg" /></TD>}
                  {manage && <TD><div className="flex justify-end gap-1.5"><Bone className="h-8 w-8 rounded-lg" /><Bone className="h-8 w-8 rounded-lg" /></div></TD>}
                </TR>
              )) : items.map((r, i) => {
                const overdue = !!r.cv_submission_date && r.cv_submission_date < today && (r.status === 'open' || r.status === 'hold');
                return (
                  <TR key={r.id} className="align-top">
                    <TD className="tabular-nums text-slate-400">{i + 1}</TD>
                    <TD className="min-w-[7.5rem]">
                      <p className="font-semibold text-slate-900">{r.position}</p>
                    </TD>
                    <TD className="min-w-[5rem]">{r.client}</TD>
                    {manage && (
                      <TD>
                        {ed?.recruiter ? (
                          <RecruitersSelect value={r.recruiters.map((x) => x.id)} options={withCurrent(r)} onCommit={(ids) => void patch(r.id, { recruiter_ids: ids })} className="min-w-[6.25rem]" />
                        ) : <span className="text-sm text-slate-700">{r.recruiters.length ? r.recruiters.map((x) => x.username).join(', ') : <span className="text-slate-400">Unassigned</span>}</span>}
                      </TD>
                    )}
                    <TD className="min-w-[7.5rem]">
                      {manage && ed?.recruitment_manager ? (
                        <PersonSelect label="Recruitment manager" value={r.manager?.id ?? ''} current={r.manager} people={managerList} onChange={(id) => void patch(r.id, { manager_id: id })} />
                      ) : <span className="text-sm text-slate-700">{r.manager?.username ?? <span className="text-slate-400">Unassigned</span>}</span>}
                    </TD>
                    <TD className="min-w-[7.5rem]">
                      {manage && ed?.sales_manager ? (
                        <PersonSelect label="Sales manager" value={r.sales_manager?.id ?? ''} current={r.sales_manager} people={salesList} onChange={(id) => void patch(r.id, { sales_manager_id: id })} />
                      ) : <span className="text-sm text-slate-700">{r.sales_manager?.username ?? <span className="text-slate-400">Unassigned</span>}</span>}
                    </TD>
                    <TD className="whitespace-nowrap tabular-nums">{formatDay(r.requirement_date)}</TD>
                    <TD className="whitespace-nowrap tabular-nums">
                      {r.cv_submission_date ? (
                        <span className={cn(overdue && 'font-semibold text-red-600')} title={overdue ? 'The submission deadline date has passed' : undefined}>{formatDay(r.cv_submission_date)}</span>
                      ) : <span className="text-slate-300">-</span>}
                    </TD>
                    {/* a recruiter writes their own numbers here; a manager sees the total (the form shows each recruiter's) */}
                    <TD><InlineDate label="CVs submitted on" value={r.cvs_submitted_date} min={r.requirement_date} editable={isRecruiter && !!ed?.cvs_submitted && !!user?.id} onSave={(v) => patch(r.id, { cvs_submissions: [{ recruiter_id: user!.id, date: v }] })} /></TD>
                    <TD className="text-center" title={r.recruiters.length > 1 ? r.recruiters.filter((x) => x.cvs_submitted_count != null).map((x) => `${x.username}: ${x.cvs_submitted_count}`).join('\n') || undefined : undefined}>
                      <InlineCount label="Number of CVs submitted" value={r.cvs_submitted_count} editable={isRecruiter && !!ed?.cvs_submitted && !!user?.id} onSave={(v) => patch(r.id, { cvs_submissions: [{ recruiter_id: user!.id, count: v }] })} />
                    </TD>
                    <TD>{ed?.status ? <StatusSelect value={r.status} onChange={(s) => void patch(r.id, { status: s })} /> : <StatusPill status={r.status} />}</TD>
                    {manage && (
                      <TD><CommentCell width="w-24" label="Sales manager comments" value={r.sales_comments} editable={!!ed?.sales_comments} onSave={(v) => patch(r.id, { sales_comments: v })} /></TD>
                    )}
                    <TD><CommentCell width="w-24" label="Recruitment manager comments" value={r.rm_comments} editable={!!ed?.rm_comments} onSave={(v) => patch(r.id, { rm_comments: v })} /></TD>
                    <TD><CommentCell width="w-24" label="Recruiter comments" value={r.recruiter_comments} editable={!!ed?.recruiter_comments} onSave={(v) => patch(r.id, { recruiter_comments: v })} /></TD>
                    <TD className="min-w-[6rem]">{r.job_location || <span className="text-slate-300">-</span>}</TD>
                    <TD className="min-w-[6.75rem] tabular-nums">{r.salary || <span className="text-slate-300">-</span>}</TD>
                    <TD className="min-w-[5.5rem]">
                      {(() => {
                        const d = durationParts(r);
                        return d ? (<><p className="whitespace-nowrap text-slate-800">{d.main}</p>{d.note && <p className="text-2xs text-slate-400">{d.note}</p>}</>) : <span className="text-slate-300">-</span>;
                      })()}
                    </TD>

                    {!manage && (
                    <TD className="min-w-[8rem]">
                      {r.jd_id ? (
                        <button type="button" onClick={() => void previewJd(r.jd_id!, 'jd', r.jd_filename || undefined)} className="inline-flex max-w-[8.5rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-paper px-2 py-1 text-xs font-medium text-slate-700 shadow-soft hover:border-navy-200 hover:bg-navy-50 hover:text-navy-800" title="Preview the job description">
                          <Eye className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{r.jd_filename || 'Preview'}</span>
                        </button>
                      ) : <span className="text-xs text-slate-300">None yet</span>}
                    </TD>
                    )}

                    {!manage && (
                      <TD className="min-w-[9rem] sticky right-0 z-[1] bg-paper shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.14)]">
                        {r.job_id ? (
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant="success" dot>Posted</Badge>
                            <button type="button" onClick={() => router.push(`/careers-manage/${encodeURIComponent(r.job_id!)}`)} className="inline-flex items-center gap-1 text-xs font-semibold text-navy-800 hover:underline"><ExternalLink className="h-3 w-3" /> View the job</button>
                          </div>
                        ) : r.jd_id ? (
                          <Button variant="primary" size="sm" icon={<Briefcase />} onClick={() => postInCareers(r)}>Post job in Careers</Button>
                        ) : (
                          <span className="text-xs text-slate-400">Waiting for a job description</span>
                        )}
                      </TD>
                    )}

                    {manage && (
                      <TD className="sticky right-0 z-[1] bg-paper shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.14)]">
                        <div className="flex items-center justify-end gap-1">
                          {r.job_id && <Badge variant="success" className="mr-1" title="The job is posted in Careers">Posted</Badge>}
                          {r.jd_id && <IconButton size="sm" label="Preview the job description" icon={<Eye />} onClick={() => void previewJd(r.jd_id!, 'jd', r.jd_filename || undefined)} />}
                          <IconButton size="sm" label="Edit" icon={<Pencil />} onClick={() => setDialog({ requirement: r })} />
                          <IconButton size="sm" label="Delete" tone="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(r)} />
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {!firstLoad && (
            <p className="mt-2 text-center text-xs tabular-nums text-slate-500">
              {items.length.toLocaleString()} of {total.toLocaleString()} requirement{total === 1 ? '' : 's'}
            </p>
          )}
          {!firstLoad && items.length < total && (
            <div className="mt-2 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => void loadMore()} loading={loadingMore}>Load more</Button>
            </div>
          )}
        </>
      )}

      {dialog && options && (
        <RequirementDialog
          requirement={dialog.requirement}
          options={options}
          previewOpen={!!previewNode}
          onPreview={(id, name) => void previewJd(id, 'jd', name)}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            setDialog(null);
            showSuccess(created ? 'Requirement added' : 'Requirement updated', `${saved.position} for ${saved.client}`);
            void load(items.length + (created ? 1 : 0));
          }}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this requirement?</DialogTitle>
            <DialogDescription>
              {confirmDelete ? `${confirmDelete.position} for ${confirmDelete.client}` : ''} and its history will be removed. Its job description stays in the JD library. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()} loading={deleting}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {previewNode}

      <ClosureCelebration
        data={celebration}
        onClose={() => setCelebration(null)}
        onViewClosures={() => { setCelebration(null); router.push('/tracker/closures'); }}
      />
    </div>
  );
}
