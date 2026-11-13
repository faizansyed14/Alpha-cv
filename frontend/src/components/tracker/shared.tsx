'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Pencil, X } from '@/components/icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Requirement, RequirementStatus } from '@/lib/types';

export const STATUSES: RequirementStatus[] = ['open', 'submitted', 'hold', 'closed', 'canceled'];

/** Brand header row for tracker tables: solid navy background, white column labels. */
export const TRACKER_THEAD = 'border-solid !bg-solid [&_th]:!bg-solid [&_th]:!text-white';
export const TRACKER_TH_STICKY = 'sticky right-0 z-[1] !bg-solid shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.35)]';

/** How each status looks: its label, a dot and the pill colours. Full class names, so Tailwind keeps them. */
export const STATUS_META: Record<RequirementStatus, { label: string; dot: string; pill: string }> = {
  open: { label: 'Open', dot: 'bg-sky-500', pill: 'border-sky-200 bg-sky-50 text-sky-800' },
  submitted: { label: 'Submitted', dot: 'bg-emerald-500', pill: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  hold: { label: 'Hold', dot: 'bg-amber-500', pill: 'border-amber-200 bg-amber-50 text-amber-800' },
  closed: { label: 'Closed', dot: 'bg-slate-400', pill: 'border-slate-200 bg-slate-100 text-slate-700' },
  canceled: { label: 'Cancelled', dot: 'bg-rose-500', pill: 'border-rose-200 bg-rose-50 text-rose-800' },
};

export function StatusPill({ status }: { status: RequirementStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.open;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold', m.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} /> {m.label}
    </span>
  );
}

/** The status as a dropdown that looks like its pill: pick another one to change it. */
export function StatusSelect({ value, onChange, disabled }: { value: RequirementStatus; onChange: (s: RequirementStatus) => void; disabled?: boolean }) {
  const m = STATUS_META[value] ?? STATUS_META.open;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RequirementStatus)} disabled={disabled}>
      <SelectTrigger aria-label="Status" className={cn('h-8 w-[7.75rem] gap-1.5 rounded-full px-2.5 text-xs font-semibold shadow-none', m.pill)}>
        <span className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
          {m.label}
        </span>
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_META[s].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const ALL_LOCATIONS = '__all__';
const NO_PERSON = '__none__';

export interface Person { id: string; username: string; location?: string }

