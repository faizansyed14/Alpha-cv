'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Bug, CheckCircle, Send } from '@/components/icons';
import { api } from '@/lib/api';
import type { BugReport, BugSeverity } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { PageHeader } from '@/components/ui/page';
import { cn } from '@/lib/utils';
import { BUG_AREAS, SEVERITIES, SeverityChip, StatusChip, errText, shortId, whenLabel } from './bugUi';

const TITLE_MAX = 160, DESCRIPTION_MAX = 4000, STEPS_MAX = 3000;
const field = 'h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] text-gray-900 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30';
const area = 'w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/30';

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={cn('text-[11px] tabular-nums', value > max * 0.9 ? 'text-amber-600' : 'text-slate-400')}>{value}/{max}</span>;
}

export default function ReportBugPage() {
  const [title, setTitle] = useState('');
  const [where, setWhere] = useState<string>('Other');
  const [severity, setSeverity] = useState<BugSeverity>('medium');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<BugReport | null>(null);

  const [mine, setMine] = useState<BugReport[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const r = await api.listMyBugReports({ limit: 20, offset: 0 });
      setMine(r.items);
      setTotal(r.total);
    } catch {
      /* the list is a convenience: the form still works */
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.listMyBugReports({ limit: 20, offset: mine.length });
      setMine((prev) => [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]);
      setTotal(r.total);
    } catch {
      /* try again when the strip is seen again */
    } finally {
      setLoadingMore(false);
    }
  };

  const titleOk = title.trim().length >= 5;
  const descriptionOk = description.trim().length >= 10;
  const canSend = titleOk && descriptionOk && !sending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const report = await api.submitBugReport({
        title: title.trim(),
        description: description.trim(),
        steps: steps.trim() || undefined,
        area: where,
        severity,
      });
      setSent(report);
      setTitle('');
      setDescription('');
      setSteps('');
      setSeverity('medium');
      await loadMine();
    } catch (err) {
      setError(errText(err, 'The report could not be sent. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Report a bug"
        description="Something not working? Tell us what happened and the admin will look into it. You can follow the answer here."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        {/* the form */}
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-surface-border bg-white p-5 shadow-card sm:p-6 lg:col-span-3">
          {sent && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800" role="status">
              <span className="flex items-start gap-2">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="font-semibold">Thank you, your report was sent.</span>{' '}
                  Reference <span className="font-mono">{shortId(sent.id)}</span>. You can follow it under &ldquo;Your reports&rdquo;.
                </span>
              </span>
              <button type="button" onClick={() => setSent(null)} className="shrink-0 text-emerald-700 hover:underline">Dismiss</button>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="bug-title" className="text-[13px] font-medium text-gray-700">Short summary <span className="text-red-500">*</span></label>
              <Counter value={title.length} max={TITLE_MAX} />
            </div>
            <Input
              id="bug-title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => { setTitle(e.target.value); setSent(null); }}
              placeholder="e.g. The Match page keeps loading and never shows results"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bug-area" className="text-[13px] font-medium text-gray-700">Where did it happen?</label>
            <select id="bug-area" value={where} onChange={(e) => setWhere(e.target.value)} className={field}>
              {BUG_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium text-gray-700">How bad is it?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEVERITIES.map((s) => {
                const on = severity === s.value;
                return (
                  <label
                    key={s.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
                      on ? 'border-navy-400 bg-navy-50/70 ring-1 ring-navy-300' : 'border-surface-border bg-white hover:border-navy-200 hover:bg-slate-50',
                    )}
                  >
                    <input type="radio" name="severity" value={s.value} checked={on} onChange={() => setSeverity(s.value)} className="sr-only" />
                    <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', s.dot)} />
                    <span>
                      <span className="block text-[13px] font-semibold text-slate-900">{s.label}</span>
                      <span className="block text-[12px] text-slate-500">{s.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="bug-description" className="text-[13px] font-medium text-gray-700">What happened? <span className="text-red-500">*</span></label>
              <Counter value={description.length} max={DESCRIPTION_MAX} />
            </div>
            <textarea
              id="bug-description"
              value={description}
              maxLength={DESCRIPTION_MAX}
              rows={5}
              onChange={(e) => { setDescription(e.target.value); setSent(null); }}
              placeholder="What did you expect, and what did you see instead? Include any message that appeared."
              className={area}
            />
            {description.length > 0 && !descriptionOk && <p className="text-[12px] text-amber-700">Please write at least 10 characters.</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label htmlFor="bug-steps" className="text-[13px] font-medium text-gray-700">How can we make it happen again? <span className="text-xs font-normal text-gray-500">(optional)</span></label>
              <Counter value={steps.length} max={STEPS_MAX} />
            </div>
            <textarea
              id="bug-steps"
              value={steps}
              maxLength={STEPS_MAX}
              rows={3}
              onChange={(e) => setSteps(e.target.value)}
              placeholder={'1. Open Candidates\n2. Search for "python"\n3. Click the first CV'}
              className={area}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border pt-4">
            <p className="text-[12px] text-slate-500">Your name and role are sent with the report so the admin can follow up.</p>
            <Button type="submit" variant="primary" icon={<Send className="h-4 w-4" />} loading={sending} disabled={!canSend}>
              Send report
            </Button>
          </div>
        </form>

        {/* what this person already reported */}
        <section className="lg:col-span-2">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Your reports</h2>
            {total > 0 && <span className="text-[12px] tabular-nums text-slate-500">{total.toLocaleString()}</span>}
          </div>
          {loadingList ? (
            <div className="space-y-3" aria-hidden>
              {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-surface-border bg-white" />)}
            </div>
          ) : mine.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-strong bg-white px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 ring-1 ring-inset ring-navy-100"><Bug className="h-5 w-5" /></span>
              <p className="mt-3 text-[14px] font-semibold text-slate-900">Nothing reported yet</p>
              <p className="mt-1 text-[12.5px] text-slate-500">When you send a report it appears here with its status.</p>
            </div>
          ) : (
            <>
            <ul className="space-y-3">
              {mine.map((b) => (
                <li key={b.id} className="rounded-2xl border border-surface-border bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-[13.5px] font-semibold text-slate-900">{b.title}</p>
                    <StatusChip status={b.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-slate-500">
                    <SeverityChip severity={b.severity} />
                    <span>{b.area}</span>
                    <span className="text-slate-300">·</span>
                    <span>{whenLabel(b.created_at)}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-[11px]">{shortId(b.id)}</span>
                  </div>
                  {b.admin_note && (
                    <div className="mt-3 rounded-xl bg-navy-50/70 px-3 py-2.5 text-[12.5px] text-slate-700">
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-navy-700">Reply from the admin</p>
                      <p className="whitespace-pre-wrap break-words">{b.admin_note}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <InfiniteScrollSentinel hasMore={mine.length < total} loading={loadingMore} itemCount={mine.length} onLoadMore={loadMore} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
