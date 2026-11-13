'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ChevronDown } from '@/components/icons';
import { CopyButton } from '@/components/agents/shared/CopyButton';
import { cn } from '@/lib/utils';
import { ease } from '@/lib/motion';
import type { AgentMessage } from '@/lib/types';

/** The Interview Question Agent's answer: plain numbered question cards. Black text, one navy accent, nothing else. */
export function InterviewAnswer({ message, fresh }: { message: AgentMessage; fresh: boolean }) {
  const meta = message.meta;
  const questions = useMemo(() => (meta?.type === 'interview' && meta.questions ? meta.questions : []), [meta]);
  const [filter, setFilter] = useState('All');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [allOpen, setAllOpen] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    questions.forEach((q) => counts.set(q.category, (counts.get(q.category) ?? 0) + 1));
    return Array.from(counts.entries());
  }, [questions]);

  if (questions.length === 0) return null;
  const fromCv = questions.filter((q) => q.based_on).length;
  const shown = questions.map((q, i) => ({ q, i })).filter(({ q }) => filter === 'All' || q.category === filter);

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-md font-semibold text-slate-900">{questions.length} interview questions{meta?.role ? ` for ${meta.role}` : ''}</p>
          {fromCv > 0 && <p className="mt-0.5 text-xs text-slate-500">{fromCv} based on the candidate&apos;s CV</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => { const next = !allOpen; setAllOpen(next); setOpen(Object.fromEntries(questions.map((_, i) => [i, next]))); }}
            className="rounded-lg border border-slate-200 bg-paper px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50">
            {allOpen ? 'Hide guidance' : 'Show guidance'}
          </button>
          <CopyButton text={message.content} label="Copy all" />
        </div>
      </div>

      {categories.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[['All', questions.length] as [string, number], ...categories].map(([name, count]) => (
            <button key={name} type="button" onClick={() => setFilter(name)}
              className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === name ? 'bg-solid text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {name} <span className={filter === name ? 'text-white/70' : 'text-slate-400'}>{count}</span>
            </button>
          ))}
        </div>
      )}

      <ol className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-paper">
        {shown.map(({ q, i }, k) => {
          const isOpen = !!open[i];
          return (
            <motion.li
              key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease, delay: fresh ? Math.min(k, 12) * 0.05 : 0 }} className="px-4 py-3.5"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium leading-snug text-slate-900">{q.question}</p>
                  <p className="mt-1.5 text-xs text-slate-500">
                    {q.category} · {q.difficulty}
                    {q.based_on ? <span className="text-navy-700"> · From the CV: {q.based_on}</span> : null}
                  </p>
                  <AnimatePresence initial={false}>
                    {isOpen && (q.listen_for || q.follow_up) && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease }} className="overflow-hidden">
                        <div className="mt-3 space-y-2.5 border-l-2 border-slate-200 pl-3.5 text-sm leading-relaxed text-slate-700">
                          {q.listen_for && <p><span className="font-semibold text-slate-900">A strong answer: </span>{q.listen_for}</p>}
                          {q.follow_up && <p><span className="font-semibold text-slate-900">Follow-up: </span>{q.follow_up}</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <div className="flex shrink-0 items-center">
                  <CopyButton text={q.question} label="" compact />
                  <button type="button" aria-label={isOpen ? 'Hide guidance' : 'Show guidance'} onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))}
                    className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                    <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')} />
                  </button>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ol>
      {meta?.warnings && meta.warnings.length > 0 ? (
        <div className="mt-2.5 space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          {meta.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>)}
        </div>
      ) : null}
    </div>
  );
}
