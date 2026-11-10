'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bookmark, Loader2, RefreshCw, Search, Target, Users } from '@/components/icons';
import { api } from '@/lib/api';
import type { CVListItem } from '@/lib/types';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSavedCvsStore } from '@/stores/savedCvsStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { Button } from '@/components/ui/button';
import { InfiniteScrollSentinel } from '@/components/ui/infinite-scroll';
import { EmptyState, PageHeader } from '@/components/ui/page';
import CandidateCard from '@/components/database/CandidateCard';
import { getCVDisplay } from '@/components/database/DatabasePage';

const FilePreviewModal = dynamic(() => import('@/components/ui/file-preview-modal').then((m) => m.FilePreviewModal), { ssr: false });

const PAGE = 50;
type NoteMeta = { count: number; text: string | null; author: string | null };

/** The signed-in person's own saved CVs, in the same cards as the Candidates page: select some, then pick a job description to match them. */
export default function SavedCvsPage() {
  const router = useRouter();
  const { go } = useWorkspaceNav();
  const user = useAuthStore((s) => s.user);
  const { selectedCVs, selectedJD, selectCV, deselectCV, deselectAllCVs, rememberCVs, runMatch } = useAppStore();
  const unsave = useSavedCvsStore((s) => s.unsave);
  const loadSavedIds = useSavedCvsStore((s) => s.load);

  const [items, setItems] = useState<CVListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, NoteMeta>>({});
  const [noteSavingId, setNoteSavingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; id: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const requestId = useRef(0);                // only the newest request may fill the list

  const loadNotes = useCallback(async (list: CVListItem[]) => {
    const ids = list.map((c) => c.id);
    if (ids.length === 0) return;
    try {
      const r = await api.getNotesSummary(ids);
      setNotes((prev) => {
        const next = { ...prev };
        (r.summaries || []).forEach((s: any) => {
          if (!s.cv_id) return;
          const count = Number(s.notes_count || 0);
          if (count <= 0) { delete next[s.cv_id]; return; }
          const latest = s.latest_note;
          next[s.cv_id] = {
            count,
            text: typeof latest === 'string' ? latest : typeof latest?.note === 'string' ? latest.note : null,
            author: latest && typeof latest === 'object' && typeof latest.hr_user === 'string' ? latest.hr_user : null,
          };
        });
        return next;
      });
    } catch { /* notes are a convenience */ }
  }, []);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    setError(null);
    try {
      const r = await api.getSavedCVs({ limit: PAGE, offset: 0, q: query });
      if (mine !== requestId.current) return;
      setItems(r.cvs);
      setTotal(r.total);
      rememberCVs(r.cvs);
      void loadNotes(r.cvs);
    } catch (e: any) {
      if (mine === requestId.current) setError(e?.response?.data?.detail || e?.message || 'Your saved CVs could not be loaded.');
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [query, rememberCVs, loadNotes]);

  // A new search loads the first page of what matches (typing waits a moment).
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, query.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  const loadMore = async () => {
    if (loadingMore) return;
    const mine = requestId.current;
    setLoadingMore(true);
    try {
      const r = await api.getSavedCVs({ limit: PAGE, offset: items.length, q: query });
      if (mine !== requestId.current) return;
      setItems((prev) => [...prev, ...r.cvs.filter((c) => !prev.some((p) => p.id === c.id))]);
      setTotal(r.total);
      rememberCVs(r.cvs);
      void loadNotes(r.cvs);
    } catch { /* asked again when the strip is seen again */ } finally {
      setLoadingMore(false);
    }
  };

  const removeFromSaved = async (ids: string[]) => {
    try {
      await unsave(ids);
      const gone = new Set(ids);
      setItems((prev) => prev.filter((c) => !gone.has(c.id)));
      setTotal((t) => Math.max(0, t - ids.length));
      ids.forEach((id) => deselectCV(id));
    } catch {
      setError('Could not remove from your saved CVs. Please try again.');
    }
  };

  const loadedIds = items.map((c) => c.id);
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selectedCVs.includes(id));
  const selectedHere = loadedIds.filter((id) => selectedCVs.includes(id));

  const toggleAllLoaded = () => {
    if (allLoadedSelected) loadedIds.forEach((id) => deselectCV(id));
    else loadedIds.forEach((id) => { if (!selectedCVs.includes(id)) selectCV(id); });
  };

  const matchSelected = () => {
    if (selectedJD) {
      useAppStore.setState({ matchResult: null });
      void runMatch();            // flips the matching flag at once, so the Match page shows live progress
      go('match');
    } else {
      go('jobs');                 // pick the job description first; the match tray follows the selection there
    }
  };

  const openPreview = async (cv: CVListItem, name: string) => {
    const base = (cv.filename || name || 'document').trim();
    const fileName = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
    setPreviewError(null);
    setPreviewLoading(true);
    setPreview({ url: '', name: fileName, id: cv.id });
    try {
      const { blob } = await api.downloadCV(cv.id);
      if (!blob || blob.size === 0) throw new Error('Document is empty');
      setPreview({ url: URL.createObjectURL(blob), name: fileName, id: cv.id });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Failed to load document');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
  };

  const saveNote = async (cvId: string, text: string) => {
    if (!user?.username || !text.trim()) return;
    setNoteSavingId(cvId);
    try {
      await api.addOrUpdateNote(cvId, text.trim(), user.username);
      await loadNotes(items.filter((c) => c.id === cvId));
    } catch { /* the note stays as it was */ } finally {
      setNoteSavingId(null);
    }
  };

  const deleteNote = async (cvId: string, author?: string | null) => {
    const who = author || user?.username;
    if (!who) return;
    setNoteSavingId(cvId);
    try {
      await api.deleteCVNote(cvId, who);
      setNotes((prev) => { const next = { ...prev }; delete next[cvId]; return next; });
    } catch { /* the note stays as it was */ } finally {
      setNoteSavingId(null);
    }
  };

  useEffect(() => { void loadSavedIds(); }, [loadSavedIds]);

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      <PageHeader
        title="Saved CVs"
        description="Your own shortlist. Select CVs here, then pick a job description to match them against."
        actions={
          <>
            <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => { setLoading(true); void load(); }}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => go('candidates')}>
              Browse candidates
            </Button>
          </>
        }
      />

      <div className="toolbar-bar">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setLoading(true); setQuery(e.target.value); }}
            placeholder="Search your saved CVs by name, title, skill…"
            className="h-9 w-full rounded-lg border border-transparent bg-slate-50 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 transition-colors hover:bg-slate-100/70 focus:border-navy-500 focus:bg-white focus:outline-none focus:shadow-glow"
          />
        </div>
        <span className="text-[13px] font-medium tabular-nums text-slate-600">{total.toLocaleString()} saved</span>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-2.5" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl border border-surface-border bg-white" />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={query.trim() ? 'No saved CV matches your search' : 'No saved CVs yet'}
          hint={query.trim() ? 'Try other words, or clear the search.' : 'Use the bookmark on any candidate to keep it here.'}
          action={!query.trim() ? <Button variant="primary" icon={<Users className="h-4 w-4" />} onClick={() => go('candidates')}>Browse candidates</Button> : undefined}
        />
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
            <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13px] font-medium text-slate-700">
              <input
                type="checkbox"
                checked={allLoadedSelected}
                onChange={toggleAllLoaded}
                className="h-4 w-4 cursor-pointer rounded accent-navy-600"
                aria-label="Select all loaded CVs"
              />
              {allLoadedSelected ? 'Deselect all loaded' : 'Select all loaded'}
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="tabular-nums">{items.length.toLocaleString()} of {total.toLocaleString()}</span>
              {selectedHere.length > 0 && (
                <>
                  <button type="button" onClick={() => void removeFromSaved(selectedHere)} className="font-semibold text-red-600 hover:underline">
                    Remove {selectedHere.length} from saved
                  </button>
                  <button type="button" onClick={() => deselectAllCVs()} className="font-semibold text-navy-600 hover:underline">
                    Clear {selectedCVs.length} selected
                  </button>
                  <Button size="sm" variant="primary" icon={<Target className="h-4 w-4" />} onClick={matchSelected}>
                    {selectedJD ? `Match ${selectedCVs.length}` : 'Choose a job to match'}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2.5">
            {items.map((cv, i) => {
              const d = getCVDisplay(cv);
              const meta = notes[cv.id];
              return (
                <CandidateCard
                  key={cv.id}
                  cv={cv}
                  display={d}
                  index={i + 1}
                  selected={selectedCVs.includes(cv.id)}
                  matchedKeywords={[]}
                  noteText={meta?.text || null}
                  noteAuthor={meta?.author || null}
                  noteSaving={noteSavingId === cv.id}
                  saved
                  onToggleSave={() => void removeFromSaved([cv.id])}
                  onToggleSelect={() => (selectedCVs.includes(cv.id) ? deselectCV(cv.id) : selectCV(cv.id))}
                  onOpenDetails={() => router.push(`/candidates/${cv.id}?from=/saved-cvs`)}
                  onPreview={() => void openPreview(cv, d.name)}
                  onSaveNote={(text) => saveNote(cv.id, text)}
                  onDeleteNote={() => deleteNote(cv.id, meta?.author)}
                />
              );
            })}
          </div>
          <InfiniteScrollSentinel hasMore={items.length < total} loading={loadingMore} itemCount={items.length} onLoadMore={loadMore} />
        </>
      )}

      {preview && (previewLoading || previewError) ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50">
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white p-6 shadow-lg">
            {previewError ? (
              <>
                <p className="text-[13px] text-red-600">{previewError}</p>
                <Button variant="secondary" onClick={closePreview}>Close</Button>
              </>
            ) : (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
                <p className="text-[13px] text-slate-700">Loading document…</p>
              </>
            )}
          </div>
        </div>
      ) : null}
      <FilePreviewModal
        isOpen={!!preview && !previewLoading && !previewError && !!preview.url}
        onClose={closePreview}
        fileUrl={preview?.url || ''}
        fileName={preview?.name || ''}
        fileId={preview?.id || ''}
        docType="cv"
      />
    </div>
  );
}
