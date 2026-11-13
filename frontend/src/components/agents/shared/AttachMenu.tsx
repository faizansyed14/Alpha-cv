'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, FileText, Plus, Search, Upload, UserRound } from '@/components/icons';
import type { ComboboxOption } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';
import { pop } from '@/lib/motion';
import { cvReady, jdReady, type SetupState } from './setup';

type View = 'root' | 'jd-list' | 'jd-paste' | 'cv-list';

function Item({ icon, label, hint, done, onClick }: { icon: React.ReactNode; label: string; hint?: string; done?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-100">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="block truncate text-2xs text-slate-400">{hint}</span>}
      </span>
      {done && <Check className="h-4 w-4 shrink-0 text-navy-700" />}
    </button>
  );
}

function Back({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 px-1 pb-1.5">
      <button type="button" onClick={onBack} aria-label="Back" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
    </div>
  );
}

function PickList({ options, selected, placeholder, empty, onPick }: {
  options: ComboboxOption[]; selected: string; placeholder: string; empty: string; onPick: (v: string) => void;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? options.filter((o) => o.label.toLowerCase().includes(t) || (o.hint ?? '').toLowerCase().includes(t)) : options).slice(0, 120);
  }, [options, q]);
  return (
    <div>
      <div className="relative mb-1.5 px-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-navy-300 focus:bg-paper" />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {shown.length === 0 ? <p className="px-3 py-6 text-center text-xs text-slate-400">{empty}</p> : shown.map((o) => (
          <button key={o.value} type="button" onClick={() => onPick(o.value)}
            className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100', o.value === selected && 'bg-slate-50')}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{o.label}</span>
              {o.hint && <span className="block truncate text-2xs text-slate-400">{o.hint}</span>}
            </span>
            {o.value === selected && <Check className="h-4 w-4 shrink-0 text-navy-700" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The "+" in the message box: attach a job description (from the list, pasted or a file) and, for the interview agent, a CV. */
export function AttachMenu({ setup, patch, jdOptions, cvOptions, acceptsCv, onUpload, maxJdChars }: {
  setup: SetupState;
  patch: (p: Partial<SetupState>) => void;
  jdOptions: ComboboxOption[];
  cvOptions: ComboboxOption[];
  acceptsCv: boolean;
  onUpload: (kind: 'jd' | 'cv', file: File) => void;
  maxJdChars: number;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('root');
  const [paste, setPaste] = useState('');
  const [down, setDown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const jdFile = useRef<HTMLInputElement>(null);
  const cvFile = useRef<HTMLInputElement>(null);

  const close = () => { setOpen(false); setView('root'); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pickFile = (kind: 'jd' | 'cv') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onUpload(kind, f);
    e.target.value = '';
    close();
  };

  return (
    <div ref={box} className="relative">
      <input ref={jdFile} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={pickFile('jd')} />
      <input ref={cvFile} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" onChange={pickFile('cv')} />
      <button
        type="button" aria-label="Attach a job description or CV" aria-expanded={open}
        onClick={() => {
          // the list is about 380px tall: open it downward when there is not that much room above the button
          const r = box.current?.getBoundingClientRect();
          setDown(!!r && r.top < 440);
          setOpen((o) => !o); setView('root');
        }}
        className={cn('flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900', open && 'rotate-45 bg-slate-100 text-slate-900')}
      >
        <Plus className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div variants={pop} initial="hidden" animate="show" exit="exit"
            className={cn('absolute left-0 z-40 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-paper p-1.5 shadow-[0_16px_48px_-12px_rgba(15,23,42,0.28)]', down ? 'top-full mt-2 origin-top-left' : 'bottom-full mb-2 origin-bottom-left')}>
            {view === 'root' && (
              <>
                <p className="px-3 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">Job description</p>
                <Item icon={<FileText className="h-4 w-4" />} label="Select from my list" hint="Job descriptions already saved" done={jdReady(setup) && setup.jdSource === 'library'} onClick={() => setView('jd-list')} />
                <Item icon={<FileText className="h-4 w-4" />} label="Paste text" hint="Paste a job description" done={jdReady(setup) && setup.jdSource === 'pasted'} onClick={() => { setPaste(setup.pastedText); setView('jd-paste'); }} />
                <Item icon={<Upload className="h-4 w-4" />} label="Upload a file" hint="PDF, DOCX or TXT" done={jdReady(setup) && setup.jdSource === 'uploaded'} onClick={() => jdFile.current?.click()} />
                {acceptsCv && (
                  <>
                    <div className="mx-3 my-1.5 h-px bg-slate-100" />
                    <p className="px-3 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">Candidate CV (optional)</p>
                    <Item icon={<UserRound className="h-4 w-4" />} label="Select a candidate" hint="Questions will be tailored to them" done={cvReady(setup) && setup.cvMode === 'library'} onClick={() => setView('cv-list')} />
                    <Item icon={<Upload className="h-4 w-4" />} label="Upload a CV" hint="PDF, DOCX or TXT" done={cvReady(setup) && setup.cvMode === 'uploaded'} onClick={() => cvFile.current?.click()} />
                  </>
                )}
              </>
            )}
            {view === 'jd-list' && (
              <>
                <Back title="Select a job description" onBack={() => setView('root')} />
                <PickList options={jdOptions} selected={setup.jdSource === 'library' ? setup.libraryId : ''} placeholder="Search job descriptions" empty="No job description matches"
                  onPick={(v) => { patch({ jdSource: 'library', libraryId: v }); close(); }} />
              </>
            )}
            {view === 'cv-list' && (
              <>
                <Back title="Select a candidate" onBack={() => setView('root')} />
                <PickList options={cvOptions} selected={setup.cvMode === 'library' ? setup.cvLibraryId : ''} placeholder="Search by name or title" empty="No CV matches"
                  onPick={(v) => { patch({ cvMode: 'library', cvLibraryId: v }); close(); }} />
              </>
            )}
            {view === 'jd-paste' && (
              <div className="p-1">
                <Back title="Paste a job description" onBack={() => setView('root')} />
                <textarea autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} rows={7} maxLength={maxJdChars} placeholder="Paste the full job description"
                  className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed outline-none transition-colors placeholder:text-slate-400 focus:border-navy-300 focus:bg-paper" />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-2xs tabular-nums text-slate-400">{paste.length.toLocaleString()} characters</span>
                  <button type="button" disabled={!paste.trim()} onClick={() => { patch({ jdSource: 'pasted', pastedText: paste }); close(); }}
                    className="rounded-lg bg-solid px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-solid-hover disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
                    Attach
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
