'use client';

import { AlertCircle } from '@/components/icons';
import { CopyButton } from '@/components/agents/shared/CopyButton';
import { Typewriter } from '@/components/agents/shared/Typewriter';
import type { AgentMessage } from '@/lib/types';

const LIMIT = 3000;

/** The LinkedIn Job Post Agent's answer: the post as plain text in a card, hashtags, a length gauge, and any figure to double-check. */
export function LinkedInAnswer({ message, fresh }: { message: AgentMessage; fresh: boolean }) {
  const meta = message.meta;
  if (meta?.type !== 'linkedin' || !meta.post) return null;
  const chars = meta.chars ?? meta.post.length;
  const pct = Math.min(100, Math.round((100 * chars) / LIMIT));
  return (
    <div className="w-full max-w-[640px]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5">
          <p className="text-[13px] font-semibold text-slate-900">LinkedIn post</p>
          <CopyButton text={message.content} label="Copy post" />
        </div>
        <div className="whitespace-pre-wrap px-4 py-4 text-[14.5px] leading-[1.65] text-slate-900">
          <Typewriter text={meta.post} active={fresh} />
        </div>
        {meta.hashtags && meta.hashtags.length > 0 ? (
          <p className="px-4 pb-4 text-[14px] font-medium text-navy-700">{meta.hashtags.join('  ')}</p>
        ) : null}
        <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-navy-700 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11.5px] tabular-nums text-slate-500">{chars.toLocaleString()} / {LIMIT.toLocaleString()}</span>
        </div>
      </div>
      {meta.warnings && meta.warnings.length > 0 ? (
        <div className="mt-2.5 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900">
          {meta.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>)}
        </div>
      ) : null}
    </div>
  );
}