/** One person chosen from a list (a recruitment manager, a sales manager): a dropdown that sets or clears them. A person who is no longer in the list is still shown. */
export function PersonSelect({ value, current, people, onChange, label, disabled, className }: {
  value: string;
  current?: { id: string; username: string } | null;
  people: Person[];
  onChange: (id: string | null) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const list = current && !people.some((p) => p.id === current.id) ? [...people, current] : people;
  return (
    <Select value={value || NO_PERSON} onValueChange={(v) => onChange(v === NO_PERSON ? null : v)} disabled={disabled}>
      <SelectTrigger aria-label={label} className={cn('h-8 w-[8.75rem] text-xs', className)}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={NO_PERSON}>Unassigned</SelectItem>
        {list.map((p) => <SelectItem key={p.id} value={p.id}>{p.username}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** A filter for a list of people: everyone, nobody chosen, or one person. */
export function PersonFilter({ value, people, onChange, label, all, className }: {
  value: string;
  people: Person[];
  onChange: (id: string) => void;
  label: string;
  all: string;
  className?: string;
}) {
  return (
    <Select value={value || ALL_LOCATIONS} onValueChange={(v) => onChange(v === ALL_LOCATIONS ? '' : v)}>
      <SelectTrigger aria-label={label} className={cn('h-8 w-full text-xs sm:w-[10.5rem]', className)}><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={ALL_LOCATIONS}>{all}</SelectItem>
        <SelectItem value="none">Unassigned</SelectItem>
        {people.map((p) => <SelectItem key={p.id} value={p.id}>{p.username}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The Location dropdown of the EVP and the admin: all locations, or Dubai, or Abu Dhabi. Everyone else works in one location and never sees it. */
export function LocationFilter({ value, locations, onChange, className }: { value: string; locations: string[]; onChange: (location: string) => void; className?: string }) {
  return (
    <Select value={value || ALL_LOCATIONS} onValueChange={(v) => onChange(v === ALL_LOCATIONS ? '' : v)}>
      <SelectTrigger aria-label="Location" className={cn('h-8 w-full text-xs sm:w-[9.5rem]', className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
        {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The years a Year dropdown offers: the five before this one, this one, the five after it, and any year that has data, newest first. */
export function yearChoices(dataYears: number[] = [], ...selected: Array<number | undefined>): number[] {
  const now = new Date().getFullYear();
  const years = new Set<number>(dataYears);
  for (let y = now - 5; y <= now + 5; y += 1) years.add(y);
  for (const y of selected) if (y) years.add(y);
  return Array.from(years).sort((a, b) => b - a);
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const DURATION_UNITS = ['days', 'months', 'years'] as const;
export const DURATION_NUMBERS = Array.from({ length: 31 }, (_, i) => i + 1);

/** The job duration as a table cell shows it: "Full time", or "6 months" with "Extendable" / "Not extendable" under it. Null when none is set. */
export function durationParts(r: Pick<Requirement, 'duration_type' | 'duration_value' | 'duration_unit' | 'duration_extendable'>): { main: string; note: string | null } | null {
  if (r.duration_type === 'full_time') return { main: 'Full time', note: null };
  if (r.duration_type === 'fixed' && r.duration_value && r.duration_unit) {
    const unit = r.duration_value === 1 ? r.duration_unit.replace(/s$/, '') : r.duration_unit;
    return { main: `${r.duration_value} ${unit}`, note: r.duration_extendable ? 'Extendable' : 'Not extendable' };
  }
  return null;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Choose the recruiters of a requirement: tick as many as work on it. The first one ticked is the lead, who is credited when it is closed.
 * In a table cell pass `onCommit`: the choice is saved once, when the list is closed. In a form pass `onChange` and `inline`: it updates at
 * every tick and the list opens inside the form (a list opened over a dialog would count as a click outside it).
 */
export function RecruitersSelect({ value, options, onChange, onCommit, inline, disabled, className, placeholder = 'Unassigned' }: {
  value: string[];
  options: Array<{ id: string; username: string }>;
  onChange?: (ids: string[]) => void;
  onCommit?: (ids: string[]) => void;
  inline?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 224, maxHeight: 320 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const chosen = onCommit ? draft : value;
  const nameOf = (id: string) => options.find((o) => o.id === id)?.username ?? 'Former user';
  const names = chosen.map(nameOf);
  const MAX = 10;

  useEffect(() => { if (!open) setDraft(value); }, [value, open]);

  const finish = (save: boolean) => {
    setOpen(false);
    if (onCommit && save && !sameIds(draftRef.current, value)) onCommit(draftRef.current);
    else setDraft(value);
  };

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !button.current?.contains(t)) finish(true);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false); };
    const away = (e: Event) => { if (!panel.current?.contains(e.target as Node)) finish(true); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  const toggle = () => {
    if (disabled) return;
    if (!open && button.current && !inline) {
      const r = button.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 240)), width: Math.max(r.width, 224), maxHeight: Math.max(160, Math.min(340, window.innerHeight - r.bottom - 16)) });
    }
    if (open) finish(true); else setOpen(true);
  };

  const tick = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.length >= MAX ? chosen : [...chosen, id];
    if (onCommit) setDraft(next); else onChange?.(next);
  };

  const list = (
    <div
      ref={panel}
      role="listbox"
      aria-label="Recruiters"
      aria-multiselectable
      style={inline ? undefined : { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
      className={cn('overflow-y-auto rounded-xl border border-slate-200 bg-paper p-1.5 shadow-pop', inline ? 'absolute left-0 top-full z-20 mt-1 max-h-72 w-full min-w-[14rem]' : 'fixed z-[80]')}
    >
      {options.length === 0 ? (
        <p className="px-2 py-3 text-xs text-slate-500">No recruiters to assign yet.</p>
      ) : options.map((o) => {
        const index = chosen.indexOf(o.id);
        return (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
            <input type="checkbox" checked={index >= 0} onChange={() => tick(o.id)} className="h-4 w-4 rounded accent-navy-600" />
            <span className="min-w-0 flex-1 truncate">{o.username}</span>
            {index === 0 && <span className="rounded bg-navy-50 px-1.5 py-0.5 text-2xs font-semibold text-navy-800">Lead</span>}
          </label>
        );
      })}
      <p className="px-2 pb-1 pt-1.5 text-2xs leading-snug text-slate-400">The first recruiter ticked is the lead, credited when the requirement is closed.</p>
      {(onCommit || inline) && (
        <div className="flex justify-end px-1 pb-0.5 pt-1">
          <button type="button" onClick={() => finish(true)} className="rounded-md bg-navy-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy-800">Done</button>
        </div>
      )}
    </div>
  );

  return (
    <div className={inline ? 'relative' : undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Recruiters"
        disabled={disabled}
        onClick={toggle}
        title={names.join(', ') || undefined}
        className={cn('flex h-8 w-full min-w-[7rem] items-center justify-between gap-1.5 rounded-md border border-slate-200 bg-paper px-2 text-left text-xs shadow-sm transition-colors hover:border-navy-300 focus:outline-none focus-visible:border-navy-500 focus-visible:shadow-glow disabled:opacity-50', className)}
      >
        <span className={cn('truncate', names.length === 0 && 'text-slate-500')}>{names.length ? names.join(', ') : placeholder}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (inline ? list : createPortal(list, document.body))}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-11-02 -> 02 Nov 2026 (read from the text, so no time zone can move the day). */
export function formatDay(iso?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : '';
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate().toString().padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * A comment in a table cell. Click it to edit in place: Ctrl+Enter or the tick saves, Escape or the cross cancels.
 * When the person cannot edit it, it is plain text.
 */
export function CommentCell({ value, onSave, editable, label, width = 'w-28' }: {
  value: string | null;
  onSave: (next: string | null) => Promise<boolean>;
  editable: boolean;
  label: string;
  width?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value ?? ''); }, [value, editing]);
  useEffect(() => { if (editing) { box.current?.focus(); box.current?.setSelectionRange(draft.length, draft.length); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const next = draft.trim() || null;
    if (next === (value ?? null)) { setEditing(false); return; }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div className={cn('space-y-1.5', width)}>
        <textarea
          ref={box}
          value={draft}
          maxLength={4000}
          rows={3}
          aria-label={label}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
          }}
          className="field-input w-full resize-y py-1.5 text-xs leading-relaxed"
        />
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => setEditing(false)} disabled={saving} aria-label="Cancel" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><X className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => void save()} disabled={saving} aria-label="Save" className="rounded-md bg-navy-900 p-1 text-white hover:bg-navy-800">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 !text-white" />}
          </button>
        </div>
      </div>
    );
  }

  if (!editable) {
    return value ? <p className={cn('line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-700', width)} title={value}>{value}</p> : <span className="text-xs text-slate-300">-</span>;
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={`Edit ${label.toLowerCase()}`}
      className={cn('group/c -mx-1.5 flex items-start gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-slate-100', width)}
    >
      {value ? (
        <span className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-700" title={value}>{value}</span>
      ) : (
        <span className="text-xs text-slate-400">Add a comment</span>
      )}
      <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-slate-300 opacity-0 transition-opacity group-hover/c:opacity-100" />
    </button>
  );
}

/** A date shown as text, or (when the person may change it) a small date field that saves as soon as a day is picked. */
export function InlineDate({ value, onSave, editable, label, min }: { value: string | null; onSave: (next: string | null) => Promise<boolean>; editable: boolean; label: string; min?: string }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  if (!editable) return value ? <span className="whitespace-nowrap tabular-nums">{formatDay(value)}</span> : <span className="text-slate-300">-</span>;
  return (
    <input
      type="date"
      aria-label={label}
      value={draft}
      min={min}
      max="2100-12-31"
      onChange={async (e) => {
        const next = e.target.value;
        setDraft(next);
        if (next && next.length < 10) return;                       // a day still being typed
        if (!(await onSave(next || null))) setDraft(value ?? '');
      }}
      className="field-input h-8 w-[8.6rem] px-1.5 text-xs tabular-nums"
    />
  );
}

/** A whole number shown as text, or (when the person may change it) a small number field that saves when they leave it or press Enter. */
export function InlineCount({ value, onSave, editable, label, max = 100000 }: { value: number | null; onSave: (next: number | null) => Promise<boolean>; editable: boolean; label: string; max?: number }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  if (!editable) return value == null ? <span className="text-slate-300">-</span> : <span className="tabular-nums">{value.toLocaleString()}</span>;
  const revert = () => setDraft(value == null ? '' : String(value));
  const commit = async () => {
    const text = draft.trim();
    const next = text === '' ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > max)) { revert(); return; }
    if (next === (value ?? null)) return;
    if (!(await onSave(next))) revert();
  };
  return (
    <input
      type="number"
      min={0}
      max={max}
      step={1}
      inputMode="numeric"
      aria-label={label}
      value={draft}
      placeholder="0"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { revert(); e.currentTarget.blur(); } }}
      className="field-input h-8 w-[4.5rem] px-1.5 text-center text-xs tabular-nums"
    />
  );
}

export const FIELD_LABELS: Record<string, string> = {
  requirement_date: 'Requirement date',
  position: 'Position',
  client: 'Client',
  job_location: 'Job location',
  salary: 'Salary',
  duration: 'Job duration',
  location: 'Location',            // only in the history of a requirement that moved to the other team
  jd: 'Job description',
  sales_comments: 'Sales manager comments',
  rm_comments: 'Recruitment manager comments',
  recruiter_comments: 'Recruiter comments',
  cv_submission_date: 'Submission deadline date',
  cvs_submitted_date: 'CVs submitted on',
  cvs_submitted_count: 'CVs submitted',
  recruiter: 'Recruiters',
  recruitment_manager: 'Recruitment manager',
  sales_manager: 'Sales manager',
  status: 'Status',
  job_posted: 'Job posted in Careers',
};
