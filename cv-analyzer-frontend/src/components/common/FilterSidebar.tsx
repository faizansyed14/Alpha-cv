'use client';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterGroupDef {
  key: string;
  label: string;
  options: FilterOption[];
}

interface FilterSidebarProps {
  groups: FilterGroupDef[];
  /** group key -> selected option values */
  selected: Record<string, string[]>;
  onToggle: (groupKey: string, value: string) => void;
  onClearAll: () => void;
  className?: string;
}

/** Recruiter-portal style left filter panel: grouped checkboxes with counts,
 * each group collapsible, sticky under the page header. */
export default function FilterSidebar({ groups, selected, onToggle, onClearAll, className }: FilterSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeCount = Object.values(selected).reduce((sum, arr) => sum + (arr?.length || 0), 0);

  return (
    <aside className={`w-full shrink-0 sm:w-60 ${className || ''}`}>
      <div className="rounded-lg border border-slate-200 bg-white sm:sticky sm:top-4">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
          </h3>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-[12px] font-medium text-brand-600 hover:underline"
            >
              Clear all ({activeCount})
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {groups.map((group) => {
            const isCollapsed = collapsedGroups[group.key] ?? false;
            const selectedInGroup = selected[group.key] || [];
            return (
              <div key={group.key} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapse(group.key)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                    {group.label}
                    {selectedInGroup.length > 0 && (
                      <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                        {selectedInGroup.length}
                      </span>
                    )}
                  </span>
                  {isCollapsed ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                  )}
                </button>
                {!isCollapsed && (
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                    {group.options.length === 0 ? (
                      <p className="py-1 text-[12px] text-slate-400">No options</p>
                    ) : (
                      group.options.map((opt) => (
                        <label
                          key={opt.value}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-[13px] text-slate-700 hover:bg-slate-50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedInGroup.includes(opt.value)}
                              onChange={() => onToggle(group.key, opt.value)}
                              className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-2 focus:ring-brand-500/30"
                            />
                            <span className="truncate">{opt.label}</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-slate-400">{opt.count}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

/** Shared helper: build a FilterGroupDef from a list of items + an accessor,
 * counting occurrences and sorting by count desc. Buckets missing/blank
 * values under "Not specified" so nothing silently disappears from the list. */
export function buildFilterGroup<T>(
  key: string,
  label: string,
  items: T[],
  getValue: (item: T) => string | null | undefined
): FilterGroupDef {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = getValue(item);
    const value = raw && String(raw).trim() ? String(raw).trim() : 'Not specified';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const options = Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count);
  return { key, label, options };
}

/** Fixed-order variant for enum-like fields (e.g. notice period buckets) —
 * keeps the given order instead of sorting by count, and still folds
 * anything unrecognized into "Not specified". */
export function buildFixedFilterGroup<T>(
  key: string,
  label: string,
  items: T[],
  getValue: (item: T) => string | null | undefined,
  order: string[]
): FilterGroupDef {
  const counts = new Map<string, number>();
  for (const item of items) {
    const raw = getValue(item);
    const value = raw && String(raw).trim() ? String(raw).trim() : 'Not specified';
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const known = order.filter((v) => counts.has(v)).map((value) => ({ value, label: value, count: counts.get(value)! }));
  const rest = Array.from(counts.entries())
    .filter(([value]) => !order.includes(value))
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, label: value, count }));
  return { key, label, options: [...known, ...rest] };
}
