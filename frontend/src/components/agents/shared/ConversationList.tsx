'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trash2 } from '@/components/icons';
import { cn } from '@/lib/utils';
import { spring } from '@/lib/motion';
import type { AgentConversationSummary } from '@/lib/types';

function asDate(iso: string): Date {
  return new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
}

function groupOf(iso: string): string {
  const d = asDate(iso);
  if (Number.isNaN(d.getTime())) return 'Older';
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  return 'Older';
}

const ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

export function ConversationList({ items, activeId, onOpen, onDelete }: {
  items: AgentConversationSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, AgentConversationSummary[]>();
    for (const c of items) {
      const g = groupOf(c.last_message_at);
      map.set(g, [...(map.get(g) ?? []), c]);
    }
    return ORDER.filter((g) => map.has(g)).map((g) => ({ name: g, rows: map.get(g)! }));
  }, [items]);

  if (items.length === 0) {
    return <p className="px-4 py-6 text-[12.5px] leading-relaxed text-slate-400">No chats yet. Your conversations are saved here.</p>;
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3 pt-1">
      {groups.map((g) => (
        <div key={g.name}>
          <p className="px-2.5 pb-1 text-[11px] font-medium text-slate-400">{g.name}</p>
          <AnimatePresence initial={false}>
            {g.rows.map((c) => {
              const active = c.id === activeId;
              const asking = confirming === c.id;
              return (
                <motion.div
                  key={c.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  exit={{ opacity: 0, x: -16, height: 0 }} transition={spring.layout} className="group relative"
                >
                  {asking ? (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                      <p className="text-[12.5px] font-medium text-slate-900">Delete this chat?</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">It leaves your list. A copy is kept for the audit record.</p>
                      <div className="mt-2 flex gap-1.5">
                        <button type="button" disabled={deleting === c.id}
                          onClick={async () => { setDeleting(c.id); try { await onDelete(c.id); } finally { setDeleting(null); setConfirming(null); } }}
                          className="rounded-md bg-rose-600 px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60">
                          {deleting === c.id ? 'Deleting...' : 'Delete'}
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="rounded-md px-2.5 py-1 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-100">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button type="button" onClick={() => onOpen(c.id)} title={c.title}
                        className={cn('block w-full truncate rounded-lg px-2.5 py-2 pr-8 text-left text-[13px] transition-colors',
                          active ? 'bg-slate-200/70 font-medium text-slate-900' : 'text-slate-700 hover:bg-slate-200/50')}>
                        {c.title}
                      </button>
                      <button type="button" onClick={() => setConfirming(c.id)} aria-label={`Delete chat ${c.title}`}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 opacity-0 transition-all hover:bg-white hover:text-rose-600 focus:opacity-100 group-hover:opacity-100">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
