import { api } from '@/lib/api';
import type { MatchRequest, MatchResponse } from '@/lib/types';

/**
 * Runs one match to completion and reports progress while it runs.
 *
 * The backend does the work in a queue and publishes a 0-100 number (scoring 2-88, AI verification 90-98, saving
 * 99-100) plus counts. This is the only place that reads it, for the Match page and the Careers page. While the job
 * waits in the queue the percentage stays at 0; once it runs, it is laid out on a time scale (see below) and only
 * ever moves forward.
 */

export type MatchPhase = 'initializing' | 'batches' | 'llm_verification' | 'finalizing';

export interface MatchUpdate {
  /** Waiting in the queue for a free runner (no work has started). */
  waiting: boolean;
  queuePosition: number | null;
  estimatedWaitTime: number | null;
  message: string | null;
  /** 0-100, never decreases within a run. */
  percent: number;
  totalCVs: number;
  processedCVs: number;
  phase: MatchPhase;
  currentBatch: number;
  totalBatches: number;
  currentCandidate: string | null;
  recent: { cv_id: string; cv_name: string }[];
  llmDone: number;
  llmTotal: number;
  /** Seconds left, from the measured rate of this run (null until there is enough to measure). */
  etaSeconds: number | null;
}

export interface MatchRunOptions {
  pollMs?: number;
  timeoutMs?: number;
}

const PHASES: Record<string, MatchPhase> = {
  scoring: 'batches',
  llm_verification: 'llm_verification',
  llm_enhancement: 'llm_verification',
  finalizing: 'finalizing',
};

/** The most CVs one match may score (the backend refuses more: MATCH_MAX_CVS). */
export const MATCH_MAX_CVS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The figure shown to the user. The backend's own number (2-88 scoring, 90-98 AI review) is honest about WORK DONE but
 * not about TIME: scoring 20 CVs takes a second, the AI review of the top 30 takes up to ~20 seconds in a few big steps, so
 * the raw number rushes to 90 and then sits there. This lays the run out on a time scale instead:
 *   - scoring takes the share of the bar its expected time deserves (tiny for a handful of CVs, most of it for 15,000),
 *   - the AI review then fills the rest gradually, the way its time is really spent, and every batch that comes back
 *     lifts it to at least its real share,
 *   - it never reaches 100 by itself: the caller finishes the bar when the results are in (see finishMatchProgress).
 */
const SCORING_CVS_PER_SECOND = 35;     // measured: ~15,000 CVs in ~6.5 minutes
const AI_REVIEW_SECONDS = 20;          // the top 30 in batches of 10, three requests at a time (an upper estimate)
const AI_REVIEW_CEILING = 96;          // the AI phase never shows more than this until it is really done

function scoringShare(totalCVs: number): number {
  const scoring = Math.max(1, totalCVs) / SCORING_CVS_PER_SECOND;
  return Math.min(90, Math.max(6, (100 * scoring) / (scoring + AI_REVIEW_SECONDS)));
}

/** Let the bar finish (glide to 100) and stay there a moment before the results replace it. */
export async function finishMatchProgress(set: (p: Record<string, unknown>) => void, holdMs = 900): Promise<void> {
  set({ percent: 100, phase: 'finalizing', currentStage: 'finalizing', estimatedTimeRemaining: undefined });
  await sleep(holdMs);
}

// ---- A running match is remembered, so a refresh or a closed tab does not lose it ----------------------------------------
// The match itself runs on the server and survives anything the browser does; only this page's wait for it was lost.
const ACTIVE_KEY = 'alpha.activeMatch.v1';
const ACTIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface ActiveMatch {
  jobId: string;
  startedAt: number;
  totalCVs: number;
  /** Who started it: another account on the same browser must not pick it up. */
  owner?: string;
}

function readActive(): ActiveMatch | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ACTIVE_KEY) : null;
    return raw ? (JSON.parse(raw) as ActiveMatch) : null;
  } catch {
    return null;                                     // storage unavailable or damaged: nothing to resume
  }
}

/** The match this browser was waiting for, if it is recent enough to still be worth asking the server about. */
export function loadActiveMatch(owner?: string): ActiveMatch | null {
  const active = readActive();
  if (!active?.jobId || Date.now() - (active.startedAt || 0) > ACTIVE_MAX_AGE_MS) {
    clearActiveMatch();
    return null;
  }
  if (owner && active.owner && active.owner !== owner) return null;
  return active;
}

export function saveActiveMatch(active: ActiveMatch): void {
  try {
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(active));
  } catch {
    /* storage unavailable: the match still runs, it just cannot be resumed */
  }
}

