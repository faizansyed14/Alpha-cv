import { beforeEach, describe, expect, it, vi } from 'vitest';

const matchCandidates = vi.fn();
const getMatchJob = vi.fn();
vi.mock('@/lib/api', () => ({ api: { matchCandidates: (r: unknown) => matchCandidates(r), getMatchJob: (id: string) => getMatchJob(id) } }));

import { clearActiveMatch, loadActiveMatch, pollDelay, resumeMatchJob, retryAfterMs, runMatchJob, type MatchUpdate } from './matchRun';

const queued = (extra = {}) => ({ is_queued: true, job_id: 'job-1', status: 'queued', queue_position: 2, progress: { progress_percent: 0 }, ...extra });
const running = (percent: number, extra = {}) => ({
  is_queued: true, job_id: 'job-1', status: 'processing',
  progress: { phase: 'scoring', progress_percent: percent, total_candidates: 1000, processed_candidates: Math.round(percent * 10), ...extra },
});
const done = { is_queued: false, candidates: [{ cv_id: 'a' }] };

beforeEach(() => {
  matchCandidates.mockReset();
  getMatchJob.mockReset();
  clearActiveMatch();
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
    expect(percents[0]).toBe(0);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));            // never goes backwards
    expect(percents[3]).toBe(percents[2]);                                      // the stale read changed nothing
    expect(percents[4]).toBeGreaterThan(percents[2]);
    expect(percents[4]).toBeLessThan(60);                                       // scoring owns only its share of the bar
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
    expect(seen[1]).toMatchObject({ phase: 'llm_verification', llmDone: 20, llmTotal: 50 });
    expect(seen[1].percent).toBeGreaterThan(50);       // 20 of 50 reviewed lifts the bar to that share of the AI part
    expect(seen[1].percent).toBeLessThan(96);          // and it never claims to be finished before the results are in
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
    getMatchJob.mockResolvedValueOnce(running(5)).mockResolvedValueOnce(running(40)).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    const run = runMatchJob({ jd_id: 'jd' } as never, (u) => seen.push(u), { pollMs: 10_000 });
    await vi.advanceTimersByTimeAsync(10_000);   // first poll: 2%
    await vi.advanceTimersByTimeAsync(10_000);   // second poll: 25%, 10 s into the run
    await vi.advanceTimersByTimeAsync(10_000);   // third poll: done
    await run;
    vi.useRealTimers();
    expect(seen[1].etaSeconds).toBeNull();                 // first reading: too early to say
    expect(seen[2].etaSeconds).not.toBeNull();             // later, from the elapsed time
    expect(seen[2].etaSeconds as number).toBeGreaterThan(0);
  });
});

