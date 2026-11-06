'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload } from '@/components/icons';
import { cn } from '@/lib/utils';
import { CardShell } from './ui';

/** "Upload the job description": drop a file here (or choose one) and the assistant drafts the posting from it. */
export function UploadPromptCard({ onUpload, active, uploading }: { onUpload: (file: File) => void; active: boolean; uploading: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const disabled = !active || uploading;
  return (
    <CardShell title="Upload the job description" footer="PDF, DOCX or TXT. I read it, ask for anything missing (like the location), show you a draft, and post it only when you say yes.">
      <div className="p-4">
        <input ref={input} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
        <button
          type="button" disabled={disabled} onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onUpload(f); }}
          className={cn('flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-[13px] transition-colors',
            over ? 'border-navy-400 bg-navy-50' : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50', disabled && 'cursor-not-allowed opacity-60')}
        >
          {uploading ? <Loader2 className="h-6 w-6 animate-spin text-slate-500" /> : <Upload className="h-6 w-6 text-slate-500" />}
          <span className="font-medium text-slate-800">{uploading ? 'Reading your file...' : 'Choose a file or drop it here'}</span>
        </button>
      </div>
    </CardShell>
  );
}
