'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, Search, SlidersHorizontal, X } from '@/components/icons';

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

/** A named set of a group's values ticked together, e.g. "Any GCC National" in Nationality. */
export interface FilterSet {
  key: string;
  label: string;
  values: string[];
}

export interface FilterGroupDef {
  key: string;
  label: string;
  options: FilterOption[];
  /** Shown above the options; a set's own values that are not among `options` are listed with a count of 0. */
  sets?: FilterSet[];
  /** Starts folded unless set to false; the person can still toggle it. */
  defaultCollapsed?: boolean;
}

interface FilterSidebarProps {
  groups: FilterGroupDef[];
  /** group key -> selected option values */
  selected: Record<string, string[]>;
  onToggle: (groupKey: string, value: string) => void;
  /** Tick (or untick) several values of a group at once: a whole set. */
  onSetMany?: (groupKey: string, values: string[], on: boolean) => void;
  onClearAll: () => void;
  /** A block shown above the checkbox groups (the page's own controls, e.g. a date range). */
  top?: ReactNode;
  /** Filters active in `top`, counted in "Clear all". */
  extraActive?: number;
  className?: string;
}

const matches = (text: string, q: string) => text.toLowerCase().includes(q);

function Checkbox({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!mixed && !checked; }, [mixed, checked]);
  return (
    <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label}
      className="h-4 w-4 shrink-0 cursor-pointer rounded accent-navy-600" />
  );
}

function Count({ n }: { n: number }) {
  return <span className={`shrink-0 rounded px-1.5 text-2xs font-medium tabular-nums ${n ? 'bg-slate-100 text-slate-500' : 'text-slate-300'}`}>{n}</span>;
}

/** Recruiter-portal style left filter panel: grouped checkboxes with counts, each group collapsible and searchable, sticky under the
 * page header. A group may offer sets ("Any Arab National") that tick all their values at once and open to show them. */
