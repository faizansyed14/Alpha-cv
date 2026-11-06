'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Briefcase, Check, ChevronUp, Target, Users, X } from '@/components/icons';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/stores/appStore';
import { useWorkspaceNav } from '@/hooks/useWorkspaceNav';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MATCH_MAX_CVS } from '@/lib/matchRun';

/**
 * The match tray: a docked bar that follows the user across the workspace while they build a match. It shows the
 * selected candidates and job description, jumps to whichever half is missing, and starts the match from anywhere.
 * The close button hides it for the current selection (nothing is deselected); choosing another CV / JD brings it back.
 */
export default function MatchTray() {
  const pathname = usePathname() || '';
  const { go } = useWorkspaceNav();
  const [listOpen, setListOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const { cvs, jds, selectedCVs, selectedJD, deselectCV, deselectAllCVs, selectJD, runMatch, matching, progressVisible } = useAppStore(
    useShallow((s) => ({
      cvs: s.cvs,
      jds: s.jds,
      selectedCVs: s.selectedCVs,
      selectedJD: s.selectedJD,
      deselectCV: s.deselectCV,
      deselectAllCVs: s.deselectAllCVs,
      selectJD: s.selectJD,
      runMatch: s.runMatch,
      matching: s.loadingStates.matching.isLoading || s.loadingStates.careersMatching.isLoading,
      progressVisible: s.matchingProgress.isVisible,
    })),
  );

  const onMatchPage = pathname.replace(/\/$/, '') === '/match';
  const onCandidates = pathname.startsWith('/candidates');
  const onJobs = pathname.startsWith('/jobs');

  const jd = useMemo(() => (selectedJD ? jds.find((j) => j.id === selectedJD) : null), [jds, selectedJD]);
  const jdTitle = jd ? (jd.job_title && jd.job_title !== 'Not specified' ? jd.job_title : jd.filename) || 'Job description' : selectedJD ? 'Job description' : null;

  const cvIndex = useMemo(() => new Map(cvs.map((c) => [c.id, c])), [cvs]);
  const selectedList = useMemo(
    () =>
      selectedCVs.map((id) => {
        const cv = cvIndex.get(id);
        return { id, name: cv?.full_name || cv?.filename || 'Candidate', title: cv?.job_title || '' };
      }),
    [selectedCVs, cvIndex],
  );

  const selectionKey = `${selectedCVs.length}|${selectedJD ?? ''}`;
  const visible =
    !onMatchPage && !matching && !progressVisible && (selectedCVs.length > 0 || !!selectedJD) && dismissedFor !== selectionKey;
  const tooMany = selectedCVs.length > MATCH_MAX_CVS;
  const ready = selectedCVs.length > 0 && !!selectedJD && !tooMany;

  const start = () => {
    if (!ready) return;
    setListOpen(false);
    // runMatch flips the matching flag synchronously, so the Match page shows live progress instead of re-running.
    useAppStore.setState({ matchResult: null });
    void runMatch();
    go('match');
  };

  const close = () => {
    setListOpen(false);
    setDismissedFor(selectionKey);
  };

  const step = (n: number, done: boolean) => (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
        done ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600',
      )}
    >
      {done ? <Check className="h-2.5 w-2.5" /> : n}
    </span>
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="match-tray"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-3"
        >
          <div className="pointer-events-auto relative w-full max-w-[880px]">
            {listOpen && selectedList.length > 0 && (
              <div className="absolute bottom-full left-0 mb-2 w-full max-w-sm overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-[0_24px_48px_-12px_rgba(16,24,40,0.22)]">
                <div className="flex items-center justify-between border-b border-surface-border px-4 py-2.5">
                  <span className="text-[13px] font-semibold text-slate-900">Selected candidates ({selectedList.length.toLocaleString()})</span>
                  <button
                    type="button"
                    onClick={() => { deselectAllCVs(); setListOpen(false); }}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
                <ul className="max-h-[44vh] overflow-y-auto p-1.5">
                  {selectedList.slice(0, 300).map((c) => (
                    <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-slate-50">
                      <Avatar name={c.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-slate-900">{c.name}</p>
                        {c.title ? <p className="truncate text-xs text-slate-500">{c.title}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => deselectCV(c.id)}
                        className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${c.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {selectedList.length > 300 && (
                    <li className="px-2.5 py-2 text-center text-xs text-slate-500">+{(selectedList.length - 300).toLocaleString()} more selected</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-2xl border border-surface-border bg-paper/95 p-2 shadow-[0_16px_40px_-12px_rgba(16,24,40,0.22)] ring-1 ring-navy-100 backdrop-blur sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center">
                {/* Step 1: candidates */}
                <button
                  type="button"
                  onClick={() => (selectedCVs.length > 0 ? setListOpen((v) => !v) : go('candidates'))}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-navy-50/70"
                >
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', selectedCVs.length ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-500')}>
                    <Users className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">{step(1, selectedCVs.length > 0)} Candidates</span>
                    <span className="block truncate text-[13px] font-semibold text-slate-900">
                      {selectedCVs.length ? `${selectedCVs.length.toLocaleString()} selected` : 'None selected'}
                    </span>
                  </span>
                  {selectedCVs.length > 0 && <ChevronUp className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', !listOpen && 'rotate-180')} />}
                </button>

                <span className="hidden h-8 w-px shrink-0 bg-surface-border sm:block" />

                {/* Step 2: job description */}
                <div className="flex min-w-0 flex-1 items-center">
                  <button
                    type="button"
                    onClick={() => go('jobs')}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-navy-50/70"
                    title={jdTitle ? 'Change job description' : 'Choose a job description'}
                  >
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', jdTitle ? 'bg-navy-600 text-white' : 'bg-slate-100 text-slate-500')}>
                      <Briefcase className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">{step(2, !!jdTitle)} Job description</span>
                      <span className="block truncate text-[13px] font-semibold text-slate-900">{jdTitle || 'Not chosen'}</span>
                    </span>
                  </button>
                  {selectedJD && (
                    <button
                      type="button"
                      onClick={() => selectJD(null)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Clear job description"
                      title="Clear job description"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Next step / run, and close */}
              <div className="flex shrink-0 items-center gap-2">
                {!ready && !selectedJD && !onJobs && (
                  <Button variant="soft" size="lg" className="flex-1 sm:flex-none" onClick={() => go('jobs')}>
                    Choose a job <ArrowRight />
                  </Button>
                )}
                {!ready && selectedCVs.length === 0 && !onCandidates && (
                  <Button variant="soft" size="lg" className="flex-1 sm:flex-none" onClick={() => go('candidates')}>
                    Choose candidates <ArrowRight />
                  </Button>
                )}
                {(ready || onJobs || onCandidates) && (
                  <Button variant="primary" size="lg" className="flex-1 sm:flex-none" onClick={start} disabled={!ready}>
                    <Target />
                    {ready ? `Run match (${selectedCVs.length.toLocaleString()})` : tooMany ? `Max ${MATCH_MAX_CVS.toLocaleString()} CVs` : 'Run match'}
                  </Button>
                )}
                <span className="hidden h-8 w-px bg-surface-border sm:block" />
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close"
                  title="Close (your selection is kept)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
