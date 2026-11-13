'use client';

import { useState } from 'react';
import { Check, Copy } from '@/components/icons';
import type { AgenticCard } from '@/lib/types';
import { Action, CardShell, Pill, type Send } from './ui';

const FIELDS: Array<[string, string]> = [
  ['job_title', 'Job title'], ['job_location', 'Location'], ['job_summary', 'Summary'],
  ['key_responsibilities', 'Responsibilities'], ['qualifications', 'Qualifications'],
];

/**
 * A job draft. It is only a draft: nothing is posted until the person confirms. The buttons are active on the latest draft only,
 * so an old draft higher up the chat can never be posted by accident.
 */
export function JobDraftCard({ card, onSend, active }: { card: AgenticCard; onSend: Send; active: boolean }) {
  const f: Record<string, string> = card.fields ?? {};
  const missing: string[] = card.missing ?? [];
  const needs = missing.map((m) => (m === 'job_location' ? 'the location' : 'the job title')).join(' and ');
  return (
    <CardShell title="Draft job post" count={missing.length ? 'needs one more thing' : active ? 'not posted yet' : 'older draft'}
      footer={active && !missing.length ? 'Say what to change (for example "keep Dubai"), or confirm to post it.' : undefined}>
      {missing.length > 0 ? (
        <div className="border-b border-amber-100 bg-amber-50/80 px-4 py-2 text-xs font-medium text-amber-900">
          This file does not say {needs}. Tell me in the chat (a city, a country, or remote) and I will add it.
        </div>
      ) : null}
      {card.attachment?.filename ? (
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
          <Pill tone="navy">From your file</Pill><span className="truncate">{card.attachment.filename}</span>
        </div>
      ) : null}
      <dl className="divide-y divide-slate-100">
        {FIELDS.filter(([k]) => f[k]).map(([k, label]) => (
          <div key={k} className="px-4 py-2.5">
            <dt className="text-2xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{f[k]}</dd>
          </div>
        ))}
      </dl>
      {active && !missing.length && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          <Action tone="primary" label="Yes, post it" onClick={() => onSend('Yes, post it')} />
          <Action label="I want to change something" onClick={() => onSend('I want to change something')} />
        </div>
      )}
    </CardShell>
  );
}

/** The confirmation after a job went live. */
export function JobPostedCard({ card, onSend }: { card: AgenticCard; onSend: Send }) {
  const [copied, setCopied] = useState(false);
  const link: string = card.public_link || (card.public_token ? `/careers/jobs/${card.public_token}` : '');
  const href = link && typeof window !== 'undefined' && link.startsWith('/') ? `${window.location.origin}${link}` : link;
  return (
    <CardShell title="Job posted">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-md font-semibold text-slate-900">{card.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">It is live on the careers page.</p>
          {card.subject ? (
            <div className="mt-2 flex items-center gap-2">
              <Pill tone="navy">Subject</Pill>
              <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">{card.subject}</code>
              <button type="button" aria-label="Copy subject" onClick={() => { void navigator.clipboard?.writeText(card.subject); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {href ? <a href={href} target="_blank" rel="noreferrer" className="rounded-full bg-solid px-3 py-1 text-xs font-medium text-white hover:bg-solid-hover">Open the job page</a> : null}
        <Action label="Write a LinkedIn post for this job" onClick={() => onSend(`Write a LinkedIn post for the ${card.title} job`)} />
      </div>
    </CardShell>
  );
}
