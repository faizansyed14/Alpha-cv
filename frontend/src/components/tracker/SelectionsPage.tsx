'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Hourglass, Pencil, Search, Send, Trash2, Trophy, X, XCircle } from '@/components/icons';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Bone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ToastContainer, useToast } from '@/components/ui/toast';
import type { Selection, SelectionFilters, SelectionInput, SelectionOptions, SelectionStats, SelectionStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { errorText } from './jd';
import { CommentCell, InlineDate, LocationFilter, TRACKER_TH_STICKY, TRACKER_THEAD } from './shared';

const PAGE = 50;
const ALL = '__all__';
const NO_STATS: SelectionStats = { total: 0, offer_pending: 0, offer_released: 0, joined: 0, backed_out: 0 };

const STATUS: Record<SelectionStatus, { label: string; dot: string; pill: string }> = {
  offer_pending: { label: 'Offer Pending', dot: 'bg-amber-500', pill: 'border-amber-200 bg-amber-50 text-amber-800' },
  offer_released: { label: 'Offer Released', dot: 'bg-sky-500', pill: 'border-sky-200 bg-sky-50 text-sky-800' },
  joined: { label: 'Joined', dot: 'bg-emerald-500', pill: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  backed_out: { label: 'Backed Out', dot: 'bg-rose-500', pill: 'border-rose-200 bg-rose-50 text-rose-800' },
};
const ORDER: SelectionStatus[] = ['offer_pending', 'offer_released', 'joined', 'backed_out'];

function StatusPill({ status }: { status: SelectionStatus }) {
  const m = STATUS[status] ?? STATUS.offer_pending;
  return <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold', m.pill)}><span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}</span>;
}

/** The status as a dropdown that looks like its pill. */
function StatusPick({ value, onChange, disabled }: { value: SelectionStatus; onChange: (s: SelectionStatus) => void; disabled?: boolean }) {
  const m = STATUS[value] ?? STATUS.offer_pending;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SelectionStatus)} disabled={disabled}>
      <SelectTrigger aria-label="Status" className={cn('h-8 w-[10.25rem] gap-1.5 rounded-full px-2.5 text-xs font-semibold shadow-none', m.pill)}>
        <span className="flex items-center gap-1.5"><span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />{m.label}</span>
      </SelectTrigger>
      <SelectContent>
        {ORDER.map((s) => (
          <SelectItem key={s} value={s}><span className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', STATUS[s].dot)} />{STATUS[s].label}</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A short text that is written in place: click to edit, Enter or leaving the box saves, Escape cancels. */
function InlineText({ value, onSave, editable, label, placeholder }: { value: string | null; onSave: (next: string | null) => Promise<boolean>; editable: boolean; label: string; placeholder: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  const commit = async () => {
    const next = draft.trim() || null;
    if (next === (value ?? null)) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  };
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={160}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === 'Enter') void commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); } }}
        className="field-input h-8 w-44 px-2 text-sm"
      />
    );
  }
  if (!editable) return value ? <span className="font-medium text-slate-900">{value}</span> : <span className="text-slate-300">-</span>;
  return (
    <button type="button" onClick={() => setEditing(true)} aria-label={`${label}: ${value ?? 'not set'}. Click to change`} className="group inline-flex max-w-[11rem] items-center gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-slate-100">
      {value ? <span className="truncate font-medium text-slate-900">{value}</span> : <span className="text-slate-400">{placeholder}</span>}
      <Pencil className="h-3 w-3 shrink-0 text-slate-300 group-hover:text-slate-500" />
    </button>
  );
}

/**
 * Selections and joining: a row is made here by itself when a requirement is closed. The candidate who was selected, the status (offer pending,
 * offer released, joined, backed out) and a comment are written here. Not for recruiters.
 */