export default function FilterSidebar({ groups, selected, onToggle, onSetMany, onClearAll, top, extraActive = 0, className }: FilterSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});

  const toggleGroupCollapse = (key: string) => setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleSetOpen = (key: string) => setOpenSets((prev) => ({ ...prev, [key]: !prev[key] }));

  const activeCount = Object.values(selected).reduce((sum, arr) => sum + (arr?.length || 0), 0) + extraActive;

  return (
    <aside className={`w-full shrink-0 sm:w-56 ${className || ''}`}>
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-paper shadow-card sm:sticky sm:top-12">
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <SlidersHorizontal className="h-4 w-4 text-navy-600" />
            Filters
          </h3>
          {activeCount > 0 && (
            <button type="button" onClick={onClearAll} className="text-xs font-semibold text-navy-600 hover:underline">
              Clear all ({activeCount})
            </button>
          )}
        </div>
        {top && <div className="border-b border-surface-border px-4 py-3">{top}</div>}
        <div className="divide-y divide-surface-border">
          {groups.map((group) => {
            const isCollapsed = collapsedGroups[group.key] ?? (group.defaultCollapsed ?? true);
            const selectedInGroup = selected[group.key] || [];
            const q = (queries[group.key] || '').trim().toLowerCase();
            const countOf = new Map(group.options.map((o) => [o.value, o.count]));
            const labelOf = new Map(group.options.map((o) => [o.value, o.label]));

            // while searching: a set shows when its name or one of its values matches (opened on the matching values)
            const sets = (group.sets || []).map((set) => {
              const own = matches(set.label, q);
              const values = !q || own ? set.values : set.values.filter((v) => matches(labelOf.get(v) ?? v, q));
              return { set, values, show: !q || own || values.length > 0, forcedOpen: !!q && !own && values.length > 0 };
            }).filter((s) => s.show);
            const options = q ? group.options.filter((o) => matches(o.label, q)) : group.options;
            const searchable = group.options.length > 0 || (group.sets?.length ?? 0) > 0;
            const nothing = sets.length === 0 && options.length === 0;

            return (
              <div key={group.key} className="px-4 py-3">
                <button type="button" onClick={() => toggleGroupCollapse(group.key)} className="flex w-full items-center justify-between text-left">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                    {group.label}
                    {selectedInGroup.length > 0 && (
                      <span className="rounded-full bg-solid-soft px-1.5 py-0.5 text-[10px] font-semibold text-white">{selectedInGroup.length}</span>
                    )}
                  </span>
                  {isCollapsed ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />}
                </button>
                {!isCollapsed && (
                  <>
                    {searchable && (
                      <div className="relative mt-2">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                        <input
                          type="search"
                          value={queries[group.key] || ''}
                          onChange={(e) => setQueries((prev) => ({ ...prev, [group.key]: e.target.value }))}
                          placeholder={`Search ${group.label.toLowerCase()}`}
                          aria-label={`Search ${group.label}`}
                          className="h-7 w-full rounded-md border border-surface-border bg-white pl-7 pr-6 text-xs text-slate-700 placeholder:text-slate-400 focus:border-navy-300 focus:outline-none focus:ring-2 focus:ring-navy-500/15 [&::-webkit-search-cancel-button]:hidden"
                        />
                        {q && (
                          <button type="button" onClick={() => setQueries((prev) => ({ ...prev, [group.key]: '' }))} aria-label="Clear search"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-1">
                      {nothing ? (
                        <p className="py-1 text-xs text-slate-400">{q ? 'No match' : 'No options'}</p>
                      ) : (
                        <>
                          {sets.map(({ set, values, forcedOpen }) => {
                            const ticked = set.values.filter((v) => selectedInGroup.includes(v)).length;
                            const all = ticked === set.values.length;
                            const total = set.values.reduce((n, v) => n + (countOf.get(v) ?? 0), 0);
                            const open = forcedOpen || !!openSets[`${group.key}:${set.key}`];
                            return (
                              <div key={set.key} className={open ? 'rounded-md bg-navy-50/40 pb-1' : undefined}>
                                <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50">
                                  <Checkbox checked={all} mixed={ticked > 0} label={set.label}
                                    onChange={() => onSetMany?.(group.key, set.values, !all)} />
                                  <button type="button" onClick={() => toggleSetOpen(`${group.key}:${set.key}`)} aria-expanded={open}
                                    className="flex min-w-0 flex-1 items-center justify-between gap-1 text-left">
                                    <span className="truncate font-medium text-slate-800">{set.label}</span>
                                    <span className="flex shrink-0 items-center gap-1">
                                      <Count n={total} />
                                      <ChevronRight className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                                    </span>
                                  </button>
                                </div>
                                {open && (
                                  <div className="ml-3.5 border-l border-navy-100 pl-2">
                                    {values.map((v) => (
                                      <label key={v} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-[13px] text-slate-700 hover:bg-white">
                                        <span className="flex min-w-0 items-center gap-2">
                                          <Checkbox checked={selectedInGroup.includes(v)} label={labelOf.get(v) ?? v} onChange={() => onToggle(group.key, v)} />
                                          <span className="truncate">{labelOf.get(v) ?? v}</span>
                                        </span>
                                        <Count n={countOf.get(v) ?? 0} />
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {sets.length > 0 && options.length > 0 && <div className="mx-1.5 my-1.5 border-t border-dashed border-surface-border" />}
                          {options.map((opt) => (
                            <label key={opt.value} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50">
                              <span className="flex min-w-0 items-center gap-2">
                                <Checkbox checked={selectedInGroup.includes(opt.value)} label={opt.label} onChange={() => onToggle(group.key, opt.value)} />
                                <span className="truncate">{opt.label}</span>
                              </span>
                              <Count n={opt.count} />
                            </label>
                          ))}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** A min / max pair of boxes for the top of the panel (expected salary, years of experience). */
export function RangeFilter({ id, label, unit, value, onChange, decimals = false, note }: {
  id: string;
  label: string;
  unit: string;
  value: { min: string; max: string };
  onChange: (next: { min: string; max: string }) => void;
  /** Allow a decimal point (2.5 years). */
  decimals?: boolean;
  /** A line under the boxes, e.g. what the filter leaves out. */
  note?: string | null;
}) {
  const clean = (v: string) => (decimals ? v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : v.replace(/[^\d,]/g, ''));
  const box = 'field-input w-full min-w-0 tabular-nums';
  return (
    <div>
      <span className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={`${id}-min`} className="text-sm font-semibold text-slate-800">{label}</label>
        <span className="text-2xs text-slate-500">{unit}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <input id={`${id}-min`} type="text" inputMode={decimals ? 'decimal' : 'numeric'} placeholder="Min" value={value.min}
          aria-label={`Minimum ${label.toLowerCase()} (${unit})`} onChange={(e) => onChange({ ...value, min: clean(e.target.value) })} className={box} />
        <span className="text-xs text-slate-400" aria-hidden>–</span>
        <input type="text" inputMode={decimals ? 'decimal' : 'numeric'} placeholder="Max" value={value.max}
          aria-label={`Maximum ${label.toLowerCase()} (${unit})`} onChange={(e) => onChange({ ...value, max: clean(e.target.value) })} className={box} />
      </div>
      {note && <p className="mt-1.5 text-2xs leading-snug text-slate-500">{note}</p>}
    </div>
  );
}
