import { api } from '@/lib/api';
import type { MatchRequest, MatchResponse } from '@/lib/types';

/**
 * Runs one match to completion and reports REAL progress while it runs.
 *
 * The backend does the work in a queue and publishes one 0-100 progress number (scoring 2-88, AI verification
 * 90-98, saving 99-100) plus counts. This is the only place that reads it, for the Match page and the Careers page,
 * so both show the same truthful numbers. There is no time-based guessing: while the job waits in the queue the
 * percentage stays at 0, and once it runs the percentage only moves forward.
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runMatchJob(
  request: MatchRequest,
  onUpdate: (update: MatchUpdate) => void,
  { pollMs = 1000, timeoutMs = 6 * 60 * 60 * 1000 }: MatchRunOptions = {},
): Promise<MatchResponse> {
  let high = 0;
  let runStartedAt: number | null = null;
  let totalCVs = request.cv_ids?.length ?? 0;

  const emit = (r: MatchResponse) => {
    const p = r.progress ?? undefined;
    const waiting = r.status === 'queued' || (!p?.processed_candidates && !p?.progress_percent && (r.queue_position ?? 0) > 0);
    if (p?.total_candidates) totalCVs = p.total_candidates;

    const serverPercent = waiting ? 0 : Math.min(100, p?.progress_percent ?? 0);
    high = Math.max(high, serverPercent);
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
      phase: waiting || !p ? 'initializing' : PHASES[p.phase ?? 'scoring'] ?? 'batches',
      currentBatch: p?.current_chunk ?? 0,
      totalBatches: p?.total_chunks ?? 0,
      currentCandidate: p?.current_candidate ?? null,
      recent: p?.recent ?? [],
      llmDone: p?.llm_done ?? 0,
      llmTotal: p?.llm_total ?? 0,
      etaSeconds: eta,
    });
  };

  const first = await api.matchCandidates(request);
  if (!first.is_queued) return first;
  emit(first);

  const jobId = first.job_id;
  const deadline = Date.now() + timeoutMs;
  let transientFailures = 0;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let r: MatchResponse;
    try {
      // The job endpoint only reads the job; it can never start a second one.
      r = jobId ? await api.getMatchJob(jobId) : await api.matchCandidates(request);
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
