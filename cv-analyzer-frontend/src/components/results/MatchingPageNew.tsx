'use client';
import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Target,
  Brain,
  TrendingUp,
  Users,
  Award,
  BarChart3,
  Eye,
  Download,
  Star,
  Filter,
  Briefcase,
  Calendar,
  FileDown,
  MessageSquare,
  Pencil,
  Save,
  X,
  Sparkles,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileCheck
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import MatchingFullPageAnimation from '@/components/results/MatchingFullPageAnimation';
const FilePreviewModal = dynamic(() => import('@/components/ui/file-preview-modal').then(mod => mod.FilePreviewModal), {
  ssr: false,
});
import { getApiBaseUrl } from '@/lib/config';
import { useCareersStore } from '@/stores/careersStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import ContactActions from '@/components/common/ContactActions';
import { PageHeader, EmptyState } from '@/components/ui/page';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';
import { MatchWeights } from '@/lib/types';
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

function normalizeWeights(w: MatchWeights) {
  const keys = ['skills', 'responsibilities', 'job_title', 'experience'] as const;
  const sum = keys.reduce((s, k) => s + (w?.[k] ?? 0), 0);
  if (!sum || sum <= 0) return { ...DEFAULT_WEIGHTS };
  const norm = Object.fromEntries(keys.map((k) => [k, (w?.[k] ?? 0) / sum])) as typeof DEFAULT_WEIGHTS;
  return norm;
}

// Semantic color by score (0-1): >=80 green, >=60 amber, else red.
function scoreTone(score: number) {
  const pct = score * 100;
  if (pct >= 80) return { text: 'text-green-600', stroke: '#16a34a', badge: 'success' as const, label: 'Excellent' };
  if (pct >= 60) return { text: 'text-amber-500', stroke: '#f59e0b', badge: 'warning' as const, label: 'Good' };
  return { text: 'text-red-500', stroke: '#ef4444', badge: 'danger' as const, label: 'Needs review' };
}

function scoreColor(score: number) {
  return scoreTone(score).text;
}

