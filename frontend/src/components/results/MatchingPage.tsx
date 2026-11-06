'use client';
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import dynamic from 'next/dynamic';
import {
  Target,
  Brain,
  Eye,
  Briefcase,
  Calendar,
  FileDown,
  MessageSquare,
  Pencil,
  Save,
  X,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  ChevronDown,
  Users,
} from '@/components/icons';
import { useAppStore } from '@/stores/appStore';
import { useRouter } from 'next/navigation';
import { workspacePath } from '@/lib/navigation';
import { canUseAgents, interviewHref } from '@/lib/agentLinks';
import MatchingFullPageAnimation from '@/components/results/MatchingFullPageAnimation';
import { MATCH_MAX_CVS } from '@/lib/matchRun';
import { MultiSelect } from '@/components/ui/multi-select';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { motion } from 'framer-motion';
import { rise } from '@/lib/motion';
const FilePreviewModal = dynamic(() => import('@/components/ui/file-preview-modal').then(mod => mod.FilePreviewModal), {
  ssr: false,
});
import { getApiBaseUrl } from '@/lib/config';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import ContactActions from '@/components/common/ContactActions';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { Segmented } from '@/components/ui/segmented';
import { Avatar } from '@/components/ui/avatar';
// Queue components removed

type SortKey = 'score' | 'skills' | 'experience';

const DEFAULT_WEIGHTS = {
  skills: 80,
  responsibilities: 15,
  job_title: 2.5,
  experience: 2.5,
};

// --- Helpers -------------------------------------------------------------
const uuidLike = (s?: string) =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

// Semantic color by score (0-1): >=80 green, >=60 amber, else red.
function scoreTone(score: number) {
  const pct = score * 100;
  if (pct >= 80) return { text: 'text-emerald-600', stroke: '#10b981', badge: 'success' as const, label: 'Excellent' };
  if (pct >= 60) return { text: 'text-amber-600', stroke: '#f59e0b', badge: 'warning' as const, label: 'Good' };
  return { text: 'text-red-600', stroke: '#ef4444', badge: 'danger' as const, label: 'Needs review' };
}

function scoreColor(score: number) {
  return scoreTone(score).text;
}

