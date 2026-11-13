'use client';

import { useState } from 'react';
import { Check, Copy } from '@/components/icons';
import { cn } from '@/lib/utils';

/** Copies text. `compact` is an icon-only button for tight places. */
export function CopyButton({ text, label = 'Copy', compact = false }: { text: string; label?: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label || 'Copy'}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium transition-colors',
        compact
          ? 'rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700'
          : 'rounded-lg border border-slate-200 bg-paper px-2.5 py-1.5 text-slate-700 hover:bg-slate-50',
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {!compact && (done ? 'Copied' : label)}
    </button>
  );
}