function barColor(score: number) {
  const pct = score * 100;
  if (pct >= 80) return 'bg-green-600';
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
  if (pct >= 80) return { bg: 'bg-green-50', text: 'text-green-700', label: 'Excellent' };
  if (pct >= 60) return { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Good' };
  return { bg: 'bg-red-50', text: 'text-red-700', label: 'Needs review' };
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Small SVG score ring with semantic color. */
function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox="0 0 36 36" width={size} height={size}>
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke="#f3f4f6" strokeWidth="3"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke={tone.stroke} strokeWidth="3"
          strokeDasharray={`${pct}, 100`} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('text-[13px] font-semibold', tone.text)}>{pct}%</span>
      </div>
    </div>
  );
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
export default function MatchingPageNew() {
  const {
    matchResult,
    matchWeights,
    setMatchWeights,
    cvs, // used to resolve names and meta
    jds,
    loadJDs,
    selectedJD,
    selectedCVs,
    runMatch,
    loadingStates,
    matchingQueue,
    setMatchingQueue,
    matchingProgress,
  } = useAppStore();

  const { applications } = useCareersStore();
  const { user } = useAuthStore();

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
  const [filterThreshold, setFilterThreshold] = useState(0);
  const [downloadingCV, setDownloadingCV] = useState<string | null>(null);
  const [resultsLimit, setResultsLimit] = useState<number | 'all'>(3); // Default to top 3
  const [isExporting, setIsExporting] = useState(false);

  // --- Match launcher (JD + category + count) -------------------------------
  const MATCH_COUNT_OPTIONS = [50, 100, 150, 200, 250, 300];
  const [launchJdId, setLaunchJdId] = useState<string>('');
  const [launchCategory, setLaunchCategory] = useState<string>('all');
  const [launchCount, setLaunchCount] = useState<number>(50);
  const [jobSearch, setJobSearch] = useState<string>('');
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

  // Keep the JD dropdown selection valid as JDs load.
  useEffect(() => {
    if (!launchJdId && selectedJD) {
      setLaunchJdId(selectedJD);
    }
  }, [selectedJD, launchJdId]);

  const filteredJobOptions = useMemo(() => {
    const list = jds || [];
    const q = jobSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((j: any) =>
      String(j.job_title || '').toLowerCase().includes(q) ||
      String(j.filename || '').toLowerCase().includes(q) ||
      String(j.id || '').toLowerCase().includes(q)
    );
  }, [jds, jobSearch]);

  const handleLaunchMatch = async () => {
    setLaunchError(null);
    if (!launchJdId) {
      setLaunchError('Please select a job description.');
      return;
    }
    setLaunching(true);
    try {
      const category = launchCategory === 'all' ? undefined : launchCategory;
      const res = await api.listCVs({ category, limit: launchCount });
      const ids: string[] = (res.cvs || [])
        .map((c: any) => c.id || c.document_id || c.cv_id)
        .filter(Boolean);
      if (ids.length === 0) {
        setLaunchError('No CVs found for the selected category.');
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

  const matchLauncher = (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-brand-600" />
        <h3 className="text-[14px] font-semibold text-gray-900">Run a match</h3>
      </div>

      {/* Jobs search */}
      <div className="relative mb-3 max-w-md">
        <input
          type="text"
          placeholder="Search jobs…"
          value={jobSearch}
          onChange={(e) => setJobSearch(e.target.value)}
          className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* JD dropdown */}
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Job description</label>
          <select
            value={launchJdId}
            onChange={(e) => setLaunchJdId(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="">Select a job description…</option>
            {filteredJobOptions.map((j: any) => (
              <option key={j.id} value={j.id}>
                {(j.job_title && j.job_title !== 'Not specified' ? j.job_title : j.filename) || j.id}
              </option>
            ))}
          </select>
        </div>

        {/* Category dropdown */}
        <div className="flex min-w-[180px] flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Category</label>
          <select
            value={launchCategory}
            onChange={(e) => setLaunchCategory(e.target.value)}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            <option value="all">All CVs</option>
            {Object.entries(launchCategories)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, count]) => (
                <option key={cat} value={cat}>{cat} ({count})</option>
              ))}
          </select>
        </div>

        {/* Count dropdown */}
        <div className="flex min-w-[150px] flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400"># of CVs</label>
          <select
            value={launchCount}
            onChange={(e) => setLaunchCount(Number(e.target.value))}
            className="h-9 rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          >
            {MATCH_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <Button variant="primary" icon={<Target />} loading={launching} onClick={handleLaunchMatch}>
          Match
        </Button>
      </div>

      <p className="mt-2 text-[12px] text-gray-500">
        Matches the selected job description against the most recent {launchCount} CVs
        {launchCategory === 'all' ? ' across all categories' : ` in “${launchCategory}”`}.
      </p>
      {launchError && <p className="mt-2 text-[12px] text-red-600">{launchError}</p>}
    </div>
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


  const normWeights = useMemo(() => normalizeWeights(matchWeights ?? DEFAULT_WEIGHTS), [matchWeights]);

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
  const excellentMatches = candidatesWithComputed.filter((c) => c.computed_overall >= 0.8).length;
  const goodMatches = candidatesWithComputed.filter((c) => c.computed_overall >= 0.6 && c.computed_overall < 0.8).length;
  const averageScore =
    totalMatches > 0
      ? Math.round(
        (candidatesWithComputed.reduce((s, c) => s + (c.computed_overall ?? 0), 0) / totalMatches) * 100
      )
      : 0;
  const topScore =
    totalMatches > 0
      ? Math.round(Math.max(...candidatesWithComputed.map((c) => c.computed_overall ?? 0)) * 100)
      : 0;

  // Visible analytics for current view
  const visibleMatches = sortedCandidates.length;
  const visibleExcellent = sortedCandidates.filter((c) => c.computed_overall >= 0.8).length;
  const visibleGood = sortedCandidates.filter((c) => c.computed_overall >= 0.6 && c.computed_overall < 0.8).length;
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

  // While a match is running (queued, scoring, AI verification, or finalizing) this
  // page shows the full immersive animation. It's driven entirely by the global
  // store, so switching tabs and coming back here just re-reads the same live
  // state — the match itself keeps running in the background regardless.
  const isMatchingActive =
    matchingProgress.isVisible ||
    loadingStates.matching.isLoading ||
    loadingStates.careersMatching.isLoading ||
    !!matchingQueue?.isQueued;

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
                onClick={() => useAppStore.getState().setCurrentTab?.('database')}
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
          hint="Pick a job description, a category and how many CVs to match above, then press Match. You can also select CVs from the Database."
          action={
            <Button
              variant="secondary"
              onClick={() => useAppStore.getState().setCurrentTab?.('database')}
            >
              Go to database
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 bg-white min-h-full p-1">
      {matchLauncher}

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Match Results</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-0.5">
            {totalMatches} candidate{totalMatches !== 1 ? 's' : ''} evaluated. Sort, filter, and export.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportResults}
            disabled={isExporting}
            className="border-gray-300 text-gray-700"
          >
            {isExporting ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin mr-2" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-gray-300 text-gray-700"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Generate report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label={resultsLimit !== 'all' ? `Top ${resultsLimit} candidates` : 'Total candidates'}
          value={
            <>
              {visibleMatches}
              {resultsLimit !== 'all' && totalMatches > visibleMatches && (
                <span className="ml-1 text-sm text-gray-500">/{totalMatches}</span>
              )}
            </>
          }
          icon={Users}
        />
        <StatCard label="Best match" value={`${visibleTop}%`} icon={Award} />
        <StatCard label="Average score" value={`${visibleAverage}%`} icon={BarChart3} />
        <StatCard label="Excellent (≥80%)" value={visibleExcellent} icon={Star} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6">
        <div className="mb-4 flex items-center gap-3 sm:mb-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-50">
            <TrendingUp className="h-4 w-4 text-brand-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-gray-900">Quality distribution</h3>
            <p className="text-[13px] text-gray-500">Breakdown by overall match</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <div className="text-center">
            <div className="w-full bg-emerald-100 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-emerald-500 transition-[width] duration-300"
                style={{ width: `${(excellentMatches / Math.max(totalMatches, 1)) * 100}%` }}
              />
            </div>
            <div className="font-medium text-emerald-700">{excellentMatches} Excellent</div>
            <p className="text-sm text-gray-500">80–100% match</p>
          </div>
          <div className="text-center">
            <div className="w-full bg-amber-100 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-amber-500 transition-[width] duration-300"
                style={{ width: `${(goodMatches / Math.max(totalMatches, 1)) * 100}%` }}
              />
            </div>
            <div className="font-medium text-amber-700">{goodMatches} Good</div>
            <p className="text-sm text-gray-500">60–79% match</p>
          </div>
          <div className="text-center">
            <div className="w-full bg-rose-100 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-rose-500 transition-[width] duration-300"
                style={{ width: `${((totalMatches - excellentMatches - goodMatches) / Math.max(totalMatches, 1)) * 100}%` }}
              />
            </div>
            <div className="font-medium text-rose-700">
              {totalMatches - excellentMatches - goodMatches} Needs Review
            </div>
            <p className="text-sm text-gray-500">&lt;60% match</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-between">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[neutral-900] focus:border-[neutral-900]"
          >
            <option value="score">Sort by Overall Score</option>
            <option value="skills">Sort by Skills Match</option>
            <option value="experience">Sort by Experience Years</option>
          </select>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={resultsLimit}
              onChange={(e) => setResultsLimit(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[neutral-900] focus:border-[neutral-900]"
            >
              <option value={3}>Show Top 3</option>
              <option value={5}>Show Top 5</option>
              <option value="all">Show All</option>
            </select>
          </div>
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Info className="w-4 h-4 text-gray-400" />
            Tip: start with Top 3 and raise threshold for faster review.
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center bg-emerald-50 shrink-0">
              <Target className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-semibold text-gray-900">Ranked Candidates</h3>
              <p className="text-sm text-gray-600">
                {sortedCandidates.length} shown{resultsLimit !== 'all' ? ` (top ${resultsLimit})` : ''} of {totalFiltered} total.
                Sorted by {sortBy === 'score' ? 'overall match' : sortBy}.
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {sortedCandidates.map((candidate, index) => {
              const overall = candidate.computed_overall ?? 0;
              const badge = scoreBadge(overall);
              const isOpen = expandedMatch === candidate.cv_id;
              const displayName = resolveCandidateName(candidate, cvIndex);
              const title = resolveTitle(candidate, cvIndex);
              const yearsText = resolveYears(candidate, cvIndex);
              const expectedSalary = resolveExpectedSalary(candidate, applications ?? []);
              const cvMeta = cvIndex[candidate?.cv_id];
              const filename = cvMeta?.filename || `cv_${candidate.cv_id}.pdf`;

              return (
                <div
                  key={candidate.cv_id}
                  className={`relative overflow-hidden rounded-xl border bg-white ${isOpen ? 'ring-2 ring-[neutral-900]/30 border-[neutral-900]' : 'border-gray-200'}`}
                >
                    {/* OUTER WRAPPER FIXED: now a <div> with role="button" */}
                    <div
                      onClick={() =>
                        setExpandedMatch((prev) => (prev === candidate.cv_id ? null : candidate.cv_id))
                      }
                      role="button"
                      tabIndex={0}
                      className="w-full text-left p-5 hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      {/* Header row */}
                      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                          <div
                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold text-white shrink-0 ${index === 0 ? 'bg-emerald-500' : metricBarColor(overall)}`}
                          >
                            #{index + 1}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-semibold text-gray-900">{displayName}</h4>
                              {(notesSummary[candidate.cv_id]?.notes_count || (candidateNotes[candidate.cv_id]?.length || 0)) > 0 && (
                                <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                                  <MessageSquare className="w-3 h-3" />
                                  <span>{notesSummary[candidate.cv_id]?.notes_count ?? (candidateNotes[candidate.cv_id]?.length || 0)}</span>
                                </div>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">
                              {title} • {yearsText}
                              {expectedSalary != null && (
                                <span className="text-gray-700 font-medium"> • Expected: AED {expectedSalary.toLocaleString()}</span>
                              )}
                            </p>
                            {(candidate.cv_email || candidate.cv_phone) && (
                              <ContactActions
                                email={candidate.cv_email}
                                phone={candidate.cv_phone}
                                className="mt-1.5"
                              />
                            )}
                          </div>
                        </div>
                        {/* AI Badge and Score Info */}
                        <div className="flex items-center gap-4">
                          {candidate.has_llm_analysis && (
                            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm">
                              <Sparkles className="w-3 h-3" />
                              <span>AI Verified</span>
                            </div>
                          )}
                          {/* Overall Score */}
                          <div className="flex items-center gap-4">
                            <div className="text-center">
                              <div className="relative w-16 h-16 mx-auto mb-1">
                                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                                  <path
                                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeDasharray={`${overall * 100}, 100`}
                                    className={barColor(overall)}
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    className="text-gray-200"
                                    opacity="0.3"
                                  />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {Math.round(overall * 100)}%
                                  </span>
                                </div>
                              </div>
                              {candidate.has_llm_analysis && candidate.llm_analysis?.match_level ? (
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${candidate.llm_analysis.match_level === 'Strong' ? 'bg-emerald-100 text-emerald-700' :
                                    candidate.llm_analysis.match_level === 'Good' ? 'bg-blue-100 text-blue-700' :
                                      candidate.llm_analysis.match_level === 'Average' ? 'bg-amber-100 text-amber-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}
                                >
                                  {candidate.llm_analysis.match_level}
                                </span>
                              ) : (
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                                >
                                  {badge.label}
                                </span>
                              )}
                            </div>
                            <span className="text-sm text-[neutral-900] hover:text-[neutral-800]">
                              {isOpen ? 'Hide details' : 'View details'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Quick breakdown */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
                        {(() => {
                          const b = getDisplayedBreakdown(candidate);
                          const scores = b.scores;
                          return (
                            <>
                              <div className="col-span-2 md:col-span-4 -mt-1 mb-0.5">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide uppercase bg-gray-100 text-gray-700">
                                  Breakdown: {b.sourceLabel}
                                </span>
                                {candidate?.has_llm_analysis && typeof candidate?.semantic_score === 'number' && (
                                  <span className="ml-2 text-[11px] text-gray-500">
                                    Overall: {Math.round((candidate?.computed_overall ?? candidate?.overall_score ?? 0) * 100)}% • Similarity: {Math.round((candidate.semantic_score ?? 0) * 100)}%
                                  </span>
                                )}
                              </div>
                              {/* Skills */}
                              <div className="p-3 rounded-lg border border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-gray-600">Skills</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.skills)}`}>
                                    {Math.round(scores.skills * 100)}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-2 rounded-full transition-[width] duration-300 ${metricBarColor(scores.skills)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.skills * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Responsibilities */}
                              <div className="p-3 rounded-lg border border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-gray-600">Responsibilities</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.responsibilities)}`}>
                                    {Math.round(scores.responsibilities * 100)}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-2 rounded-full transition-[width] duration-300 ${metricBarColor(scores.responsibilities)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.responsibilities * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Title */}
                              <div className="p-3 rounded-lg border border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-gray-600">Title</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.title)}`}>
                                    {Math.round(scores.title * 100)}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-2 rounded-full transition-[width] duration-300 ${metricBarColor(scores.title)}`}
                                    style={{ width: `${Math.max(0, Math.min(100, scores.title * 100))}%` }}
                                  />
                                </div>
                              </div>

                              {/* Years */}
                              <div className="p-3 rounded-lg border border-gray-200 bg-white">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-medium text-gray-600">Years</span>
                                  <span className={`text-xs font-semibold ${metricTextColor(scores.years)}`}>
                                    {Math.round(scores.years * 100)}%
                                  </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                  <div
                                    className={`h-2 rounded-full transition-[width] duration-300 ${metricBarColor(scores.years)}`}
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
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[neutral-900] resize-none"
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
                                <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
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
                            className="flex items-center gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
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
                        </div>
                      </div>
                    </div>



                    {isOpen && (
                        <div className="px-5 pb-5">
                          <div className="mt-2 space-y-6">
                            {/* AI Analysis Section (Redesigned) */}
                            {candidate.has_llm_analysis && candidate.llm_analysis && (
                              <div className="p-4 sm:p-5 rounded-xl bg-white border border-gray-200 shadow-sm space-y-4">
                                <div className="flex items-start justify-between gap-4 pb-3 border-b border-gray-100">
                                  <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${candidate.llm_analysis.match_level === 'Strong' ? 'bg-emerald-100 text-emerald-600' :
                                      candidate.llm_analysis.match_level === 'Good' ? 'bg-blue-100 text-blue-600' :
                                        'bg-amber-100 text-amber-600'
                                      }`}>
                                      <Sparkles className="w-5 h-5" />
                                    </div>
                                    <div>
                                      <h4 className="text-base font-semibold text-gray-900 leading-tight">AI Match Analysis</h4>
                                      <p className="text-xs font-medium text-gray-500 mt-0.5">
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
                                  <div className="text-right">
                                    <p className="text-xl font-bold text-gray-900 leading-none">{Math.round(overall * 100)}</p>
                                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mt-1">Score</p>
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
                                        <span className="text-sm text-gray-500">No key matches identified.</span>
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
                                        <span className="text-sm text-gray-500">No major gaps identified.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="pt-3 border-t border-gray-100">
                                  <h5 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Fit Summary</h5>
                                  <p className="text-sm text-gray-900 leading-relaxed">
                                    {candidate.llm_analysis.summary || 'Detailed summary unavailable.'}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Position Details */}
                            <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                              <h4 className="font-semibold text-gray-900 mb-3">Position Details</h4>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <h5 className="text-sm font-medium text-gray-700">Job Description</h5>
                                  <div className="flex items-center mt-1">
                                    <Briefcase className="w-4 h-4 text-gray-500 mr-2" />
                                    <p className="text-sm text-gray-900">{matchResult?.jd_job_title || 'N/A'}</p>
                                  </div>
                                  <div className="flex items-center mt-1">
                                    <Calendar className="w-4 h-4 text-gray-500 mr-2" />
                                    <p className="text-sm text-gray-900">{matchResult?.jd_years || 'N/A'} years required</p>
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-sm font-medium text-gray-700">Candidate</h5>
                                  <div className="flex items-center mt-1">
                                    <Briefcase className="w-4 h-4 text-gray-500 mr-2" />
                                    <p className="text-sm text-gray-900">{candidate.cv_job_title || 'N/A'}</p>
                                  </div>
                                  <div className="flex items-center mt-1">
                                    <Calendar className="w-4 h-4 text-gray-500 mr-2" />
                                    <p className="text-sm text-gray-900">{candidate.cv_years || 'N/A'} years experience</p>
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
                                      <Brain className="w-4 h-4 text-[neutral-900]" />
                                      <h4 className="font-semibold text-gray-900">
                                        Matched Skills ({candidate.skills_assignments.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.skills_assignments.map((a: any, idx: number) => {
                                        const s = Number(a.score ?? 0);
                                        return (
                                          <div key={idx} className="p-3 rounded-lg border border-gray-200 bg-white">
                                            <div className="text-sm text-gray-900">
                                              JD Required: <span className="font-medium">{a.jd_item}</span>
                                            </div>
                                            <div className="text-sm text-gray-700">CV has: {a.cv_item}</div>
                                            <div className="flex items-center gap-2 mt-2">
                                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                <div className={`h-2 rounded-full ${barColor(s)}`} style={{ width: `${s * 100}%` }} />
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
                                      <h4 className="font-semibold text-gray-900">
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
                                      <h4 className="font-semibold text-gray-900">
                                        Matched Responsibilities ({candidate.responsibilities_assignments.length})
                                      </h4>
                                    </div>
                                    <div className="grid gap-3 max-h-80 overflow-y-auto">
                                      {candidate.responsibilities_assignments.map((a: any, idx: number) => {
                                        const s = Number(a.score ?? 0);
                                        return (
                                          <div key={idx} className="p-3 rounded-lg border border-gray-200 bg-white">
                                            <div className="text-sm text-gray-900">
                                              JD Required: <span className="font-medium">{a.jd_item}</span>
                                            </div>
                                            <div className="text-sm text-gray-700">CV has: {a.cv_item}</div>
                                            <div className="flex items-center gap-2 mt-2">
                                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                                <div className={`h-2 rounded-full ${barColor(s)}`} style={{ width: `${s * 100}%` }} />
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
                                      <h4 className="font-semibold text-gray-900">
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
                                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                                  <div className="grid grid-cols-2 gap-4 text-center">
                                    <div>
                                      <div className="text-lg font-semibold text-[neutral-900]">
                                        {candidate.skills_assignments
                                          ? candidate.skills_assignments.filter((a: any) => (a.score ?? 0) >= 0.7).length
                                          : 0}
                                        /
                                        {candidate.skills_assignments ? candidate.skills_assignments.length : 0}
                                      </div>
                                      <div className="text-xs text-gray-600">Strong Skills Matches (≥70%)</div>
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
                                      <div className="text-xs text-gray-600">Strong Responsibility Matches (≥70%)</div>
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
          {resultsLimit !== 'all' &&
            totalFiltered > sortedCandidates.length && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" />
                    <div>
                      <p className="text-sm font-medium text-blue-900">
                        Showing top {resultsLimit} of {totalFiltered} candidates
                      </p>
                      <p className="text-sm text-blue-700">
                        {totalFiltered - sortedCandidates.length} more candidates available
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setResultsLimit('all')}
                    className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Show All
                  </button>
                </div>
              </div>
            )}

          {sortedCandidates.length === 0 && (
            <div className="text-center py-12">
              <Filter className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <h3 className="text-base font-semibold text-gray-800 mb-1">No matches found</h3>
              <p className="text-sm text-gray-500">Adjust your filters to view more candidates.</p>
            </div>
          )}
        </div>
      </div>

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
        fileType={previewData.type === 'cv' ? 'application/pdf' : 'application/pdf'}
        extractedText={previewData.extractedText}
      />
    </div>
  );
}
