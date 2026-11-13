'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, FileText, Loader2, UserRound, X } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface Chip { key: string; kind: 'jd' | 'cv'; label: string; busy?: boolean; onRemove?: () => void }

/** The message box: attached job description / CV as chips on top, "+" and the text in the middle, a round send button. */
export function Composer({ value, onChange, onSend, canSend, sending, placeholder, chips, attach, maxLength, locked, autoFocus }: {
  value: string; onChange: (v: string) => void; onSend: () => void; canSend: boolean; sending: boolean; placeholder: string;
  chips: Chip[]; attach?: React.ReactNode; maxLength: number; locked?: string; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-paper shadow-[0_2px_14px_rgba(15,23,42,0.06)] transition-colors focus-within:border-navy-300">
      <AnimatePresence initial={false}>
        {chips.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {chips.map((c) => (
                <motion.span key={c.key} layout initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
                  className="inline-flex max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-1.5 text-xs text-slate-800">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-solid text-white">
                    {c.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : c.kind === 'jd' ? <FileText className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10.5px] font-semibold uppercase leading-none tracking-wide text-slate-400">{c.kind === 'jd' ? 'Job description' : 'Candidate CV'}</span>
                    <span className="mt-0.5 block max-w-[240px] truncate font-medium leading-tight">{c.label}</span>
                  </span>
                  {c.onRemove && (
                    <button type="button" onClick={c.onRemove} aria-label={`Remove ${c.label}`} className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
                  )}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-1.5 p-2">
        {attach}
        <textarea
          ref={ref} value={value} rows={1} maxLength={maxLength} disabled={sending || !!locked}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSend(); } }}
          placeholder={locked || placeholder}
          className="max-h-[168px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-base leading-relaxed text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
        />
        <motion.button
          type="button" onClick={onSend} disabled={!canSend} aria-label="Send"
          whileTap={canSend ? { scale: 0.92 } : undefined}
          className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
            canSend ? 'bg-solid text-white hover:bg-solid-hover' : 'cursor-not-allowed bg-slate-100 text-slate-300')}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
        </motion.button>
      </div>
    </div>
  );
}
