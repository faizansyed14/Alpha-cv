import { api } from '@/lib/api';

export const JD_ACCEPT = '.pdf,.doc,.docx,.txt';
const EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt'];
const MAX_BYTES = 5 * 1024 * 1024;

/** What is wrong with a file chosen as a job description, or null when it can be uploaded (the server checks it again). */
export function jdFileProblem(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!EXTENSIONS.some((e) => name.endsWith(e))) return 'Choose a PDF, Word (.doc, .docx) or text file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) return 'That file is larger than 5 MB.';
  return null;
}

export function errorText(e: any, fallback: string): string {
  const detail = e?.detail ?? e?.response?.data?.detail;
  return (typeof detail === 'string' && detail) || e?.message || fallback;
}

/**
 * Store a job description in the JD library (the same place the Job descriptions page lists) and return its id.
 * The server reads the file, so this takes a few seconds.
 */
export async function uploadJdFile(file: File): Promise<{ id: string; name: string }> {
  const problem = jdFileProblem(file);
  if (problem) throw new Error(problem);
  const res = await api.uploadJD(file);
  if (res.status !== 'success' || !res.jd_id) throw new Error('The job description could not be processed. Please try again.');
  return { id: res.jd_id, name: res.filename || file.name };
}
