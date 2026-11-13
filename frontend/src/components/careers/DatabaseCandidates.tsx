'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertCircle, Briefcase, Check, Clock, Copy, Database, Eye, FileText, Globe, MapPin, Pencil, Search } from '@/components/icons';
import { api } from '@/lib/api';
import type { JobDatabaseCandidate, JobPostingListItem } from '@/lib/types';
import ContactActions from '@/components/common/ContactActions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/page';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { CandidateRowsSkeleton } from './ApplicationsList';
import { useCvPreview } from './CvPreview';

const PAGE = 50;

function errorText(e: any): string {
  return e?.detail || e?.response?.data?.detail || e?.message || 'The database could not be searched. Please try again.';
}

/**
 * People already in the CV database who fit the job's boolean search string and have NOT applied to it.
 * The search runs on the server against every CV; the string can be changed here for this view without touching the job.
 */
export default function DatabaseCandidates({
  job,
  onTotal,
  onQuery,
}: {
  job: JobPostingListItem;
  /** The number of matches, for the tab label and the match button (null while unknown). */
  onTotal: (total: number | null, estimate: boolean) => void;
  /** The string typed here in place of the job's own (null = the job's own), so "match" uses the same people that are listed. */
  onQuery: (custom: string | null) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const preview = useCvPreview();

  const [custom, setCustom] = useState<string | null>(null);     // null = the job's own string
  const [searched, setSearched] = useState('');                  // the string the server used
  const [source, setSource] = useState<'job' | 'custom' | 'generated'>('job');
  const [rows, setRows] = useState<JobDatabaseCandidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [estimate, setEstimate] = useState(false);
  const [excluded, setExcluded] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const request = useRef(0);

  const report = useRef({ onTotal, onQuery });
  report.current = { onTotal, onQuery };

  const search = useCallback(async (query: string | null) => {
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    report.current.onTotal(null, false);
    try {
      const page = await api.getJobDatabaseCandidates(job.job_id, { limit: PAGE, q: query });
      if (mine !== request.current) return;                       // an older answer must not replace a newer search
      setRows(page.results);
      setCursor(page.next_cursor);
      setTotal(page.total);
      setEstimate(page.total_is_estimate);
      setExcluded(page.applicants_excluded);
      setSearched(page.boolean_query);
      setSource(page.query_source);
      report.current.onTotal(page.total ?? page.results.length, page.total_is_estimate);
    } catch (e) {
      if (mine !== request.current) return;
      setRows([]);
      setCursor(null);
      setTotal(null);
      setError(errorText(e));
      report.current.onTotal(0, false);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }, [job.job_id]);

  useEffect(() => {
    setCustom(null);
    setEditing(false);
    report.current.onQuery(null);
    void search(null);
  }, [job.job_id, search]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const page = await api.getJobDatabaseCandidates(job.job_id, { limit: PAGE, cursor, q: custom });
      if (mine !== request.current) return;
      setRows((r) => [...r, ...page.results]);
      setCursor(page.next_cursor);
    } catch (e) {
      if (mine === request.current) setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const apply = (value: string | null) => {
    const next = value && value.trim() ? value.trim() : null;
    setCustom(next);
    setEditing(false);
    report.current.onQuery(next);
    void search(next);
  };

  const dash = <span className="text-slate-300">-</span>;
  const th = 'px-3 py-2.5 text-left text-xs font-medium text-slate-500';
  const shownTotal = total ?? rows.length;

  return (
    <div className="space-y-4">
      {/* the search that produced this list */}
      <section className="rounded-2xl border border-surface-border bg-paper p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-navy-700" />
            <h3 className="text-sm font-semibold text-slate-900">Boolean search</h3>
            <span className="chip chip-neutral">
              {source === 'custom' ? 'Edited for this view' : source === 'generated' ? 'Built from the job title' : 'From the job'}
            </span>
          </div>
          {!editing && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                disabled={!searched}
                onClick={() => {
                  navigator.clipboard?.writeText(searched);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button variant="secondary" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { setDraft(searched); setEditing(true); }}>
                Edit search
              </Button>
              {custom !== null && (
                <Button variant="ghost" size="sm" onClick={() => apply(null)}>Use the job&apos;s string</Button>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              apply(draft);
            }}
          >
            <label htmlFor="db-boolean" className="sr-only">Boolean search string</label>
            <textarea
              id="db-boolean"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={4000}
              autoFocus
              spellCheck={false}
              className="field-input !h-auto w-full resize-y py-2 font-mono text-xs leading-relaxed"
              placeholder='("Cloud Engineer") AND ("Azure" OR "Terraform") NOT intern'
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                Use AND, OR, NOT in capitals, quotes for exact phrases and brackets to group. This changes the list here only, not the job.
              </p>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" icon={<Search className="h-3.5 w-3.5" />} disabled={!draft.trim()}>Search database</Button>
              </div>
            </div>
          </form>
        ) : (
          <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-surface-border bg-slate-50 px-3 py-2 font-mono text-xs leading-relaxed text-slate-800">
            {searched || (loading ? 'Searching…' : 'No search string')}
          </pre>
        )}
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{error}</p>
            <button type="button" className="mt-1 font-semibold underline underline-offset-2" onClick={() => { setDraft(custom ?? searched); setEditing(true); }}>
              Edit the search string
            </button>
          </div>
        </div>
      ) : loading ? (
        <CandidateRowsSkeleton label="Searching the database" variant="database" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Nobody in the database fits this search"
          hint={excluded > 0
            ? `The ${excluded} applicant${excluded === 1 ? '' : 's'} of this job are not repeated here. Try a looser search: fewer AND terms, more OR alternatives.`
            : 'Try a looser search: fewer AND terms, more OR alternatives.'}
          action={<Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => { setDraft(searched); setEditing(true); }}>Edit search</Button>}
        />
      ) : (
        <>
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900 tabular-nums">{estimate ? 'About ' : ''}{shownTotal.toLocaleString()}</span>{' '}
            candidate{shownTotal === 1 ? '' : 's'} in your database fit{shownTotal === 1 ? 's' : ''} this search, newest CV first.
            {excluded > 0 && <span className="text-slate-500"> The {excluded} applicant{excluded === 1 ? '' : 's'} of this job are listed under Applicants, not here.</span>}
          </p>

          <div className="overflow-x-auto rounded-2xl border border-surface-border bg-paper shadow-card">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[23%]" />
                <col className="w-[22%]" />
                <col className="w-[15%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-surface-border bg-slate-50">
                  <th className={th}>Candidate</th>
                  <th className={th}>Found in the CV</th>
                  <th className={th}>Location</th>
                  <th className={th}>Experience</th>
                  <th className={th}>Contact</th>
                  <th className={`${th} text-right`}>Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className="align-top transition-colors hover:bg-slate-50/70">
                    <td className="px-3 py-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <Avatar name={c.full_name} />
                        <div className="min-w-0">
                          <div className="break-words font-semibold leading-tight text-slate-900">{c.full_name || 'Unnamed candidate'}</div>
                          <div className="mt-0.5 line-clamp-2 text-xs leading-tight text-slate-500">{c.job_title || dash}</div>
                          {c.applied_job_title && (
                            <span className="chip chip-neutral mt-1.5" title={`Applied earlier to: ${c.applied_job_title}`}>Applied to another job</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {c.matched_keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {c.matched_keywords.slice(0, 6).map((k) => <span key={k} className="chip chip-brand">{k}</span>)}
                          {c.matched_keywords.length > 6 && <span className="chip chip-neutral">+{c.matched_keywords.length - 6}</span>}
                        </div>
                      ) : dash}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-start gap-1 text-slate-800">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="break-words">{c.location || dash}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                        <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="break-words">{c.nationality || dash}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1 text-slate-800">
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {c.years_of_experience != null && c.years_of_experience !== '' ? `${c.years_of_experience} yrs` : dash}
                      </div>
                      <div className="mt-1 flex items-start gap-1 text-xs text-slate-500">
                        <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="break-words">{c.notice_period ? `Notice: ${c.notice_period}` : dash}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="block break-all text-slate-800 hover:text-navy-700 hover:underline">{c.email}</a>
                      ) : dash}
                      {c.phone && <div className="mt-0.5 text-xs text-slate-500">{c.phone}</div>}
                      <ContactActions email={c.email} phone={c.phone} linkedin={c.linkedin_url} github={c.github_url} variant="icons" className="mt-1.5" />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-stretch gap-1.5">
                        <button
                          type="button"
                          onClick={() => router.push(`/candidates/${c.id}?from=${encodeURIComponent((pathname || '/careers') + window.location.search)}`)}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-solid px-2.5 text-xs font-semibold text-white transition-colors hover:bg-solid-hover"
                        >
                          <Eye className="h-3.5 w-3.5" /> Profile
                        </button>
                        <button
                          type="button"
                          onClick={() => preview.open(c.id, c.filename, c.full_name)}
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-surface-border bg-paper px-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-navy-200 hover:bg-navy-50 hover:text-navy-700"
                        >
                          <FileText className="h-3.5 w-3.5" /> CV
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-center text-xs text-slate-500 tabular-nums">
            Showing {rows.length.toLocaleString()} of {estimate ? 'about ' : ''}{shownTotal.toLocaleString()}
          </p>
          <InfiniteScrollSentinel hasMore={!!cursor} loading={loadingMore} itemCount={rows.length} onLoadMore={loadMore} />
        </>
      )}
      {preview.element}
    </div>
  );
}
