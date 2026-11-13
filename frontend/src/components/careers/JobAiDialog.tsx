'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from '@/components/icons';
import { api } from '@/lib/api';
import type { AgentMessage, JobPostingListItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { InterviewAnswer } from '@/components/agents/interview/InterviewAnswer';
import { LinkedInAnswer } from '@/components/agents/linkedin/LinkedInAnswer';

export type JobAiKind = 'linkedin' | 'interview';

const COPY: Record<JobAiKind, { title: string; working: string; agentPath: string; agentName: string; fallback: string }> = {
  linkedin: {
    title: 'LinkedIn post',
    working: 'Writing a LinkedIn post from this job…',
    agentPath: '/agents/linkedin',
    agentName: 'LinkedIn Post agent',
    fallback: 'Write a LinkedIn post for this job.',
  },
  interview: {
    title: 'Interview questions',
    working: 'Preparing interview questions from this job…',
    agentPath: '/agents/interview',
    agentName: 'Interview Questions agent',
    fallback: 'Write interview questions for this job.',
  },
};

/** What was generated for a job stays for the session, so reopening the dialog shows it at once instead of spending tokens again. */
const remembered = new Map<string, AgentMessage>();

function jobText(d: { job_title?: string; job_location?: string; job_summary?: string; key_responsibilities?: string; qualifications?: string }): string {
  return [
    d.job_title && `Job title: ${d.job_title}`,
    d.job_location && `Location: ${d.job_location}`,
    d.job_summary && `Summary:\n${d.job_summary}`,
    d.key_responsibilities && `Key responsibilities:\n${d.key_responsibilities}`,
    d.qualifications && `Qualifications:\n${d.qualifications}`,
  ].filter(Boolean).join('\n\n');
}

/** A LinkedIn post or a set of interview questions for one job, written by the matching agent from the job's own text. */
export default function JobAiDialog({ job, kind, onClose }: { job: JobPostingListItem; kind: JobAiKind; onClose: () => void }) {
  const copy = COPY[kind];
  const key = `${kind}:${job.job_id}`;
  const [message, setMessage] = useState<AgentMessage | null>(() => remembered.get(key) ?? null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const generate = useCallback(async () => {
    const mine = ++run.current;
    setWorking(true);
    setError(null);
    try {
      const [detail, agent] = await Promise.all([api.getJobForMatching(job.job_id), api.getAgentInfo(kind)]);
      const text = jobText(detail);
      if (!text.trim()) throw new Error('This job has no description to work from. Add a summary, responsibilities or qualifications first.');
      const applyUrl =
        kind === 'linkedin' && job.public_token && job.public_token !== 'unknown'
          ? `${window.location.origin}/careers/jobs/${job.public_token}`
          : undefined;
      const res = await api.agentChat(kind, {
        message: (agent as { default_request?: string })?.default_request || copy.fallback,
        jd_source: 'pasted',
        jd_text: text,
        jd_title: detail.job_title || job.job_title || 'Job',
        apply_url: applyUrl,
      });
      if (mine !== run.current) return;
      const answer = res.assistant_message as AgentMessage;
      setMessage(answer);
      if (answer.status === 'ok') remembered.set(key, answer);
    } catch (e: any) {
      if (mine !== run.current) return;
      setError(e?.detail || e?.response?.data?.detail || e?.message || 'Nothing could be generated. Please try again.');
    } finally {
      if (mine === run.current) setWorking(false);
    }
  }, [job.job_id, job.job_title, job.public_token, kind, key, copy.fallback]);

  useEffect(() => {
    if (!remembered.has(key)) void generate();
    return () => { run.current++; };      // an answer that arrives after the dialog closed is dropped
  }, [key, generate]);

  const usable = message && message.status === 'ok' && message.meta;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{job.job_title || 'Job'}{job.job_location ? `, ${job.job_location}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="min-h-[180px] flex-1 overflow-y-auto pr-1">
          {working ? (
            <div className="flex h-44 flex-col items-center justify-center gap-3 text-center" role="status">
              <Loader2 className="h-7 w-7 animate-spin text-navy-600" />
              <p className="text-sm font-medium text-slate-800">{copy.working}</p>
              <p className="text-xs text-slate-500">This usually takes 10 to 30 seconds. You can keep this window open.</p>
            </div>
          ) : error ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : usable ? (
            kind === 'linkedin' ? <LinkedInAnswer message={message} fresh={false} /> : <InterviewAnswer message={message} fresh={false} />
          ) : message ? (
            <p className="whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">{message.content}</p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-3">
          <Link href={copy.agentPath} className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-700 hover:underline">
            Refine it in the {copy.agentName} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void generate()} disabled={working}>
              {message || error ? 'Generate again' : 'Generate'}
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