function barColor(score: number) {
  const pct = score * 100;
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Per-metric bar fill color (0-1 score). */
function metricBarColor(score: number) {
  return barColor(score);
}

/** Per-metric value text color (0-1 score). */
function metricTextColor(score: number) {
  return scoreColor(score);
}

/** Pill descriptor for an overall score (0-1): bg + text classes + label. */
function scoreBadge(score: number) {
  const pct = score * 100;
  if (pct >= 80) return { bg: 'bg-emerald-50 ring-emerald-200', text: 'text-emerald-700', label: 'Excellent' };
  if (pct >= 60) return { bg: 'bg-amber-50 ring-amber-200', text: 'text-amber-700', label: 'Good' };
  return { bg: 'bg-red-50 ring-red-200', text: 'text-red-700', label: 'Needs review' };
}

/** Circular score gauge coloured by tone. */
function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${pct}% match`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF1F6" strokeWidth={5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreTone(score).stroke}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold tabular-nums text-slate-900">{pct}</span>
    </div>
  );
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function getDisplayedBreakdown(candidate: any) {
  const raw = {
    skills: Number(candidate?.skills_score ?? 0),
    responsibilities: Number(candidate?.responsibilities_score ?? 0),
    title: Number(candidate?.job_title_score ?? 0),
    years: Number(candidate?.years_score ?? 0),
  };

  // When LLM runs, backend overwrites overall_score with llm_score and stores the original similarity overall in semantic_score.
  const hasLLM = !!candidate?.has_llm_analysis && typeof candidate?.semantic_score === 'number';
  const semanticOverall = Number(candidate?.semantic_score ?? 0);
  const overall = Number(candidate?.computed_overall ?? candidate?.overall_score ?? 0);

  if (hasLLM && semanticOverall > 0) {
    const scale = overall / semanticOverall;
    return {
      sourceLabel: 'LLM-adjusted',
      scores: {
        skills: clamp01(raw.skills * scale),
        responsibilities: clamp01(raw.responsibilities * scale),
        title: clamp01(raw.title * scale),
        years: clamp01(raw.years * scale),
      },
    };
  }

  return {
    sourceLabel: 'Similarity',
    scores: {
      skills: clamp01(raw.skills),
      responsibilities: clamp01(raw.responsibilities),
      title: clamp01(raw.title),
      years: clamp01(raw.years),
    },
  };
}

// Try hard to get a human-friendly candidate name from the store or candidate object.
function resolveCandidateName(candidate: any, cvIndex: Record<string, any>): string {
  const fromCandidate = candidate?.cv_name;
  const cvMeta = cvIndex[candidate?.cv_id];
  // Prefer a proper name from candidate fields if it doesn't look like an ID
  if (fromCandidate && !uuidLike(fromCandidate)) return String(fromCandidate);
  // Try common CV metadata fields
  const guesses = [
    cvMeta?.full_name,
    cvMeta?.candidate_name,
    cvMeta?.name,
    cvMeta?.display_name,
    cvMeta?.person_name,
    cvMeta?.owner,
    // Fallback to filename before extension if it looks like a name
    (cvMeta?.filename || cvMeta?.file_name || cvMeta?.original_name)?.replace(/\.[^.]+$/, ''),
  ].filter(Boolean);
  const firstGood = guesses.find((g: string) => g && !uuidLike(g) && g.trim().length > 1);
  if (firstGood) return String(firstGood);
  // Last resort: show "Candidate" + short id suffix
  const id = String(candidate?.cv_id || '').slice(0, 8);
  return id ? `Candidate ${id}` : 'Candidate';
}

function resolveTitle(candidate: any, cvIndex: Record<string, any>): string {
  const cvMeta = cvIndex[candidate?.cv_id];
  return candidate?.cv_job_title || cvMeta?.job_title || cvMeta?.title || 'No title';
}

function resolveYears(candidate: any, cvIndex: Record<string, any>): string {
  const cvMeta = cvIndex[candidate?.cv_id];
  const yrs =
    (typeof candidate?.cv_years === 'number' ? candidate.cv_years : undefined) ??
    (typeof cvMeta?.experience_years === 'number' ? cvMeta.experience_years : undefined) ??
    (typeof cvMeta?.years_of_experience === 'number' ? cvMeta.years_of_experience : undefined);
  return typeof yrs === 'number' ? `${yrs} years` : 'Experience n/a';
}

function resolveExpectedSalary(candidate: any, applications: any[]): number | null {
  const fromCandidate = candidate?.expected_salary;
  if (typeof fromCandidate === 'number' && fromCandidate > 0) return fromCandidate;
  if (applications?.length) {
    const app = applications.find((a: any) => a.application_id === candidate?.cv_id);
    const salary = app?.expected_salary ?? (app as any)?.expected_salary;
    if (typeof salary === 'number' && salary > 0) return salary;
  }
  return null;
}

// --- Component -----------------------------------------------------------
export default function MatchingPage() {
  const router = useRouter();
  const {
    matchResult,
    matchWeights,
    setMatchWeights,
    cvs, // used to resolve names and meta
    jds,
    loadJDs,
    loadMoreJDs,
    totalJDs,
    selectedJD,
    selectedCVs,
    runMatch,
    loadingStates,
    matchingQueue,
    matchingProgress,
  } = useAppStore(
    useShallow((s) => ({
      matchResult: s.matchResult,
      matchWeights: s.matchWeights,
      setMatchWeights: s.setMatchWeights,
      cvs: s.cvs,
      jds: s.jds,
      loadJDs: s.loadJDs,
      loadMoreJDs: s.loadMoreJDs,
      totalJDs: s.totalJDs,
      selectedJD: s.selectedJD,
      selectedCVs: s.selectedCVs,
      runMatch: s.runMatch,
      loadingStates: s.loadingStates,
      matchingQueue: s.matchingQueue,
      matchingProgress: s.matchingProgress,
    }))
  );

  const { applications } = useCareersStore(
    useShallow((s) => ({ applications: s.applications }))
  );
  const { user } = useAuthStore();

  // While a match is running (queued, scoring, AI verification, or finalizing) this
  // page shows the full immersive animation instead of the results UI below. It's
  // driven entirely by the global store, so switching tabs and coming back here
  // just re-reads the same live state, the match itself keeps running in the
  // background regardless. Computed early so the (expensive, list-heavy) launcher
  // JSX further down is skipped entirely while it isn't even rendered, the fake
  // progress ticker and the backend poll both update the store every 0.5-2s, and
  // rebuilding those dropdowns on every one of those ticks was the main source of
  // jank/stutter during matching.
  const isMatchingActive =
    matchingProgress.isVisible ||
    loadingStates.matching.isLoading ||
    loadingStates.careersMatching.isLoading ||
    !!matchingQueue?.isQueued;

  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{ isOpen: boolean; url: string; name: string; id: string; type: string; extractedText?: string }>({
    isOpen: false,
    url: '',
    name: '',
    id: '',
    type: '',
    extractedText: ''
  });
  const [filterThreshold] = useState(0);
  const [downloadingCV, setDownloadingCV] = useState<string | null>(null);
  const [resultsLimit, setResultsLimit] = useState<number | 'all'>(3); // Default to top 3
  const [isExporting, setIsExporting] = useState(false);

  // --- Match launcher (JD + category + count) -------------------------------
  const MATCH_COUNT_OPTIONS: { value: number; label: string }[] = [50, 100, 150, 200, 250, 300, 500, 1000, 2500, 5000, MATCH_MAX_CVS].map(
    (n) => ({ value: n, label: n.toLocaleString() }),
  );
  const [launchJdId, setLaunchJdId] = useState<string>('');
  const [launchCats, setLaunchCats] = useState<string[]>([]);   // empty = every category
  const [launchCount, setLaunchCount] = useState<number>(50);
  const [launchCategories, setLaunchCategories] = useState<Record<string, number>>({});
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Load JDs + categories once so the launcher dropdowns are populated.
  useEffect(() => {
    if (!jds || jds.length === 0) {
      loadJDs?.();
    }
    api.getCategories()
      .then((res) => setLaunchCategories(res.categories || {}))
      .catch(() => setLaunchCategories({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The API sends job descriptions 200 at a time; the picker must offer all of them, so keep loading until we have them.
  useEffect(() => {
    if (totalJDs != null && jds && jds.length > 0 && jds.length < totalJDs && !loadingStates.jds.isLoading && !loadingStates.jds.error) {
      loadMoreJDs?.();
    }
  }, [jds?.length, totalJDs, loadingStates.jds.isLoading, loadingStates.jds.error, loadMoreJDs]);

  // Keep the JD dropdown selection valid as JDs load.
  useEffect(() => {
    if (!launchJdId && selectedJD) {
      setLaunchJdId(selectedJD);
    }
  }, [selectedJD, launchJdId]);

  const jobOptions = useMemo<ComboboxOption[]>(
    () =>
      (jds || []).map((j: any) => ({
        value: String(j.id),
        label: String((j.job_title && j.job_title !== 'Not specified' ? j.job_title : j.filename) || j.id),
        hint: j.job_title && j.job_title !== 'Not specified' && j.filename ? String(j.filename) : undefined,
      })),
    [jds],
  );

  const handleLaunchMatch = async () => {
    setLaunchError(null);
    if (!launchJdId) {
      setLaunchError('Please select a job description.');
      return;
    }
    setLaunching(true);
    try {
      const res = await api.listCVIds({ categories: launchCats.length ? launchCats : undefined, limit: Math.min(launchCount, MATCH_MAX_CVS) });
      const ids: string[] = (res.ids || []).filter(Boolean);
      if (ids.length === 0) {
        setLaunchError('No CVs found in the selected categories.');
        setLaunching(false);
        return;
      }
      // Atomically set the selection and clear any prior result, then run.
      // runMatch() flips the matching loading flag synchronously, so the
      // auto-run effect below won't double-fire.
      useAppStore.setState({ selectedJD: launchJdId, selectedCVs: ids, matchResult: null });
      await runMatch();
    } catch (e: any) {
      setLaunchError(e?.message || 'Failed to start matching.');
    } finally {
      setLaunching(false);
    }
  };

  // Not shown at all while a match is in flight (see the isMatchingActive early
  // return below), so skip rebuilding this dropdown-heavy JSX on every progress tick.
  const matchLauncher = isMatchingActive ? null : (
    <motion.div variants={rise} initial="hidden" animate="show" className="rounded-2xl border border-surface-border bg-paper p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-600 text-white shadow-sm">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Quick match</h3>
            <p className="text-xs text-slate-500">Score the latest CVs in a category against a job description.</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" icon={<Users />} onClick={() => router.push(workspacePath('candidates'))}>
          Hand-pick candidates instead
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-end">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600">Job description</label>
          <Combobox
            options={jobOptions}
            value={launchJdId}
            onChange={setLaunchJdId}
            placeholder="Search or select a job description"
            emptyText="No job description matches"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600">Categories</label>
          <MultiSelect
            options={Object.entries(launchCategories)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, count]) => ({ value: cat, label: cat, count }))}
            value={launchCats}
            onChange={setLaunchCats}
            allLabel="All categories"
            noun="categories"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-600">Number of CVs</label>
          <select
            value={String(launchCount)}
            onChange={(e) => setLaunchCount(Number(e.target.value))}
            className="field-input"
          >
            {MATCH_COUNT_OPTIONS.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))}
          </select>
        </div>

        <Button variant="primary" icon={<Target />} loading={launching} onClick={handleLaunchMatch} className="md:min-w-[120px]">
          Run match
        </Button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {`Scores the most recent ${launchCount.toLocaleString()} CVs (at most ${MATCH_MAX_CVS.toLocaleString()} per match)`}
        {launchCats.length === 0
          ? ' across all categories.'
          : launchCats.length === 1
            ? ` in the ${launchCats[0]} category.`
            : ` across the ${launchCats.length} selected categories, newest first.`}
      </p>
      {launchError && <p className="mt-2 text-xs font-medium text-red-600">{launchError}</p>}
    </motion.div>
  );

  // Notes state
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [candidateNotes, setCandidateNotes] = useState<Record<string, any[]>>({});
  const [notesSummary, setNotesSummary] = useState<Record<string, { has_notes: boolean; notes_count: number; latest_note: any | null }>>({});

  // Ensure default weights present
  useEffect(() => {
    const keys: (keyof typeof DEFAULT_WEIGHTS)[] = ['skills', 'responsibilities', 'job_title', 'experience'];
    const missing = !matchWeights || keys.some((k) => typeof (matchWeights as any)[k] !== 'number');
    const zeroSum =
      matchWeights &&
      keys.reduce((s, k) => s + (matchWeights as any)[k], 0) <= 0;
    if (missing || zeroSum) {
      setMatchWeights?.({ ...DEFAULT_WEIGHTS });
    }
  }, [matchWeights, setMatchWeights]);

  // Load batch notes summary for all candidates when match results change
  useEffect(() => {
    const loadSummary = async () => {
      try {
        if (!matchResult?.candidates) return;
        const ids: string[] = Array.from(
          new Set(
            (matchResult.candidates as any[])
              .map((c: any) => (c && c.cv_id ? String(c.cv_id) : ''))
              .filter((id: string) => Boolean(id))
          )
        );
        if (ids.length === 0) return;
        const res = await api.getNotesSummary(ids);
        const map: Record<string, { has_notes: boolean; notes_count: number; latest_note: any | null }> = {};
        (res.summaries || []).forEach((s: any) => {
          map[s.cv_id] = { has_notes: !!s.has_notes, notes_count: s.notes_count || 0, latest_note: s.latest_note || null };
        });
        setNotesSummary(map);
      } catch (e) {
        console.warn('Failed to load notes summary, falling back on-demand:', e);
      }
    };
    loadSummary();
  }, [matchResult?.candidates]);

  // Queue handlers removed

  // Auto-run matching when we have selected data but no match results
  useEffect(() => {
    if (selectedJD && selectedCVs && selectedCVs.length > 0 && !matchResult && !loadingStates.matching.isLoading && !loadingStates.careersMatching.isLoading) {
      // Check if this is careers data (when we have applications from careers store)
      const hasCareersData = applications && applications.length > 0;

      if (hasCareersData) {
        // For careers data, validate that selectedJD looks like a valid UUID
        const isValidJdId = selectedJD && typeof selectedJD === 'string' && selectedJD.length === 36 && selectedJD.includes('-');
        if (isValidJdId) {
          runMatch();
        } else {
          console.warn('Skipping auto-matching: Invalid JD ID format', { selectedJD });
        }
      } else {
        // For database page data, auto-run matching immediately
        runMatch();
      }
    }
  }, [selectedJD, selectedCVs, matchResult, loadingStates.matching.isLoading, loadingStates.careersMatching.isLoading, runMatch, applications]);


  // Build CV index for quick lookups
  const cvIndex = useMemo(() => {
    const idx: Record<string, any> = {};
    (cvs || []).forEach((cv: any) => {
      const id = cv?.id || cv?.document_id || cv?.cv_id;
      if (id) idx[id] = cv;
    });
    return idx;
  }, [cvs]);

  const candidates: any[] = matchResult?.candidates ?? [];

  // Debug logging

  // Compute display scores using current (normalized) weights
  const candidatesWithComputed = useMemo(() => {
    return candidates.map((c) => {
      // Use the backend's overall_score directly instead of recalculating
      const computed_overall = Number(c.overall_score ?? 0);
      return { ...c, computed_overall };
    });
  }, [candidates]);

  const sortedCandidates = useMemo(() => {
    const filtered = [...candidatesWithComputed]
      .filter((c) => (c.computed_overall ?? 0) >= filterThreshold)
      .sort((a, b) => {
        if (sortBy === 'score') return (b.computed_overall ?? 0) - (a.computed_overall ?? 0);
        if (sortBy === 'skills') return (b.skills_score ?? 0) - (a.skills_score ?? 0);
        if (sortBy === 'experience') return (b.years_score ?? 0) - (a.years_score ?? 0);
        return 0;
      });

    // Apply results limit
    if (resultsLimit === 'all') {
      return filtered;
    }
    return filtered.slice(0, resultsLimit);
  }, [candidatesWithComputed, sortBy, filterThreshold, resultsLimit]);

  // Analytics - both total and visible
  const totalMatches = candidatesWithComputed.length;

  const visibleMatches = sortedCandidates.length;
  const visibleAverage = visibleMatches > 0
    ? Math.round((sortedCandidates.reduce((s, c) => s + (c.computed_overall ?? 0), 0) / visibleMatches) * 100)
    : 0;
  const visibleTop = visibleMatches > 0
    ? Math.round(Math.max(...sortedCandidates.map((c) => c.computed_overall ?? 0)) * 100)
    : 0;

  // Total filtered candidates (before results limit)
  const totalFiltered = candidatesWithComputed.filter((c) => (c.computed_overall ?? 0) >= filterThreshold).length;

  // Download CV handler
  const handleDownloadCV = async (cvId: string) => {
    try {
      setDownloadingCV(cvId);
      const { blob, filename } = await api.downloadCV(cvId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download CV:', error);
    } finally {
      setDownloadingCV(null);
    }
  };

  const handlePreviewFile = async (id: string, type: string, filename: string) => {
    const normalizedFilename = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
    let fileUrl: string;
    let extractedText = '';

    if (type === 'cv') {
      // Use CV download API (same as careers page) so preview works for both
      // main CVs and job-application CVs (which may be stored under different paths).
      try {
        if (previewBlobUrl) {
          URL.revokeObjectURL(previewBlobUrl);
          setPreviewBlobUrl(null);
        }
        const { blob } = await api.downloadCV(id);
        const blobUrl = URL.createObjectURL(blob);
        setPreviewBlobUrl(blobUrl);
        fileUrl = blobUrl;
      } catch (err) {
        console.error('Failed to load CV for preview:', err);
        return;
      }
      if (!normalizedFilename.toLowerCase().endsWith('.pdf')) {
        try {
          const details = await api.getCVDetails(id);
          extractedText = details?.text_info?.extracted_text_preview || '';
        } catch {
          // ignore
        }
      }
    } else {
      fileUrl = `${getApiBaseUrl()}/api/storage/files/${type}/${id}`;
      if (!normalizedFilename.toLowerCase().endsWith('.pdf')) {
        try {
          const details = await api.getJDDetails(id);
          extractedText = details?.text_info?.extracted_text_preview || '';
        } catch {
          // ignore
        }
      }
    }

    setPreviewData({
      isOpen: true,
      url: fileUrl,
      name: normalizedFilename,
      id,
      type,
      extractedText
    });
  };

  // Notes handlers
  const loadCandidateNotes = async (cvId: string) => {
    try {
      const response = await api.getCVNotes(cvId);
      setCandidateNotes(prev => ({
        ...prev,
        [cvId]: response.notes || []
      }));
      // refresh summary cache for this id after a change/fetch
      setNotesSummary(prev => ({
        ...prev,
        [cvId]: {
          has_notes: (response.notes || []).length > 0,
          notes_count: (response.notes || []).length,
          latest_note: (response.notes || []).length > 0
            ? (response.notes as any[]).reduce((latest, n) => {
              const a = (latest?.updated_at || latest?.created_at || '') as string;
              const b = (n?.updated_at || n?.created_at || '') as string;
              return a >= b ? latest : n;
            })
            : null,
        }
      }));
    } catch (error) {
      console.error('Failed to load notes:', error);
    }
  };

  const handleEditNote = (cvId: string) => {
    setEditingNote(cvId);
    setNoteText('');
  };

  const handleSaveNote = async (cvId: string) => {
    if (!noteText.trim()) return;

    setSavingNote(cvId);
    try {
      await api.addOrUpdateNote(cvId, noteText.trim(), user?.username || 'anonymous');
      await loadCandidateNotes(cvId);
      setEditingNote(null);
      setNoteText('');
    } catch (error) {
      console.error('Failed to save note:', error);
      alert('Failed to save note');
    } finally {
      setSavingNote(null);
    }
  };

  const handleCancelNote = () => {
    setEditingNote(null);
    setNoteText('');
  };

  // Export results handler
  const handleExportResults = async () => {
    if (!matchResult || !matchResult.candidates) {
      alert('No match results to export');
      return;
    }

    setIsExporting(true);

    try {
      // Create CSV content
      const headers = [
        'Rank',
        'Candidate Name',
        'Email',
        'Phone',
        'Overall Score (%)',
        'Skills Score (%)',
        'Responsibilities Score (%)',
        'Job Title Score (%)',
        'Experience Score (%)',
        'Job Title',
        'Experience (Years)',
        'Job Description Title',
        'Job Description Experience Required',
        'Application Date',
        'CV Filename'
      ];

      const csvRows = [headers.join(',')];

      // Process each candidate
      candidatesWithComputed.forEach((candidate, index) => {
        // Find corresponding application data
        const application = applications.find(app => app.application_id === candidate.cv_id);

        // Get candidate name
        const candidateName = resolveCandidateName(candidate, cvIndex);

        // Get job title and experience
        const jobTitle = resolveTitle(candidate, cvIndex);
        const experience = resolveYears(candidate, cvIndex);

        // Get CV metadata
        const cvMeta = cvIndex[candidate?.cv_id];
        const filename = cvMeta?.filename || `cv_${candidate.cv_id}.pdf`;

        const row = [
          index + 1, // Rank
          `"${candidateName}"`, // Candidate Name
          `"${application?.applicant_email || 'N/A'}"`, // Email
          `"${application?.applicant_phone || 'N/A'}"`, // Phone
          Math.round((candidate.computed_overall ?? 0) * 100), // Overall Score
          Math.round((candidate.skills_score ?? 0) * 100), // Skills Score
          Math.round((candidate.responsibilities_score ?? 0) * 100), // Responsibilities Score
          Math.round((candidate.job_title_score ?? 0) * 100), // Job Title Score
          Math.round((candidate.years_score ?? 0) * 100), // Experience Score
          `"${jobTitle}"`, // Job Title
          `"${experience}"`, // Experience
          `"${matchResult.jd_job_title || 'N/A'}"`, // JD Title
          `"${matchResult.jd_years || 'N/A'} years"`, // JD Experience Required
          `"${application?.application_date ? new Date(application.application_date).toLocaleDateString() : 'N/A'}"`, // Application Date
          `"${filename}"` // CV Filename
        ];

        csvRows.push(row.join(','));
      });

      // Create and download CSV file
      const csvContent = csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `match_results_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export results:', error);
      alert('Failed to export results. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  if (isMatchingActive && !loadingStates.matching.error && !loadingStates.careersMatching.error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Matching" description="Finding your best matches" />
        <MatchingFullPageAnimation
          totalCVs={matchingProgress.totalCVs}
          processedCVs={matchingProgress.processedCVs}
          isQueued={!!matchingQueue?.isQueued}
          queuePosition={matchingQueue?.queuePosition ?? null}
          estimatedWaitTime={matchingQueue?.estimatedWaitTime ?? null}
          estimatedTimeRemaining={matchingProgress.estimatedTimeRemaining}
          currentBatch={matchingProgress.currentBatch}
          totalBatches={matchingProgress.totalBatches}
          phase={matchingProgress.phase}
          currentCandidate={matchingProgress.currentCandidate}
          recentCandidates={matchingProgress.recentCandidates}
          queueMessage={matchingQueue?.message ?? null}
          percent={matchingProgress.percent ?? 0}
          llmDone={matchingProgress.llmDone ?? 0}
          llmTotal={matchingProgress.llmTotal ?? 0}
        />
      </div>
    );
  }

  // Error state - show error message if matching failed (check AFTER loading state)
  const matchError = loadingStates.matching.error || loadingStates.careersMatching.error;
  if (matchError) {
    return (
      <div className="space-y-5">
        <PageHeader title="Matching" description="Matching error" />
        {matchLauncher}
        <EmptyState
          icon={AlertTriangle}
          title="Matching failed"
          hint={matchError}
          className="border-red-200 bg-red-50/40"
          action={
            <div className="flex flex-col items-center gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => router.push(workspacePath('candidates'))}
              >
                Go to database
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  // Clear error and allow user to try again
                  useAppStore.getState().setLoading?.('matching', false, undefined);
                  useAppStore.getState().setLoading?.('careersMatching', false, undefined);
                }}
              >
                Try again
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  // Empty state - show when no matching is in progress and no results
  if (!matchResult?.candidates || matchResult.candidates.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Matching" description="Run a match against a job description" />
        {matchLauncher}
        <EmptyState
          icon={Target}
          title="No matches yet"
          hint="Use quick match above, or hand-pick candidates and a job description; the match tray at the bottom of the screen runs it."
          action={
            <Button
              variant="secondary"
              onClick={() => router.push(workspacePath('candidates'))}
            >
              Browse candidates
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-h-full space-y-4">
      {matchLauncher}

      <div className="rounded-2xl border border-surface-border bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-navy-600">Match results</p>
            <h1 className="mt-0.5 truncate text-xl font-bold tracking-[-0.025em] text-slate-900">
              {matchResult?.jd_job_title || 'Job description'}
            </h1>
            {matchResult?.message && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {matchResult.message}
              </p>
            )}
          </div>
          <div className="flex items-center gap-6">
            {[
              { label: 'Ranked', value: totalMatches.toLocaleString() },
              { label: 'Best', value: `${visibleTop}%` },
              { label: 'Average', value: `${visibleAverage}%` },
            ].map((k) => (
              <div key={k.label} className="text-right">
                <p className="text-xl font-bold leading-none tracking-[-0.02em] tabular-nums text-slate-900">{k.value}</p>
                <p className="mt-1 text-xs text-slate-500">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={sortBy}
              onChange={setSortBy}
              items={[
                { value: 'score', label: 'Overall' },
                { value: 'skills', label: 'Skills' },
                { value: 'experience', label: 'Experience' },
              ]}
            />
            <Segmented
              size="sm"
              value={String(resultsLimit)}
              onChange={(v) => setResultsLimit(v === 'all' ? 'all' : Number(v))}
              items={[
                { value: '3', label: 'Top 3' },
                { value: '5', label: 'Top 5' },
                { value: 'all', label: `All ${totalMatches}` },
              ]}
            />
          </div>
          <Button variant="secondary" size="sm" icon={<FileDown />} onClick={handleExportResults} disabled={isExporting}>
            {isExporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
            {sortedCandidates.map((candidate, index) => {
              const overall = candidate.computed_overall ?? 0;
              const badge = scoreBadge(overall);
              const isOpen = expandedMatch === candidate.cv_id;
              const displayName = resolveCandidateName(candidate, cvIndex);
              const title = resolveTitle(candidate, cvIndex);
              const yearsText = resolveYears(candidate, cvIndex);
              const expectedSalary = resolveExpectedSalary(candidate, applications ?? []);

              return (
                <div
                  key={candidate.cv_id}
                  className={`relative overflow-hidden rounded-2xl border bg-white transition-shadow ${isOpen ? 'border-navy-400 shadow-[0_0_0_3px_rgba(22,32,75,0.10)]' : 'border-surface-border shadow-card hover:shadow-[0_4px_12px_-4px_rgba(16,24,40,0.10)]'}`}
                >
                    {/* OUTER WRAPPER FIXED: now a <div> with role="button" */}
                    <div
                      onClick={() =>
                        setExpandedMatch((prev) => (prev === candidate.cv_id ? null : candidate.cv_id))
                      }
                      role="button"
                      tabIndex={0}
                      className="w-full cursor-pointer px-4 py-3.5 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums ${
                              index === 0 ? 'bg-amber-100 text-amber-700' : index < 3 ? 'bg-navy-50 text-navy-700' : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {index + 1}
                          </span>
                          <Avatar name={displayName} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-slate-900">{displayName}</h4>
                              {(notesSummary[candidate.cv_id]?.notes_count || (candidateNotes[candidate.cv_id]?.length || 0)) > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                  <MessageSquare className="h-3 w-3" />
                                  {notesSummary[candidate.cv_id]?.notes_count ?? (candidateNotes[candidate.cv_id]?.length || 0)}
                                </span>
                              )}
                            </div>
                            <p className="truncate text-[13px] text-slate-500">
                              {title} · {yearsText}
                              {expectedSalary != null && (
                                <span className="font-medium text-emerald-700"> · AED {expectedSalary.toLocaleString()}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className={`hidden rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset sm:inline ${badge.bg} ${badge.text}`}>
                            {candidate.has_llm_analysis && candidate.llm_analysis?.match_level
                              ? candidate.llm_analysis.match_level
                              : badge.label}
                          </span>
                          <ScoreRing score={overall} />
                          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {isOpen && (
                      <>
                      {(candidate.requirements?.length ?? 0) > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-[84px]" onClick={(e) => e.stopPropagation()}>
                          {candidate.requirements!.map((r: { type: string; name: string; mandatory: boolean; status: string }) => {
                            const tone =
                              r.status === 'met'
                                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                : r.status === 'missing'
                                  ? 'bg-red-50 text-red-700 ring-red-200'
                                  : 'bg-slate-50 text-slate-500 ring-slate-200';
                            const note =
                              r.status === 'met' ? 'listed on the CV' : r.status === 'missing' ? 'not among the CV’s listed ones' : 'the CV lists none';
                            return (
                              <span
                                key={`${r.type}-${r.name}`}
                                title={`${r.mandatory ? 'Mandatory' : 'Preferred'} ${r.type}: ${note}`}
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}
                              >
                                {r.status === 'met' ? '✓ ' : r.status === 'missing' ? '✗ ' : '? '}
                                {r.name}
                                {!r.mandatory && ' (preferred)'}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {(candidate.cv_email || candidate.cv_phone || candidate.cv_linkedin || candidate.cv_github) && (
                        <div className="mt-3 pl-[84px]" onClick={(e) => e.stopPropagation()}>
                          <ContactActions
                            email={candidate.cv_email}
                            phone={candidate.cv_phone}
                            linkedin={candidate.cv_linkedin}
                            github={candidate.cv_github}
                            privacy
                          />
                        </div>
                      )}
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        {(() => {
                          const b = getDisplayedBreakdown(candidate);
                          const scores = b.scores;
                          const llmBd = candidate?.has_llm_analysis ? (candidate?.llm_analysis?.score_breakdown as Record<string, number> | undefined) : undefined;
                          const llmRows = llmBd
                            ? (['skills', 'experience', 'domain', 'seniority', 'education', 'language'] as const)
                              .filter((k) => typeof llmBd[k] === 'number')
                              .map((k) => [k, llmBd[k]] as const)
                            : [];
                          if (llmRows.length > 0) {
                            return (
                              <>
                                <div className="col-span-2 md:col-span-4 -mt-1 mb-0.5">
                                  <span className="inline-flex items-center rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">
                                    Breakdown: AI analysis
                                  </span>
                                </div>
                                {llmRows.map(([k, v]) => (
                                  <div key={k} className="rounded-xl border border-surface-border bg-slate-50/60 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-semibold capitalize text-slate-600">{k}</span>
                                      <span className={`text-xs font-semibold ${metricTextColor(v / 100)}`}>{Math.round(v)}%</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                                      <div
                                        className={`h-1.5 rounded-full transition-[width] duration-300 ${metricBarColor(v / 100)}`}
                                        style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </>
                            );
                          }
                          return (
                            <>
                              <div className="col-span-2 md:col-span-4 -mt-1 mb-0.5">
                                <span className="inline-flex items-center rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-semibold text-navy-700">
                                  Breakdown: {b.sourceLabel}
                                </span>
                                {candidate?.has_llm_analysis && typeof candidate?.semantic_score === 'number' && (
                                  <span className="ml-2 text-[11px] text-slate-500">
                                    Overall: {Math.round((candidate?.computed_overall ?? candidate?.overall_score ?? 0) * 100)}% • Similarity: {Math.round((candidate.semantic_score ?? 0) * 100)}%
                                  </span>
                                )}
                              </div>
                              {/* Skills */}
                              <div className="rounded-xl border border-surface-border bg-slate-50/60 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-slate-600">Skills</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.skills)}`}>
                                    {Math.round(scores.skills * 100)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className={`h-1.5 rounded-full transition-[width] duration-300 ${metricBarColor(scores.skills)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.skills * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Responsibilities */}
                              <div className="rounded-xl border border-surface-border bg-slate-50/60 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-slate-600">Responsibilities</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.responsibilities)}`}>
                                    {Math.round(scores.responsibilities * 100)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className={`h-1.5 rounded-full transition-[width] duration-300 ${metricBarColor(scores.responsibilities)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.responsibilities * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Title */}
                              <div className="rounded-xl border border-surface-border bg-slate-50/60 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-slate-600">Title</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.title)}`}>
                                    {Math.round(scores.title * 100)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className={`h-1.5 rounded-full transition-[width] duration-300 ${metricBarColor(scores.title)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.title * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Years */}
                              <div className="rounded-xl border border-surface-border bg-slate-50/60 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-slate-600">Years</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.years)}`}>
                                    {Math.round(scores.years * 100)}%
                                  </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                                  <div
                                    className={`h-1.5 rounded-full transition-[width] duration-300 ${metricBarColor(scores.years)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.years * 100))}%` }}
                                  />
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 flex justify-between items-center">
                        {/* Note Section */}
                        <div className="flex items-center gap-2">
                          {editingNote === candidate.cv_id ? (
                            <div className="flex items-center gap-2">
                              <textarea
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Add a note about this candidate..."
                                className="resize-none rounded-lg border border-surface-strong px-3 py-2 text-sm focus:border-navy-500 focus:shadow-glow focus:outline-none"
                                rows={2}
                                cols={30}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveNote(candidate.cv_id);
                                }}
                                disabled={savingNote === candidate.cv_id || !noteText.trim()}
                                className="flex items-center gap-1"
                              >
                                {savingNote === candidate.cv_id ? (
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Save className="w-4 h-4 text-white" />
                                )}
                                <span className="text-white">Save</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelNote();
                                }}
                                className="flex items-center gap-1"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditNote(candidate.cv_id);
                                }}
                                className="flex items-center gap-1"
                              >
                                <Pencil className="w-4 h-4" />
                                <span>Add Note</span>
                              </Button>
                              {(notesSummary[candidate.cv_id]?.notes_count || (candidateNotes[candidate.cv_id]?.length || 0)) > 0 && (
                                <div className="flex items-center gap-1 rounded-full bg-navy-50 px-2 py-1 text-xs font-semibold text-navy-700">
                                  <MessageSquare className="w-4 h-4" />
                                  <span>{(notesSummary[candidate.cv_id]?.notes_count ?? (candidateNotes[candidate.cv_id]?.length || 0))} note{((notesSummary[candidate.cv_id]?.notes_count ?? (candidateNotes[candidate.cv_id]?.length || 0)) !== 1) ? 's' : ''}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              const cvMeta = cvIndex[candidate?.cv_id];
                              const filename = cvMeta?.filename || candidate.cv_name || `cv_${candidate.cv_id}.pdf`;
                              // Ensure filename has .pdf extension (simple: just add .pdf if missing)
                              const normalizedFilename = filename.toLowerCase().endsWith('.pdf') 
                                ? filename 
                                : `${filename}.pdf`;
                              handlePreviewFile(candidate.cv_id, 'cv', normalizedFilename);
                            }}
                            title="Preview Original File"
                            className="flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            <span>Preview</span>
                          </Button>

                          {/* We don't have CVDetails exported yet, so I'll just use the expand functionality 
                              The user said "beside delete button there is one more button Show Extracted Content"
                              Since there is no delete button here, I'll add it anyway as per requested UI.
                          */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedMatch(expandedMatch === candidate.cv_id ? null : candidate.cv_id);
                            }}
                            title="Show AI Analysis"
                            className="flex items-center gap-1"
                          >
                            <FileCheck className="w-4 h-4" />
                            <span>Details</span>
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadCV(candidate.cv_id);
                            }}
                            disabled={downloadingCV === candidate.cv_id}
                            className="flex items-center gap-1"
                          >
                            {downloadingCV === candidate.cv_id ? (
                              <>
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                                <span>Downloading...</span>
                              </>
                            ) : (
                              <>
                                <FileDown className="w-4 h-4" />
                                <span>Download CV</span>
                              </>
                            )}
                          </Button>

                          {canUseAgents(user?.role) && matchResult?.jd_id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(interviewHref({
                                  jdId: matchResult.jd_id, cvId: candidate.cv_id,
                                  jdTitle: matchResult.jd_job_title, cvTitle: displayName,
                                }));
                              }}
                              title="Open the Interview questions agent with this candidate and this job"
                              className="flex items-center gap-1"
                            >
                              <MessageSquare className="w-4 h-4" />
                              <span>Interview questions</span>
                            </Button>
                          )}
                        </div>
                      </div>
                      </>
                      )}
                    </div>



                    {isOpen && (
                        <div className="px-5 pb-5">
                          <div className="mt-2 space-y-6">
                            {/* AI Analysis Section (Redesigned) */}
                            {candidate.has_llm_analysis && candidate.llm_analysis && (
                              <div className="space-y-4 rounded-2xl border border-surface-border bg-white p-4 shadow-card sm:p-5">
                                <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
                                  <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${candidate.llm_analysis.match_level === 'Strong' ? 'bg-emerald-100 text-emerald-600' :
                                      candidate.llm_analysis.match_level === 'Good' ? 'bg-blue-100 text-blue-600' :
                                        'bg-amber-100 text-amber-600'
                                      }`}>
                                      <Sparkles className="w-5 h-5" />
                                    </div>
                                    <div>
                                      <h4 className="text-base font-semibold text-slate-900 leading-tight">AI Match Analysis</h4>
                                      <p className="text-xs font-medium text-slate-500 mt-0.5">
                                        Match Level:{' '}
                                        <span className={`font-semibold ${
                                          candidate.llm_analysis.match_level === 'Strong' ? 'text-emerald-600' :
                                            candidate.llm_analysis.match_level === 'Good' ? 'text-blue-600' :
                                              'text-amber-600'
                                        }`}>
                                          {candidate.llm_analysis.match_level || 'N/A'}
                                        </span>
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    {candidate.llm_analysis.recommendation ? (
                                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
                                        candidate.llm_analysis.recommendation === 'Shortlist' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' :
                                          candidate.llm_analysis.recommendation === 'Reject' ? 'bg-rose-50 text-rose-700 ring-rose-200' :
                                            'bg-amber-50 text-amber-700 ring-amber-200'
                                      }`}>
                                        {candidate.llm_analysis.recommendation}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                  <div>
                                    <h5 className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2 flex items-center gap-2">
                                      <CheckCircle2 className="w-4 h-4" /> Matched skills &amp; tech
                                    </h5>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(candidate.llm_analysis.key_matches || []).map((match: string, i: number) => (
                                        <span
                                          key={i}
                                          className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800"
                                        >
                                          {match}
                                        </span>
                                      ))}
                                      {(!candidate.llm_analysis.key_matches || candidate.llm_analysis.key_matches.length === 0) && (
                                        <span className="text-sm text-slate-500">No key matches identified.</span>
                                      )}
                                    </div>
                                  </div>

                                  <div>
                                    <h5 className="text-xs font-semibold text-rose-700 uppercase tracking-wide mb-2 flex items-center gap-2">
                                      <AlertTriangle className="w-4 h-4" /> Missing skills &amp; tech
                                    </h5>
                                    <div className="flex flex-wrap gap-1.5">
                                      {(candidate.llm_analysis.gaps || []).map((gap: string, i: number) => (
                                        <span
                                          key={i}
                                          className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800"
                                        >
                                          {gap}
                                        </span>
                                      ))}
                                      {(!candidate.llm_analysis.gaps || candidate.llm_analysis.gaps.length === 0) && (
                                        <span className="text-sm text-slate-500">No major gaps identified.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {(candidate.llm_analysis.strengths || []).length > 0 && (
                                  <div className="pt-3 border-t border-slate-100">
                                    <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Key strengths</h5>
                                    <ul className="space-y-1.5">
                                      {(candidate.llm_analysis.strengths as string[]).map((t, i) => (
                                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-800">
                                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                          <span>{t}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {(candidate.llm_analysis.experience_analysis || candidate.llm_analysis.responsibility_alignment || candidate.llm_analysis.education_certifications || candidate.llm_analysis.language_fit) && (
                                  <div className="grid grid-cols-1 gap-4 pt-3 border-t border-slate-100 md:grid-cols-2">
                                    {[
                                      ['Experience', candidate.llm_analysis.experience_analysis],
                                      ['Responsibilities', candidate.llm_analysis.responsibility_alignment],
                                      ['Education and certifications', candidate.llm_analysis.education_certifications],
                                      ['Languages', candidate.llm_analysis.language_fit],
                                    ].filter(([, v]) => v).map(([label, v]) => (
                                      <div key={label as string}>
                                        <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1.5">{label}</h5>
                                        <p className="text-[13px] leading-relaxed text-slate-700">{v}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="pt-3 border-t border-slate-100">
                                  <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">Fit Summary</h5>
                                  <p className="text-sm text-slate-900 leading-relaxed">
                                    {candidate.llm_analysis.summary || 'Detailed summary unavailable.'}
                                  </p>
                                </div>

                                {(candidate.llm_analysis.red_flags || []).length > 0 && (
                                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                                    <h5 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-700">
                                      <AlertTriangle className="h-4 w-4" /> Points to check
                                    </h5>
                                    <ul className="list-disc space-y-1 pl-5 text-[13px] text-rose-900">
                                      {(candidate.llm_analysis.red_flags as string[]).map((t, i) => <li key={i}>{t}</li>)}
                                    </ul>
                                  </div>
                                )}

                              </div>
                            )}

                            {/* Position Details */}
                            <div className="rounded-2xl border border-surface-border bg-slate-50/60 p-4">
                              <h4 className="mb-3 text-[13px] font-semibold text-slate-900">Position details</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <h5 className="text-sm font-medium text-slate-700">Job Description</h5>
                                  <div className="flex items-center mt-1">
                                    <Briefcase className="w-4 h-4 text-slate-500 mr-2" />
                                    <p className="text-sm text-slate-900">{matchResult?.jd_job_title || 'N/A'}</p>
                                  </div>
                                  <div className="flex items-center mt-1">
                                    <Calendar className="w-4 h-4 text-slate-500 mr-2" />
                                    <p className="text-sm text-slate-900">{matchResult?.jd_years || 'N/A'} years required</p>
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-sm font-medium text-slate-700">Candidate</h5>
                                  <div className="flex items-center mt-1">
                                    <Briefcase className="w-4 h-4 text-slate-500 mr-2" />
                                    <p className="text-sm text-slate-900">{candidate.cv_job_title || 'N/A'}</p>
                                  </div>
                                  <div className="flex items-center mt-1">
                                    <Calendar className="w-4 h-4 text-slate-500 mr-2" />
                                    <p className="text-sm text-slate-900">{candidate.cv_years || 'N/A'} years experience</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Semantic Details (Hidden for AI analyze candidates) */}
                            {!candidate.has_llm_analysis && (
                              <>
                                {/* Skills details */}
                                {Array.isArray(candidate.skills_assignments) && candidate.skills_assignments.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Brain className="w-4 h-4 text-navy-600" />
                                      <h4 className="font-semibold text-slate-900">
                                        Matched Skills ({candidate.skills_assignments.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.skills_assignments.map((a: any, idx: number) => {
                                        const s = Number(a.score ?? 0);
                                        return (
                                          <div key={idx} className="rounded-xl border border-surface-border bg-white p-3">
                                            <div className="text-sm text-slate-900">
                                              JD Required: <span className="font-medium">{a.jd_item}</span>
                                            </div>
                                            <div className="text-sm text-slate-700">CV has: {a.cv_item}</div>
                                            <div className="flex items-center gap-2 mt-2">
                                              <div className="h-1.5 flex-1 rounded-full bg-slate-200/80">
                                                <div className={`h-1.5 rounded-full ${barColor(s)}`} style={{ width: `${s * 100}%` }} />
                                              </div>
                                              <span className={`text-xs font-medium ${scoreColor(s)}`}>{Math.round(s * 100)}%</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Unmatched Skills */}
                                {Array.isArray(candidate.unmatched_jd_skills) && candidate.unmatched_jd_skills.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Eye className="w-4 h-4 text-rose-600" />
                                      <h4 className="font-semibold text-slate-900">
                                        Unmatched Skills ({candidate.unmatched_jd_skills.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.unmatched_jd_skills.map((skill: string, idx: number) => (
                                        <div key={idx} className="p-3 rounded-lg border border-rose-200 bg-rose-50">
                                          <div className="text-sm text-rose-900">
                                            Required skill: <span className="font-medium">{skill}</span>
                                          </div>
                                          <div className="text-sm text-rose-700">No matching skill found in candidate's profile</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Responsibilities detail */}
                                {Array.isArray(candidate.responsibilities_assignments) && candidate.responsibilities_assignments.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Target className="w-4 h-4 text-emerald-600" />
                                      <h4 className="font-semibold text-slate-900">
                                        Matched Responsibilities ({candidate.responsibilities_assignments.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.responsibilities_assignments.map((a: any, idx: number) => {
                                        const s = Number(a.score ?? 0);
                                        return (
                                          <div key={idx} className="rounded-xl border border-surface-border bg-white p-3">
                                            <div className="text-sm text-slate-900">
                                              JD Required: <span className="font-medium">{a.jd_item}</span>
                                            </div>
                                            <div className="text-sm text-slate-700">CV has: {a.cv_item}</div>
                                            <div className="flex items-center gap-2 mt-2">
                                              <div className="h-1.5 flex-1 rounded-full bg-slate-200/80">
                                                <div className={`h-1.5 rounded-full ${barColor(s)}`} style={{ width: `${s * 100}%` }} />
                                              </div>
                                              <span className={`text-xs font-medium ${scoreColor(s)}`}>{Math.round(s * 100)}%</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Unmatched Responsibilities */}
                                {Array.isArray(candidate.unmatched_jd_responsibilities) && candidate.unmatched_jd_responsibilities.length > 0 && (
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Eye className="w-4 h-4 text-rose-600" />
                                      <h4 className="font-semibold text-slate-900">
                                        Unmatched Responsibilities ({candidate.unmatched_jd_responsibilities.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.unmatched_jd_responsibilities.map((resp: string, idx: number) => (
                                        <div key={idx} className="p-3 rounded-lg border border-rose-200 bg-rose-50">
                                          <div className="text-sm text-rose-900">
                                            Required responsibility: <span className="font-medium">{resp}</span>
                                          </div>
                                          <div className="text-sm text-rose-700">No matching responsibility found in candidate's profile</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Summary */}
                                <div className="rounded-2xl border border-surface-border bg-slate-50/60 p-4">
                                  <div className="grid grid-cols-2 gap-4 text-center">
                                    <div>
                                      <div className="text-lg font-semibold text-navy-600">
                                        {candidate.skills_assignments
                                          ? candidate.skills_assignments.filter((a: any) => (a.score ?? 0) >= 0.7).length
                                          : 0}
                                        /
                                        {candidate.skills_assignments ? candidate.skills_assignments.length : 0}
                                      </div>
                                      <div className="text-xs text-slate-600">Strong Skills Matches (≥70%)</div>
                                    </div>
                                    <div>
                                      <div className="text-lg font-semibold text-emerald-600">
                                        {candidate.responsibilities_assignments
                                          ? candidate.responsibilities_assignments.filter((a: any) => (a.score ?? 0) >= 0.7).length
                                          : 0}
                                        /
                                        {candidate.responsibilities_assignments
                                          ? candidate.responsibilities_assignments.length
                                          : 0}
                                      </div>
                                      <div className="text-xs text-slate-600">Strong Responsibility Matches (≥70%)</div>
                                    </div>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                );
              })}
          </div>

          {/* Show All Notice */}
          {resultsLimit !== 'all' && totalFiltered > sortedCandidates.length && (
            <button
              type="button"
              onClick={() => setResultsLimit('all')}
              className="w-full rounded-xl border border-dashed border-surface-strong py-2.5 text-[13px] font-semibold text-navy-600 transition-colors hover:border-navy-300 hover:bg-navy-50/50"
            >
              Show all {totalFiltered} candidates
            </button>
          )}

          {sortedCandidates.length === 0 && (
            <div className="py-12 text-center">
              <h3 className="text-[14px] font-semibold text-slate-800">No matches found</h3>
              <p className="mt-1 text-[13px] text-slate-500">Adjust filters to see more candidates.</p>
            </div>
          )}

      <FilePreviewModal
        isOpen={previewData.isOpen}
        onClose={() => {
          if (previewBlobUrl) {
            URL.revokeObjectURL(previewBlobUrl);
            setPreviewBlobUrl(null);
          }
          setPreviewData((prev) => ({ ...prev, isOpen: false }));
        }}
        fileUrl={previewData.url}
        fileName={previewData.name}
        fileId={previewData.id}
        extractedText={previewData.extractedText}
      />
    </div>
  );
}