export default function SelectionsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const allowed = !!user && user.role !== 'user';
  const { toasts, showSuccess, showError, removeToast } = useToast();

  const [options, setOptions] = useState<SelectionOptions | null>(null);
  const [items, setItems] = useState<Selection[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<SelectionStats>(NO_STATS);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Selection | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SelectionStatus | ''>('');
  const [location, setLocation] = useState('');
  const [recruiterId, setRecruiterId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { if (user && user.role === 'user') router.replace('/tracker'); }, [user, router]);     // recruiters do not have this page
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { if (allowed) api.getSelectionOptions().then(setOptions).catch(() => undefined); }, [allowed]);

  const filters: SelectionFilters = useMemo(() => ({ q, status, location, recruiter_id: recruiterId, date_from: dateFrom, date_to: dateTo }), [q, status, location, recruiterId, dateFrom, dateTo]);
  const filtered = !!(q || status || location || recruiterId || dateFrom || dateTo);

  const run = useRef(0);
  const load = useCallback(async (keep = 0) => {
    const mine = ++run.current;
    try {
      const page = await api.listSelections(filters, Math.max(PAGE, keep), 0);
      if (mine !== run.current) return;
      setItems(page.items);
      setTotal(page.total);
      setStats(page.stats);
      setError(null);
    } catch (e) {
      if (mine === run.current) setError(errorText(e, 'The selections could not be loaded.'));
    } finally {
      if (mine === run.current) setLoading(false);
    }
  }, [filters]);
  useEffect(() => { if (allowed) { setLoading(true); void load(); } }, [load, allowed]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await api.listSelections(filters, PAGE, items.length);
      setItems((prev) => [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]);
      setTotal(page.total);
      setStats(page.stats);
    } catch (e) {
      showError('Could not load more', errorText(e, 'Please try again.'));
    } finally {
      setLoadingMore(false);
    }
  };

  /** Change fields of one row; the row is replaced by the server's answer. */
  const patch = useCallback(async (id: string, body: SelectionInput): Promise<boolean> => {
    try {
      const updated = await api.updateSelection(id, body);
      setItems((prev) => prev.map((r) => (r.id === id ? updated : r)));
      if (body.status !== undefined) void load(items.length);                 // the cards and the status filter follow the change
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
      await api.deleteSelection(confirmDelete.id);
      showSuccess('Selection deleted', `${confirmDelete.candidate_name || 'No candidate yet'}: ${confirmDelete.position} for ${confirmDelete.client}`);
      setConfirmDelete(null);
      await load(items.length);
    } catch (e) {
      showError('Not deleted', errorText(e, 'Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  const clear = () => { setSearch(''); setQ(''); setStatus(''); setLocation(''); setRecruiterId(''); setDateFrom(''); setDateTo(''); };

  if (!allowed) return null;
  const ed = options?.editable;
  const firstLoad = loading && items.length === 0;
  const recruiters = (options?.recruiters ?? []).filter((r) => !location || r.location === location);

  // the cards, in this order; each one filters the list by its status (Selections shows them all)
  const tiles: Array<{ label: string; value: number; icon: any; tone: 'blue' | 'amber' | 'sky' | 'rose' | 'emerald'; filter: SelectionStatus | '' }> = [
    { label: 'Selections', value: stats.total, icon: Trophy, tone: 'blue', filter: '' },
    { label: 'Offer pending', value: stats.offer_pending, icon: Hourglass, tone: 'amber', filter: 'offer_pending' },
    { label: 'Offer released', value: stats.offer_released, icon: Send, tone: 'sky', filter: 'offer_released' },
    { label: 'Backouts', value: stats.backed_out, icon: XCircle, tone: 'rose', filter: 'backed_out' },
    { label: 'Joined', value: stats.joined, icon: CheckCircle2, tone: 'emerald', filter: 'joined' },
  ];

  return (
    <div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <PageHeader
        className="!mb-3"
        title="Selections & joining"
        description="A row is added here when a requirement is closed. Record who was selected and whether they joined."
      />

      <div className="mb-3 grid grid-cols-2 gap-1 sm:grid-cols-5">
        {tiles.map((t) => (
          <StatCard
            key={t.label}
            compact
            label={t.label}
            value={t.value.toLocaleString()}
            loading={firstLoad}
            icon={t.icon}
            tone={t.tone}
            onClick={() => setStatus(t.filter === '' || status === t.filter ? '' : t.filter)}
            aria-pressed={t.filter !== '' && status === t.filter}
            className={cn(t.filter !== '' && status === t.filter && 'ring-2 ring-navy-500/60')}
          />
        ))}
      </div>

      <div className="toolbar-bar !mb-3 min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 w-full flex-1 sm:min-w-[200px] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <label htmlFor="sel-search" className="sr-only">Search selections</label>
          <input id="sel-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate, position, client, recruiter" className="field-input h-8 w-full !pl-8 pr-7 text-sm" maxLength={100} />
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>}
        </div>

        <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? '' : (v as SelectionStatus))}>
          <SelectTrigger aria-label="Status" className="h-8 w-full text-xs sm:w-[10.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {ORDER.map((s) => <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>)}
          </SelectContent>
        </Select>

        {options?.all_locations && <LocationFilter value={location} locations={options.locations} onChange={(l) => { setLocation(l); setRecruiterId(''); }} className="w-full sm:w-[9.5rem]" />}

        <Select value={recruiterId || ALL} onValueChange={(v) => setRecruiterId(v === ALL ? '' : v)}>
          <SelectTrigger aria-label="Recruiter" className="h-8 w-full text-xs sm:w-[10.5rem]"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={ALL}>All recruiters</SelectItem>
            {recruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.username}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="flex w-full flex-wrap items-center gap-1.5 text-xs text-slate-500 sm:w-auto">
          <span>From</span>
          <Input type="date" aria-label="Date from" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[min(100%,11rem)] flex-1 px-2 text-xs sm:w-[8.75rem] sm:flex-none" />
          <span>to</span>
          <Input type="date" aria-label="Date to" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[min(100%,11rem)] flex-1 px-2 text-xs sm:w-[8.75rem] sm:flex-none" />
        </div>

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
          title={filtered ? 'No selections match these filters' : 'No selections yet'}
          hint={filtered ? 'Change the search or the filters above.' : 'When a requirement is closed, a row for it appears here.'}
          action={filtered ? <Button variant="secondary" onClick={clear}>Clear the filters</Button> : undefined}
        />
      ) : (
        <>
          <Table className="min-w-[1380px] [&_td]:px-2.5 [&_th]:whitespace-normal [&_th]:px-2.5">
            <THead className={TRACKER_THEAD}>
              <TR className="hover:bg-transparent">
                <TH className="w-12">S.No</TH>
                <TH>Date</TH>
                <TH>Candidate</TH>
                <TH>Position</TH>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Recruiter</TH>
                <TH>Account manager</TH>
                <TH>Recruitment manager</TH>
                <TH className="min-w-[9rem]">Comments</TH>
                <TH className={cn(TRACKER_TH_STICKY, 'text-right')}>Action</TH>
              </TR>
            </THead>
            <TBody aria-busy={firstLoad}>
              {firstLoad ? Array.from({ length: 6 }).map((_, i) => (
                <TR key={i} className="align-top">
                  <TD><Bone className="h-4 w-5" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-28" /></TD>
                  <TD><Bone className="h-4 w-32" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-8 w-[10.25rem] rounded-full" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-4 w-20" /></TD>
                  <TD><Bone className="h-3 w-24" /></TD>
                  <TD className="sticky right-0 z-[1] bg-paper"><div className="flex justify-end"><Bone className="h-8 w-8 rounded-lg" /></div></TD>
                </TR>
              )) : items.map((r, i) => (
                <TR key={r.id} className="align-top">
                  <TD className="tabular-nums text-slate-400">{i + 1}</TD>
                  <TD className="whitespace-nowrap tabular-nums">
                    <InlineDate label="Date" value={r.date} editable={!!ed?.selection_date} onSave={async (v) => (v ? patch(r.id, { selection_date: v }) : false)} />
                  </TD>
                  <TD className="min-w-[10rem]">
                    <InlineText label="Candidate" placeholder="Add candidate" value={r.candidate_name} editable={!!ed?.candidate_name} onSave={(v) => patch(r.id, { candidate_name: v })} />
                  </TD>
                  <TD className="min-w-[8rem] font-semibold text-slate-900">{r.position}</TD>
                  <TD className="min-w-[6rem]">{r.client}</TD>
                  <TD>{ed?.status ? <StatusPick value={r.status} onChange={(s) => void patch(r.id, { status: s })} /> : <StatusPill status={r.status} />}</TD>
                  <TD className="min-w-[7rem] text-slate-700">{r.recruiters.length ? r.recruiters.map((x) => x.username).join(', ') : <span className="text-slate-300">-</span>}</TD>
                  <TD className="min-w-[7rem] text-slate-700">{r.sales_manager?.username ?? <span className="text-slate-300">-</span>}</TD>
                  <TD className="min-w-[7rem] text-slate-700">{r.manager?.username ?? <span className="text-slate-300">-</span>}</TD>
                  <TD><CommentCell width="w-32" label="Comments" value={r.comments} editable={!!ed?.comments} onSave={(v) => patch(r.id, { comments: v })} /></TD>
                  <TD className="sticky right-0 z-[1] bg-paper shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.14)]">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton size="sm" label="Delete" tone="danger" icon={<Trash2 />} onClick={() => setConfirmDelete(r)} />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!firstLoad && <p className="mt-2 text-center text-xs tabular-nums text-slate-500">{items.length.toLocaleString()} of {total.toLocaleString()} selection{total === 1 ? '' : 's'}</p>}
          {!firstLoad && items.length < total && (
            <div className="mt-2 flex justify-center"><Button variant="secondary" size="sm" onClick={() => void loadMore()} loading={loadingMore}>Load more</Button></div>
          )}
        </>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this selection?</DialogTitle>
            <DialogDescription>
              {confirmDelete ? `${confirmDelete.candidate_name || 'No candidate yet'}: ${confirmDelete.position} for ${confirmDelete.client}` : ''} will be removed from this page. The requirement itself is not touched. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()} loading={deleting}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
