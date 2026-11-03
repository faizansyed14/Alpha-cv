import { beforeEach, describe, expect, it, vi } from 'vitest';

const matchCandidates = vi.fn();
const getMatchJob = vi.fn();
vi.mock('@/lib/api', () => ({ api: { matchCandidates: (r: unknown) => matchCandidates(r), getMatchJob: (id: string) => getMatchJob(id) } }));

import { runMatchJob, type MatchUpdate } from './matchRun';

const queued = (extra = {}) => ({ is_queued: true, job_id: 'job-1', status: 'queued', queue_position: 2, progress: { progress_percent: 0 }, ...extra });
const running = (percent: number, extra = {}) => ({
  is_queued: true, job_id: 'job-1', status: 'processing',
  progress: { phase: 'scoring', progress_percent: percent, total_candidates: 1000, processed_candidates: Math.round(percent * 10), ...extra },
});
const done = { is_queued: false, candidates: [{ cv_id: 'a' }] };

beforeEach(() => {
  matchCandidates.mockReset();
  getMatchJob.mockReset();
});

describe('runMatchJob', () => {
  it('shows 0% while waiting in the queue and reports the position', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValueOnce(queued({ queue_position: 1 })).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    await runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 1 });
    expect(seen.every((u) => u.waiting && u.percent === 0)).toBe(true);
    expect(seen.map((u) => u.queuePosition)).toEqual([2, 1]);
  });

  it('reports the backend percentage and counts, and never goes backwards', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob
      .mockResolvedValueOnce(running(10))
      .mockResolvedValueOnce(running(40))
      .mockResolvedValueOnce(running(35))   // a stale / out-of-order read
      .mockResolvedValueOnce(running(70))
      .mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    const result = await runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 1 });
    const percents = seen.map((u) => u.percent);
    expect(percents).toEqual([0, 10, 40, 40, 70]);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(seen[1]).toMatchObject({ totalCVs: 1000, processedCVs: 100, phase: 'batches', waiting: false });
    expect(result).toBe(done);
  });

  it('takes the total from the server even when no CVs were selected (match all)', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValueOnce(running(20)).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    await runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 1 });
    expect(seen[1].totalCVs).toBe(1000);
  });

  it('reports AI verification as its own phase with real batch counts', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob
      .mockResolvedValueOnce(running(92, { phase: 'llm_verification', llm_total: 50, llm_done: 20 }))
      .mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    await runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 1 });
    expect(seen[1]).toMatchObject({ phase: 'llm_verification', llmDone: 20, llmTotal: 50, percent: 92 });
  });

  it('polls the job endpoint, so a poll can never start a second match', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValue(done);
    await runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1 });
    expect(matchCandidates).toHaveBeenCalledTimes(1);
    expect(getMatchJob).toHaveBeenCalledWith('job-1');
  });

  it('returns immediately when the backend answers inline', async () => {
    matchCandidates.mockResolvedValue(done);
    expect(await runMatchJob({ jd_id: 'jd' } as never, () => undefined)).toBe(done);
    expect(getMatchJob).not.toHaveBeenCalled();
  });

  it('surfaces a failed job', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValue({ is_queued: false, status: 'failed', message: 'JD not found', candidates: [] });
    await expect(runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1 })).rejects.toThrow('JD not found');
  });

  it('retries a transient network error but stops on a failed job', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(done);
    expect(await runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1 })).toBe(done);

    getMatchJob.mockReset();
    getMatchJob.mockRejectedValue({ response: { status: 500, data: { detail: 'boom' } }, detail: 'boom' });
    await expect(runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1 })).rejects.toMatchObject({ detail: 'boom' });
  });

  it('estimates time left from the measured rate, only once there is enough to measure', async () => {
    vi.useFakeTimers();
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValueOnce(running(2)).mockResolvedValueOnce(running(25)).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    const run = runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);   // first poll: 2%
    await vi.advanceTimersByTimeAsync(10_000);   // second poll: 25%, 10 s into the run
    await vi.advanceTimersByTimeAsync(10_000);   // third poll: done
    await run;
    vi.useRealTimers();
    expect(seen[1].etaSeconds).toBeNull();                 // 2%: too early to say
    expect(seen[2].etaSeconds).not.toBeNull();             // 25% after the elapsed time
    expect(seen[2].etaSeconds as number).toBeGreaterThan(0);
  });
});
