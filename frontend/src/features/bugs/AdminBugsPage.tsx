'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bug, RefreshCw, Search, Trash2, X } from '@/components/icons';
import { api } from '@/lib/api';
import type { AdminBugReport, BugCounts, BugSeverity, BugStatus } from '@/lib/types';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { EmptyState, PageHeader } from '@/components/ui/page';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { BUG_AREAS, SEVERITIES, STATUSES, SeverityChip, StatusChip, errText, fullWhen, shortId, whenLabel } from './bugUi';

const PAGE = 25;
const EMPTY_COUNTS: BugCounts = { all: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 };
const select = 'field-input text-slate-700';
const textarea = 'w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30';

function Block({ title, text }: { title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <section>
      <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <p className="whitespace-pre-wrap break-words rounded-xl border border-surface-border bg-slate-50/60 p-3.5 text-[13px] leading-relaxed text-slate-800">{text}</p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-slate-800">{children}</dd>
    </div>
  );
}

export default function AdminBugsPage() {
  const [items, setItems] = useState<AdminBugReport[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<BugCounts>(EMPTY_COUNTS);
  const [status, setStatus] = useState<'all' | BugStatus>('open');
  const [severity, setSeverity] = useState<'all' | BugSeverity>('all');
  const [areaFilter, setAreaFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState<AdminBugReport | null>(null);
  const [draftStatus, setDraftStatus] = useState<BugStatus>('open');
  const [draftSeverity, setDraftSeverity] = useState<BugSeverity>('medium');
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const requestId = useRef(0);          // only the newest request may fill the list (a slow answer to an old filter is dropped)

  const filters = useCallback(
    () => ({ q: query, status, severity, area: areaFilter }),
    [query, status, severity, areaFilter],
  );

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    setError(null);
    try {
      const r = await api.adminListBugReports({ ...filters(), limit: PAGE, offset: 0 });
      if (mine !== requestId.current) return;
      setItems(r.items);
      setTotal(r.total);
      setCounts(r.counts);
    } catch (err) {
      if (mine === requestId.current) setError(errText(err, 'The bug reports could not be loaded.'));
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [filters]);

  // A change of filter loads the first page of what matches (the typed search waits a moment).
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const loadMore = async () => {
    if (loadingMore) return;
    const mine = requestId.current;
    setLoadingMore(true);
    try {
      const r = await api.adminListBugReports({ ...filters(), limit: PAGE, offset: items.length });
      if (mine !== requestId.current) return;
      setItems((prev) => [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setTotal(r.total);
    } catch {
      /* asked again when the strip is seen again */
    } finally {
      setLoadingMore(false);
    }
  };

  const openReport = (b: AdminBugReport) => {
    setOpen(b);
    setDraftStatus(b.status);
    setDraftSeverity(b.severity);
    setDraftNote(b.admin_note || '');
    setConfirmDelete(false);
    setDialogError(null);
  };

  const dirty = !!open && (draftStatus !== open.status || draftSeverity !== open.severity || draftNote.trim() !== (open.admin_note || '').trim());

  const save = async () => {
    if (!open || !dirty) return;
    setSaving(true);
    setDialogError(null);
    try {
      await api.adminUpdateBugReport(open.id, {
        ...(draftStatus !== open.status ? { status: draftStatus } : {}),
        ...(draftSeverity !== open.severity ? { severity: draftSeverity } : {}),
        ...(draftNote.trim() !== (open.admin_note || '').trim() ? { admin_note: draftNote.trim() } : {}),
      });
      setOpen(null);
      await load();                          // the tabs' numbers and the list change together
    } catch (err) {
      setDialogError(errText(err, 'The change could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!open) return;
    setSaving(true);
    setDialogError(null);
    try {
      await api.adminDeleteBugReport(open.id);
      setOpen(null);
      await load();
    } catch (err) {
      setDialogError(errText(err, 'The report could not be deleted.'));
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: 'all' | BugStatus; label: string }[] = [{ id: 'all', label: 'All' }, ...STATUSES.map((s) => ({ id: s.value, label: s.label }))];
  const filtering = !!query.trim() || severity !== 'all' || !!areaFilter;

  return (
    <div>
      <PageHeader
        title="Bug reports"
        description="What users reported. Open one to change its status, set how serious it is, and reply to the reporter."
        actions={
          <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { setLoading(true); void load(); }}>
            Refresh
          </Button>
        }
      />

      {/* status tabs */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-surface-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setLoading(true); setStatus(t.id); }}
            className={cn(
              '-mb-px border-b-2 pb-2.5 text-[13px] font-medium transition-colors',
              status === t.id ? 'border-navy-600 text-navy-700' : 'border-transparent text-slate-500 hover:text-slate-900',
            )}
          >
            {t.label} <span className="ml-1 text-xs tabular-nums text-slate-400">({counts[t.id].toLocaleString()})</span>
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="toolbar-bar flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, text or reporter…"
            className="field-input w-full !pl-10 pr-3"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <select value={severity} onChange={(e) => { setLoading(true); setSeverity(e.target.value as 'all' | BugSeverity); }} className={select} aria-label="Severity">
            <option value="all">Any severity</option>
            {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={areaFilter} onChange={(e) => { setLoading(true); setAreaFilter(e.target.value); }} className={select} aria-label="Area">
            <option value="">Any area</option>
            {BUG_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="text-[13px] tabular-nums text-slate-500">{total.toLocaleString()} result{total === 1 ? '' : 's'}</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-surface-border bg-white" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bug}
          title={filtering || status !== 'all' ? 'No reports match' : 'No bug reports yet'}
          hint={filtering || status !== 'all' ? 'Try another status or clear the filters.' : 'When someone reports a bug it appears here.'}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Report</TH>
                <TH className="hidden w-[110px] sm:table-cell">Severity</TH>
                <TH className="hidden w-[120px] md:table-cell">Status</TH>
                <TH className="hidden w-[190px] lg:table-cell">Reported by</TH>
                <TH className="w-[110px] text-right">When</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((b) => (
                <TR
                  key={b.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${b.title}`}
                  onClick={() => openReport(b)}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReport(b); } }}
                  className="cursor-pointer transition-colors hover:bg-slate-50/70 focus:bg-slate-50 focus:outline-none"
                >
                  <TD>
                    <p className="line-clamp-1 text-[13.5px] font-semibold text-slate-900">{b.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-[12.5px] text-slate-500">{b.description}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-slate-400">
                      <span>{b.area}</span>
                      <span className="font-mono">{shortId(b.id)}</span>
                      <span className="sm:hidden"><SeverityChip severity={b.severity} /></span>
                      <span className="md:hidden"><StatusChip status={b.status} /></span>
                    </p>
                  </TD>
                  <TD className="hidden sm:table-cell"><SeverityChip severity={b.severity} /></TD>
                  <TD className="hidden md:table-cell"><StatusChip status={b.status} /></TD>
                  <TD className="hidden lg:table-cell">
                    <div className="flex items-center gap-2">
                      <Avatar name={b.reporter_username} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-slate-800">{b.reporter_username}</p>
                        <p className="truncate text-[11.5px] capitalize text-slate-400">{(b.reporter_role || '').replace('_', ' ')}</p>
                      </div>
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap text-right text-[12.5px] text-slate-500">{whenLabel(b.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-3 text-center text-[13px] tabular-nums text-slate-500">Showing {items.length.toLocaleString()} of {total.toLocaleString()}</p>
          <InfiniteScrollSentinel hasMore={items.length < total} loading={loadingMore} itemCount={items.length} onLoadMore={loadMore} />
        </>
      )}

      {/* one report */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o && !saving) setOpen(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" hideClose>
          {open && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <DialogTitle className="break-words text-left text-[18px] leading-snug">{open.title}</DialogTitle>
                    <DialogDescription className="mt-1 text-left">
                      <span className="font-mono">{shortId(open.id)}</span> · {open.area} · {fullWhen(open.created_at)}
                    </DialogDescription>
                  </div>
                  <button type="button" onClick={() => !saving && setOpen(null)} aria-label="Close" className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </DialogHeader>

              {dialogError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{dialogError}</span>
                </div>
              )}

              <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-surface-border bg-white p-4 sm:grid-cols-2">
                <Fact label="Reported by">
                  <span className="inline-flex items-center gap-2"><Avatar name={open.reporter_username} size="sm" />{open.reporter_username}
                    <span className="capitalize text-slate-400">({(open.reporter_role || '').replace('_', ' ') || 'user'})</span></span>
                </Fact>
                <Fact label="Email">{open.reporter_email ? <a className="text-navy-700 hover:underline" href={`mailto:${open.reporter_email}`}>{open.reporter_email}</a> : <span className="text-slate-400">Not set</span>}</Fact>
                <Fact label="Browser">{open.user_agent ? <span className="text-[12px] text-slate-600">{open.user_agent}</span> : <span className="text-slate-400">Unknown</span>}</Fact>
                {open.handled_by && <Fact label="Last handled by">{open.handled_by}{open.updated_at ? <span className="text-slate-400"> · {fullWhen(open.updated_at)}</span> : null}</Fact>}
              </dl>

              <Block title="What happened" text={open.description} />
              <Block title="Steps to reproduce" text={open.steps} />

              <div className="space-y-4 rounded-xl border border-surface-border bg-slate-50/50 p-4">
                <div>
                  <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Status</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Status">
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={draftStatus === s.value}
                        onClick={() => setDraftStatus(s.value)}
                        className={cn(
                          'h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                          draftStatus === s.value ? 'border-navy-600 bg-navy-900 text-white' : 'border-surface-border bg-white text-slate-700 hover:border-navy-300 hover:bg-navy-50',
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="bug-severity" className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Severity</label>
                  <select id="bug-severity" value={draftSeverity} onChange={(e) => setDraftSeverity(e.target.value as BugSeverity)} className={cn(select, 'w-full sm:w-56')}>
                    {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="bug-note" className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500">Reply to the reporter <span className="font-normal normal-case text-slate-400">(they see this under Your reports)</span></label>
                  <textarea id="bug-note" rows={3} maxLength={3000} value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="e.g. Fixed in today's update. Please try again." className={textarea} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-4">
                {confirmDelete ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-red-700">Delete this report for good?</span>
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} loading={saving} onClick={remove}>Yes, delete</Button>
                    <Button size="sm" variant="secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>Keep it</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" className="text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="h-4 w-4" />} disabled={saving} onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" disabled={saving} onClick={() => setOpen(null)}>Close</Button>
                  <Button variant="primary" loading={saving && !confirmDelete} disabled={!dirty || saving} onClick={save}>Save changes</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
