'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, X } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { AgentMessageMeta } from '@/lib/types';

const LABELS: Record<string, string> = {
  search_candidates: 'Searched the candidates', get_candidate: 'Read a candidate profile', get_job_applications: 'Read the applications',
  list_jobs: 'Looked at the job postings', list_job_descriptions: 'Looked at the job descriptions', draft_job_post: 'Prepared a job draft',
  publish_job_post: 'Posted the confirmed job', run_matching: 'Ran matching', get_match_results: 'Checked the matching run',
  generate_interview_questions: 'Wrote interview questions', generate_linkedin_post: 'Wrote the LinkedIn post',
  token_usage_overview: 'Read token usage',
  list_requirements: 'Looked at the requirements', list_closures: 'Looked at the closures', get_requirement: 'Read a requirement', tracker_analytics: 'Read the analytics',
  list_selections: 'Looked at selections and joining', propose_requirement_create: 'Prepared a new requirement', propose_requirement_update: 'Prepared a requirement change',
  propose_selection_update: 'Prepared a selection change',
  pending_token_requests: 'Read the reset requests',
};

const SPECIALISTS: Record<string, string> = {
  jobs: 'Jobs', matching: 'Matching', candidates: 'Candidates', tracker: 'Requirements tracker', interview: 'Interview questions', linkedin: 'LinkedIn post', admin: 'Admin insights',
};

/** A quiet "how I got this" line under an answer: which skill answered and which steps it took. Nothing is hidden from the person. */
export function TraceStrip({ meta }: { meta: AgentMessageMeta | null }) {
  const [open, setOpen] = useState(false);
  const trace = meta?.trace ?? [];
  if (!meta?.specialist) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 text-2xs text-slate-400 transition-colors hover:text-slate-600">
        <span>{SPECIALISTS[meta.specialist] ?? meta.specialist}{trace.length ? ` · ${trace.length} ${trace.length === 1 ? 'step' : 'steps'}` : ''}</span>
        {trace.length > 0 && <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />}
      </button>
      <AnimatePresence initial={false}>
        {open && trace.length > 0 && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            {trace.map((t, i) => (
              <li key={i} className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                {t.ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <X className="h-3.5 w-3.5 text-rose-500" />}
                <span>{LABELS[t.tool] ?? t.tool}</span><span className="tabular-nums text-slate-300">{t.ms < 1000 ? `${t.ms} ms` : `${(t.ms / 1000).toFixed(1)} s`}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