/** Forget the remembered match. With a job id, only if it is that one (a newer match must not be forgotten by an older one). */
export function clearActiveMatch(jobId?: string): void {
  try {
    if (jobId && readActive()?.jobId !== jobId) return;
    window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

export interface RunMatchOptions extends MatchRunOptions {
  /** Remember this match so it can be resumed after a reload (the Match page does; background callers need not). */
  remember?: boolean;
  owner?: string;
}

/** Follows one queued job to the end, reporting progress. ``first`` is the response that created it (null when resuming). */
async function followJob(
  jobId: string | undefined,
  request: MatchRequest | undefined,
  startTotal: number,
  first: MatchResponse | null,
  onUpdate: (update: MatchUpdate) => void,
  { pollMs = 1000, timeoutMs = 6 * 60 * 60 * 1000 }: MatchRunOptions,
): Promise<MatchResponse> {
  let high = 0;
  let runStartedAt: number | null = null;
  let aiStartedAt: number | null = null;
  let totalCVs = startTotal;

  const emit = (r: MatchResponse) => {
    const p = r.progress ?? undefined;
    const waiting = r.status === 'queued' || (!p?.processed_candidates && !p?.progress_percent && (r.queue_position ?? 0) > 0);
    if (p?.total_candidates) totalCVs = p.total_candidates;

    const phase: MatchPhase = waiting || !p ? 'initializing' : PHASES[p.phase ?? 'scoring'] ?? 'batches';
    const serverPercent = waiting ? 0 : Math.min(100, p?.progress_percent ?? 0);
    const share = scoringShare(totalCVs);
    let shown = 0;
    if (!waiting && phase === 'batches') {
      shown = (share * Math.min(88, serverPercent)) / 88;                       // scoring: its own share of the bar
    } else if (!waiting && phase === 'llm_verification') {
      if (aiStartedAt === null) aiStartedAt = Date.now();
      const seconds = (Date.now() - aiStartedAt) / 1000;
      // Steady climb to 90% of the AI share over the usual time, then a slow crawl toward 97% if it takes longer.
      const byTime = seconds <= AI_REVIEW_SECONDS
        ? (0.9 * seconds) / AI_REVIEW_SECONDS
        : 0.9 + 0.07 * (1 - Math.exp(-(seconds - AI_REVIEW_SECONDS) / AI_REVIEW_SECONDS));
      const byWork = p?.llm_total ? Math.min(1, (p.llm_done ?? 0) / p.llm_total) : 0;
      shown = share + (AI_REVIEW_CEILING - share) * Math.min(0.97, Math.max(byTime, byWork));
    } else if (!waiting && phase === 'finalizing') {
      shown = 98;
    }
    high = Math.max(high, Math.min(99, shown));
    if (!waiting && runStartedAt === null) runStartedAt = Date.now();

    let eta: number | null = null;
    if (runStartedAt !== null && high >= 5 && high < 99) {
      const elapsed = (Date.now() - runStartedAt) / 1000;
      eta = Math.max(0, Math.round((elapsed * (100 - high)) / high));
    }

    onUpdate({
      waiting,
      queuePosition: r.queue_position ?? null,
      estimatedWaitTime: r.estimated_wait_time ?? null,
      message: r.message ?? null,
      percent: high,
      totalCVs,
      processedCVs: Math.min(totalCVs || Infinity, p?.processed_candidates ?? 0),
      phase,
      currentBatch: p?.current_chunk ?? 0,
      totalBatches: p?.total_chunks ?? 0,
      currentCandidate: p?.current_candidate ?? null,
      recent: p?.recent ?? [],
      llmDone: p?.llm_done ?? 0,
      llmTotal: p?.llm_total ?? 0,
      etaSeconds: eta,
    });
  };

  if (first) emit(first);
  const deadline = Date.now() + timeoutMs;
  let transientFailures = 0;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let r: MatchResponse;
    try {
      // The job endpoint only reads the job; it can never start a second one.
      r = jobId ? await api.getMatchJob(jobId) : await api.matchCandidates(request as MatchRequest);
      transientFailures = 0;
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.detail || error?.response?.data?.detail;
      if ((status && status >= 500 && detail) || status === 404) throw error;   // the job failed or expired
      if (++transientFailures >= 8) throw error;                                // network down for ~8 polls
      continue;
    }

    if (r.status === 'failed') throw new Error(r.message || 'Matching failed');
    if (!r.is_queued) return r;
    emit(r);
  }
  throw new Error('Matching is taking longer than expected. Please try again.');
}

export async function runMatchJob(
  request: MatchRequest,
  onUpdate: (update: MatchUpdate) => void,
  { remember = false, owner, ...poll }: RunMatchOptions = {},
): Promise<MatchResponse> {
  const first = await api.matchCandidates(request);
  if (!first.is_queued) return first;
  const jobId = first.job_id ?? undefined;
  const totalCVs = request.cv_ids?.length ?? 0;
  if (remember && jobId) saveActiveMatch({ jobId, startedAt: Date.now(), totalCVs, owner });
  try {
    return await followJob(jobId, request, totalCVs, first, onUpdate, poll);
  } finally {
    if (remember && jobId) clearActiveMatch(jobId);             // finished, failed or abandoned: nothing left to resume
  }
}

/** Picks a remembered match up again after a reload: only asks the server about the job, never starts a new one. */
export async function resumeMatchJob(
  active: ActiveMatch,
  onUpdate: (update: MatchUpdate) => void,
  poll: MatchRunOptions = {},
): Promise<MatchResponse> {
  try {
    return await followJob(active.jobId, undefined, active.totalCVs, null, onUpdate, poll);
  } finally {
    clearActiveMatch(active.jobId);
  }
}

/** Backend progress -> the fields the progress UI keeps in the store. The percentage is the backend's own. */
export function toMatchingProgress(u: MatchUpdate) {
  return {
    percent: u.percent,
    totalCVs: u.totalCVs,
    processedCVs: u.processedCVs,
    phase: u.phase,
    currentStage: (u.phase === 'llm_verification' ? 'analyzing' : u.phase === 'finalizing' ? 'finalizing' : u.phase === 'batches' ? 'scoring' : 'initializing') as
      | 'initializing' | 'analyzing' | 'finalizing' | 'scoring',
    currentBatch: u.currentBatch,
    totalBatches: u.totalBatches,
    currentCandidate: u.currentCandidate,
    recentCandidates: u.recent,
    llmDone: u.llmDone,
    llmTotal: u.llmTotal,
    estimatedTimeRemaining: u.etaSeconds ?? undefined,
  };
}
