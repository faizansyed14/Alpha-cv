import { api } from '@/lib/api';
import type { UploadResponse } from '@/lib/types';

/**
 * Uploading CVs in parallel.
 *
 * The backend accepts a file immediately and processes it in the ingest worker, several CVs at a time, so the browser
 * should not upload one file and wait before sending the next. `runPool` keeps `limit` uploads in flight, and
 * `uploadCVAndWait` follows one queued file until the worker has finished it (reading, AI extraction, embeddings and
 * storing) while reporting the current step.
 */

export const UPLOAD_CONCURRENCY = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `worker` over `items` with at most `limit` running at once; every item is attempted, errors stay per item. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export interface CVProgress {
  status: string;
  progress_percent?: number;
  current_step?: string;
}

/** Uploads one CV and resolves with its id once it is fully processed (immediately for non-queued processing). */
export async function uploadCVAndWait(
  file: File,
  onStep: (step: string, percent: number) => void,
  { pollMs = 1000, timeoutMs = 15 * 60 * 1000 }: { pollMs?: number; timeoutMs?: number } = {},
): Promise<UploadResponse> {
  const response = await api.uploadCV(file);
  if ((response as { processing_mode?: string }).processing_mode !== 'queued') return response;

  const cvId = (response as { cv_id: string }).cv_id;
  onStep('Queued', 0);
  const deadline = Date.now() + timeoutMs;
  let notFound = 0;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const p: CVProgress = await api.getCVUploadProgress(cvId);
    if (p.status === 'completed') return response;
    if (p.status === 'failed') throw new Error(p.current_step || 'Processing failed');
    if (p.status === 'not_found') {
      if (++notFound > 15) throw new Error('The upload was lost. Please upload the file again.');
      continue;
    }
    notFound = 0;
    onStep(p.current_step || 'Processing', p.progress_percent ?? 0);
  }
  throw new Error('Processing is taking longer than expected');
}