describe('the percentage shown while a match runs', () => {
  it('lays a short match out on a time scale: a little for scoring, then a steady climb through the AI review', async () => {
    vi.useFakeTimers();
    matchCandidates.mockResolvedValue(queued());
    const ai = (done: number) => running(90, { phase: 'llm_verification', total_candidates: 20, llm_total: 20, llm_done: done });
    getMatchJob
      .mockResolvedValueOnce(running(88, { total_candidates: 20 }))   // scoring done in a second
      .mockResolvedValueOnce(ai(0)).mockResolvedValueOnce(ai(0)).mockResolvedValueOnce(ai(0))
      .mockResolvedValueOnce(ai(10)).mockResolvedValueOnce(ai(20)).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    const run = runMatchJob({ jd_id: 'jd', cv_ids: new Array(20).fill('x') } as never, (u) => seen.push(u), { pollMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000 * 7);
    await run;
    vi.useRealTimers();
    const p = seen.map((u) => u.percent);
    expect(p[1]).toBeLessThan(15);                              // 20 CVs score in a moment: no big jump at the start
    expect(p).toEqual([...p].sort((a, b) => a - b));
    expect(Math.max(...p)).toBeLessThan(99);                    // the runner never calls it finished itself
    const gaps = p.slice(2).map((v, i) => v - p[i + 1]);
    expect(Math.max(...gaps)).toBeLessThan(30);                 // steady steps, not one leap
  });
});

describe('a running match survives a reload', () => {
  it('remembers the job while it runs and forgets it when the results are in', async () => {
    matchCandidates.mockResolvedValue(queued());
    let during: ReturnType<typeof loadActiveMatch> = null;
    getMatchJob.mockImplementationOnce(async () => { during = loadActiveMatch(); return running(20); }).mockResolvedValueOnce(done);
    await runMatchJob({ jd_id: 'jd', cv_ids: new Array(7).fill('x') } as never, () => undefined, { pollMs: 1, remember: true, owner: 'sam' });
    expect(during).toMatchObject({ jobId: 'job-1', totalCVs: 7, owner: 'sam' });
    expect(loadActiveMatch()).toBeNull();
  });

  it('forgets it when the job fails too, so a dead job is never resumed', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockResolvedValue({ is_queued: false, status: 'failed', message: 'boom', candidates: [] });
    await expect(runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1, remember: true })).rejects.toThrow('boom');
    expect(loadActiveMatch()).toBeNull();
  });

  it('remembers nothing unless asked (careers and other callers)', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockImplementationOnce(async () => { expect(loadActiveMatch()).toBeNull(); return running(10); }).mockResolvedValueOnce(done);
    await runMatchJob({ jd_id: 'jd' } as never, () => undefined, { pollMs: 1 });
  });

  it('resumes by asking the server about the same job, and never starts a second match', async () => {
    getMatchJob.mockResolvedValueOnce(running(30)).mockResolvedValueOnce(done);
    const seen: MatchUpdate[] = [];
    const result = await resumeMatchJob({ jobId: 'job-9', startedAt: Date.now(), totalCVs: 1000 }, (u) => seen.push(u), { pollMs: 1 });
    expect(result).toBe(done);
    expect(matchCandidates).not.toHaveBeenCalled();
    expect(getMatchJob).toHaveBeenCalledWith('job-9');
    expect(seen[0]).toMatchObject({ totalCVs: 1000, phase: 'batches' });
  });

  it('a job that has expired on the server ends the resume quietly with the 404 and forgets it', async () => {
    getMatchJob.mockRejectedValue({ response: { status: 404 } });
    localStorage.setItem('alpha.activeMatch.v1', JSON.stringify({ jobId: 'old', startedAt: Date.now(), totalCVs: 5 }));
    await expect(resumeMatchJob({ jobId: 'old', startedAt: Date.now(), totalCVs: 5 }, () => undefined, { pollMs: 1 })).rejects.toMatchObject({ response: { status: 404 } });
    expect(loadActiveMatch()).toBeNull();
  });

  it('ignores a remembered match that is too old or belongs to someone else', () => {
    localStorage.setItem('alpha.activeMatch.v1', JSON.stringify({ jobId: 'a', startedAt: Date.now() - 7 * 3600 * 1000, totalCVs: 1 }));
    expect(loadActiveMatch()).toBeNull();
    localStorage.setItem('alpha.activeMatch.v1', JSON.stringify({ jobId: 'b', startedAt: Date.now(), totalCVs: 1, owner: 'sam' }));
    expect(loadActiveMatch('alex')).toBeNull();
    expect(loadActiveMatch('sam')).toMatchObject({ jobId: 'b' });
  });
});

describe('being told to slow down', () => {
  const throttle = (retryAfter?: string) => ({ response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {}, data: { detail: 'slow down' } } });

  it('keeps following the job through many 429 answers instead of abandoning it', async () => {
    matchCandidates.mockResolvedValue(queued());
    for (let i = 0; i < 12; i++) getMatchJob.mockRejectedValueOnce(throttle());   // more than the 8 plain failures that used to abort
    getMatchJob.mockResolvedValueOnce(done);
    await expect(runMatchJob({ jd_id: 'jd' } as never, () => {}, { pollMs: 1 })).resolves.toBe(done);
  });

  it('a busy server (503) is waited out the same way', async () => {
    matchCandidates.mockResolvedValue(queued());
    getMatchJob.mockRejectedValueOnce({ response: { status: 503, headers: {}, data: { detail: 'The server is busy.' } } }).mockResolvedValueOnce(done);
    await expect(runMatchJob({ jd_id: 'jd' } as never, () => {}, { pollMs: 1 })).resolves.toBe(done);
  });

  it('honours Retry-After, within limits', () => {
    expect(retryAfterMs(throttle('5'), 1000)).toBe(5000);
    expect(retryAfterMs(throttle('999'), 1000)).toBe(30000);   // never longer than 30 s
    expect(retryAfterMs(throttle('0'), 1000)).toBe(1000);      // never shorter than the normal poll
    expect(retryAfterMs(throttle(), 1000)).toBe(1000);
  });
});

describe('pollDelay', () => {
  it('reads every second at first and backs off as the match gets long', () => {
    expect(pollDelay(1000, 5_000)).toBe(1000);
    expect(pollDelay(1000, 60_000)).toBe(2000);
    expect(pollDelay(1000, 300_000)).toBe(3000);
    expect(pollDelay(1000, 3_600_000)).toBe(5000);
  });
});
