'use client';

import { Check, X } from '@/components/icons';
import type { AgenticCard } from '@/lib/types';
import { useCardActions } from './actions';
import { Action, CardShell } from './ui';

/**
 * A change the assistant PROPOSED. Nothing has happened yet: the rows say exactly what will change, and only the buttons here
 * (or a plain yes / no) carry it out. The server runs the details it saved with this card, never anything sent from the browser.
 */
export function ActionCard({ card, active }: { card: AgenticCard; active: boolean }) {
  const { decide } = useCardActions();
  const rows: Array<{ label: string; value: string }> = card.rows ?? [];
  return (
    <CardShell title={card.title ?? 'Confirm this change'} count={active ? 'waiting for you' : 'closed'}
      footer={(
        active ? (
          <div className="flex flex-wrap items-center gap-2">
            <Action tone="primary" label="Confirm" onClick={() => decide('confirm', card.id, 'Yes, do it')} />
            <Action label="Cancel" onClick={() => decide('cancel_action', card.id, 'Cancel')} />
          </div>
        ) : <span className="text-[11.5px] text-slate-400">This change is no longer waiting. Ask again if you still want it.</span>
      )}>
      <dl className="space-y-2.5 px-4 py-3.5">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-x-4 sm:grid-cols-[130px_1fr]">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</dt>
            <dd className="whitespace-pre-wrap break-words text-[13px] text-slate-800">{r.value}</dd>
          </div>
        ))}
      </dl>
      {card.warning ? <p className="mx-4 mb-3.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{card.warning}</p> : null}
    </CardShell>
  );
}

/** What happened after the person confirmed: the application's own answer in one line. */
export function ActionDoneCard({ card }: { card: AgenticCard }) {
  const ok = card.ok !== false;
  return (
    <div className={`flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-[13px] ${ok ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800' : 'border-rose-200 bg-rose-50/80 text-rose-800'}`}>
      {ok ? <Check className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
      <span><b className="font-semibold">{card.title}</b>{card.text ? `: ${card.text}` : ''}</span>
    </div>
  );
}
