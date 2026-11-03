import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadCV = vi.fn();
const getCVUploadProgress = vi.fn();
vi.mock('@/lib/api', () => ({ api: { uploadCV: (f: unknown) => uploadCV(f), getCVUploadProgress: (id: string) => getCVUploadProgress(id) } }));

import { runPool, uploadCVAndWait } from './uploadRun';

beforeEach(() => {
  uploadCV.mockReset();
  getCVUploadProgress.mockReset();
});

describe('runPool', () => {
  it('runs several at once but never more than the limit', async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBe(4);
  });

  it('attempts every item even when one fails', async () => {
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      try {
        if (n === 2) throw new Error('boom');
        done.push(n);
      } catch {
        /* handled per item by the caller */
      }
    });
    expect(done.sort()).toEqual([1, 3, 4, 5]);
  });

  it('copes with fewer items than lanes and with none', async () => {
    const seen: number[] = [];
    await runPool([1], 4, async (n) => void seen.push(n));
    await runPool([], 4, async () => undefined);
    expect(seen).toEqual([1]);
  });
});

describe('uploadCVAndWait', () => {
  it('returns at once when the backend processed the file itself', async () => {
    uploadCV.mockResolvedValue({ status: 'success', cv_id: 'a' });
    expect(await uploadCVAndWait(new File(['x'], 'a.pdf'), () => undefined)).toMatchObject({ cv_id: 'a' });
    expect(getCVUploadProgress).not.toHaveBeenCalled();
  });

  it('follows a queued file to completion and reports each step', async () => {
    uploadCV.mockResolvedValue({ status: 'queued', processing_mode: 'queued', cv_id: 'q1' });
    getCVUploadProgress
      .mockResolvedValueOnce({ status: 'processing', progress_percent: 25, current_step: 'Standardising with AI' })
      .mockResolvedValueOnce({ status: 'processing', progress_percent: 70, current_step: 'Storing' })
      .mockResolvedValueOnce({ status: 'completed' });
    const steps: string[] = [];
    const res = await uploadCVAndWait(new File(['x'], 'a.pdf'), (s) => steps.push(s), { pollMs: 1 });
    expect(res).toMatchObject({ cv_id: 'q1' });
    expect(steps).toEqual(['Queued', 'Standardising with AI', 'Storing']);
  });

  it('surfaces the worker failure message', async () => {
    uploadCV.mockResolvedValue({ status: 'queued', processing_mode: 'queued', cv_id: 'q2' });
    getCVUploadProgress.mockResolvedValue({ status: 'failed', current_step: 'Could not extract sufficient text' });
    await expect(uploadCVAndWait(new File(['x'], 'a.pdf'), () => undefined, { pollMs: 1 })).rejects.toThrow('sufficient text');
  });

  it('gives up if the queued file is never found', async () => {
    uploadCV.mockResolvedValue({ status: 'queued', processing_mode: 'queued', cv_id: 'q3' });
    getCVUploadProgress.mockResolvedValue({ status: 'not_found' });
    await expect(uploadCVAndWait(new File(['x'], 'a.pdf'), () => undefined, { pollMs: 1 })).rejects.toThrow('lost');
  });
});
